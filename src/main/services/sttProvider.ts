export interface SttEvents {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export interface SttProvider {
  start(events: SttEvents): Promise<void>;
  sendAudio(chunk: Int16Array): void;
  stop(): Promise<void>;
}
