import { DeepgramClient } from "@deepgram/sdk";
import type { SttEvents, SttProvider } from "./sttProvider";

type DeepgramLiveMessage = {
  type?: string;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
};

export class DeepgramSttProvider implements SttProvider {
  private readonly client: DeepgramClient;
  private connection: Awaited<ReturnType<DeepgramClient["listen"]["v1"]["connect"]>> | null = null;
  private events: SttEvents | null = null;
  private sentAudioDiagnostics = false;
  /** Finalized segments for the current utterance; must be joined until speech_final. */
  private utteranceParts: string[] = [];

  constructor(apiKey: string) {
    this.client = new DeepgramClient({ apiKey });
  }

  async start(events: SttEvents): Promise<void> {
    this.events = events;
    this.utteranceParts = [];
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
      const message = data as DeepgramLiveMessage;

      if (message.type === "UtteranceEnd") {
        this.flushUtterance();
        return;
      }

      if (message.type !== "Results") return;

      const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      const isFinal = Boolean(message.is_final);
      const speechFinal = Boolean(message.speech_final);

      if (!transcript && !(speechFinal && this.utteranceParts.length > 0)) return;

      if (isFinal && transcript) {
        this.utteranceParts.push(transcript);
      }

      const assembled = this.utteranceParts.join(" ").replace(/\s+/g, " ").trim();
      const liveText =
        !isFinal && transcript
          ? [assembled, transcript].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
          : assembled;

      if (speechFinal) {
        const finalText = assembled || transcript;
        this.utteranceParts = [];
        if (finalText) this.events?.onFinal(finalText);
        return;
      }

      if (liveText) this.events?.onInterim(liveText);
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
    this.flushUtterance();
    if (!this.connection) return;
    this.connection.socket.close();
    this.connection = null;
    this.events = null;
    this.sentAudioDiagnostics = false;
    this.utteranceParts = [];
  }

  private flushUtterance(): void {
    const finalText = this.utteranceParts.join(" ").replace(/\s+/g, " ").trim();
    this.utteranceParts = [];
    if (finalText) this.events?.onFinal(finalText);
  }
}
