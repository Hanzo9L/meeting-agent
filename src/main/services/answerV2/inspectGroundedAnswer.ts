import { buildAnswerPlan } from "./answerPlanner";
import type { ClaimRealizationProvider } from "./answerGenerator";
import { FakeAnswerGenerator } from "./fakeAnswerGenerator";
import { generateGroundedAnswer } from "./groundedAnswerService";
import { runQuestionToEvidenceBundle } from "./inspectEvidence";
import { OpenAiGroundedAnswerGenerator } from "./openAiGroundedAnswerGenerator";

function resolveGenerator(preferredProvider?: "openai" | "fake"): ClaimRealizationProvider {
  const mode = preferredProvider ?? "openai";
  if (mode === "fake") {
    return new FakeAnswerGenerator();
  }
  const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
  if (!apiKey) {
    return new FakeAnswerGenerator();
  }
  return new OpenAiGroundedAnswerGenerator({ apiKey });
}

export async function inspectGroundedAnswerForQuestion(params: {
  question: string;
  databasePath?: string;
  provider?: "openai" | "fake";
}): Promise<Record<string, unknown>> {
  const run = await runQuestionToEvidenceBundle({
    question: params.question,
    databasePath: params.databasePath
  });
  const plan = buildAnswerPlan(run.bundle);
  const generator = resolveGenerator(params.provider);
  const grounded = await generateGroundedAnswer({
    plan,
    bundle: run.bundle,
    generator
  });
  return {
    question: params.question,
    provider: generator.providerId,
    answerability: plan.answerability,
    valid: grounded.ok,
    validationIssues: grounded.ok
      ? grounded.answer.validation.issues
      : [...grounded.failure.snapshotIssues, ...grounded.failure.groundingIssues],
    diagnostics: grounded.ok ? grounded.answer.diagnostics : grounded.failure.diagnostics,
    groundedAnswer: grounded.ok ? grounded.answer : undefined,
    failure: grounded.ok ? undefined : grounded.failure
  };
}
