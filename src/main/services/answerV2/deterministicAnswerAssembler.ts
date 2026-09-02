import { performance } from "node:perf_hooks";
import { validateAnswerPlanIntegrity } from "./answerPlanIntegrity";
import { validateGroundingDecisionBoundary } from "./groundingDecisionSnapshot";
import type {
  AnswerPlan,
  EvidenceBundle,
  ExtractiveAssemblyIssue,
  ExtractiveAssemblyProvenance,
  ExtractiveAssemblerPolicyVersion,
  ExtractivePolicyUnit,
  ExtractiveRenderedClaim,
  GroundedAnswerDiagnostics,
  GroundedAnswerResult,
  PlannedClaim
} from "./types";

export const EXTRACTIVE_ASSEMBLER_POLICY_VERSION: ExtractiveAssemblerPolicyVersion =
  "deterministic-extractive-assembler/r4";

type RenderedClaimText = {
  text: string;
  transformation: ExtractiveRenderedClaim["transformation"];
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderClaimText(claim: PlannedClaim): RenderedClaimText {
  const original = claim.proposition.trim();
  let text = normalizeWhitespace(original);
  let transformation: ExtractiveRenderedClaim["transformation"] =
    text === original ? "none" : "whitespace_normalized";

  if (text.startsWith("|")) {
    const cells = text
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length > 1) {
      text = cells[cells.length - 1] ?? text;
      transformation = "source_artifact_removed";
    }
  }
  const withoutPrompt = text.replace(/^PS\s+[^>]*>\s*/i, "");
  if (withoutPrompt !== text) {
    text = withoutPrompt;
    transformation = "source_artifact_removed";
  }
  const withoutFences = text
    .replace(/^```[a-z0-9_-]*\s*/i, "")
    .replace(/\s*```$/i, "");
  if (withoutFences !== text) {
    text = withoutFences;
    transformation = "source_artifact_removed";
  }

  return {
    text: normalizeWhitespace(text),
    transformation
  };
}

function claimPropositionIsSourceBound(claim: PlannedClaim): boolean {
  const proposition = normalizeWhitespace(claim.proposition);
  const spanTexts = claim.sourceSpans.map((span) =>
    normalizeWhitespace(span.text)
  );
  if (spanTexts.some((text) => text === proposition)) return true;
  const uniqueInOrder = spanTexts.filter(
    (text, index) => spanTexts.indexOf(text) === index
  );
  return uniqueInOrder.join(" — ") === proposition;
}

function renderedTextIsAuthorized(
  claim: PlannedClaim,
  rendered: RenderedClaimText
): boolean {
  if (!rendered.text) return false;
  const proposition = normalizeWhitespace(claim.proposition);
  return (
    proposition === rendered.text ||
    proposition.includes(rendered.text)
  );
}

function assemblyDiagnostics(params: {
  started: number;
  validationLatencyMs: number;
  claimCount: number;
  mandatoryCount: number;
  valid: boolean;
}): GroundedAnswerDiagnostics {
  return {
    generatorProviderId: EXTRACTIVE_ASSEMBLER_POLICY_VERSION,
    generationLatencyMs: 0,
    validationLatencyMs: params.validationLatencyMs,
    totalLatencyMs: performance.now() - params.started,
    claimTaskCount: params.claimCount,
    mandatoryClaimTaskCount: params.mandatoryCount,
    successfulClaimCount: params.valid ? params.claimCount : 0,
    failedClaimCount: params.valid ? 0 : params.mandatoryCount,
    requestCount: 0,
    retryCount: 0,
    firstAttemptValid: params.valid,
    finalAttemptValid: params.valid,
    firstAttemptIssues: [],
    attempts: [],
    tokenUsage: {
      inputTokens: null,
      outputTokens: null
    }
  };
}

