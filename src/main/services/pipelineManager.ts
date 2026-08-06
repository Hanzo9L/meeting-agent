import { BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type { AnswerChunkMessage, ConnectionStatus, TranscriptMessage } from "@shared/types";
import { looksLikeQuestion } from "./questionDetector";
import type { LlmProvider } from "./llmProvider";
import type { LlmContextChunk } from "./llmProvider";
import type { SttProvider } from "./sttProvider";

type StatusHandler = (status: ConnectionStatus) => void;

export class PipelineManager {
  private readonly sttProvider: SttProvider;
  private readonly llmProvider: LlmProvider;
  private readonly getTopic: () => { topic: string; topicPromptTemplate: string };
  private readonly getKnowledgeContext: (question: string) => Promise<LlmContextChunk[]>;
  private readonly sendStatus: StatusHandler;
  private active = false;

  constructor(params: {
    sttProvider: SttProvider;
    llmProvider: LlmProvider;
    getTopic: () => { topic: string; topicPromptTemplate: string };
    getKnowledgeContext?: (question: string) => Promise<LlmContextChunk[]>;
    sendStatus: StatusHandler;
  }) {
    this.sttProvider = params.sttProvider;
    this.llmProvider = params.llmProvider;
    this.getTopic = params.getTopic;
    this.getKnowledgeContext = params.getKnowledgeContext ?? (async () => []);
    this.sendStatus = params.sendStatus;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.sendStatus("capturing");

    await this.sttProvider.start({
      onInterim: (text) => this.broadcastTranscript(text, false),
      onFinal: (text) => void this.handleFinalTranscript(text),
      onError: (message) => {
        this.broadcastTranscript(`STT error: ${message}`, false);
        this.sendStatus("error");
      }
    });
  }

  sendAudioChunk(chunk: Int16Array): void {
    if (!this.active) return;
    this.sttProvider.sendAudio(chunk);
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    await this.sttProvider.stop();
    this.active = false;
    this.sendStatus("idle");
  }

  private broadcastTranscript(text: string, isFinal: boolean): void {
    const payload: TranscriptMessage = {
      text,
      isFinal,
      timestamp: Date.now()
    };
    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.send(IPC_CHANNELS.transcript, payload)
    );
  }

  private async handleFinalTranscript(text: string): Promise<void> {
    this.broadcastTranscript(text, true);
    if (!looksLikeQuestion(text)) return;
    this.sendStatus("answering");

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

    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.send(IPC_CHANNELS.answerDone)
    );
    this.sendStatus("capturing");
  }
}
