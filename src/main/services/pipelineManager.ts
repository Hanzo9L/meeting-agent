import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type {
  AnswerChunkMessage,
  AnswerTriggerMode,
  CaptureSourceTag,
  ConnectionStatus,
  TranscriptMessage
} from "@shared/types";
import { looksLikeQuestion } from "./questionDetector";
import type { LlmProvider } from "./llmProvider";
import type { LlmContextChunk } from "./llmProvider";
import type { SttProvider } from "./sttProvider";

type StatusHandler = (status: ConnectionStatus) => void;
type SourceLabelMode = "single" | "multi";

export class PipelineManager {
  private readonly sttProviderFactory: () => SttProvider;
  private readonly llmProvider: LlmProvider;
  private readonly getTopic: () => { topic: string; topicPromptTemplate: string };
  private readonly getKnowledgeContext: (question: string) => Promise<LlmContextChunk[]>;
  private readonly sendStatus: StatusHandler;
  private readonly sttProviders = new Map<CaptureSourceTag, SttProvider>();
  private active = false;
  private answering = false;
  private answerTriggerMode: AnswerTriggerMode = "questions_only";
  private answerSourcePreference: CaptureSourceTag | "any" = "any";
  private sourceLabelMode: SourceLabelMode = "single";

  constructor(params: {
    sttProviderFactory: () => SttProvider;
    llmProvider: LlmProvider;
    getTopic: () => { topic: string; topicPromptTemplate: string };
    getKnowledgeContext?: (question: string) => Promise<LlmContextChunk[]>;
    sendStatus: StatusHandler;
  }) {
    this.sttProviderFactory = params.sttProviderFactory;
    this.llmProvider = params.llmProvider;
    this.getTopic = params.getTopic;
    this.getKnowledgeContext = params.getKnowledgeContext ?? (async () => []);
    this.sendStatus = params.sendStatus;
  }

  async start(config: { sources: CaptureSourceTag[]; answerTriggerMode: AnswerTriggerMode }): Promise<void> {
    if (this.active) return;
    if (config.sources.length === 0) {
      throw new Error("No capture sources were provided to pipeline start.");
    }
    this.active = true;
    this.answering = false;
    this.answerTriggerMode = config.answerTriggerMode;
    this.sourceLabelMode = config.sources.length > 1 ? "multi" : "single";
    this.answerSourcePreference = config.sources.includes("system") ? "system" : "any";
    this.sendStatus("capturing");

    await Promise.all(
      config.sources.map(async (source) => {
        const provider = this.sttProviderFactory();
        this.sttProviders.set(source, provider);
        await provider.start({
          onInterim: (text) => this.broadcastTranscript(text, false, source),
          onFinal: (text) => void this.handleFinalTranscript(text, source),
          onError: (message) => {
            this.broadcastTranscript(`STT error (${source}): ${message}`, false, source);
            this.sendStatus("error");
          }
        });
      })
    );
  }

  sendAudioChunk(source: CaptureSourceTag, chunk: Int16Array): void {
    if (!this.active) return;
    this.sttProviders.get(source)?.sendAudio(chunk);
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    await Promise.all(
      Array.from(this.sttProviders.values()).map(async (provider) => {
        await provider.stop();
      })
    );
    this.sttProviders.clear();
    this.active = false;
    this.answering = false;
    this.sendStatus("idle");
  }

  private formatWithSource(text: string, source: CaptureSourceTag): string {
    if (this.sourceLabelMode === "single") return text;
    const prefix = source === "system" ? "[System]" : "[Microphone]";
    return `${prefix} ${text}`;
  }

  private broadcastTranscript(text: string, isFinal: boolean, source: CaptureSourceTag): void {
    const payload: TranscriptMessage = {
      text: this.formatWithSource(text, source),
      isFinal,
      timestamp: Date.now()
    };
    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.send(IPC_CHANNELS.transcript, payload)
    );
  }

  private shouldAnswer(source: CaptureSourceTag, text: string): boolean {
    if (this.answerSourcePreference !== "any" && source !== this.answerSourcePreference) {
      return false;
    }
    if (this.answerTriggerMode === "all_final") return true;
    return looksLikeQuestion(text);
  }

  private async handleFinalTranscript(text: string, source: CaptureSourceTag): Promise<void> {
    this.broadcastTranscript(text, true, source);
    if (!this.shouldAnswer(source, text) || this.answering) return;
    this.answering = true;
    this.sendStatus("answering");

    try {
      const { topic, topicPromptTemplate } = this.getTopic();
      const context = await this.getKnowledgeContext(text);
      for await (const chunk of this.llmProvider.streamAnswer({
        topic,
        topicPromptTemplate,
        question: text,
        context
      })) {
        const payload: AnswerChunkMessage = {
          text: chunk,
          timestamp: Date.now()
        };
        BrowserWindow.getAllWindows().forEach((window) =>
          window.webContents.send(IPC_CHANNELS.answerChunk, payload)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown answer error";
      this.broadcastTranscript(`Answer error: ${message}`, false, source);
      const fallback: AnswerChunkMessage = {
        text: "I could not generate an answer right now. Please verify API key, network, and knowledge base sync.",
        timestamp: Date.now()
      };
      BrowserWindow.getAllWindows().forEach((window) =>
        window.webContents.send(IPC_CHANNELS.answerChunk, fallback)
      );
    } finally {
      BrowserWindow.getAllWindows().forEach((window) =>
        window.webContents.send(IPC_CHANNELS.answerDone)
      );
      this.answering = false;
      this.sendStatus("capturing");
    }
  }
}
