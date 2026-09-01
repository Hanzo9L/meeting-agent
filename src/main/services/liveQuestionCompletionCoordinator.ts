import { performance } from "node:perf_hooks";
import type { CaptureSourceTag } from "@shared/types";
import { assessQuestionCompleteness } from "./questionCompletenessGuard";
import type { SourceCompletedUtterance } from "./crossSourceUtteranceArbiter";
import type {
  QuestionUnderstandingPort,
  QuestionUnderstandingResult
} from "./questionUnderstandingPort";
import {
  classifyQuestionUnderstandingFailure,
  type QuestionUnderstandingFailureKind
} from "./questionUnderstandingPort";

export const THOUGHT_CONTINUE_STATUS =
  "thought incomplete — waiting for the speaker to continue";
export const THOUGHT_UNDERSTANDING_ERROR_STATUS =
  "Question understanding unavailable";

interface ThoughtContribution {
  utteranceId: string;
  text: string;
  source: CaptureSourceTag;
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
  arrivalSequence: number;
}

interface ThoughtAccumulator {
  source: CaptureSourceTag;
  utterances: ThoughtContribution[];
  text: string;
  transientFailures: number;
}

export interface QuestionUnderstandingDiagnostic {
  sessionId: string;
  source: CaptureSourceTag;
  bufferVersion: number;
  utteranceCount: number;
  requestAttempted: boolean;
  outcome: "continue" | "complete" | "error" | "stale";
  model: string | null;
  reasoningEffort: "low" | "medium" | null;
  latencyMs: number | null;
  requestStartedAtMs: number | null;
  responseCompletedAtMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  errorCode: string | null;
  failureKind: QuestionUnderstandingFailureKind | null;
  resetReason: string | null;
}

export type LiveQuestionCompletionOutcome =
  | {
      state: "continue";
      bufferVersion: number;
      text: string;
      semanticCallMade: boolean;
      result?: QuestionUnderstandingResult;
    }
  | {
      state: "complete";
      bufferVersion: number;
      text: string;
      result: QuestionUnderstandingResult & {
        decision: "complete";
        normalizedQuestion: string;
      };
    }
  | {
      state: "error";
      bufferVersion: number;
      text: string;
      error: unknown;
      failureKind: QuestionUnderstandingFailureKind;
      errorCode: string;
      bufferReset: boolean;
      resetReason: string | null;
    }
  | {
      state: "stale";
      bufferVersion: number;
      text: string;
    };

function appendThought(
  current: ThoughtAccumulator | undefined,
  input: SourceCompletedUtterance,
  arrivalSequence: number
): ThoughtAccumulator {
  const utterances = [
    ...(current?.utterances ?? []),
    {
      utteranceId: input.utterance.utteranceId,
      text: input.utterance.text.trim(),
      source: input.source,
      sourceStartSeconds: input.utterance.sourceStartSeconds,
      sourceEndSeconds: input.utterance.sourceEndSeconds,
      arrivalSequence
    }
  ];
  return {
    source: input.source,
    utterances,
    transientFailures: current?.transientFailures ?? 0,
    text: utterances
      .map((item) => item.text)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  };
}

export class LiveQuestionCompletionCoordinator {
  private readonly thoughts = new Map<
    CaptureSourceTag,
    ThoughtAccumulator
  >();
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private nextArrivalSequence = 1;

  constructor(
    private readonly understanding: QuestionUnderstandingPort,
    private readonly onDiagnostic:
      | ((diagnostic: QuestionUnderstandingDiagnostic) => void)
      | null = null
  ) {}

