import type {
  AnswerTriggerMode,
  CaptureSourceTag,
  ConnectionStatus,
  TranscriptMessage
} from "@shared/types";
import { looksLikeQuestion } from "./questionDetector";
import {
  INCOMPLETE_UTTERANCE_STATUS,
  isCompleteEnoughForPromotion
} from "./questionCompletenessGuard";
import type {
  CompletedSttUtterance,
  RawSttDiagnostic,
  SttProvider
} from "./sttProvider";
import {
  CrossSourceUtteranceArbiter,
  type CrossSourceArbitrationDiagnostic,
  type SourceCompletedUtterance
} from "./crossSourceUtteranceArbiter";
import {
  LiveQuestionCompletionCoordinator,
  type QuestionUnderstandingDiagnostic,
  THOUGHT_UNDERSTANDING_ERROR_STATUS
} from "./liveQuestionCompletionCoordinator";
import type {
  QuestionUnderstandingPort,
  QuestionUnderstandingResult
} from "./questionUnderstandingPort";

type StatusHandler = (status: ConnectionStatus) => void;
type AcceptedQuestionHandler = (
  question: string,
  source: CaptureSourceTag,
  understanding?: QuestionUnderstandingResult,
  sessionId?: string
) => Promise<void>;
type SourceLabelMode = "single" | "multi";

export interface LiveSttDiagnostic extends RawSttDiagnostic {
  sessionId: string;
  source: CaptureSourceTag;
}

export interface LiveQuestionGateDiagnostic {
  sessionId: string;
  source: CaptureSourceTag;
  bufferVersion: number;
  semanticDecision: "continue" | "complete" | "error" | "stale";
  durableTurnCreated: boolean;
  retrievalStarted: boolean;
  synthesisStarted: boolean;
  projectionCreated: boolean;
}

function combineThoughtDisplay(
  retainedThought: string,
  acousticPreview: string
): string {
  const retained = retainedThought.replace(/\s+/g, " ").trim();
  const preview = acousticPreview.replace(/\s+/g, " ").trim();
  if (!retained) return preview;
  if (!preview) return retained;
  const retainedKey = retained.toLocaleLowerCase();
  const previewKey = preview.toLocaleLowerCase();
  if (previewKey.startsWith(retainedKey)) return preview;
  if (
    retainedKey.endsWith(previewKey) ||
    retainedKey.includes(previewKey)
  ) {
    return retained;
  }
  return `${retained} ${preview}`;
}

/**
 * Audio/STT/question-acceptance adapter only.
 *
 * Accepted questions are serialized and delegated to Relay's durable
 * conversation service. This class contains no factual answer generator.
 */
export class PipelineManager {
  private readonly sttProviderFactory: () => SttProvider;
  private readonly onAcceptedQuestion: AcceptedQuestionHandler;
  private readonly sendStatus: StatusHandler;
  private readonly sendTranscript: (
    payload: TranscriptMessage
  ) => void;
  private readonly sttProviders = new Map<
    CaptureSourceTag,
    SttProvider
  >();
  private active = false;
  private answerTriggerMode: AnswerTriggerMode = "questions_only";
  private answerSourcePreference: CaptureSourceTag | "any" = "any";
  private sourceLabelMode: SourceLabelMode = "single";
  private acceptedQueue: Promise<void> = Promise.resolve();
  private readonly completedUtteranceIds = new Map<
    CaptureSourceTag,
    Set<string>
  >();
  private readonly retainedThoughtText = new Map<
    CaptureSourceTag,
    string
  >();
  private readonly pendingThoughtContributions = new Map<
    CaptureSourceTag,
    Array<{ utteranceId: string; text: string }>
  >();
  private readonly currentAcousticPreview = new Map<
    CaptureSourceTag,
    string
  >();
  private readonly onArbitrationDiagnostic: (
    diagnostic: CrossSourceArbitrationDiagnostic
  ) => void;
  private utteranceArbiter: CrossSourceUtteranceArbiter | null =
    null;
  private readonly completionCoordinator:
    | LiveQuestionCompletionCoordinator
    | null;
  private readonly onSttDiagnostic: (
    diagnostic: LiveSttDiagnostic
  ) => void;
  private readonly onQuestionGateDiagnostic: (
    diagnostic: LiveQuestionGateDiagnostic
  ) => void;
  private readonly requireSemanticCompletion: boolean;

