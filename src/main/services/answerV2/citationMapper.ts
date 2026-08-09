import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { validateAnswerPlanIntegrity } from "./answerPlanIntegrity";
import { hashSourceSpanContent } from "./answerPlanIntegrity";
import { resolveCanonicalCitationUrl } from "./canonicalCitationUrl";
import { validateGroundingDecisionBoundary } from "./groundingDecisionSnapshot";
import type {
  AnswerPlan,
  ClaimSourceSpan,
  EvidenceBundle,
  EvidenceItem,
  ExtractiveRenderedClaim,
  GroundedAnswer,
  PlannedClaim
} from "./types";
import type {
  CitationMappingResult,
  CitationPolicyVersion,
  CitationValidationFailureReason,
  SourceCitation
} from "./citationTypes";

export const CITATION_POLICY_VERSION: CitationPolicyVersion =
  "source-bound-citation-mapper/wb21";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourceFieldText(
  evidence: EvidenceItem,
  span: ClaimSourceSpan
): string | null {
  if (span.sourceField === "text") return evidence.text;
  if (span.sourceField === "title") return evidence.source.title;
  return evidence.location.headingPath[span.fieldIndex ?? -1] ?? null;
}

function revisionString(
  revision: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = revision[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function requiredSpanGroups(params: {
  claim: PlannedClaim;
  rendered: ExtractiveRenderedClaim;
}): ClaimSourceSpan[][] {
  const spans = params.rendered.sourceSpans;
  const proposition = normalize(params.claim.proposition);
  const exact = spans.filter(
    (span) => normalize(span.text) === proposition
  );
  if (exact.length > 0) return [exact];

  const groups = new Map<string, ClaimSourceSpan[]>();
  for (const span of spans) {
    const key = normalize(span.text);
    const existing = groups.get(key) ?? [];
    existing.push(span);
    groups.set(key, existing);
  }
  return [...groups.values()];
}

function orderedCandidates(
  spans: ClaimSourceSpan[]
): ClaimSourceSpan[] {
  return [...spans].sort(
    (left, right) =>
      left.sourceOrder - right.sourceOrder ||
      (left.sentenceIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.sentenceIndex ?? Number.MAX_SAFE_INTEGER) ||
      left.startOffset - right.startOffset
  );
}

function uniqueReasons(
  reasons: CitationValidationFailureReason[]
): CitationValidationFailureReason[] {
  return [...new Set(reasons)];
}

function validateSpanCandidate(params: {
  bundle: EvidenceBundle;
  plan: AnswerPlan;
  answer: GroundedAnswer;
  rendered: ExtractiveRenderedClaim;
  claim: PlannedClaim | undefined;
  span: ClaimSourceSpan;
  factualRangeId: string;
  answerTextHash: string;
  preflightReasons: CitationValidationFailureReason[];
}): SourceCitation {
  const reasons = [...params.preflightReasons];
  const evidence = params.bundle.evidence.find(
    (item) => item.evidenceId === params.span.evidenceId
  );
  const claimSpan = params.claim?.sourceSpans.find(
    (span) => span.spanId === params.span.spanId
  );
  if (!params.claim) reasons.push("claim_missing");
  if (!evidence) reasons.push("evidence_missing");
  if (!claimSpan) reasons.push("span_missing");

  if (evidence) {
    const fieldText = sourceFieldText(evidence, params.span);
    const exactText =
      fieldText &&
      params.span.startOffset >= 0 &&
      params.span.endOffset <= fieldText.length
        ? fieldText.slice(
            params.span.startOffset,
            params.span.endOffset
          )
        : null;
    if (
      exactText !== params.span.text ||
      hashSourceSpanContent(params.span.text) !==
        params.span.contentHash
    ) {
      reasons.push("span_hash_mismatch");
    }
    if (
      evidence.documentId !== params.span.documentId ||
      evidence.chunkId !== params.span.chunkId ||
      evidence.source.sourceId !== params.span.sourceId ||
      evidence.source.sourcePath !== params.span.sourcePath ||
      evidence.location.sectionId !== params.span.sectionId ||
      JSON.stringify(evidence.location.headingPath) !==
        JSON.stringify(params.span.headingPath)
    ) {
      reasons.push("provenance_mismatch");
    }
    const revisionPath = revisionString(
      evidence.source.sourceRevision,
      "sourcePath",
      "source_path",
      "path"
    ).replace(/\\/g, "/");
    if (
      revisionPath &&
      revisionPath.toLowerCase() !==
        evidence.source.sourcePath
          .replace(/\\/g, "/")
          .toLowerCase()
    ) {
      reasons.push("provenance_mismatch");
    }
    const revisionStatus = revisionString(
      evidence.source.sourceRevision,
      "sourceStatus",
      "source_status",
      "status"
    );
    if (
      revisionStatus &&
      revisionStatus.toLowerCase() !==
        evidence.source.sourceStatus.toLowerCase()
    ) {
      reasons.push("source_status_mismatch");
    }
    if (
      !params.claim?.authorityContext.authorityRoles.includes(
        params.span.authorityRole
      ) ||
      !evidence.source.authorityRoles.includes(
        params.span.authorityRole
      )
    ) {
      reasons.push("authority_role_mismatch");
    }
    if (
      params.bundle.rejectedCandidates.some(
        (rejected) =>
          rejected.chunkId === evidence.chunkId ||
          rejected.candidateId === evidence.evidenceId
      )
    ) {
      reasons.push("rejected_evidence");
    }
    const aspectEvidence =
      (params.claim &&
        params.bundle.aspectCoverage.evidenceByAspect[
          params.claim.requiredAspectId
        ]) ??
      [];
    if (
      evidence.supportTypes.every((type) => type === "contextual") ||
      !aspectEvidence.includes(evidence.evidenceId)
    ) {
      reasons.push("contextual_evidence");
    }
  }

  const urlResolution = evidence
    ? resolveCanonicalCitationUrl(evidence)
    : {
        canonicalUrl: null,
        source: null,
        failureReason: "canonical_url_missing" as const
      };
  if (urlResolution.failureReason) {
    reasons.push(urlResolution.failureReason);
  }

  const unique = uniqueReasons(reasons);
  const validationState =
    unique.length === 0
      ? "valid"
      : unique.every(
            (reason) =>
              reason === "canonical_url_missing" ||
              reason === "canonical_url_untrusted"
          )
        ? "unavailable"
        : "invalid";
  const evidenceId = evidence?.evidenceId ?? params.span.evidenceId;
  const documentId = evidence?.documentId ?? params.span.documentId;
  const sourceId = evidence?.source.sourceId ?? params.span.sourceId;
  const citationSeed = [
    params.plan.snapshotBinding.snapshotId,
    params.factualRangeId,
    params.claim?.claimId ?? params.rendered.claimId,
    evidenceId,
    params.span.spanId,
    urlResolution.canonicalUrl ?? "unavailable"
  ].join("|");
  return {
    citationId: `citation:${sha256(citationSeed).slice(0, 24)}`,
    citationPolicyVersion: CITATION_POLICY_VERSION,
    snapshotBinding: params.plan.snapshotBinding,
    answerTextHash: params.answerTextHash,
    factualRangeId: params.factualRangeId,
    answerRange: { ...params.rendered.answerTextRange },
    claimId: params.claim?.claimId ?? params.rendered.claimId,
    evidenceId,
    spanId: params.span.spanId,
    supportingSpanIds: [],
    documentId,
    sourceId,
    authorityRole: params.span.authorityRole,
    sourceTitle: evidence?.source.title ?? "",
    headingPath: evidence
      ? [...evidence.location.headingPath]
      : [...params.span.headingPath],
    sectionId:
      evidence?.location.sectionId ?? params.span.sectionId,
    canonicalUrl: urlResolution.canonicalUrl,
    canonicalUrlSource: urlResolution.source,
    sourceStatus: evidence?.source.sourceStatus ?? "unknown",
    sourceRevision: evidence
      ? { ...evidence.source.sourceRevision }
      : {},
    freshnessState: {
      mustVerifyBeforeFinalAnswer:
        params.answer.freshnessState.mustVerifyBeforeFinalAnswer,
      reasons: [...params.answer.freshnessState.reasons]
    },
    validation: {
      state: validationState,
      failureReasons: unique
    }
  };
}

function mergeSameSourceCitations(
  citations: SourceCitation[]
): SourceCitation[] {
  const merged = new Map<string, SourceCitation>();
  for (const citation of citations) {
    if (citation.validation.state !== "valid") {
      merged.set(citation.citationId, citation);
      continue;
    }
    const key = [
      citation.factualRangeId,
      citation.documentId,
      citation.canonicalUrl
    ].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, citation);
      continue;
    }
    const spanIds = [
      existing.spanId,
      ...existing.supportingSpanIds,
      citation.spanId,
      ...citation.supportingSpanIds
    ];
    const uniqueSpanIds = [...new Set(spanIds)];
    const citationId = `citation:${sha256(
      [
        citation.snapshotBinding.snapshotId,
        citation.factualRangeId,
        citation.documentId,
        citation.canonicalUrl,
        uniqueSpanIds.join(",")
      ].join("|")
    ).slice(0, 24)}`;
    merged.delete(key);
    merged.set(key, {
      ...existing,
      citationId,
      spanId: uniqueSpanIds[0]!,
      supportingSpanIds: uniqueSpanIds.slice(1)
    });
  }
  return [...merged.values()];
}