function validateAssemblyOrder(plan: AnswerPlan): ExtractiveAssemblyIssue[] {
  const issues: ExtractiveAssemblyIssue[] = [];
  const sequences = plan.plannedClaims.map(
    (claim) => claim.ordering.sequence
  );
  if (
    sequences.some(
      (sequence, index) =>
        sequence !== index + 1 ||
        sequences.indexOf(sequence) !== index
    )
  ) {
    issues.push({
      code: "invalid_claim_order",
      message: "Planned claim sequence is not contiguous and deterministic."
    });
  }

  const procedureClaims = plan.plannedClaims.filter(
    (claim) => claim.claimType === "procedure_step"
  );
  let previousStep: number | null = null;
  let previousSourceOrder = -1;
  for (const claim of procedureClaims) {
    const step = claim.ordering.procedureStep;
    if (
      (step !== null &&
        previousStep !== null &&
        step <= previousStep) ||
      (step === null &&
        claim.ordering.sourceOrder < previousSourceOrder)
    ) {
      issues.push({
        code: "invalid_procedure_order",
        message: "Procedure claims are not in documented source order.",
        claimId: claim.claimId
      });
      break;
    }
    if (step !== null) previousStep = step;
    previousSourceOrder = claim.ordering.sourceOrder;
  }
  return issues;
}

class AnswerTextBuilder {
  text = "";
  readonly renderedClaims: ExtractiveRenderedClaim[] = [];
  readonly policyUnits: ExtractivePolicyUnit[] = [];

  appendStructural(value: string): void {
    this.text += value;
  }

  appendClaim(
    claim: PlannedClaim,
    rendered: RenderedClaimText,
    prefix = ""
  ): void {
    this.text += prefix;
    const startOffset = this.text.length;
    this.text += rendered.text;
    this.renderedClaims.push({
      claimId: claim.claimId,
      requiredAspectId: claim.requiredAspectId,
      sectionId: claim.sectionId,
      status: claim.status,
      renderedText: rendered.text,
      transformation: rendered.transformation,
      evidenceIds: [...claim.evidenceIds],
      sourceSpans: claim.sourceSpans.map((span) => ({
        ...span,
        headingPath: [...span.headingPath]
      })),
      answerTextRange: {
        startOffset,
        endOffset: this.text.length
      }
    });
  }

  appendPolicyUnit(params: {
    kind: ExtractivePolicyUnit["kind"];
    code: string;
    text: string;
    prefix?: string;
  }): void {
    this.text += params.prefix ?? "";
    const startOffset = this.text.length;
    this.text += params.text;
    this.policyUnits.push({
      kind: params.kind,
      code: params.code,
      text: params.text,
      answerTextRange: {
        startOffset,
        endOffset: this.text.length
      }
    });
  }
}

function appendClaims(params: {
  builder: AnswerTextBuilder;
  plan: AnswerPlan;
  claims: Array<{ claim: PlannedClaim; rendered: RenderedClaimText }>;
}): void {
  const { builder, plan, claims } = params;
  if (claims.length === 0) return;
  const procedural =
    plan.answerType === "procedural" ||
    plan.answerType === "configuration";
  if (procedural) {
    builder.appendStructural("Steps:\n");
    claims.forEach(({ claim, rendered }, index) => {
      if (index > 0) builder.appendStructural("\n");
      builder.appendClaim(claim, rendered, "- ");
    });
    return;
  }
  claims.forEach(({ claim, rendered }, index) => {
    if (index > 0) builder.appendStructural("\n\n");
    builder.appendClaim(claim, rendered);
  });
}

function appendPolicyDecisions(params: {
  builder: AnswerTextBuilder;
  plan: AnswerPlan;
}): void {
  const { builder, plan } = params;
  if (plan.unsupportedAspects.length > 0) {
    if (builder.text.length > 0) builder.appendStructural("\n\n");
    builder.appendStructural("Limitations:\n");
    plan.unsupportedAspects.forEach((aspect, index) => {
      if (index > 0) builder.appendStructural("\n");
      builder.appendPolicyUnit({
        kind: "unsupported_aspect",
        code: aspect.reason,
        text: normalizeWhitespace(aspect.detail),
        prefix: "- "
      });
    });
  }
  if (plan.requiredCaveats.length > 0) {
    if (builder.text.length > 0) builder.appendStructural("\n\n");
    builder.appendStructural("Caveats:\n");
    plan.requiredCaveats.forEach((caveat, index) => {
      if (index > 0) builder.appendStructural("\n");
      builder.appendPolicyUnit({
        kind: "caveat",
        code: caveat.code,
        text: normalizeWhitespace(caveat.detail),
        prefix: "- "
      });
    });
  }
}

