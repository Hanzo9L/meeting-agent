import { performance } from "node:perf_hooks";
import { getSourceById, type SourceDomain } from "../knowledgeV2";
import type { FusedRetrievalCandidate, HybridRetrievalResult } from "../retrievalV2";
import { classifyAnswerability } from "./answerabilityPolicy";
import {
  canBindPerUserEvidence,
  deriveEvidenceAspects,
  evaluateCandidateAspectSupport,
  hasCmdletAuthority,
  loadCandidateEvidenceMetadata,
  type CandidateAspectEvaluation,
  type CandidateEvidenceMetadata
} from "./evidenceAspectPolicy";
import {
  areConceptsRedundant,
  computeConceptSignature,
  isBroadSelectionAspect,
  BROAD_ASPECT_CONCEPT_CAP,
  type ConceptSignature
} from "./evidenceConceptDistinctness";
import {
  bindEvidenceBundleSnapshot,
  type EvidenceBundleDecisionState
} from "./groundingDecisionSnapshot";
import { aspectMethodConstraintsSatisfiedByDirectEvidence } from "./methodConstraintPolicy";
import type {
  BuildEvidenceBundleResult,
  EvidenceAspect,
  EvidenceAspectCoverage,
  EvidenceAspectSupport,
  EvidenceAspectSupportStrength,
  EvidenceBundle,
  EvidenceConflict,
  EvidenceItem,
  EvidenceRejectionReason,
  EvidenceSupportFacet,
  RejectedEvidenceCandidate
} from "./types";

const EVIDENCE_POLICY = {
  maxEvidenceItems: 8
} as const;

export interface BuildEvidenceBundleOptions {
  databasePath?: string;
  /** Optional resolver-local metadata override (tests / inspect). */
  metadataByChunkId?: Map<string, CandidateEvidenceMetadata>;
}

function sourceDomainFromSourceId(sourceId: string): SourceDomain | "unknown" {
  if (sourceId === "ms-teams-admin") return "teams_admin";
  if (sourceId === "ms-teams-powershell") return "teams_powershell";
  if (sourceId === "ms-graph-docs") return "graph";
  if (sourceId === "ms-entra-docs") return "entra";
  if (sourceId === "ms-m365-docs") return "m365";
  if (sourceId === "ms-teams-dev-docs") return "teams_dev";
  if (sourceId === "ms-sharepoint-docs" || sourceId === "ms-sharepoint-powershell") {
    return "sharepoint";
  }
  if (sourceId === "ms-powershell-core") return "powershell_core";
  return "unknown";
}

