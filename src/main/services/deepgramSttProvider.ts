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
};

export class DeepgramSttProvider implements SttProvider {
  private readonly client: DeepgramClient;
  private connection: Awaited<ReturnType<DeepgramClient["listen"]["v1"]["connect"]>> | null = null;
  private events: SttEvents | null = null;
  private sentAudioDiagnostics = false;

  constructor(apiKey: string) {
    this.client = new DeepgramClient({ apiKey });
  }

  async start(events: SttEvents): Promise<void> {
    this.events = events;
    this.connection = await this.client.listen.v1.connect({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      endpointing: "200"
    });

    this.connection.on("message", (data: unknown) => {
      const message = data as DeepgramLiveMessage;
      if (message.type !== "Results") return;
      const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      if (!transcript) return;
      if (message.is_final) {
        this.events?.onFinal(transcript);
      } else {
        this.events?.onInterim(transcript);
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
    if (!this.connection) return;
    this.connection.socket.close();
    this.connection = null;
    this.events = null;
    this.sentAudioDiagnostics = false;
  }
}
