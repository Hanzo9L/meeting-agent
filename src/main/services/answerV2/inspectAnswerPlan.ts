import { buildAnswerPlan } from "./answerPlanner";
import { runQuestionToEvidenceBundle } from "./inspectEvidence";

export async function inspectAnswerPlanForQuestion(params: {
  question: string;
  databasePath?: string;
}): Promise<Record<string, unknown>> {
  const run = await runQuestionToEvidenceBundle({
    question: params.question,
    databasePath: params.databasePath
  });
  const plan = buildAnswerPlan(run.bundle);
  return {
    question: params.question,
    answerability: plan.answerability,
    answerType: plan.answerType,
    plannedStructure: plan.recommendedStructure,
    plannedClaims: plan.plannedClaims,
    requiredCaveats: plan.requiredCaveats,
    unsupportedAspects: plan.unsupportedAspects,
    freshnessInstructions: plan.freshnessInstructions,
    previewInstructions: plan.previewInstructions,
    exactIdentifierState: plan.exactIdentifierState,
    diagnostics: plan.diagnostics,
    evidenceDiagnostics: run.bundle.diagnostics
  };
}