function canonicalFromSourcePath(sourceId: string, sourcePath: string): string {
  const path = sourcePath.replace(/\\/g, "/").replace(/^\//, "").replace(/\.md$/i, "");
  if (!path) return "";
  if (sourceId === "ms-teams-admin") {
    const leaf = path.split("/").pop() ?? path;
    return `https://learn.microsoft.com/en-us/microsoftteams/${leaf}`;
  }
  if (sourceId === "ms-teams-powershell") {
    const leaf = path.split("/").pop() ?? path;
    return `https://learn.microsoft.com/powershell/module/microsoftteams/${leaf}`;
  }
  return "";
}

function toEvidenceItem(
  candidate: FusedRetrievalCandidate,
  supportedAspects: EvidenceAspect[],
  strength: EvidenceAspectSupportStrength,
  conceptSelectionNote?: string
): EvidenceItem {
  const revisionCanonicalUrl =
    typeof candidate.provenance.sourceRevision["canonicalUrl"] === "string"
      ? String(candidate.provenance.sourceRevision["canonicalUrl"])
      : typeof candidate.provenance.sourceRevision["canonical_url"] === "string"
        ? String(candidate.provenance.sourceRevision["canonical_url"])
        : "";
  const canonicalUrl =
    candidate.provenance.canonicalUrl ||
    revisionCanonicalUrl ||
    canonicalFromSourcePath(candidate.authority.sourceId, candidate.provenance.sourcePath);
  return {
    evidenceId: `evidence:${candidate.chunkId}`,
    chunkId: candidate.chunkId,
    documentId: candidate.documentId,
    source: {
      sourceId: candidate.authority.sourceId,
      trackId: candidate.authority.trackId,
      sourceStatus: candidate.authority.sourceStatus,
      sourceDomain: sourceDomainFromSourceId(candidate.authority.sourceId),
      authorityTier: candidate.authority.authorityTier,
      authorityRoles: [...candidate.authority.authorityRoles],
      routePriority: candidate.authority.routePriority,
      title: candidate.title,
      canonicalUrl,
      sourcePath: candidate.provenance.sourcePath,
      sourceRevision: candidate.provenance.sourceRevision
    },
    location: {
      sectionId: candidate.sectionId,
      headingPath: [...candidate.headingPath]
    },
    text: candidate.text,
    supportTypes: [
      ...new Set(supportedAspects.map((aspect) => aspect.supportType))
    ],
    retrieval: {
      methods: [...candidate.methods],
      fusionRank: candidate.fusion.rank,
      fusionScore: candidate.fusion.score,
      methodSignals: candidate.methodSignals,
      exactMatch: candidate.exactMatch ?? null,
      retrievalReasons: [...candidate.retrievalReasons]
    },
    selectionReason: `selected:aspect:${supportedAspects
      .map((aspect) => aspect.aspectId)
      .sort()
      .join(",")}:${strength}${conceptSelectionNote ? `:${conceptSelectionNote}` : ""}`
  };
}

function detectConflicts(
  evidence: EvidenceItem[],
  aspectCoverage: EvidenceAspectCoverage
): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  const byId = new Map(evidence.map((item) => [item.evidenceId, item]));
  const mandatoryAspectIds = new Set(
    aspectCoverage.aspects
      .filter((aspect) => aspect.requirement === "mandatory")
      .map((aspect) => aspect.aspectId)
  );
  for (const [aspectId, evidenceIds] of Object.entries(
    aspectCoverage.evidenceByAspect
  )) {
    if (!mandatoryAspectIds.has(aspectId) || evidenceIds.length < 2) continue;
    const items = evidenceIds
      .map((evidenceId) => byId.get(evidenceId))
      .filter((item): item is EvidenceItem => Boolean(item));
    const negative = items.find((item) =>
      /\b(deprecated|no longer supported|not supported)\b/i.test(item.text)
    );
    const positive = items.find((item) =>
      /\b(is|remains|currently)\s+supported\b/i.test(item.text)
    );
    if (negative && positive && negative.evidenceId !== positive.evidenceId) {
      conflicts.push({
        conflictId: `conflict:${aspectId}:support-status`,
        conflictType: "contradiction",
        topic: aspectId,
        evidenceIds: [negative.evidenceId, positive.evidenceId],
        notes:
          "authoritative evidence directly supporting the same required aspect has incompatible support-status assertions"
      });
    }
  }
  return conflicts;
}

function computeFreshnessState(result: HybridRetrievalResult): EvidenceBundle["freshness"] {
  if (result.scope.freshnessVerification.required) {
    return {
      state: "verification_required",
      requiresVerification: true,
      reasons: [...result.scope.freshnessVerification.reasons]
    };
  }
  const staleWarning = result.warnings.find((warning) => /stale|freshness/i.test(warning));
  if (staleWarning) {
    return {
      state: "possibly_stale",
      requiresVerification: false,
      reasons: [staleWarning]
    };
  }
  return {
    state: "unknown",
    requiresVerification: false,
    reasons: []
  };
}

