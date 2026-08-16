import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolveCanonicalCitationUrl } from "./canonicalCitationUrl";
import type {
  AnswerPlan,
  EvidenceBundle,
  EvidenceItem,
  EvidenceSupportType,
  PlannedClaim
} from "./types";
import type {
  ExplanationContextBlock,
  ExplanationContextBuildResult,
  ExplanationContextType
} from "./explanationContextTypes";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Infer context type only from evidence supportTypes metadata.
 * Never use broad keyword regexes when metadata is ambiguous.
 */
export function inferContextType(
  supportTypes: EvidenceSupportType[]
): ExplanationContextType {
  const types = new Set(supportTypes);
  if (types.has("prerequisite")) return "prerequisite";
  if (types.has("procedure")) return "procedure";
  if (types.has("cmdlet_semantics")) return "cmdlet_reference";
  if (types.has("parameter_semantics")) return "parameter_reference";
  if (types.has("concept_definition")) return "definition";
  if (types.has("troubleshooting_guidance")) return "verification";
  if (types.has("configuration_behavior")) {
    return "conceptual_explanation";
  }
  if (types.has("comparison_dimension") || types.has("licensing_or_status")) {
    return "supporting_context";
  }
  return "supporting_context";
}

function primaryAuthorityRole(
  item: EvidenceItem
): ExplanationContextBlock["authorityRole"] {
  return item.source.authorityRoles[0] ?? "unknown";
}

function contextualOnlyEvidenceIds(bundle: EvidenceBundle): Set<string> {
  const ids = new Set<string>();
  for (const aspectId of bundle.aspectCoverage.contextualOnlyAspectIds) {
    for (const evidenceId of bundle.aspectCoverage.evidenceByAspect[
      aspectId
    ] ?? []) {
      ids.add(evidenceId);
    }
  }
  return ids;
}

function claimLinkedEvidenceIds(plan: AnswerPlan): Set<string> {
  const ids = new Set<string>();
  for (const claim of plan.plannedClaims) {
    for (const evidenceId of claim.evidenceIds) {
      ids.add(evidenceId);
    }
  }
  return ids;
}

function aspectLinkedEvidenceIds(bundle: EvidenceBundle): Set<string> {
  const ids = new Set<string>();
  const allowedAspects = new Set([
    ...bundle.aspectCoverage.supportedMandatoryAspectIds,
    ...bundle.aspectCoverage.supportedOptionalAspectIds
  ]);
  for (const aspectId of allowedAspects) {
    for (const evidenceId of bundle.aspectCoverage.evidenceByAspect[
      aspectId
    ] ?? []) {
      ids.add(evidenceId);
    }
  }
  return ids;
}

function relatedClaims(
  evidenceId: string,
  plan: AnswerPlan
): PlannedClaim[] {
  return plan.plannedClaims.filter((claim) =>
    claim.evidenceIds.includes(evidenceId)
  );
}

function relatedAspectIds(
  evidenceId: string,
  bundle: EvidenceBundle
): string[] {
  const aspects: string[] = [];
  for (const [aspectId, evidenceIds] of Object.entries(
    bundle.aspectCoverage.evidenceByAspect
  )) {
    if (evidenceIds.includes(evidenceId)) aspects.push(aspectId);
  }
  return aspects.sort();
}

function buildBlock(params: {
  item: EvidenceItem;
  bundle: EvidenceBundle;
  plan: AnswerPlan;
  relevance: ExplanationContextBlock["relevance"];
  sequence: number;
  canonicalUrl: string;
}): ExplanationContextBlock {
  const exactText = normalizeWhitespace(params.item.text);
  const related = relatedClaims(params.item.evidenceId, params.plan);
  return {
    contextBlockId: `context:${sha256(
      [
        params.bundle.decisionSnapshot.snapshotId,
        params.item.evidenceId,
        exactText
      ].join("|")
    ).slice(0, 24)}`,
    groundingSnapshotId: params.bundle.decisionSnapshot.snapshotId,
    groundingSnapshotHash: params.bundle.decisionSnapshot.snapshotHash,
    evidenceId: params.item.evidenceId,
    documentId: params.item.documentId,
    chunkId: params.item.chunkId,
    sourceId: params.item.source.sourceId,
    sourceTitle: params.item.source.title,
    headingPath: [...params.item.location.headingPath],
    sectionId: params.item.location.sectionId,
    exactText,
    startOffset: 0,
    endOffset: exactText.length,
    contentHash: sha256(exactText),
    canonicalUrl: params.canonicalUrl,
    contextType: inferContextType(params.item.supportTypes),
    relevance: params.relevance,
    relatedClaimIds: related.map((claim) => claim.claimId),
    relatedAspectIds: relatedAspectIds(
      params.item.evidenceId,
      params.bundle
    ),
    authorityRole: primaryAuthorityRole(params.item),
    supportTypes: [...params.item.supportTypes],
    ordering: {
      sequence: params.sequence,
      sourceOrder: params.item.retrieval.fusionRank
    }
  };
}

