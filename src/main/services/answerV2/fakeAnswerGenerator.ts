import type {
  ClaimRealizationTask,
  GenerateGroundedAnswerOptions,
  AnswerPlan
} from "./types";
import type { ClaimRealizationProvider, ClaimRealizationResult } from "./answerGenerator";

export class FakeAnswerGenerator implements ClaimRealizationProvider {
  readonly providerId = "fake";

  async realizeClaim(
    task: ClaimRealizationTask,
    _context: {
      question: string;
      answerType: AnswerPlan["answerType"];
      answerability: "answered" | "partial";
    },
    _options?: GenerateGroundedAnswerOptions
  ): Promise<ClaimRealizationResult> {
    return {
      realization: {
        claimId: task.claimId,
        text: task.proposition
      },
      usage: {
        inputTokens: null,
        outputTokens: null
      }
    };
  }
}
