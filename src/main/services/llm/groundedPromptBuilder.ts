import type {
  AnswerPlan,
  ClaimRealizationTask,
  CorrectiveRetryInput
} from "../answerV2/types";

export interface GroundedPromptPayload {
  system: string;
  user: string;
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildGroundedPrompt(params: {
  task: ClaimRealizationTask;
  context: {
    question: string;
    answerType: AnswerPlan["answerType"];
    answerability: "answered" | "partial";
  };
  correction?: CorrectiveRetryInput;
}): GroundedPromptPayload {
  const system = [
    "You realize exactly one approved claim.",
    "Do not research, retrieve, or add facts beyond the claim proposition and evidence context.",
    "Do not add cmdlets, parameters, prerequisites, licensing assumptions, or adjacent technical claims.",
    "Return strict JSON only: {\"claimId\": string, \"text\": string}.",
    "claimId must exactly equal the requested claimId.",
    "text must be concise, technically precise, and non-empty."
  ].join("\n");

  const userPayload = {
    question: params.context.question,
    answerType: params.context.answerType,
    answerability: params.context.answerability,
    claimTask: {
      claimId: params.task.claimId,
      claimType: params.task.claimType,
      sectionId: params.task.sectionId,
      proposition: params.task.proposition,
      requiresCaveat: params.task.requiresCaveat,
      authorityContext: params.task.authorityContext,
      evidence: params.task.evidence.map((entry) => ({
        ...entry,
        excerpt: compact(entry.excerpt).slice(0, 700)
      }))
    }
  };

  const instructions = ["Express this claim naturally while preserving technical meaning."];
  if (params.correction) {
    instructions.push(
      "This is a corrective retry. Fix only the listed structural grounding issues.",
      "Do not change claim scope, evidence scope, or factual meaning."
    );
  }
  const userSections = [instructions.join("\n"), JSON.stringify(userPayload, null, 2)];
  if (params.correction) {
    userSections.push(
      JSON.stringify(
        {
          correctiveRetry: {
            issues: params.correction.issues,
            previousText: params.correction.previousText,
            expectedClaimId: params.correction.expectedClaimId
          }
        },
        null,
        2
      )
    );
  }
  const user = userSections.join("\n\n");

  return { system, user };
}
