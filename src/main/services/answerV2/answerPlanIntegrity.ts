import { createHash } from "node:crypto";
import type {
  AnswerPlan,
  AnswerPlanIntegrityIssue,
  AnswerPlanIntegrityValidation,
  AnswerPlannerPolicyVersion,
  AnswerPlanSchemaVersion,
  ClaimSourceSpan,
  EvidenceBundle
} from "./types";

export const ANSWER_PLAN_SCHEMA_VERSION: AnswerPlanSchemaVersion =
  "atomic-source-bound-answer-plan/v1";
export const ANSWER_PLANNER_POLICY_VERSION: AnswerPlannerPolicyVersion =
  "minimal-atomic-source-bound-planner/r3";

export type AnswerPlanState = Omit<AnswerPlan, "planIdentity">;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? JSON.stringify(value)
      : JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalize(value), "utf8")
    .digest("hex");
}

export function hashSourceSpanContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function makeClaimSourceSpanId(
  span: Pick<
    ClaimSourceSpan,
    | "evidenceId"
    | "sourceField"
    | "fieldIndex"
    | "startOffset"
    | "endOffset"
    | "contentHash"
  >
): string {
  return `span:${sha256({
    evidenceId: span.evidenceId,
    sourceField: span.sourceField,
    fieldIndex: span.fieldIndex,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
    contentHash: span.contentHash
  }).slice(0, 24)}`;
}

function planIdentityInputs(plan: AnswerPlanState): Record<string, unknown> {
  return {
    snapshotBinding: plan.snapshotBinding,
    question: plan.question,
    intent: plan.intent,
    answerability: plan.answerability,
    answerType: plan.answerType,
    plannedClaims: plan.plannedClaims,
    requiredCaveats: plan.requiredCaveats,
    unsupportedAspects: plan.unsupportedAspects,
    evidenceReferences: plan.evidenceReferences,
    freshnessInstructions: plan.freshnessInstructions,
    previewInstructions: plan.previewInstructions,
    exactIdentifierState: plan.exactIdentifierState,
    recommendedStructure: plan.recommendedStructure,
    diagnostics: {
      decomposition: plan.diagnostics.decomposition,
      duplicateClaimsCollapsed: plan.diagnostics.duplicateClaimsCollapsed,
      facetCoverage: plan.diagnostics.facetCoverage,
      evidenceWithoutIndependentClaims:
        plan.diagnostics.evidenceWithoutIndependentClaims,
      canonicalUrlCoverage: plan.diagnostics.canonicalUrlCoverage
    }
  };
}

export function createAnswerPlanIdentity(plan: AnswerPlanState): AnswerPlan["planIdentity"] {
  const planHash = sha256({
    schemaVersion: ANSWER_PLAN_SCHEMA_VERSION,
    plannerPolicyVersion: ANSWER_PLANNER_POLICY_VERSION,
    plan: planIdentityInputs(plan)
  });
  return {
    planId: `answer-plan:${planHash.slice(0, 24)}`,
    planHash,
    schemaVersion: ANSWER_PLAN_SCHEMA_VERSION,
    plannerPolicyVersion: ANSWER_PLANNER_POLICY_VERSION
  };
}

export function bindAnswerPlanIdentity(plan: AnswerPlanState): AnswerPlan {
  return {
    ...plan,
    planIdentity: createAnswerPlanIdentity(plan)
  };
}

function sourceFieldText(
  evidence: EvidenceBundle["evidence"][number],
  span: ClaimSourceSpan
): string | null {
  if (span.sourceField === "text") return evidence.text;
  if (span.sourceField === "title") return evidence.source.title;
  return evidence.location.headingPath[span.fieldIndex ?? -1] ?? null;
}

