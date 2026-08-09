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
  SttProvider
} from "./sttProvider";
import {
  CrossSourceUtteranceArbiter,
  type CrossSourceArbitrationDiagnostic,
  type SourceCompletedUtterance
} from "./crossSourceUtteranceArbiter";

type StatusHandler = (status: ConnectionStatus) => void;
type AcceptedQuestionHandler = (
  question: string,
  source: CaptureSourceTag
) => Promise<void>;
type SourceLabelMode = "single" | "multi";

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
  private readonly onArbitrationDiagnostic: (
    diagnostic: CrossSourceArbitrationDiagnostic
  ) => void;
  private utteranceArbiter: CrossSourceUtteranceArbiter | null =
    null;

  constructor(params: {
    sttProviderFactory: () => SttProvider;
    onAcceptedQuestion: AcceptedQuestionHandler;
    sendStatus: StatusHandler;
    sendTranscript: (payload: TranscriptMessage) => void;
    onArbitrationDiagnostic?: (
      diagnostic: CrossSourceArbitrationDiagnostic
    ) => void;
  }) {
    this.sttProviderFactory = params.sttProviderFactory;
    this.onAcceptedQuestion = params.onAcceptedQuestion;
    this.sendStatus = params.sendStatus;
    this.sendTranscript = params.sendTranscript;
    this.onArbitrationDiagnostic =
      params.onArbitrationDiagnostic ?? (() => undefined);
  }

  async start(config: {
    sources: CaptureSourceTag[];
    answerTriggerMode: AnswerTriggerMode;
    sessionId?: string;
  }): Promise<void> {
    if (this.active) return;
    if (config.sources.length === 0) {
      throw new Error(
        "No capture sources were provided to pipeline start."
      );
    }
    this.active = true;
    this.completedUtteranceIds.clear();
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

    try {
      await Promise.all(
        config.sources.map(async (source) => {
          const provider = this.sttProviderFactory();
          this.sttProviders.set(source, provider);
          await provider.start({
            onInterim: (text) =>
              this.broadcastTranscript(text, false, source),
            onUtterance: (utterance) =>
              void this.handleCompletedUtterance(
                utterance,
                source
              ),
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
      this.sttProviders.clear();
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
    await Promise.all(
      Array.from(this.sttProviders.values()).map(async (provider) => {
        await provider.stop();
      })
    );
    this.sttProviders.clear();
    this.completedUtteranceIds.clear();
    this.sendStatus("idle");
    // Already accepted turns intentionally continue through acceptedQueue.
  }

  async askQuestion(
    question: string,
    source: CaptureSourceTag = "microphone"
  ): Promise<void> {
    const text = question.trim();
    if (!text) return;
    this.broadcastTranscript(text, true, source);
    await this.enqueueAcceptedQuestion(text, source);
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
    this.broadcastTranscript(text, true, source);
    if (!this.active) return;
    if (!isCompleteEnoughForPromotion(text)) {
      this.broadcastTranscript(
        INCOMPLETE_UTTERANCE_STATUS,
        false,
        source
      );
      return;
    }
    if (!this.shouldAccept(source, text)) return;
    await this.enqueueAcceptedQuestion(text, source);
  }

  private enqueueAcceptedQuestion(
    text: string,
    source: CaptureSourceTag
  ): Promise<void> {
    const execute = async (): Promise<void> => {
      this.sendStatus("answering");
      try {
        await this.onAcceptedQuestion(text, source);
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
}
