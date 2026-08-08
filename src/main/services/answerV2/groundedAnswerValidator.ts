import type {
  AnswerPlan,
  EvidenceBundle,
  GroundedAnswerDraft,
  GroundingValidationIssue,
  GroundingValidationResult
} from "./types";

const CMDLET_PATTERN = /\b(?:Get|Set|Grant|Remove|New|Test)-Cs[A-Za-z0-9]+\b/g;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function validateGroundedAnswer(params: {
  plan: AnswerPlan;
  bundle: EvidenceBundle;
  draft: GroundedAnswerDraft;
  failedClaimIds?: Set<string>;
}): GroundingValidationResult {
  const issues: GroundingValidationIssue[] = [];
  const claimById = new Map(params.plan.plannedClaims.map((claim) => [claim.claimId, claim]));
  const evidenceIds = new Set(params.bundle.evidence.map((item) => item.evidenceId));
  const realizedIds = new Set(params.draft.realizedClaims.map((claim) => claim.claimId));

  for (const claim of params.draft.realizedClaims) {
    const planned = claimById.get(claim.claimId);
    if (!planned) {
      issues.push({
        code: "unknown_claim_id",
        message: `Unknown claimId returned by generator: ${claim.claimId}`,
        claimId: claim.claimId
      });
      continue;
    }
    if (planned.evidenceIds.length === 0 || !planned.evidenceIds.every((id) => evidenceIds.has(id))) {
      issues.push({
        code: "claim_without_evidence",
        message: `Claim has no valid mapped evidence: ${claim.claimId}`,
        claimId: claim.claimId
      });
    }
  }

  const mandatoryClaims = params.plan.plannedClaims.filter((claim) => claim.mandatory);
  for (const claim of mandatoryClaims) {
    if (!realizedIds.has(claim.claimId)) {
      if (params.failedClaimIds?.has(claim.claimId)) {
        issues.push({
          code: "claim_generation_failed",
          message: `Mandatory claim generation failed: ${claim.claimId}`,
          claimId: claim.claimId
        });
      } else {
        issues.push({
          code: "missing_mandatory_claim",
          message: `Mandatory claim missing: ${claim.claimId}`,
          claimId: claim.claimId
        });
      }
    }
  }

  const caveatCodes = new Set(params.draft.caveats.map((caveat) => caveat.code));
  for (const required of params.plan.requiredCaveats) {
    if (!caveatCodes.has(required.code)) {
      issues.push({
        code: "missing_required_caveat",
        message: `Required caveat missing: ${required.code}`
      });
    }
  }

  const unsupportedIds = new Set(params.draft.unsupportedAspects.map((aspect) => aspect.aspectId));
  for (const unsupported of params.plan.unsupportedAspects) {
    if (!unsupportedIds.has(unsupported.aspectId)) {
      issues.push({
        code: "missing_unsupported_aspect",
        message: `Unsupported aspect missing: ${unsupported.aspectId}`
      });
    }
  }

  if (
    params.plan.answerability === "insufficient_evidence" &&
    params.draft.realizedClaims.length > 0
  ) {
    issues.push({
      code: "insufficient_answer_contains_claims",
      message: "insufficient_evidence draft must not realize technical claims."
    });
  }

  if (params.plan.previewInstructions.requiredLabel && !caveatCodes.has("preview_evidence_used")) {
    issues.push({
      code: "preview_caveat_missing",
      message: "Preview evidence label is required but missing."
    });
  }

  if (
    params.plan.freshnessInstructions.mustVerifyBeforeFinalAnswer &&
    !caveatCodes.has("freshness_verification_required")
  ) {
    issues.push({
      code: "freshness_caveat_missing",
      message: "Freshness verification caveat is required but missing."
    });
  }

  if (
    params.plan.exactIdentifierState.required &&
    !params.plan.exactIdentifierState.verified &&
    params.plan.answerability === "insufficient_evidence"
  ) {
    const cmdlets = params.draft.answerText.match(CMDLET_PATTERN) ?? [];
    const allowedValues = new Set(
      params.plan.exactIdentifierState.requiredDirectives.map((directive) =>
        normalize(directive.value)
      )
    );
    const unauthorizedCmdlet = cmdlets.some((cmdlet) => !allowedValues.has(normalize(cmdlet)));
    if (unauthorizedCmdlet) {
      issues.push({
        code: "exact_identifier_violation",
        message: "Draft includes cmdlet identifiers not verified by exact-match state."
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    coverage: {
      mandatoryClaimsTotal: mandatoryClaims.length,
      mandatoryClaimsRealized: mandatoryClaims.filter((claim) => realizedIds.has(claim.claimId)).length,
      unknownClaimCount: issues.filter((issue) => issue.code === "unknown_claim_id").length,
      missingCaveatCount: issues.filter((issue) =>
        issue.code === "missing_required_caveat" ||
        issue.code === "preview_caveat_missing" ||
        issue.code === "freshness_caveat_missing"
      ).length
    }
  };
}