/**
 * Builds Explanation Context only from authoritative evidence already in the
 * grounded decision. Same-document expansion is limited to other selected
 * evidence items already present in the EvidenceBundle for documents that
 * support Proof Facts. Rejected and contextual-only evidence are excluded.
 */
export function buildExplanationContext(params: {
  bundle: EvidenceBundle;
  plan: AnswerPlan;
}): ExplanationContextBuildResult {
  const started = performance.now();
  const contextualOnly = contextualOnlyEvidenceIds(params.bundle);
  const claimLinked = claimLinkedEvidenceIds(params.plan);
  const aspectLinked = aspectLinkedEvidenceIds(params.bundle);
  const rejectedIds = new Set(
    params.bundle.rejectedCandidates.map(
      (candidate) => candidate.candidateId
    )
  );

  const byEvidenceId = new Map(
    params.bundle.evidence.map((item) => [item.evidenceId, item])
  );

  const selected: ExplanationContextBlock[] = [];
  const usedEvidenceIds = new Set<string>();
  let sequence = 0;
  let contextualOnlyExcluded = 0;
  let rejectedEvidenceExcluded = 0;

  const seedIds = [...new Set([...claimLinked, ...aspectLinked])].sort();
  for (const evidenceId of seedIds) {
    if (contextualOnly.has(evidenceId) && !claimLinked.has(evidenceId)) {
      contextualOnlyExcluded += 1;
      continue;
    }
    const item = byEvidenceId.get(evidenceId);
    if (!item) continue;
    if (rejectedIds.has(item.chunkId) || rejectedIds.has(evidenceId)) {
      rejectedEvidenceExcluded += 1;
      continue;
    }
    const canonicalUrl = resolveCanonicalCitationUrl(item).canonicalUrl;
    if (!canonicalUrl) continue;
    if (!normalizeWhitespace(item.text)) continue;
    usedEvidenceIds.add(evidenceId);
    selected.push(
      buildBlock({
        item,
        bundle: params.bundle,
        plan: params.plan,
        relevance: claimLinked.has(evidenceId)
          ? "supports_claim"
          : "aspect_linked",
        sequence: sequence++,
        canonicalUrl
      })
    );
  }

  const seedDocumentIds = new Set(
    selected
      .filter((block) => block.relevance === "supports_claim")
      .map((block) => block.documentId)
  );

  let sameDocumentAdjacentCount = 0;
  for (const item of params.bundle.evidence) {
    if (usedEvidenceIds.has(item.evidenceId)) continue;
    if (!seedDocumentIds.has(item.documentId)) continue;
    if (contextualOnly.has(item.evidenceId)) {
      contextualOnlyExcluded += 1;
      continue;
    }
    const canonicalUrl = resolveCanonicalCitationUrl(item).canonicalUrl;
    if (!canonicalUrl) continue;
    if (!normalizeWhitespace(item.text)) continue;
    usedEvidenceIds.add(item.evidenceId);
    sameDocumentAdjacentCount += 1;
    selected.push(
      buildBlock({
        item,
        bundle: params.bundle,
        plan: params.plan,
        relevance: "same_document_adjacent",
        sequence: sequence++,
        canonicalUrl
      })
    );
  }

  selected.sort(
    (left, right) =>
      left.ordering.sourceOrder - right.ordering.sourceOrder ||
      left.ordering.sequence - right.ordering.sequence
  );

  return {
    blocks: selected,
    diagnostics: {
      latencyMs: performance.now() - started,
      selectedEvidenceCount: selected.length,
      rejectedEvidenceExcluded,
      contextualOnlyExcluded,
      sameDocumentAdjacentCount,
      providerRequestCount: 0
    }
  };
}
