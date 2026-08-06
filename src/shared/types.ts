export type ConnectionStatus = "idle" | "capturing" | "transcribing" | "answering" | "error";

export interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface AnswerChunkMessage {
  text: string;
  timestamp: number;
}

export interface QaItem {
  question: string;
  answer: string;
  createdAt: number;
}

export interface ApiKeys {
  deepgramApiKey: string;
  openAiApiKey: string;
}

export interface OverlayPrefs {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface AppSettings {
  topic: string;
  topicPromptTemplate: string;
  overlay: OverlayPrefs;
  apiKeys: ApiKeys;
}

export interface OverlayApi {
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  clearFeed: () => Promise<void>;
  enableLoopbackAudio: () => Promise<void>;
  disableLoopbackAudio: () => Promise<void>;
  sendAudioChunk: (buffer: ArrayBuffer) => void;
  onTranscript: (handler: (payload: TranscriptMessage) => void) => () => void;
  onAnswerChunk: (handler: (payload: AnswerChunkMessage) => void) => () => void;
  onAnswerDone: (handler: () => void) => () => void;
  onStatus: (handler: (status: ConnectionStatus) => void) => () => void;
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings>;
  updateTopic: (topic: string) => Promise<void>;
  updateApiKeys: (apiKeys: ApiKeys) => Promise<void>;
  updateOverlayPrefs: (prefs: Partial<OverlayPrefs>) => Promise<void>;
}
