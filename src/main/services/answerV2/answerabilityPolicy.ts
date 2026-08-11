import { methodGapsForBundle } from "./methodConstraintPolicy";
import type { AnswerabilityStatus, EvidenceBundle } from "./types";

export interface AnswerabilityDecision {
  status: AnswerabilityStatus;
  rationale: string[];
}

export function classifyAnswerability(bundle: Pick<
  EvidenceBundle,
  | "evidence"
  | "conflicts"
  | "freshness"
  | "exactIdentifierValidation"
  | "aspectCoverage"
  | "authorityCoverage"
  | "diagnostics"
>): AnswerabilityDecision {
  const rationale: string[] = [];
  const mandatoryAspectIds = bundle.aspectCoverage.aspects
    .filter((aspect) => aspect.requirement === "mandatory")
    .map((aspect) => aspect.aspectId);
  const supportedMandatory = new Set(
    bundle.aspectCoverage.supportedMandatoryAspectIds
  );
  const supportedCount = mandatoryAspectIds.filter((aspectId) =>
    supportedMandatory.has(aspectId)
  ).length;
  if (mandatoryAspectIds.length === 0 || supportedCount === 0) {
    rationale.push("no_mandatory_aspect_has_direct_authoritative_support");
    return { status: "insufficient_evidence", rationale };
  }

  const hasCriticalConflict = bundle.conflicts.some((conflict) =>
    conflict.conflictType === "contradiction" || conflict.conflictType === "stale_vs_current"
  );
  if (hasCriticalConflict) {
    rationale.push("critical_conflict_present");
    if (mandatoryAspectIds.length === 1) {
      return { status: "insufficient_evidence", rationale };
    }
    return { status: "partial", rationale };
  }

  const freshnessLimited = bundle.freshness.state === "verification_required";
  const exactIdentifierLimited =
    bundle.exactIdentifierValidation.required &&
    !bundle.exactIdentifierValidation.verified;
  const allMandatorySupported = supportedCount === mandatoryAspectIds.length;
  const methodGaps = methodGapsForBundle({
    aspects: bundle.aspectCoverage.aspects,
    supportedMandatoryAspectIds:
      bundle.aspectCoverage.supportedMandatoryAspectIds,
    evidenceByAspect: bundle.aspectCoverage.evidenceByAspect,
    evidence: bundle.evidence
  });
  const methodLimited = methodGaps.length > 0;
  if (methodLimited) {
    rationale.push("requested_method_not_satisfied");
  }

  if (
    allMandatorySupported &&
    !freshnessLimited &&
    !exactIdentifierLimited &&
    !methodLimited
  ) {
    rationale.push("all_mandatory_aspects_have_direct_authoritative_support");
    return { status: "answered", rationale };
  }

  if (!allMandatorySupported) {
    rationale.push("incomplete_mandatory_aspect_support");
  }
  if (freshnessLimited) rationale.push("freshness_verification_required");
  if (exactIdentifierLimited) {
    rationale.push("required_exact_identifier_not_verified");
  }
  return { status: "partial", rationale };
}