function computeExactIdentifierValidation(
  result: HybridRetrievalResult,
  selected: EvidenceItem[]
): EvidenceBundle["exactIdentifierValidation"] {
  const requiredDirectives = result.scope.exactMatchDirectives.filter((directive) => directive.required);
  const missing: Array<{ type: "cmdlet" | "policy" | "entity"; value: string }> = [];
  for (const directive of requiredDirectives) {
    const normalizeIdentifier = (value: string): string =>
      value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const pathLeaf = (value: string): string =>
      value
        .split(/[?#]/, 1)[0]
        ?.replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/\.md$/i, "") ?? "";
    const expected = normalizeIdentifier(directive.value);
    const selectedMatch = selected.some((item) => {
      const identityMatches = [
        item.source.title,
        pathLeaf(item.source.sourcePath),
        pathLeaf(item.source.canonicalUrl)
      ].some((value) => normalizeIdentifier(value) === expected);
      if (!identityMatches) return false;
      if (directive.type !== "cmdlet") return true;
      // Cmdlet-identity verification must accept authority from any
      // genuine PowerShell cmdlet-reference domain (Teams, SharePoint,
      // etc.), not assume every cmdlet belongs to Teams PowerShell.
      return hasCmdletAuthority({ authorityRoles: item.source.authorityRoles });
    });
    if (!selectedMatch) {
      missing.push({ type: directive.type, value: directive.value });
    }
  }
  return {
    required: requiredDirectives.length > 0,
    verified: requiredDirectives.length === 0 || missing.length === 0,
    requiredDirectives: requiredDirectives.map((directive) => ({
      type: directive.type,
      value: directive.value
    })),
    missingRequiredDirectives: missing
  };
}

function facetsCovered(
  aspect: EvidenceAspect,
  selectedSupports: EvidenceAspectSupport[],
  candidateById: Map<string, FusedRetrievalCandidate>
): boolean {
  const matched = new Set<EvidenceSupportFacet>();
  for (const support of selectedSupports) {
    if (support.strength !== "direct") continue;
    for (const facet of support.matchedFacets) matched.add(facet);
  }
  if (!aspect.requiredFacets.every((facet) => matched.has(facet))) {
    return false;
  }
  if (
    !aspect.requiredFacets.includes("user_target") ||
    !aspect.requiredFacets.includes("returned_value")
  ) {
    return true;
  }
  const direct = selectedSupports.filter(
    (support) => support.strength === "direct"
  );
  const targets = direct.filter((support) =>
    support.matchedFacets.includes("user_target")
  );
  const values = direct.filter((support) =>
    support.matchedFacets.includes("returned_value")
  );
  return targets.some((targetSupport) => {
    const target = candidateById.get(targetSupport.candidateId);
    if (!target) return false;
    return values.some((valueSupport) => {
      const value = candidateById.get(valueSupport.candidateId);
      return Boolean(
        value &&
          canBindPerUserEvidence(
            {
              candidateId: target.candidateId,
              documentId: target.documentId,
              sectionId: target.sectionId,
              title: target.title
            },
            {
              candidateId: value.candidateId,
              documentId: value.documentId,
              sectionId: value.sectionId,
              title: value.title
            }
          )
      );
    });
  });
}

export function buildEvidenceBundle(
  result: HybridRetrievalResult,
  options: BuildEvidenceBundleOptions = {}
): BuildEvidenceBundleResult {
  const started = performance.now();
  const selectionStarted = performance.now();
  const aspects = deriveEvidenceAspects(result);
  const mandatoryAspects = aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  const optionalAspects = aspects.filter(
    (aspect) => aspect.requirement === "optional"
  );
  const candidateById = new Map(
    result.candidates.map((candidate) => [candidate.candidateId, candidate])
  );
  const metadataByChunkId =
    options.metadataByChunkId ??
    loadCandidateEvidenceMetadata({
      databasePath: options.databasePath,
      chunkIds: result.candidates.map((candidate) => candidate.chunkId)
    });

  const evaluations = new Map<string, Map<string, CandidateAspectEvaluation>>();
  const supportByAspect: Record<string, EvidenceAspectSupport[]> = {};
  for (const aspect of aspects) {
    supportByAspect[aspect.aspectId] = [];
  }
  for (const candidate of result.candidates) {
    const byAspect = new Map<string, CandidateAspectEvaluation>();
    for (const aspect of aspects) {
      const support = evaluateCandidateAspectSupport(
        result,
        candidate,
        aspect,
        { metadataByChunkId }
      );
      const evaluation: CandidateAspectEvaluation = {
        aspectId: aspect.aspectId,
        topical: support.topical,
        direct: support.strength === "direct",
        authoritative: support.authoritySatisfied,
        canonicalIdentityVerified: support.canonicalIdentityVerified,
        qualityScore: support.qualityScore,
        support
      };
      byAspect.set(aspect.aspectId, evaluation);
      supportByAspect[aspect.aspectId]?.push(support);
    }
    evaluations.set(candidate.candidateId, byAspect);
  }
  for (const aspectId of Object.keys(supportByAspect)) {
    supportByAspect[aspectId] = [...(supportByAspect[aspectId] ?? [])].sort(
      (left, right) => {
        if (left.qualityScore !== right.qualityScore) {
          return right.qualityScore - left.qualityScore;
        }
        return left.candidateId.localeCompare(right.candidateId);
      }
    );
  }

  const selectedCandidates = new Map<
    string,
    {
      candidate: FusedRetrievalCandidate;
      aspectIds: Set<string>;
      strength: EvidenceAspectSupportStrength;
    }
  >();
  const selectedSupportsByAspect = new Map<string, EvidenceAspectSupport[]>();
  const authorityLimitedAspectIds = new Set<string>();
  const supportingOnlyAspectIds = new Set<string>();
  const contextualOnlyAspectIds = new Set<string>();
  const maxEvidenceItems = Math.max(
    EVIDENCE_POLICY.maxEvidenceItems,
    mandatoryAspects.length
  );
  /** Per-candidate overrides for the final rejection-reason pass, populated by
   * the broad-aspect concept-distinctness selection loop below. */
  const conceptDecisionOverrides = new Map<string, EvidenceRejectionReason>();
  /** Per-candidate "why selected" note for broad-aspect diagnostics. */
  const conceptSelectionNotes = new Map<string, string>();

  const eligibleDirectForAspect = (
    aspect: EvidenceAspect
  ): Array<{ candidate: FusedRetrievalCandidate; support: EvidenceAspectSupport }> => {
    const rows: Array<{
      candidate: FusedRetrievalCandidate;
      support: EvidenceAspectSupport;
    }> = [];
    for (const candidate of result.candidates) {
      const support = evaluations
        .get(candidate.candidateId)
        ?.get(aspect.aspectId)?.support;
      const perUserPairComponent =
        aspect.requiredFacets.includes("user_target") &&
        aspect.requiredFacets.includes("returned_value") &&
        support?.authoritySatisfied &&
        support.matchedFacets.some(
          (facet) =>
            facet === "user_target" || facet === "returned_value"
        );
      if (
        !support ||
        (support.strength !== "direct" && !perUserPairComponent)
      ) {
        continue;
      }
      const betaLike =
        candidate.authority.sourceStatus === "beta" ||
        candidate.authority.sourceStatus === "preview";
      if (betaLike && !result.intent.allowsBetaSources) continue;
      rows.push({ candidate, support });
    }
    const hasBoundComplement = (row: (typeof rows)[number]): boolean => {
      const needsTarget = !row.support.matchedFacets.includes("user_target");
      const needsValue = !row.support.matchedFacets.includes("returned_value");
      if (!needsTarget && !needsValue) return true;
      return rows.some((other) => {
        if (other.candidate.candidateId === row.candidate.candidateId) {
          return false;
        }
        const suppliesMissing =
          (!needsTarget ||
            other.support.matchedFacets.includes("user_target")) &&
          (!needsValue ||
            other.support.matchedFacets.includes("returned_value"));
        return (
          suppliesMissing &&
          canBindPerUserEvidence(
            {
              candidateId: row.candidate.candidateId,
              documentId: row.candidate.documentId,
              sectionId: row.candidate.sectionId,
              title: row.candidate.title
            },
            {
              candidateId: other.candidate.candidateId,
              documentId: other.candidate.documentId,
              sectionId: other.candidate.sectionId,
              title: other.candidate.title
            }
          )
        );
      });
    };
    return rows.sort((left, right) => {
      const leftComplete = left.support.strength === "direct";
      const rightComplete = right.support.strength === "direct";
      if (leftComplete !== rightComplete) return leftComplete ? -1 : 1;
      const leftBindable = hasBoundComplement(left);
      const rightBindable = hasBoundComplement(right);
      if (leftBindable !== rightBindable) return leftBindable ? -1 : 1;
      if (left.support.qualityScore !== right.support.qualityScore) {
        return right.support.qualityScore - left.support.qualityScore;
      }
      return left.candidate.fusion.rank - right.candidate.fusion.rank;
    });
  };

  const selectForAspect = (
    candidate: FusedRetrievalCandidate,
    aspect: EvidenceAspect,
    support: EvidenceAspectSupport
  ): void => {
    const selectedSupport: EvidenceAspectSupport =
      support.strength !== "direct" &&
      aspect.requiredFacets.includes("user_target") &&
      aspect.requiredFacets.includes("returned_value") &&
      support.authoritySatisfied &&
      support.matchedFacets.some(
        (facet) =>
          facet === "user_target" || facet === "returned_value"
      )
        ? {
            ...support,
            strength: "direct",
            reasonCodes: [
              ...support.reasonCodes,
              "bounded_per_user_pair_component"
            ]
          }
        : support;
    const existing = selectedCandidates.get(candidate.candidateId);
    if (existing) {
      existing.aspectIds.add(aspect.aspectId);
      if (selectedSupport.strength === "direct") {
        existing.strength = "direct";
      }
    } else {
      selectedCandidates.set(candidate.candidateId, {
        candidate,
        aspectIds: new Set([aspect.aspectId]),
        strength: selectedSupport.strength
      });
    }
    const list = selectedSupportsByAspect.get(aspect.aspectId) ?? [];
    list.push(selectedSupport);
    selectedSupportsByAspect.set(aspect.aspectId, list);
  };

  for (const aspect of mandatoryAspects) {
    const supports = supportByAspect[aspect.aspectId] ?? [];
    const hasDirect = supports.some((support) => support.strength === "direct");
    const hasSupporting = supports.some(
      (support) => support.strength === "supporting"
    );
    const hasContextual = supports.some(
      (support) => support.strength === "contextual" && support.topical
    );
    if (
      supports.some(
        (support) => support.topical && !support.authoritySatisfied
      )
    ) {
      authorityLimitedAspectIds.add(aspect.aspectId);
    }
    if (!hasDirect && hasSupporting) {
      supportingOnlyAspectIds.add(aspect.aspectId);
    } else if (!hasDirect && !hasSupporting && hasContextual) {
      contextualOnlyAspectIds.add(aspect.aspectId);
    }

    const eligible = eligibleDirectForAspect(aspect);
    const broadSelection = isBroadSelectionAspect(aspect);
    if (!broadSelection) {
      // Narrow/bounded aspects preserve the original minimal-selection
      // behavior: stop as soon as the aspect's required facets are covered.
      for (const row of eligible) {
        if (
          !selectedCandidates.has(row.candidate.candidateId) &&
          selectedCandidates.size >= maxEvidenceItems
        ) {
          continue;
        }
        selectForAspect(row.candidate, aspect, row.support);
        if (
          facetsCovered(
            aspect,
            selectedSupportsByAspect.get(aspect.aspectId) ?? [],
            candidateById
          )
        ) {
          break;
        }
      }
    } else {
      // Broad aspects: keep inspecting authoritative direct candidates beyond
      // the first, but only accept one when it contributes a materially
      // distinct concept (not merely a higher-ranked restatement), and stop
      // at a small bounded maximum. Every accepted candidate already
      // satisfies the same direct+authoritative requirements as narrow
      // aspects (via eligibleDirectForAspect) — breadth never relaxes
      // authority or promotes supporting/contextual evidence.
      const acceptedConcepts: ConceptSignature[] = [];
      for (const row of eligible) {
        if (acceptedConcepts.length >= BROAD_ASPECT_CONCEPT_CAP) {
          if (!selectedCandidates.has(row.candidate.candidateId)) {
            conceptDecisionOverrides.set(row.candidate.candidateId, "bounded_selection_limit");
          }
          continue;
        }
        if (
          !selectedCandidates.has(row.candidate.candidateId) &&
          selectedCandidates.size >= maxEvidenceItems
        ) {
          continue;
        }
        const signature = computeConceptSignature(row.candidate, aspect);
        if (acceptedConcepts.length > 0 && areConceptsRedundant(signature, acceptedConcepts)) {
          conceptDecisionOverrides.set(row.candidate.candidateId, "redundant_same_concept");
          continue;
        }
        selectForAspect(row.candidate, aspect, row.support);
        conceptSelectionNotes.set(
          row.candidate.candidateId,
          acceptedConcepts.length === 0 ? "primary_direct_selected" : "distinct_concept_selected"
        );
        acceptedConcepts.push(signature);
      }
    }

    const selectedForAspect = selectedSupportsByAspect.get(aspect.aspectId) ?? [];
    if (selectedForAspect.length === 0) continue;
    const primary = eligible[0]?.candidate;
    if (!primary) continue;
    const primaryNegative =
      /\b(deprecated|no longer supported|not supported)\b/i.test(primary.text);
    const primaryPositive =
      /\b(is|remains|currently)\s+supported\b/i.test(primary.text);
    const incompatible = eligible.slice(1).find(({ candidate }) => {
      const negative =
        /\b(deprecated|no longer supported|not supported)\b/i.test(
          candidate.text
        );
      const positive =
        /\b(is|remains|currently)\s+supported\b/i.test(candidate.text);
      return (
        (primaryNegative && positive) || (primaryPositive && negative)
      );
    });
    if (incompatible) {
      selectForAspect(
        incompatible.candidate,
        aspect,
        incompatible.support
      );
    }
  }

  if (selectedCandidates.size > 0) {
    for (const aspect of optionalAspects) {
      const primary = eligibleDirectForAspect(aspect).find(({ candidate }) =>
        selectedCandidates.has(candidate.candidateId)
      );
      if (!primary) continue;
      selectForAspect(primary.candidate, aspect, primary.support);
    }
  }

  const selected = [...selectedCandidates.values()]
    .sort(
      (left, right) =>
        left.candidate.fusion.rank - right.candidate.fusion.rank
    )
    .map(({ candidate, aspectIds, strength }) =>
      toEvidenceItem(
        candidate,
        aspects.filter((aspect) => aspectIds.has(aspect.aspectId)),
        strength,
        conceptSelectionNotes.get(candidate.candidateId)
      )
    );
  const evidenceIdByCandidateId = new Map(
    [...selectedCandidates.values()].map(({ candidate }) => [
      candidate.candidateId,
      `evidence:${candidate.chunkId}`
    ])
  );
  const evidenceByAspect: Record<string, string[]> = {};
  for (const aspect of aspects) {
    evidenceByAspect[aspect.aspectId] = [
      ...selectedCandidates.values()
    ]
      .filter(({ aspectIds }) => aspectIds.has(aspect.aspectId))
      .map(({ candidate }) => evidenceIdByCandidateId.get(candidate.candidateId))
      .filter((evidenceId): evidenceId is string => Boolean(evidenceId));
  }

  const selectedEvidenceById = new Map(
    selected.map((item) => [item.evidenceId, item])
  );
  const factuallySupportedMandatoryAspects = mandatoryAspects.filter(
    (aspect) =>
      facetsCovered(
        aspect,
        selectedSupportsByAspect.get(aspect.aspectId) ?? [],
        candidateById
      )
  );
  const methodLimitedAspectIds = factuallySupportedMandatoryAspects
    .filter((aspect) => {
      const evidenceWithSupport = (
        selectedSupportsByAspect.get(aspect.aspectId) ?? []
      )
        .map((support) => ({
          support,
          item: selectedEvidenceById.get(
            evidenceIdByCandidateId.get(support.candidateId) ?? ""
          )
        }))
        .filter(
          (
            entry
          ): entry is {
            support: EvidenceAspectSupport;
            item: EvidenceItem;
          } => Boolean(entry.item)
        )
        .map(({ support, item }) => ({
          item,
          strength: support.strength
        }));
      return !aspectMethodConstraintsSatisfiedByDirectEvidence(
        aspect,
        evidenceWithSupport
      );
    })
    .map((aspect) => aspect.aspectId);
  const methodLimited = new Set(methodLimitedAspectIds);
  const supportedMandatoryAspectIds =
    factuallySupportedMandatoryAspects
      .filter((aspect) => !methodLimited.has(aspect.aspectId))
      .map((aspect) => aspect.aspectId);
  const unsupportedMandatoryAspectIds = mandatoryAspects
    .filter((aspect) => !supportedMandatoryAspectIds.includes(aspect.aspectId))
    .map((aspect) => aspect.aspectId);
  const supportedOptionalAspectIds = optionalAspects
    .filter((aspect) =>
      facetsCovered(
        aspect,
        selectedSupportsByAspect.get(aspect.aspectId) ?? [],
        candidateById
      )
    )
    .map((aspect) => aspect.aspectId);

  const aspectCoverage: EvidenceAspectCoverage = {
    aspects,
    evidenceByAspect,
    supportByAspect,
    supportedMandatoryAspectIds,
    unsupportedMandatoryAspectIds,
    methodLimitedAspectIds: [...methodLimitedAspectIds].sort(),
    authorityLimitedAspectIds: [...authorityLimitedAspectIds].sort(),
    supportingOnlyAspectIds: [...supportingOnlyAspectIds].sort(),
    contextualOnlyAspectIds: [...contextualOnlyAspectIds].sort(),
    supportedOptionalAspectIds
  };

  const rejected: RejectedEvidenceCandidate[] = [];
  for (const candidate of result.candidates) {
    if (selectedCandidates.has(candidate.candidateId)) continue;
    const reasons: EvidenceRejectionReason[] = [];
    const betaLike =
      candidate.authority.sourceStatus === "beta" ||
      candidate.authority.sourceStatus === "preview";
    if (betaLike && !result.intent.allowsBetaSources) {
      reasons.push("beta_not_allowed");
    }
    const conceptOverrideReason = conceptDecisionOverrides.get(candidate.candidateId);
    if (conceptOverrideReason) {
      // This candidate was evaluated as an authoritative direct candidate for
      // a broad aspect but was not accepted because it restates an
      // already-selected concept or exceeded the bounded per-aspect cap —
      // not because it lacked authority/directness.
      reasons.push(conceptOverrideReason);
    } else {
      const candidateSupports = [
        ...(evaluations.get(candidate.candidateId)?.values() ?? [])
      ].map((evaluation) => evaluation.support);
      const bestStrength = candidateSupports.some(
        (support) => support.strength === "direct"
      )
        ? "direct"
        : candidateSupports.some((support) => support.strength === "supporting")
          ? "supporting"
          : "contextual";
      const topical = candidateSupports.some((support) => support.topical);
      if (!topical || bestStrength === "contextual") {
        reasons.push("low_topical_relevance", "insufficient_direct_support");
      } else if (bestStrength === "supporting") {
        reasons.push("insufficient_direct_support");
        if (candidateSupports.some((support) => !support.authoritySatisfied)) {
          reasons.push("lower_authority");
        }
      } else if (selectedCandidates.size >= maxEvidenceItems) {
        reasons.push("candidate_cap");
      } else {
        reasons.push("redundant");
      }
    }
    rejected.push({
      candidateId: candidate.candidateId,
      chunkId: candidate.chunkId,
      documentId: candidate.documentId,
      title: candidate.title,
      sourceId: candidate.authority.sourceId,
      fusionRank: candidate.fusion.rank,
      reasons: [...new Set(reasons)]
    });
  }
  const selectionLatencyMs = performance.now() - selectionStarted;

  const conflictStarted = performance.now();
  const requestedDomains = [...result.intent.domains] as SourceDomain[];
  const conflicts = detectConflicts(selected, aspectCoverage);
  const conflictLatencyMs = performance.now() - conflictStarted;

  const coveredDomains = [
    ...new Set(
      selected.flatMap((item) => {
        const registered = getSourceById(item.source.sourceId)?.domains ?? [];
        if (registered.length > 0) return registered;
        return item.source.sourceDomain === "unknown"
          ? []
          : [item.source.sourceDomain];
      })
    )
  ] as SourceDomain[];
  const missingDomains = requestedDomains.filter((domain) => !coveredDomains.includes(domain));
  const freshness = computeFreshnessState(result);
  const exactIdentifierValidation = computeExactIdentifierValidation(result, selected);

  const requiredConceptCoverage =
    mandatoryAspects.length > 0 &&
    supportedMandatoryAspectIds.length === mandatoryAspects.length;
  const authoritativeEvidencePresent = selected.some((item) => item.source.authorityTier === "tier1");
  const provenanceComplete = selected.every(
    (item) => item.source.canonicalUrl.length > 0 && item.source.sourcePath.length > 0 && item.source.title.length > 0
  );

  const diagnosticsSignals = {
    authoritativeEvidencePresent,
    exactIdentifierVerified: exactIdentifierValidation.verified,
    requiredConceptCoverage,
    conflictFree: conflicts.length === 0,
    freshnessOk: freshness.state !== "verification_required",
    authorityCoverageOk: missingDomains.length === 0,
    provenanceComplete
  };

  const answerabilityStarted = performance.now();
  const answerability = classifyAnswerability({
    evidence: selected,
    conflicts,
    freshness,
    exactIdentifierValidation,
    aspectCoverage,
    authorityCoverage: {
      requestedDomains,
      coveredDomains,
      missingDomains
    },
    diagnostics: {
      latencyMs: { total: 0, selection: 0, conflictDetection: 0, answerability: 0 },
      populations: {
        candidates: result.candidates.length,
        selectedEvidence: selected.length,
        rejectedCandidates: rejected.length
      },
      policySignals: diagnosticsSignals
    }
  });
  const answerabilityLatencyMs = performance.now() - answerabilityStarted;

  const decisionState: EvidenceBundleDecisionState = {
    question: result.intent.originalQuestion,
    intent: result.intent,
    scope: result.scope,
    evidence: selected,
    rejectedCandidates: rejected,
    conflicts,
    freshness,
    exactIdentifierValidation,
    aspectCoverage,
    authorityCoverage: {
      requestedDomains,
      coveredDomains,
      missingDomains
    },
    answerability: answerability.status,
    diagnostics: {
      latencyMs: {
        total: performance.now() - started,
        selection: selectionLatencyMs,
        conflictDetection: conflictLatencyMs,
        answerability: answerabilityLatencyMs
      },
      populations: {
        candidates: result.candidates.length,
        selectedEvidence: selected.length,
        rejectedCandidates: rejected.length
      },
      policySignals: diagnosticsSignals
    }
  };
  return {
    bundle: bindEvidenceBundleSnapshot(decisionState),
    retrieval: result
  };
}
