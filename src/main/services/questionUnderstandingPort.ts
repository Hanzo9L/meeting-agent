import type { CaptureSourceTag } from "@shared/types";

export interface QuestionFacet {
  id: string;
  query: string;
  label: string;
}

export interface QuestionUnderstandingResult {
  decision: "continue" | "complete";
  /** Coordinator-owned exact accumulated STT text; never model-generated. */
  originalQuestion?: string;
  normalizedQuestion?: string;
  facets?: QuestionFacet[];
  confidence: number;
  reason: string;
  diagnostics?: {
    provider: string;
    model: string;
    latencyMs: number;
    reasoningEffort?: "low" | "medium";
    requestStartedAtMs?: number;
    responseCompletedAtMs?: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  };
}

export interface QuestionUnderstandingInput {
  text: string;
  source: CaptureSourceTag;
  utteranceCount: number;
}

export type QuestionUnderstandingFailureKind =
  | "permanent"
  | "transient";

export class QuestionUnderstandingFailure extends Error {
  constructor(
    readonly code: string,
    readonly kind: QuestionUnderstandingFailureKind,
    message = code,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "QuestionUnderstandingFailure";
  }
}

export function classifyQuestionUnderstandingFailure(
  error: unknown
): QuestionUnderstandingFailure {
  if (error instanceof QuestionUnderstandingFailure) return error;
  const record =
    typeof error === "object" && error !== null
      ? error as Record<string, unknown>
      : null;
  const message =
    error instanceof Error ? error.message : "question_understanding_failed";
  const normalized = message.toLowerCase();
  const status =
    typeof record?.["status"] === "number"
      ? record["status"]
      : null;
  const permanent =
    normalized.includes("model_not_configured") ||
    normalized.includes("api_key_missing") ||
    normalized.includes("provider_construction") ||
    normalized.includes("invalid_model") ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422;
  return new QuestionUnderstandingFailure(
    permanent
      ? "question_understanding_configuration_error"
      : normalized.includes("timeout")
        ? "question_understanding_timeout"
        : "question_understanding_provider_error",
    permanent ? "permanent" : "transient",
    message,
    error instanceof Error ? { cause: error } : undefined
  );
}

export interface QuestionUnderstandingPort {
  understand(
    input: QuestionUnderstandingInput
  ): Promise<QuestionUnderstandingResult>;
}
