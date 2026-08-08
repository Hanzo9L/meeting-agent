import type { ClaimRealizationProvider } from "./answerGenerator";
import { validateGroundingDecisionBoundary } from "./groundingDecisionSnapshot";
import { validateGroundedAnswer } from "./groundedAnswerValidator";
import type {
  AnswerPlan,
  ClaimRealization,
  ClaimRealizationTask,
  EvidenceBundle,
  GenerateGroundedAnswerOptions,
  GroundedAnswerDiagnostics,
  GroundedAnswerResult,
  GroundedAnswerDraft
} from "./types";

export interface GroundedAnswerServiceOptions extends GenerateGroundedAnswerOptions {
  schemaRetryLimit?: number;
  claimRetryLimit?: number;
}

const SECTION_LABELS: Partial<Record<ClaimRealizationTask["sectionId"], string>> = {
  direct_answer: "Direct answer",
  key_components: "Key components",
  relationships: "Relationships",
  prerequisites: "Prerequisites",
  steps: "Steps",
  validation: "Validation",
  behavior: "Behavior",
  parameters: "Parameters",
  examples: "Examples",
  checks: "Checks",
  corrective_actions: "Corrective actions",
  limitations: "Limitations",
  compared_dimensions: "Compared dimensions",
  caveats: "Caveats"
};

function toClaimTasks(plan: AnswerPlan, bundle: EvidenceBundle, includeOptionalClaims: boolean): ClaimRealizationTask[] {
  const evidenceById = new Map(bundle.evidence.map((item) => [item.evidenceId, item]));
  return plan.plannedClaims
    .filter((claim) => claim.mandatory || includeOptionalClaims)
    .map((claim) => ({
      claimId: claim.claimId,
      proposition: claim.proposition,
      claimType: claim.claimType,
      sectionId: claim.sectionId,
      requiresCaveat: claim.requiresCaveat,
      mandatory: claim.mandatory,
      authorityContext: claim.authorityContext.sourceIds,
      evidence: claim.evidenceIds
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter(Boolean)
        .map((evidence) => ({
          evidenceId: evidence!.evidenceId,
          title: evidence!.source.title,
          headingPath: evidence!.location.headingPath,
          excerpt: evidence!.text,
          sourceDomain: evidence!.source.sourceDomain,
          sourceStatus: evidence!.source.sourceStatus,
          authorityTier: evidence!.source.authorityTier
        }))
    }));
}

function renderCaveats(plan: AnswerPlan): GroundedAnswerDraft["caveats"] {
  return plan.requiredCaveats.map((caveat) => {
    const textByCode: Record<typeof caveat.code, string> = {
      partial_coverage: "Only part of the request is covered by authoritative evidence.",
      preview_evidence_used: "Some supporting evidence is preview/beta and may change.",
      freshness_verification_required: "Current availability was not live-verified.",
      unresolved_conflict: "Available authoritative sources contain unresolved conflicts.",
      missing_adjacent_authority: "Adjacent authority coverage is missing for portions of this request.",
      exact_identifier_unverified: "The requested exact identifier could not be verified in authoritative evidence."
    };
    return {
      code: caveat.code,
      text: textByCode[caveat.code] ?? caveat.detail
    };
  });
}

function renderUnsupported(plan: AnswerPlan): GroundedAnswerDraft["unsupportedAspects"] {
  return plan.unsupportedAspects.map((aspect) => ({
    aspectId: aspect.aspectId,
    text: aspect.detail
  }));
}

function assembleAnswerText(params: {
  plan: AnswerPlan;
  realizations: ClaimRealization[];
  caveats: GroundedAnswerDraft["caveats"];
  unsupportedAspects: GroundedAnswerDraft["unsupportedAspects"];
}): string {
  if (params.plan.answerability === "insufficient_evidence") {
    const missing = params.plan.exactIdentifierState.missingRequiredDirectives[0]?.value;
    const detail = params.unsupportedAspects[0]?.text ?? "The requested detail could not be verified.";
    const lead = missing
      ? `I couldn't verify ${missing} in the authoritative evidence available to me.`
      : "I couldn't verify the requested detail in the authoritative evidence available to me.";
    return `${lead} ${detail}`.trim();
  }

  const claimById = new Map(params.plan.plannedClaims.map((claim) => [claim.claimId, claim]));
  const bySection = new Map<string, string[]>();
  for (const realization of params.realizations) {
    const claim = claimById.get(realization.claimId);
    if (!claim) continue;
    const existing = bySection.get(claim.sectionId) ?? [];
    existing.push(realization.text.trim());
    bySection.set(claim.sectionId, existing);
  }
  const lines: string[] = [];
  for (const sectionId of params.plan.recommendedStructure.orderedSections) {
    const entries = bySection.get(sectionId) ?? [];
    if (entries.length === 0) continue;
    if (sectionId !== "direct_answer") {
      const label = SECTION_LABELS[sectionId] ?? sectionId;
      lines.push(`${label}:`);
    }
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }
  if (params.caveats.length > 0) {
    lines.push("Caveats:");
    for (const caveat of params.caveats) lines.push(`- ${caveat.text}`);
    lines.push("");
  }
  if (params.unsupportedAspects.length > 0) {
    lines.push("Not fully supported:");
    for (const aspect of params.unsupportedAspects) lines.push(`- ${aspect.text}`);
  }
  return lines.join("\n").trim();
}

