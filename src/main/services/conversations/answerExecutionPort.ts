export interface AnswerExecutionRequest {
  conversationId: string;
  userMessageId: string;
  question: string;
}

export interface AnswerUnavailableResult {
  ok: false;
  code: "answer_unavailable";
}

export interface AnswerExecutionPort {
  execute(request: AnswerExecutionRequest): Promise<AnswerUnavailableResult>;
}

/**
 * Slice 2 intentionally has no answer backend. This adapter is the only answer
 * execution implementation and always fails closed without producing text.
 */
export class UnavailableAnswerExecutionPort implements AnswerExecutionPort {
  async execute(_request: AnswerExecutionRequest): Promise<AnswerUnavailableResult> {
    return {
      ok: false,
      code: "answer_unavailable"
    };
  }
}
