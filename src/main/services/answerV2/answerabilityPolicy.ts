import type { AnswerabilityStatus, EvidenceBundle } from "./types";

export interface AnswerabilityDecision {
  status: AnswerabilityStatus;
  rationale: string[];
}

export function classifyAnswerability(bundle: Pick<
  EvidenceBundle,
  "evidence" | "conflicts" | "freshness" | "exactIdentifierValidation" | "authorityCoverage" | "diagnostics"
>): AnswerabilityDecision {
  const rationale: string[] = [];
  const hasEvidence = bundle.evidence.length > 0;
  if (!hasEvidence) {
    rationale.push("no_selected_evidence");
    return { status: "insufficient_evidence", rationale };
  }

  if (!bundle.exactIdentifierValidation.verified && bundle.exactIdentifierValidation.required) {
    rationale.push("required_exact_identifier_not_verified");
    return { status: "insufficient_evidence", rationale };
  }

  const hasCriticalConflict = bundle.conflicts.some((conflict) =>
    conflict.conflictType === "contradiction" || conflict.conflictType === "stale_vs_current"
  );
  if (hasCriticalConflict) {
    rationale.push("critical_conflict_present");
    return { status: "insufficient_evidence", rationale };
  }

  const missingAuthority = bundle.authorityCoverage.missingDomains.length > 0;
  const freshnessLimited = bundle.freshness.state === "verification_required";
  const conceptCoverage = bundle.diagnostics.policySignals.requiredConceptCoverage;
  const authoritativePresent = bundle.diagnostics.policySignals.authoritativeEvidencePresent;

  if (authoritativePresent && conceptCoverage && !missingAuthority && !freshnessLimited) {
    rationale.push("authoritative_evidence_sufficient");
    return { status: "answered", rationale };
  }

  if (authoritativePresent && (conceptCoverage || !missingAuthority)) {
    if (missingAuthority) rationale.push("missing_adjacent_domain_authority");
    if (freshnessLimited) rationale.push("freshness_verification_required");
    if (!conceptCoverage) rationale.push("incomplete_required_concept_support");
    return { status: "partial", rationale };
  }

  rationale.push("authoritative_support_insufficient");
  return { status: "insufficient_evidence", rationale };
}