  constructor(params: {
    sttProviderFactory: () => SttProvider;
    onAcceptedQuestion: AcceptedQuestionHandler;
    sendStatus: StatusHandler;
    sendTranscript: (payload: TranscriptMessage) => void;
    onArbitrationDiagnostic?: (
      diagnostic: CrossSourceArbitrationDiagnostic
    ) => void;
    questionUnderstanding?: QuestionUnderstandingPort;
    onQuestionUnderstandingDiagnostic?: (
      diagnostic: QuestionUnderstandingDiagnostic
    ) => void;
    onSttDiagnostic?: (diagnostic: LiveSttDiagnostic) => void;
    onQuestionGateDiagnostic?: (
      diagnostic: LiveQuestionGateDiagnostic
    ) => void;
    requireSemanticCompletion?: boolean;
  }) {
    this.sttProviderFactory = params.sttProviderFactory;
    this.onAcceptedQuestion = params.onAcceptedQuestion;
    this.sendStatus = params.sendStatus;
    this.sendTranscript = params.sendTranscript;
    this.onArbitrationDiagnostic =
      params.onArbitrationDiagnostic ?? (() => undefined);
    this.onSttDiagnostic =
      params.onSttDiagnostic ?? (() => undefined);
    this.onQuestionGateDiagnostic =
      params.onQuestionGateDiagnostic ?? (() => undefined);
    this.requireSemanticCompletion =
      params.requireSemanticCompletion ?? false;
    this.completionCoordinator = params.questionUnderstanding
      ? new LiveQuestionCompletionCoordinator(
          params.questionUnderstanding,
          params.onQuestionUnderstandingDiagnostic ?? null
        )
      : null;
  }

  async start(config: {
    sources: CaptureSourceTag[];
    answerTriggerMode: AnswerTriggerMode;
    sessionId?: string;
  }): Promise<void> {
    if (
      this.requireSemanticCompletion &&
      !this.completionCoordinator
    ) {
      throw new Error(
        "Semantic question completion is required for this pipeline."
      );
    }
    if (this.active) return;
    if (config.sources.length === 0) {
      throw new Error(
        "No capture sources were provided to pipeline start."
      );
    }
    this.active = true;
    this.completionCoordinator?.reset();
    this.completedUtteranceIds.clear();
    this.retainedThoughtText.clear();
    this.pendingThoughtContributions.clear();
    this.currentAcousticPreview.clear();
    this.answerTriggerMode = config.answerTriggerMode;
    this.sourceLabelMode =
      config.sources.length > 1 ? "multi" : "single";
    this.answerSourcePreference =
      config.sources.length === 1
        ? (config.sources[0] ?? "any")
        : "any";
    this.utteranceArbiter = new CrossSourceUtteranceArbiter({
      sessionId: config.sessionId ?? "pipeline-session",
      bothMode: config.sources.length > 1,
      accept: (input) => {
        void this.handleArbitratedUtterance(input);
      },
      diagnostic: this.onArbitrationDiagnostic
    });
    this.sendStatus("capturing");
    const sessionId = config.sessionId ?? "pipeline-session";

    try {
      await Promise.all(
        config.sources.map(async (source) => {
          const provider = this.sttProviderFactory();
          this.sttProviders.set(source, provider);
          await provider.start({
            onInterim: (text) =>
              this.broadcastThoughtTranscript(text, false, source),
            onUtterance: (utterance) =>
              void this.handleCompletedUtterance(
                utterance,
                source
              ),
            onDiagnostic: (diagnostic) =>
              this.onSttDiagnostic({
                ...diagnostic,
                sessionId,
                source
              }),
            onError: (message) => {
              this.broadcastTranscript(
                `STT error (${source}): ${message}`,
                false,
                source
              );
              this.sendStatus("error");
            }
          });
        })
      );
    } catch (error) {
      this.active = false;
      this.utteranceArbiter?.stop();
      this.utteranceArbiter = null;
      this.completionCoordinator?.reset();
      this.sttProviders.clear();
      this.retainedThoughtText.clear();
      this.pendingThoughtContributions.clear();
      this.currentAcousticPreview.clear();
      this.sendStatus("error");
      throw error;
    }
  }

