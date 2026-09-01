import { DeepgramClient } from "@deepgram/sdk";
import type {
  RawSttDiagnostic,
  SttEvents,
  SttProvider
} from "./sttProvider";
import {
  DeepgramUtteranceProcessor,
  type DeepgramTranscriptMessage
} from "./deepgramUtteranceAssembler";

function transcriptPreview(message: DeepgramTranscriptMessage): string | null {
  const text =
    message.channel?.alternatives?.[0]?.transcript
      ?.replace(/\s+/g, " ")
      .trim() ?? "";
  return text ? text.slice(0, 96) : null;
}

export function toRawDeepgramDiagnostic(
  message: DeepgramTranscriptMessage,
  timestamp = Date.now()
): RawSttDiagnostic | null {
  if (message.type === "Results") {
    return {
      event: "results",
      timestamp,
      transcriptLength:
        message.channel?.alternatives?.[0]?.transcript?.trim()
          .length ?? 0,
      transcriptPreview: transcriptPreview(message),
      isFinal: Boolean(message.is_final),
      speechFinal: Boolean(message.speech_final)
    };
  }
  if (message.type === "UtteranceEnd") {
    return {
      event: "utterance_end",
      timestamp,
      transcriptLength: 0,
      transcriptPreview: null,
      isFinal: null,
      speechFinal: null
    };
  }
  return null;
}

export class DeepgramSttProvider implements SttProvider {
  private readonly client: DeepgramClient;
  private connection: Awaited<ReturnType<DeepgramClient["listen"]["v1"]["connect"]>> | null = null;
  private events: SttEvents | null = null;
  private sentAudioDiagnostics = false;
  private readonly transcriptProcessor =
    new DeepgramUtteranceProcessor();

  constructor(apiKey: string) {
    this.client = new DeepgramClient({ apiKey });
  }

  async start(events: SttEvents): Promise<void> {
    this.events = events;
    this.transcriptProcessor.clear();
    this.sentAudioDiagnostics = false;
    this.connection = await this.client.listen.v1.connect({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      // 200ms was cutting mid-phrase; conversational pauses need more headroom.
      endpointing: "400",
      // Backup end-of-turn signal when VAD misses silence in noisy call audio.
      utterance_end_ms: "1200"
    });

    this.connection.on("message", (data: unknown) => {
      const message = data as DeepgramTranscriptMessage;
      const diagnostic = toRawDeepgramDiagnostic(message);
      if (diagnostic) this.events?.onDiagnostic?.(diagnostic);
      const result = this.transcriptProcessor.process(
        message
      );
      if (result.interimText) {
        this.events?.onInterim(result.interimText);
      }
      if (result.completedUtterance) {
        this.events?.onUtterance(result.completedUtterance);
      }
    });

    this.connection.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : "Deepgram stream error";
      this.events?.onError(message);
    });

    this.connection.connect();
    await this.connection.waitForOpen();
    this.events?.onInterim("STT connected. Waiting for speech...");
  }

  sendAudio(chunk: Int16Array): void {
    if (!this.connection) return;
    if (!this.sentAudioDiagnostics && chunk.length > 0) {
      this.sentAudioDiagnostics = true;
      this.events?.onInterim("Audio stream detected. Transcribing...");
    }
    this.connection.socket.send(
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    );
  }

  async stop(): Promise<void> {
    // Stop/session termination must never promote a pending fragment.
    this.transcriptProcessor.clear();
    if (!this.connection) return;
    this.connection.socket.close();
    this.connection = null;
    this.events = null;
    this.sentAudioDiagnostics = false;
    this.transcriptProcessor.clear();
  }
}