export function validateAnswerPlanIntegrity(params: {
  bundle: EvidenceBundle;
  plan: AnswerPlan;
}): AnswerPlanIntegrityValidation {
  const issues: AnswerPlanIntegrityIssue[] = [];
  const { plan, bundle } = params;
  const { planIdentity: _identity, ...state } = plan;
  const recomputed = createAnswerPlanIdentity(state);
  const evidenceById = new Map(
    bundle.evidence.map((evidence) => [evidence.evidenceId, evidence])
  );
  const aspectById = new Map(
    bundle.aspectCoverage.aspects.map((aspect) => [aspect.aspectId, aspect])
  );
  const supportedMandatory = new Set(
    bundle.aspectCoverage.supportedMandatoryAspectIds
  );

  if (plan.planIdentity.planHash !== recomputed.planHash) {
    issues.push({
      code: "plan_hash_mismatch",
      message: "AnswerPlan content no longer matches its plan hash."
    });
  }
  if (plan.planIdentity.planId !== recomputed.planId) {
    issues.push({
      code: "plan_id_mismatch",
      message: "AnswerPlan content no longer matches its plan identity."
    });
  }
  if (
    plan.snapshotBinding.snapshotId !== bundle.decisionSnapshot.snapshotId ||
    plan.snapshotBinding.snapshotHash !== bundle.decisionSnapshot.snapshotHash
  ) {
    issues.push({
      code: "plan_snapshot_binding_mismatch",
      message: "AnswerPlan does not bind to the supplied grounding snapshot."
    });
  }

  for (const claim of plan.plannedClaims) {
    const aspect = aspectById.get(claim.requiredAspectId);
    if (!aspect) {
      issues.push({
        code: "claim_unknown_aspect",
        message: `Claim references an unknown aspect: ${claim.requiredAspectId}`,
        claimId: claim.claimId,
        aspectId: claim.requiredAspectId
      });
    } else if (!supportedMandatory.has(claim.requiredAspectId)) {
      issues.push({
        code: "claim_unsupported_aspect",
        message: `Claim references an aspect without direct mandatory coverage: ${claim.requiredAspectId}`,
        claimId: claim.claimId,
        aspectId: claim.requiredAspectId
      });
    }
    if (
      claim.groundingSnapshotId !== plan.snapshotBinding.snapshotId ||
      claim.groundingSnapshotHash !== plan.snapshotBinding.snapshotHash
    ) {
      issues.push({
        code: "plan_snapshot_binding_mismatch",
        message: `Claim does not carry the plan grounding snapshot: ${claim.claimId}`,
        claimId: claim.claimId,
        aspectId: claim.requiredAspectId
      });
    }

    const spanEvidenceIds = new Set(
      claim.sourceSpans.map((span) => span.evidenceId)
    );
    if (
      claim.evidenceIds.length === 0 ||
      claim.evidenceIds.some((id) => !spanEvidenceIds.has(id)) ||
      [...spanEvidenceIds].some((id) => !claim.evidenceIds.includes(id))
    ) {
      issues.push({
        code: "claim_evidence_mismatch",
        message: `Claim evidence IDs do not match its source spans: ${claim.claimId}`,
        claimId: claim.claimId
      });
    }

    for (const span of claim.sourceSpans) {
      const evidence = evidenceById.get(span.evidenceId);
      if (!evidence) {
        issues.push({
          code: "claim_evidence_mismatch",
          message: `Claim span references missing evidence: ${span.evidenceId}`,
          claimId: claim.claimId,
          spanId: span.spanId
        });
        continue;
      }
      const fieldText = sourceFieldText(evidence, span);
      if (
        fieldText === null ||
        span.startOffset < 0 ||
        span.endOffset <= span.startOffset ||
        span.endOffset > (fieldText?.length ?? 0)
      ) {
        issues.push({
          code: "claim_span_out_of_bounds",
          message: `Claim span offsets are invalid: ${span.spanId}`,
          claimId: claim.claimId,
          spanId: span.spanId
        });
        continue;
      }
      const exactText = fieldText.slice(span.startOffset, span.endOffset);
      if (exactText !== span.text) {
        issues.push({
          code: "claim_span_text_mismatch",
          message: `Claim span text does not match source content: ${span.spanId}`,
          claimId: claim.claimId,
          spanId: span.spanId
        });
      }
      if (
        hashSourceSpanContent(span.text) !== span.contentHash ||
        makeClaimSourceSpanId(span) !== span.spanId
      ) {
        issues.push({
          code: "claim_span_hash_mismatch",
          message: `Claim span hash is invalid: ${span.spanId}`,
          claimId: claim.claimId,
          spanId: span.spanId
        });
      }
      if (!evidence.source.authorityRoles.includes(span.authorityRole)) {
        issues.push({
          code: "claim_authority_role_mismatch",
          message: `Claim span authority role is not licensed by its evidence: ${span.spanId}`,
          claimId: claim.claimId,
          spanId: span.spanId
        });
      }
    }
  }

  for (const aspectId of supportedMandatory) {
    const aspect = aspectById.get(aspectId);
    if (!aspect) continue;
    const planned = new Set(
      plan.plannedClaims
        .filter((claim) => claim.requiredAspectId === aspectId)
        .flatMap((claim) => claim.coveredFacets)
    );
    for (const facet of aspect.requiredFacets) {
      if (!planned.has(facet)) {
        issues.push({
          code: "required_facet_unplanned",
          message: `Required facet ${facet} has no source-bound claim for ${aspectId}.`,
          aspectId
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