  sendAudioChunk(
    source: CaptureSourceTag,
    chunk: Int16Array
  ): void {
    if (!this.active) return;
    this.sttProviders.get(source)?.sendAudio(chunk);
  }

  async stop(): Promise<void> {
    if (!this.active && this.sttProviders.size === 0) return;
    // Prevent provider flushes during stop from promoting new questions.
    this.active = false;
    this.utteranceArbiter?.stop();
    this.utteranceArbiter = null;
    this.completionCoordinator?.reset();
    this.retainedThoughtText.clear();
    this.pendingThoughtContributions.clear();
    this.currentAcousticPreview.clear();
    await Promise.all(
      Array.from(this.sttProviders.values()).map(async (provider) => {
        await provider.stop();
      })
    );
    this.sttProviders.clear();
    this.completedUtteranceIds.clear();
    this.clearThoughtDisplay();
    this.sendStatus("idle");
    // Already accepted turns intentionally continue through acceptedQueue.
  }

  private formatWithSource(
    text: string,
    source: CaptureSourceTag
  ): string {
    if (this.sourceLabelMode === "single") return text;
    const prefix =
      source === "system" ? "[System]" : "[Microphone]";
    return `${prefix} ${text}`;
  }

  private broadcastTranscript(
    text: string,
    isFinal: boolean,
    source: CaptureSourceTag
  ): void {
    const payload: TranscriptMessage = {
      text: this.formatWithSource(text, source),
      isFinal,
      timestamp: Date.now()
    };
    this.sendTranscript(payload);
  }

  private broadcastThoughtTranscript(
    acousticText: string,
    isFinal: boolean,
    source: CaptureSourceTag
  ): void {
    this.currentAcousticPreview.set(source, acousticText);
    this.publishThoughtDisplay(source, isFinal);
  }

  private publishThoughtDisplay(
    source: CaptureSourceTag,
    isFinal = false
  ): void {
    const pending = (
      this.pendingThoughtContributions.get(source) ?? []
    )
      .map((entry) => entry.text)
      .join(" ");
    const finalized = combineThoughtDisplay(
      this.retainedThoughtText.get(source) ?? "",
      pending
    );
    const display = combineThoughtDisplay(
      finalized,
      this.currentAcousticPreview.get(source) ?? ""
    );
    if (!display) {
      this.clearThoughtDisplay();
      return;
    }
    this.broadcastTranscript(display, isFinal, source);
  }

  private clearThoughtDisplay(): void {
    this.sendTranscript({
      text: "",
      isFinal: false,
      timestamp: Date.now()
    });
  }

  private shouldAccept(
    source: CaptureSourceTag,
    text: string
  ): boolean {
    if (
      this.answerSourcePreference !== "any" &&
      source !== this.answerSourcePreference
    ) {
      return false;
    }
    if (this.answerTriggerMode === "all_final") return true;
    return looksLikeQuestion(text);
  }

  private async handleCompletedUtterance(
    utterance: CompletedSttUtterance,
    source: CaptureSourceTag
  ): Promise<void> {
    const completedForSource =
      this.completedUtteranceIds.get(source) ?? new Set<string>();
    this.completedUtteranceIds.set(source, completedForSource);
    if (completedForSource.has(utterance.utteranceId)) return;
    completedForSource.add(utterance.utteranceId);
    this.currentAcousticPreview.delete(source);
    this.utteranceArbiter?.submit({
      source,
      utterance,
      completedAtMs: Date.now()
    });
  }