  submit(
    input: SourceCompletedUtterance
  ): Promise<LiveQuestionCompletionOutcome> {
    const generation = this.generation;
    const result = this.queue.then(() =>
      this.process(input, generation)
    );
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  reset(): void {
    this.generation += 1;
    this.nextArrivalSequence = 1;
    this.thoughts.clear();
  }

  private async process(
    input: SourceCompletedUtterance,
    generation: number
  ): Promise<LiveQuestionCompletionOutcome> {
    if (generation !== this.generation) {
      this.emitDiagnostic(input, 0, 0, false, "stale", {
        resetReason: "session_reset"
      });
      return {
        state: "stale",
        bufferVersion: 0,
        text: input.utterance.text.trim()
      };
    }
    const thought = appendThought(
      this.thoughts.get(input.source),
      input,
      this.nextArrivalSequence
    );
    const bufferVersion = this.nextArrivalSequence;
    this.nextArrivalSequence += 1;
    this.thoughts.set(input.source, thought);
    const deterministic = assessQuestionCompleteness(thought.text);
    if (
      !deterministic.complete &&
      thought.utterances.length === 1
    ) {
      this.emitDiagnostic(
        input,
        this.nextArrivalSequence - 1,
        thought.utterances.length,
        false,
        "continue"
      );
      return {
        state: "continue",
        bufferVersion,
        text: thought.text,
        semanticCallMade: false
      };
    }

    let result: QuestionUnderstandingResult;
    const semanticStartedAtMs = Date.now();
    const semanticStarted = performance.now();
    try {
      result = await this.understanding.understand({
        text: thought.text,
        source: thought.source,
        utteranceCount: thought.utterances.length
      });
    } catch (error) {
      const failure = classifyQuestionUnderstandingFailure(error);
      const bufferReset =
        failure.kind === "permanent" ||
        thought.transientFailures >= 1;
      const resetReason = bufferReset
        ? failure.kind === "permanent"
          ? "permanent_provider_failure"
          : "transient_recovery_exhausted"
        : null;
      if (bufferReset) {
        this.thoughts.delete(input.source);
      } else {
        thought.transientFailures += 1;
      }
      this.emitDiagnostic(
        input,
        this.nextArrivalSequence - 1,
        thought.utterances.length,
        true,
        "error",
        {
          latencyMs: performance.now() - semanticStarted,
          requestStartedAtMs: semanticStartedAtMs,
          responseCompletedAtMs: Date.now(),
          errorCode: failure.code,
          failureKind: failure.kind,
          resetReason
        }
      );
      return {
        state: "error",
        bufferVersion,
        text: thought.text,
        error: failure,
        failureKind: failure.kind,
        errorCode: failure.code,
        bufferReset,
        resetReason
      };
    }
    if (generation !== this.generation) {
      this.emitDiagnostic(
        input,
        this.nextArrivalSequence - 1,
        thought.utterances.length,
        true,
        "stale",
        {
          latencyMs: performance.now() - semanticStarted,
          model: result.diagnostics?.model ?? null,
          reasoningEffort:
            result.diagnostics?.reasoningEffort ?? null,
          requestStartedAtMs:
            result.diagnostics?.requestStartedAtMs ??
            semanticStartedAtMs,
          responseCompletedAtMs:
            result.diagnostics?.responseCompletedAtMs ??
            Date.now(),
          inputTokens: result.diagnostics?.inputTokens ?? null,
          outputTokens: result.diagnostics?.outputTokens ?? null,
          totalTokens: result.diagnostics?.totalTokens ?? null,
          resetReason: "session_reset"
        }
      );
      return { state: "stale", bufferVersion, text: thought.text };
    }
    if (result.decision === "continue") {
      this.emitDiagnostic(
        input,
        this.nextArrivalSequence - 1,
        thought.utterances.length,
        true,
        "continue",
        {
          latencyMs:
            result.diagnostics?.latencyMs ??
            performance.now() - semanticStarted,
          model: result.diagnostics?.model ?? null,
          reasoningEffort:
            result.diagnostics?.reasoningEffort ?? null,
          requestStartedAtMs:
            result.diagnostics?.requestStartedAtMs ??
            semanticStartedAtMs,
          responseCompletedAtMs:
            result.diagnostics?.responseCompletedAtMs ??
            Date.now(),
          inputTokens: result.diagnostics?.inputTokens ?? null,
          outputTokens: result.diagnostics?.outputTokens ?? null,
          totalTokens: result.diagnostics?.totalTokens ?? null
        }
      );
      return {
        state: "continue",
        bufferVersion,
        text: thought.text,
        semanticCallMade: true,
        result
      };
    }

    const normalizedQuestion = result.normalizedQuestion?.trim();
    if (!normalizedQuestion) {
      this.thoughts.delete(input.source);
      this.emitDiagnostic(
        input,
        this.nextArrivalSequence - 1,
        thought.utterances.length,
        true,
        "error",
        {
          latencyMs:
            result.diagnostics?.latencyMs ??
            performance.now() - semanticStarted,
          model: result.diagnostics?.model ?? null,
          reasoningEffort:
            result.diagnostics?.reasoningEffort ?? null,
          requestStartedAtMs:
            result.diagnostics?.requestStartedAtMs ??
            semanticStartedAtMs,
          responseCompletedAtMs:
            result.diagnostics?.responseCompletedAtMs ??
            Date.now(),
          inputTokens: result.diagnostics?.inputTokens ?? null,
          outputTokens: result.diagnostics?.outputTokens ?? null,
          totalTokens: result.diagnostics?.totalTokens ?? null,
          errorCode: "normalized_question_missing",
          failureKind: "permanent",
          resetReason: "invalid_semantic_result"
        }
      );
      return {
        state: "error",
        bufferVersion,
        text: thought.text,
        error: new Error(
          "complete question understanding omitted normalizedQuestion"
        ),
        failureKind: "permanent",
        errorCode: "normalized_question_missing",
        bufferReset: true,
        resetReason: "invalid_semantic_result"
      };
    }
    this.thoughts.delete(input.source);
    this.emitDiagnostic(
      input,
      this.nextArrivalSequence - 1,
      thought.utterances.length,
      true,
      "complete",
      {
        latencyMs:
          result.diagnostics?.latencyMs ??
          performance.now() - semanticStarted,
        model: result.diagnostics?.model ?? null,
        reasoningEffort:
          result.diagnostics?.reasoningEffort ?? null,
        requestStartedAtMs:
          result.diagnostics?.requestStartedAtMs ??
          semanticStartedAtMs,
        responseCompletedAtMs:
          result.diagnostics?.responseCompletedAtMs ??
          Date.now(),
        inputTokens: result.diagnostics?.inputTokens ?? null,
        outputTokens: result.diagnostics?.outputTokens ?? null,
        totalTokens: result.diagnostics?.totalTokens ?? null,
        resetReason: "semantic_complete"
      }
    );
    return {
      state: "complete",
      bufferVersion,
      text: thought.text,
      result: {
        ...result,
        decision: "complete",
        originalQuestion: thought.text,
        normalizedQuestion
      }
    };
  }

  private emitDiagnostic(
    input: SourceCompletedUtterance,
    bufferVersion: number,
    utteranceCount: number,
    requestAttempted: boolean,
    outcome: QuestionUnderstandingDiagnostic["outcome"],
    overrides: Partial<QuestionUnderstandingDiagnostic> = {}
  ): void {
    this.onDiagnostic?.({
      sessionId: input.sessionId,
      source: input.source,
      bufferVersion,
      utteranceCount,
      requestAttempted,
      outcome,
      model: null,
      reasoningEffort: null,
      latencyMs: null,
      requestStartedAtMs: null,
      responseCompletedAtMs: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      errorCode: null,
      failureKind: null,
      resetReason: null,
      ...overrides
    });
  }
}