export function mapAnswerCitations(params: {
  bundle: EvidenceBundle;
  plan: AnswerPlan;
  answer: GroundedAnswer;
}): CitationMappingResult {
  const started = performance.now();
  const answerTextHash = sha256(params.answer.answerText);
  const preflightReasons: CitationValidationFailureReason[] = [];
  const boundary = validateGroundingDecisionBoundary({
    bundle: params.bundle,
    plan: params.plan
  });
  const integrity = validateAnswerPlanIntegrity({
    bundle: params.bundle,
    plan: params.plan
  });
  const assembly = params.answer.extractiveAssembly;
  if (
    !boundary.valid ||
    !integrity.valid ||
    params.answer.snapshotBinding.snapshotId !==
      params.plan.snapshotBinding.snapshotId ||
    params.answer.snapshotBinding.snapshotHash !==
      params.plan.snapshotBinding.snapshotHash ||
    assembly?.planId !== params.plan.planIdentity.planId ||
    assembly?.planHash !== params.plan.planIdentity.planHash
  ) {
    preflightReasons.push("snapshot_mismatch");
  }

  const claimById = new Map(
    params.plan.plannedClaims.map((claim) => [
      claim.claimId,
      claim
    ])
  );
  const citations: SourceCitation[] = [];
  const factualRanges: CitationMappingResult["factualRanges"] = [];

  for (const rendered of assembly?.renderedClaims ?? []) {
    const factualRangeId = `factual-range:${sha256(
      [
        params.plan.planIdentity.planId,
        rendered.claimId,
        rendered.answerTextRange.startOffset,
        rendered.answerTextRange.endOffset,
        rendered.renderedText
      ].join("|")
    ).slice(0, 24)}`;
    const rangeReasons = [...preflightReasons];
    if (
      params.answer.answerText.slice(
        rendered.answerTextRange.startOffset,
        rendered.answerTextRange.endOffset
      ) !== rendered.renderedText
    ) {
      rangeReasons.push("r4_range_missing");
    }
    const claim = claimById.get(rendered.claimId);
    const spanGroups = claim
      ? requiredSpanGroups({ claim, rendered })
      : rendered.sourceSpans.map((span) => [span]);
    const selected: SourceCitation[] = [];
    let validGroupCount = 0;
    for (const group of spanGroups) {
      const candidates = orderedCandidates(group).map((span) =>
        validateSpanCandidate({
          bundle: params.bundle,
          plan: params.plan,
          answer: params.answer,
          rendered,
          claim,
          span,
          factualRangeId,
          answerTextHash,
          preflightReasons: rangeReasons
        })
      );
      const chosen =
        candidates.find(
          (citation) => citation.validation.state === "valid"
        ) ??
        candidates[0];
      if (!chosen) continue;
      selected.push(chosen);
      if (chosen.validation.state === "valid") validGroupCount += 1;
    }
    const rangeCitations = mergeSameSourceCitations(selected);
    citations.push(...rangeCitations);
    const validIds = rangeCitations
      .filter((citation) => citation.validation.state === "valid")
      .map((citation) => citation.citationId);
    const invalidIds = rangeCitations
      .filter((citation) => citation.validation.state !== "valid")
      .map((citation) => citation.citationId);
    factualRanges.push({
      factualRangeId,
      answerRange: { ...rendered.answerTextRange },
      claimId: rendered.claimId,
      citationIds: validIds,
      invalidCitationIds: invalidIds,
      coverage:
        validIds.length === 0
          ? "zero"
          : validIds.length === 1
            ? "one"
            : "multiple",
      complete:
        spanGroups.length > 0 &&
        validGroupCount === spanGroups.length
    });
  }

  const failureReasons = uniqueReasons([
    ...preflightReasons,
    ...citations.flatMap(
      (citation) => citation.validation.failureReasons
    )
  ]);
  const validCitationCount = citations.filter(
    (citation) => citation.validation.state === "valid"
  ).length;
  const invalidCitationCount = citations.length - validCitationCount;
  return {
    citationPolicyVersion: CITATION_POLICY_VERSION,
    snapshotBinding: params.plan.snapshotBinding,
    answerText: params.answer.answerText,
    answerTextHash,
    citations,
    factualRanges,
    validation: {
      valid:
        failureReasons.length === 0 &&
        factualRanges.every((range) => range.complete),
      failureReasons
    },
    previewState: params.answer.previewState,
    freshnessState: params.answer.freshnessState,
    diagnostics: {
      latencyMs: performance.now() - started,
      factualRangeCount: factualRanges.length,
      validCitationCount,
      invalidCitationCount,
      rangesWithoutCitation: factualRanges.filter(
        (range) => range.citationIds.length === 0
      ).length,
      providerRequestCount: 0
    }
  };
}
