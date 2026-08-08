import { performance } from "node:perf_hooks";
import type { SourceDomain } from "../knowledgeV2";
import type { FusedRetrievalCandidate, HybridRetrievalResult } from "../retrievalV2";
import { classifyAnswerability } from "./answerabilityPolicy";
import {
  bindEvidenceBundleSnapshot,
  type EvidenceBundleDecisionState
} from "./groundingDecisionSnapshot";
import type {
  BuildEvidenceBundleResult,
  EvidenceBundle,
  EvidenceConflict,
  EvidenceItem,
  EvidenceRejectionReason,
  RejectedEvidenceCandidate
} from "./types";

const EVIDENCE_POLICY = {
  maxEvidenceItems: 8,
  maxPerDocument: 2,
  minTopicalRelevanceScore: 2
} as const;

function sourceDomainFromSourceId(sourceId: string): SourceDomain | "unknown" {
  if (sourceId === "ms-teams-admin") return "teams_admin";
  if (sourceId === "ms-teams-powershell") return "teams_powershell";
  if (sourceId === "ms-graph-docs") return "graph";
  if (sourceId === "ms-entra-docs") return "entra";
  if (sourceId === "ms-m365-docs") return "m365";
  if (sourceId === "ms-teams-dev-docs") return "teams_dev";
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

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function buildRequiredConcepts(result: HybridRetrievalResult): string[] {
  const concepts = new Set<string>();
  for (const cmdlet of result.intent.commandNames ?? []) concepts.add(normalizeText(cmdlet));
  for (const policy of result.intent.policyNames ?? []) concepts.add(normalizeText(policy));
  for (const entity of result.intent.entities) {
    const normalized = normalizeText(entity);
    if (normalized.length >= 4) concepts.add(normalized);
  }
  return [...concepts];
}

function candidateSupportsConcept(candidate: FusedRetrievalCandidate, concept: string): boolean {
  const title = normalizeText(candidate.title);
  const text = normalizeText(candidate.text);
  const url = normalizeText(candidate.provenance.canonicalUrl);
  return title.includes(concept) || text.includes(concept) || url.includes(concept);
}

function evidenceSupportsConcept(evidence: EvidenceItem, concept: string): boolean {
  const title = normalizeText(evidence.source.title);
  const text = normalizeText(evidence.text);
  const url = normalizeText(evidence.source.canonicalUrl);
  return title.includes(concept) || text.includes(concept) || url.includes(concept);
}

function supportTypesForCandidate(candidate: FusedRetrievalCandidate): EvidenceItem["supportTypes"] {
  const text = normalizeText(`${candidate.title} ${candidate.text} ${candidate.sectionId}`);
  const types = new Set<EvidenceItem["supportTypes"][number]>();
  if (/cmdlet|set-|grant-|get-|remove-/.test(text)) types.add("cmdlet_semantics");
  if (/parameter|-identity|-policy/.test(text)) types.add("parameter_semantics");
  if (/how to|steps|assign|configure|setup|set up/.test(text)) types.add("procedure");
  if (/prerequisite|requirement|license|licensing/.test(text)) types.add("prerequisite");
  if (/troubleshoot|issue|error|diagnos/.test(text)) types.add("troubleshooting_guidance");
  if (/policy|works|overview|concept|direct routing|external access|calling plans/.test(text)) {
    types.add("concept_definition");
    types.add("configuration_behavior");
  }
  if (/compare|difference|versus|vs/.test(text)) types.add("comparison_dimension");
  if (types.size === 0) types.add("contextual");
  return [...types];
}

function topicalRelevanceScore(result: HybridRetrievalResult, candidate: FusedRetrievalCandidate): number {
  let score = 0;
  const requiredConcepts = buildRequiredConcepts(result);
  for (const concept of requiredConcepts) {
    if (candidateSupportsConcept(candidate, concept)) score += 2;
  }
  if (candidate.methodSignals.exact.matched) score += 3;
  if (candidate.authority.routePriority === "primary") score += 2;
  if (candidate.authority.authorityTier === "tier1") score += 2;
  if (candidate.methods.includes("semantic")) score += 1;
  if (candidate.fusion.rank <= 5) score += 1;
  return score;
}

function specificityScore(result: HybridRetrievalResult, candidate: FusedRetrievalCandidate): number {
  const combined = normalizeText(`${candidate.title} ${candidate.provenance.canonicalUrl} ${candidate.sectionId}`);
  let score = 0;
  const entities = result.intent.entities.map((entity) => normalizeText(entity)).filter((entity) => entity.length >= 4);
  for (const entity of entities) {
    if (combined.includes(entity)) score += 3;
  }
  if (/reference|related articles|landing page/.test(combined)) score -= 3;
  if (/overview/.test(combined) && entities.length > 0) score -= 1;
  const explicitCmdlet = (result.intent.commandNames ?? [])[0];
  if (explicitCmdlet && combined.includes(normalizeText(explicitCmdlet))) score += 6;
  if (result.intent.normalizedQuestion.includes("external access") && combined.includes("external-access")) score += 4;
  if (result.intent.normalizedQuestion.includes("meeting polic") && combined.includes("meeting-policies")) score += 4;
  if (result.intent.normalizedQuestion.includes("direct routing") && combined.includes("direct-routing")) score += 4;
  if (result.intent.normalizedQuestion.includes("calling plan") && combined.includes("calling-plans")) score += 4;
  return score;
}

function toEvidenceItem(candidate: FusedRetrievalCandidate): EvidenceItem {
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
    supportTypes: supportTypesForCandidate(candidate),
    retrieval: {
      methods: [...candidate.methods],
      fusionRank: candidate.fusion.rank,
      fusionScore: candidate.fusion.score,
      methodSignals: candidate.methodSignals,
      exactMatch: candidate.exactMatch ?? null,
      retrievalReasons: [...candidate.retrievalReasons]
    },
    selectionReason: `selected:${candidate.authority.routePriority}:rank_${candidate.fusion.rank}`
  };
}