  private async handleArbitratedUtterance(
    input: SourceCompletedUtterance
  ): Promise<void> {
    const { source, utterance } = input;
    const text = utterance.text.trim();
    if (!text) return;
    if (this.completionCoordinator) {
      const pending =
        this.pendingThoughtContributions.get(source) ?? [];
      pending.push({ utteranceId: utterance.utteranceId, text });
      this.pendingThoughtContributions.set(source, pending);
      this.publishThoughtDisplay(source, true);
    } else {
      this.broadcastTranscript(text, true, source);
    }
    if (!this.active) return;
    if (
      this.answerSourcePreference !== "any" &&
      source !== this.answerSourcePreference
    ) {
      return;
    }
    if (this.completionCoordinator) {
      const outcome =
        await this.completionCoordinator.submit(input);
      if (!this.active || outcome.state === "stale") {
        this.emitQuestionGateDiagnostic(
          input,
          outcome.bufferVersion,
          "stale"
        );
        return;
      }
      const remaining = (
        this.pendingThoughtContributions.get(source) ?? []
      ).filter(
        (entry) => entry.utteranceId !== utterance.utteranceId
      );
      this.pendingThoughtContributions.set(source, remaining);
      if (outcome.state === "continue") {
        this.retainedThoughtText.set(source, outcome.text);
        this.publishThoughtDisplay(source);
        this.emitQuestionGateDiagnostic(
          input,
          outcome.bufferVersion,
          "continue"
        );
        return;
      }
      if (outcome.state === "error") {
        if (outcome.bufferReset) {
          this.retainedThoughtText.delete(source);
        } else {
          this.retainedThoughtText.set(source, outcome.text);
        }
        this.publishThoughtDisplay(source);
        this.broadcastTranscript(
          THOUGHT_UNDERSTANDING_ERROR_STATUS,
          false,
          source
        );
        this.emitQuestionGateDiagnostic(
          input,
          outcome.bufferVersion,
          "error"
        );
        return;
      }
      const question = outcome.result.normalizedQuestion;
      this.retainedThoughtText.delete(source);
      await this.enqueueAcceptedQuestion(
        question,
        source,
        outcome.result,
        input.sessionId
      );
      this.onQuestionGateDiagnostic({
        sessionId: input.sessionId,
        source,
        bufferVersion: outcome.bufferVersion,
        semanticDecision: "complete",
        durableTurnCreated: true,
        retrievalStarted: true,
        synthesisStarted: false,
        projectionCreated: true
      });
      this.publishThoughtDisplay(source);
      return;
    }
    if (!isCompleteEnoughForPromotion(text)) {
      this.broadcastTranscript(
        INCOMPLETE_UTTERANCE_STATUS,
        false,
        source
      );
      return;
    }
    if (!this.shouldAccept(source, text)) return;
    await this.enqueueAcceptedQuestion(
      text,
      source,
      undefined,
      input.sessionId
    );
  }

  private enqueueAcceptedQuestion(
    text: string,
    source: CaptureSourceTag,
    understanding?: QuestionUnderstandingResult,
    sessionId?: string
  ): Promise<void> {
    const execute = async (): Promise<void> => {
      this.sendStatus("answering");
      try {
        await this.onAcceptedQuestion(
          text,
          source,
          understanding,
          sessionId
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown accepted-question error";
        this.broadcastTranscript(
          `Grounded answer error: ${message}`,
          false,
          source
        );
        this.sendStatus("error");
      } finally {
        if (this.active) this.sendStatus("capturing");
      }
    };
    const result = this.acceptedQueue.then(execute);
    this.acceptedQueue = result.catch(() => undefined);
    return result;
  }

  private emitQuestionGateDiagnostic(
    input: SourceCompletedUtterance,
    bufferVersion: number,
    semanticDecision: "continue" | "error" | "stale"
  ): void {
    this.onQuestionGateDiagnostic({
      sessionId: input.sessionId,
      source: input.source,
      bufferVersion,
      semanticDecision,
      durableTurnCreated: false,
      retrievalStarted: false,
      synthesisStarted: false,
      projectionCreated: false
    });
  }
}