export async function generateGroundedAnswer(params: {
  plan: AnswerPlan;
  bundle: EvidenceBundle;
  generator: ClaimRealizationProvider;
  options?: GroundedAnswerServiceOptions;
}): Promise<GroundedAnswerResult> {
  const serviceStart = Date.now();
  const boundaryValidation = validateGroundingDecisionBoundary({
    plan: params.plan,
    bundle: params.bundle
  });
  if (!boundaryValidation.valid) {
    return {
      ok: false,
      failure: {
        code: "decision_snapshot_mismatch",
        message: "Grounded answer generation rejected a mismatched or stale decision snapshot.",
        snapshotIssues: boundaryValidation.issues,
        groundingIssues: [],
        failedClaimIds: []
      }
    };
  }

  const claimRetryLimit = Math.min(1, Math.max(0, params.options?.claimRetryLimit ?? 1));
  const claimConcurrency = Math.max(1, Math.min(6, params.options?.claimConcurrency ?? 3));
  const includeOptionalClaims = Boolean(params.options?.includeOptionalClaims);
  let usage = { inputTokens: 0, outputTokens: 0 };
  let generationLatencyMs = 0;
  let requestCount = 0;
  let retryCount = 0;
  const attempts: GroundedAnswerDiagnostics["attempts"] = [];

  if (params.plan.answerability === "insufficient_evidence") {
    const caveats = renderCaveats(params.plan);
    const unsupportedAspects = renderUnsupported(params.plan);
    const draft: GroundedAnswerDraft = {
      answerText: assembleAnswerText({
        plan: params.plan,
        realizations: [],
        caveats,
        unsupportedAspects
      }),
      realizedClaims: [],
      caveats,
      unsupportedAspects
    };
    const validationStart = Date.now();
    const validation = validateGroundedAnswer({ plan: params.plan, bundle: params.bundle, draft });
    const validationLatencyMs = Date.now() - validationStart;
    const diagnostics: GroundedAnswerDiagnostics = {
      generatorProviderId: params.generator.providerId,
      generationLatencyMs: 0,
      validationLatencyMs,
      totalLatencyMs: Date.now() - serviceStart,
      claimTaskCount: 0,
      mandatoryClaimTaskCount: 0,
      successfulClaimCount: 0,
      failedClaimCount: 0,
      requestCount: 0,
      retryCount: 0,
      firstAttemptValid: validation.valid,
      finalAttemptValid: validation.valid,
      firstAttemptIssues: validation.issues,
      attempts: [],
      tokenUsage: { inputTokens: null, outputTokens: null }
    };
    if (!validation.valid) {
      return {
        ok: false,
        failure: {
          code: "grounding_validation_failed",
          message: "Grounded answer validation failed closed.",
          snapshotIssues: [],
          groundingIssues: validation.issues,
          failedClaimIds: [],
          diagnostics
        }
      };
    }
    return {
      ok: true,
      answer: {
        snapshotBinding: params.plan.snapshotBinding,
        answerability: params.plan.answerability,
        answerText: draft.answerText,
        realizedClaims: [],
        caveats: draft.caveats,
        unsupportedAspects: draft.unsupportedAspects,
        evidenceReferences: {
          usedEvidenceIds: params.plan.evidenceReferences.usedEvidenceIds,
          claimEvidenceMap: Object.fromEntries(
            params.plan.plannedClaims.map((claim) => [claim.claimId, claim.evidenceIds])
          )
        },
        freshnessState: params.plan.freshnessInstructions,
        previewState: params.plan.previewInstructions,
        exactIdentifierState: params.plan.exactIdentifierState,
        validation,
        diagnostics
      }
    };
  }

  const tasks = toClaimTasks(params.plan, params.bundle, includeOptionalClaims);
  const realizedClaims: ClaimRealization[] = [];
  const failedClaims = new Set<string>();
  const firstAttemptIssues: GroundedAnswerDiagnostics["firstAttemptIssues"] = [];

  let cursor = 0;
  const runClaim = async (task: ClaimRealizationTask): Promise<void> => {
    let attempt = 0;
    let previousIssues: GroundedAnswerDiagnostics["firstAttemptIssues"] = [];
    let previousText = "";
    while (attempt <= claimRetryLimit) {
      const mode: "initial" | "corrective" = attempt === 0 ? "initial" : "corrective";
      const started = Date.now();
      let realization: ClaimRealization | null = null;
      let attemptIssues: GroundedAnswerDiagnostics["firstAttemptIssues"] = [];
      let tokenUsage: { inputTokens: number | null; outputTokens: number | null } = {
        inputTokens: null,
        outputTokens: null
      };
      try {
        const generated = await params.generator.realizeClaim(
          task,
          {
            question: params.plan.question,
            answerType: params.plan.answerType,
            answerability: params.plan.answerability === "partial" ? "partial" : "answered"
          },
          {
            ...params.options,
            correction:
              mode === "corrective"
                ? {
                    previousText,
                    expectedClaimId: task.claimId,
                    issues: previousIssues
                  }
                : undefined
          }
        );
        realization = generated.realization;
        tokenUsage = generated.usage;
        if (realization.claimId !== task.claimId) {
          attemptIssues = [
            { code: "wrong_claim_id", message: `Expected ${task.claimId} but got ${realization.claimId}`, claimId: task.claimId }
          ];
        } else if (!realization.text.trim()) {
          attemptIssues = [{ code: "empty_claim_text", message: `Empty realization for ${task.claimId}`, claimId: task.claimId }];
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "claim_realization_failed";
        attemptIssues = [
          {
            code: "schema_invalid",
            message: `Claim realization failed for ${task.claimId}: ${message}`,
            claimId: task.claimId
          }
        ];
      }

      const latencyMs = Date.now() - started;
      generationLatencyMs += latencyMs;
      requestCount += 1;
      usage.inputTokens += tokenUsage.inputTokens ?? 0;
      usage.outputTokens += tokenUsage.outputTokens ?? 0;
      if (mode === "corrective") retryCount += 1;

      attempts.push({
        attempt: attempts.length + 1,
        mode,
        claimId: task.claimId,
        latencyMs,
        validationValid: attemptIssues.length === 0,
        validationIssueCodes: attemptIssues.map((issue) => issue.code),
        tokenUsage
      });
      if (mode === "initial") {
        firstAttemptIssues.push(...attemptIssues);
      }

      if (attemptIssues.length === 0 && realization) {
        realizedClaims.push(realization);
        return;
      }
      previousIssues = attemptIssues;
      previousText = realization?.text ?? "";
      if (attempt >= claimRetryLimit) {
        failedClaims.add(task.claimId);
        return;
      }
      attempt += 1;
    }
  };

  const workers = Array.from({ length: Math.min(claimConcurrency, tasks.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      await runClaim(tasks[idx]!);
    }
  });
  await Promise.all(workers);

  const caveats = renderCaveats(params.plan);
  const unsupportedAspects = renderUnsupported(params.plan);
  const draft: GroundedAnswerDraft = {
    answerText: assembleAnswerText({
      plan: params.plan,
      realizations: realizedClaims,
      caveats,
      unsupportedAspects
    }),
    realizedClaims: realizedClaims.map((item) => ({
      claimId: item.claimId,
      generatedText: item.text
    })),
    caveats,
    unsupportedAspects
  };

  const validationStart = Date.now();
  const validation = validateGroundedAnswer({
    plan: params.plan,
    bundle: params.bundle,
    draft,
    failedClaimIds: failedClaims
  });
  const validationLatencyMs = Date.now() - validationStart;

  const claimById = new Map(params.plan.plannedClaims.map((claim) => [claim.claimId, claim]));
  const mappedRealizedClaims = draft.realizedClaims.map((claim) => ({
    claimId: claim.claimId,
    generatedText: claim.generatedText,
    evidenceIds: claimById.get(claim.claimId)?.evidenceIds ?? []
  }));

  const diagnostics: GroundedAnswerDiagnostics = {
    generatorProviderId: params.generator.providerId,
    generationLatencyMs,
    validationLatencyMs,
    totalLatencyMs: Date.now() - serviceStart,
    claimTaskCount: tasks.length,
    mandatoryClaimTaskCount: tasks.filter((task) => task.mandatory).length,
    successfulClaimCount: realizedClaims.length,
    failedClaimCount: failedClaims.size,
    requestCount,
    retryCount,
    firstAttemptValid: firstAttemptIssues.length === 0,
    finalAttemptValid: validation.valid,
    firstAttemptIssues,
    attempts,
    tokenUsage: {
      inputTokens: usage.inputTokens || null,
      outputTokens: usage.outputTokens || null
    }
  };
  if (!validation.valid) {
    return {
      ok: false,
      failure: {
        code: "grounding_validation_failed",
        message: "Grounded answer validation failed closed.",
        snapshotIssues: [],
        groundingIssues: validation.issues,
        failedClaimIds: [...failedClaims],
        diagnostics
      }
    };
  }
  return {
    ok: true,
    answer: {
      snapshotBinding: params.plan.snapshotBinding,
      answerability: params.plan.answerability,
      answerText: draft.answerText,
      realizedClaims: mappedRealizedClaims,
      caveats: draft.caveats,
      unsupportedAspects: draft.unsupportedAspects,
      evidenceReferences: {
        usedEvidenceIds: params.plan.evidenceReferences.usedEvidenceIds,
        claimEvidenceMap: Object.fromEntries(
          params.plan.plannedClaims.map((claim) => [claim.claimId, claim.evidenceIds])
        )
      },
      freshnessState: params.plan.freshnessInstructions,
      previewState: params.plan.previewInstructions,
      exactIdentifierState: params.plan.exactIdentifierState,
      validation,
      diagnostics
    }
  };
}
