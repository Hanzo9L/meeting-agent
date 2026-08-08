import type {
  AnswerPlan,
  ClaimRealization,
  ClaimRealizationTask,
  GenerateGroundedAnswerOptions
} from "./types";

export interface ClaimRealizationResult {
  realization: ClaimRealization;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

export interface ClaimRealizationProvider {
  readonly providerId: string;
  realizeClaim(
    task: ClaimRealizationTask,
    context: {
      question: string;
      answerType: AnswerPlan["answerType"];
      answerability: "answered" | "partial";
    },
    options?: GenerateGroundedAnswerOptions
  ): Promise<ClaimRealizationResult>;
}