function detectConflicts(evidence: EvidenceItem[], requestedDomains: SourceDomain[]): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];

  const ga = evidence.filter((item) => item.source.sourceStatus === "ga");
  const beta = evidence.filter((item) => item.source.sourceStatus === "beta" || item.source.sourceStatus === "preview");
  if (ga.length > 0 && beta.length > 0) {
    conflicts.push({
      conflictId: "conflict:ga-vs-beta",
      conflictType: "ga_vs_beta",
      topic: "ga_beta_mixture",
      evidenceIds: [...ga.slice(0, 1), ...beta.slice(0, 1)].map((item) => item.evidenceId),
      notes: "bundle mixes GA and beta/preview evidence"
    });
  }

  const deprecated = evidence.filter((item) => /deprecated|no longer supported/i.test(item.text));
  const supported = evidence.filter((item) => /supported|recommended/i.test(item.text));
  if (deprecated.length > 0 && supported.length > 0) {
    const deprecatedItem = deprecated[0] as EvidenceItem;
    const supportedItem = supported[0] as EvidenceItem;
    conflicts.push({
      conflictId: "conflict:deprecated-vs-supported",
      conflictType: "contradiction",
      topic: "support_status",
      evidenceIds: [deprecatedItem.evidenceId, supportedItem.evidenceId],
      notes: "inconsistent support/deprecation signals"
    });
  }

  for (const item of evidence) {
    const domain = item.source.sourceDomain;
    if (domain !== "unknown" && !requestedDomains.includes(domain)) {
      conflicts.push({
        conflictId: `conflict:scope-mismatch:${item.evidenceId}`,
        conflictType: "scope_mismatch",
        topic: domain,
        evidenceIds: [item.evidenceId],
        notes: "selected evidence domain outside requested domains"
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
  const missingFromRetrieval = new Set(
    result.fusionDiagnostics.requiredExactMisses.map((miss) => `${miss.directiveType}:${normalizeText(miss.directiveValue)}`)
  );
  const missing: Array<{ type: "cmdlet" | "policy" | "entity"; value: string }> = [];
  for (const directive of requiredDirectives) {
    const key = `${directive.type}:${normalizeText(directive.value)}`;
    const selectedMatch = selected.some(
      (item) =>
        item.retrieval.exactMatch?.directiveType === directive.type &&
        normalizeText(item.retrieval.exactMatch.directiveValue) === normalizeText(directive.value)
    );
    if (!selectedMatch || missingFromRetrieval.has(key)) {
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

export function buildEvidenceBundle(result: HybridRetrievalResult): BuildEvidenceBundleResult {
  const started = performance.now();
  const selectionStarted = performance.now();
  const requiredConcepts = buildRequiredConcepts(result);
  const selected: EvidenceItem[] = [];
  const rejected: RejectedEvidenceCandidate[] = [];
  const seenText = new Set<string>();
  const perDocument = new Map<string, number>();
  let hasBlockedByBeta = false;

  const rankedForEvidence = [...result.candidates].sort((left, right) => {
    const leftScore = topicalRelevanceScore(result, left) + specificityScore(result, left);
    const rightScore = topicalRelevanceScore(result, right) + specificityScore(result, right);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.fusion.rank - right.fusion.rank;
  });

  for (const candidate of rankedForEvidence) {
    const reasons: EvidenceRejectionReason[] = [];
    const status = candidate.authority.sourceStatus;
    const betaLike = status === "beta" || status === "preview";
    if (betaLike && !result.intent.allowsBetaSources) {
      reasons.push("beta_not_allowed");
      hasBlockedByBeta = true;
    }

    const relevance = topicalRelevanceScore(result, candidate);
    if (relevance < EVIDENCE_POLICY.minTopicalRelevanceScore) reasons.push("low_topical_relevance");

    const textKey = normalizeText(candidate.text).slice(0, 240);
    if (seenText.has(textKey)) reasons.push("redundant");

    const docCount = perDocument.get(candidate.documentId) ?? 0;
    if (docCount >= EVIDENCE_POLICY.maxPerDocument) reasons.push("redundant");

    if (selected.length >= EVIDENCE_POLICY.maxEvidenceItems) reasons.push("candidate_cap");

    if (reasons.length > 0) {
      rejected.push({
        candidateId: candidate.candidateId,
        chunkId: candidate.chunkId,
        documentId: candidate.documentId,
        title: candidate.title,
        sourceId: candidate.authority.sourceId,
        fusionRank: candidate.fusion.rank,
        reasons: [...new Set(reasons)]
      });
      continue;
    }

    selected.push(toEvidenceItem(candidate));
    seenText.add(textKey);
    perDocument.set(candidate.documentId, docCount + 1);
  }
  const selectionLatencyMs = performance.now() - selectionStarted;

  const conflictStarted = performance.now();
  const requestedDomains = [...result.intent.domains] as SourceDomain[];
  const cmdletDiscoveryIntent =
    (result.intent.commandNames ?? []).length > 0 ||
    result.intent.normalizedQuestion.includes("which cmdlet") ||
    result.intent.normalizedQuestion.includes("powershell command") ||
    result.intent.normalizedQuestion.includes("powershell cmdlet");
  const primaryExpectedDomains = cmdletDiscoveryIntent
    ? (["teams_powershell"] as SourceDomain[])
    : requestedDomains;
  const conflicts = detectConflicts(selected, requestedDomains);
  const conflictLatencyMs = performance.now() - conflictStarted;

  const coveredDomains = [...new Set(selected.map((item) => item.source.sourceDomain).filter((domain) => domain !== "unknown"))] as SourceDomain[];
  const missingDomains = primaryExpectedDomains.filter((domain) => !coveredDomains.includes(domain));
  const freshness = computeFreshnessState(result);
  const exactIdentifierValidation = computeExactIdentifierValidation(result, selected);

  const supportedConcepts = requiredConcepts.filter((concept) =>
    selected.some((item) => evidenceSupportsConcept(item, concept))
  );
  const requiredConceptCoverage = requiredConcepts.length === 0 || supportedConcepts.length > 0;
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

  if (hasBlockedByBeta && selected.length === 0) {
    for (const row of rejected) {
      if (!row.reasons.includes("adjacent_domain_authority_missing")) {
        row.reasons.push("adjacent_domain_authority_missing");
      }
    }
  }

  const decisionState: EvidenceBundleDecisionState = {
    question: result.intent.originalQuestion,
    intent: result.intent,
    scope: result.scope,
    evidence: selected,
    rejectedCandidates: rejected,
    conflicts,
    freshness,
    exactIdentifierValidation,
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