function failure(params: {
  code: "answer_plan_integrity_failed" | "assembly_validation_failed";
  message: string;
  started: number;
  validationLatencyMs: number;
  plan: AnswerPlan;
  planIntegrityIssues?: ReturnType<
    typeof validateAnswerPlanIntegrity
  >["issues"];
  assemblyIssues?: ExtractiveAssemblyIssue[];
}): GroundedAnswerResult {
  return {
    ok: false,
    failure: {
      code: params.code,
      message: params.message,
      snapshotIssues: [],
      groundingIssues: [],
      failedClaimIds: params.plan.plannedClaims
        .filter((claim) => claim.mandatory)
        .map((claim) => claim.claimId),
      planIntegrityIssues: params.planIntegrityIssues,
      assemblyIssues: params.assemblyIssues,
      diagnostics: assemblyDiagnostics({
        started: params.started,
        validationLatencyMs: params.validationLatencyMs,
        claimCount: params.plan.plannedClaims.length,
        mandatoryCount: params.plan.plannedClaims.filter(
          (claim) => claim.mandatory
        ).length,
        valid: false
      })
    }
  };
}

export function assembleDeterministicAnswer(params: {
  plan: AnswerPlan;
  bundle: EvidenceBundle;
}): GroundedAnswerResult {
  const started = performance.now();
  const validationStarted = performance.now();
  const boundary = validateGroundingDecisionBoundary(params);
  if (!boundary.valid) {
    return {
      ok: false,
      failure: {
        code: "decision_snapshot_mismatch",
        message:
          "Deterministic assembly rejected a mismatched or stale grounding snapshot.",
        snapshotIssues: boundary.issues,
        groundingIssues: [],
        failedClaimIds: [],
        diagnostics: assemblyDiagnostics({
          started,
          validationLatencyMs: performance.now() - validationStarted,
          claimCount: 0,
          mandatoryCount: 0,
          valid: false
        })
      }
    };
  }

  const integrity = validateAnswerPlanIntegrity(params);
  const validationLatencyMs = performance.now() - validationStarted;
  if (!integrity.valid) {
    return failure({
      code: "answer_plan_integrity_failed",
      message:
        "Deterministic assembly rejected an invalid source-bound answer plan.",
      started,
      validationLatencyMs,
      plan: params.plan,
      planIntegrityIssues: integrity.issues
    });
  }

  const assemblyIssues = validateAssemblyOrder(params.plan);
  if (
    params.plan.answerability === "insufficient_evidence" &&
    params.plan.plannedClaims.length > 0
  ) {
    assemblyIssues.push({
      code: "insufficient_contains_claims",
      message:
        "An insufficient-evidence plan cannot contain renderable factual claims."
    });
  }

  const selectedClaims =
    params.plan.answerability === "insufficient_evidence"
      ? []
      : [...params.plan.plannedClaims].sort(
          (left, right) =>
            left.ordering.sequence - right.ordering.sequence
        );
  const rendered = selectedClaims.map((claim) => ({
    claim,
    rendered: renderClaimText(claim)
  }));
  for (const item of rendered) {
    if (!item.rendered.text) {
      assemblyIssues.push({
        code: "empty_rendered_claim",
        message: `Claim rendered to empty text: ${item.claim.claimId}`,
        claimId: item.claim.claimId
      });
    }
    if (
      !claimPropositionIsSourceBound(item.claim) ||
      !renderedTextIsAuthorized(item.claim, item.rendered)
    ) {
      assemblyIssues.push({
        code: "rendered_claim_not_source_bound",
        message: `Rendered claim is not reconstructable from its exact source spans: ${item.claim.claimId}`,
        claimId: item.claim.claimId
      });
    }
  }

  const renderedIds = new Set(rendered.map(({ claim }) => claim.claimId));
  for (const claim of params.plan.plannedClaims.filter(
    (candidate) => candidate.mandatory
  )) {
    if (!renderedIds.has(claim.claimId)) {
      assemblyIssues.push({
        code: "missing_mandatory_claim",
        message: `Mandatory claim was not selected for rendering: ${claim.claimId}`,
        claimId: claim.claimId
      });
    }
  }
  if (assemblyIssues.length > 0) {
    return failure({
      code: "assembly_validation_failed",
      message:
        "Deterministic assembly failed closed before producing factual output.",
      started,
      validationLatencyMs,
      plan: params.plan,
      assemblyIssues
    });
  }

  const emittedClaimTexts = new Set<string>();
  const renderedForPresentation = rendered.filter(({ rendered: claimText }) => {
    const normalizedText = normalizeWhitespace(claimText.text);
    if (emittedClaimTexts.has(normalizedText)) return false;
    emittedClaimTexts.add(normalizedText);
    return true;
  });

  const builder = new AnswerTextBuilder();
  if (params.plan.answerability === "insufficient_evidence") {
    builder.appendStructural(
      "Unable to provide a factual answer from the approved evidence."
    );
  } else {
    appendClaims({
      builder,
      plan: params.plan,
      claims: renderedForPresentation
    });
  }
  appendPolicyDecisions({
    builder,
    plan: params.plan
  });

  const omittedClaimIds = params.plan.plannedClaims
    .map((claim) => claim.claimId)
    .filter((claimId) => !renderedIds.has(claimId));
  const provenance: ExtractiveAssemblyProvenance = {
    assemblerPolicyVersion: EXTRACTIVE_ASSEMBLER_POLICY_VERSION,
    planId: params.plan.planIdentity.planId,
    planHash: params.plan.planIdentity.planHash,
    renderedClaims: builder.renderedClaims,
    omittedClaimIds,
    policyUnits: builder.policyUnits,
    validation: {
      valid: true,
      issues: []
    },
    factualTextAudit: {
      factualUnitCount: builder.renderedClaims.length,
      allFactualUnitsAttributed: builder.renderedClaims.every(
        (claim) =>
          claim.sourceSpans.length > 0 &&
          claim.answerTextRange.endOffset >
            claim.answerTextRange.startOffset &&
          builder.text.slice(
            claim.answerTextRange.startOffset,
            claim.answerTextRange.endOffset
          ) === claim.renderedText
      ),
      unattributedText: []
    }
  };
  if (!provenance.factualTextAudit.allFactualUnitsAttributed) {
    return failure({
      code: "assembly_validation_failed",
      message:
        "Deterministic assembly detected factual text without exact claim provenance.",
      started,
      validationLatencyMs,
      plan: params.plan,
      assemblyIssues: [
        {
          code: "rendered_claim_not_source_bound",
          message:
            "At least one rendered factual unit does not match its recorded answer-text range."
        }
      ]
    });
  }
  const mandatoryClaims = params.plan.plannedClaims.filter(
    (claim) => claim.mandatory
  );
  const diagnostics = assemblyDiagnostics({
    started,
    validationLatencyMs,
    claimCount: builder.renderedClaims.length,
    mandatoryCount: mandatoryClaims.length,
    valid: true
  });

  return {
    ok: true,
    answer: {
      snapshotBinding: params.plan.snapshotBinding,
      answerability: params.plan.answerability,
      answerText: builder.text,
      realizedClaims: builder.renderedClaims.map((claim) => ({
        claimId: claim.claimId,
        generatedText: claim.renderedText,
        evidenceIds: claim.evidenceIds
      })),
      caveats: params.plan.requiredCaveats.map((caveat) => ({
        code: caveat.code,
        text: normalizeWhitespace(caveat.detail)
      })),
      unsupportedAspects: params.plan.unsupportedAspects.map((aspect) => ({
        aspectId: aspect.aspectId,
        text: normalizeWhitespace(aspect.detail)
      })),
      evidenceReferences: {
        usedEvidenceIds: [
          ...new Set(
            builder.renderedClaims.flatMap(
              (claim) => claim.evidenceIds
            )
          )
        ],
        claimEvidenceMap: Object.fromEntries(
          builder.renderedClaims.map((claim) => [
            claim.claimId,
            claim.evidenceIds
          ])
        )
      },
      freshnessState: params.plan.freshnessInstructions,
      previewState: params.plan.previewInstructions,
      exactIdentifierState: params.plan.exactIdentifierState,
      validation: {
        valid: true,
        issues: [],
        coverage: {
          mandatoryClaimsTotal: mandatoryClaims.length,
          mandatoryClaimsRealized: mandatoryClaims.length,
          unknownClaimCount: 0,
          missingCaveatCount: 0
        }
      },
      diagnostics,
      extractiveAssembly: provenance
    }
  };
}
