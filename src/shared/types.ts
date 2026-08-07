export type ConnectionStatus = "idle" | "capturing" | "transcribing" | "answering" | "error";
export type CaptureSourceMode = "system" | "microphone" | "both";
export type CaptureSourceTag = "system" | "microphone";
export type AnswerTriggerMode = "questions_only" | "all_final";

export interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface AnswerChunkMessage {
  text: string;
  timestamp: number;
}

export interface AnswerStartMessage {
  question: string;
  timestamp: number;
}

export interface AnswerSourceRef {
  title: string;
  path: string;
  url: string;
}

export interface AnswerSourcesMessage {
  sources: AnswerSourceRef[];
  timestamp: number;
}

export interface QaItem {
  question: string;
  answer: string;
  sources?: AnswerSourceRef[];
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

export interface KnowledgeBaseSettings {
  enabled: boolean;
  repoUrl: string;
  branch: string;
}

export interface KnowledgeBaseStatus {
  ready: boolean;
  syncing: boolean;
  docCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  localPath: string;
}

export interface AppSettings {
  topic: string;
  topicPromptTemplate: string;
  overlay: OverlayPrefs;
  apiKeys: ApiKeys;
  captureSourceMode: CaptureSourceMode;
  answerTriggerMode: AnswerTriggerMode;
  /** When true, overlay is visible in screen shares (capture exclusion off). */
  demoMode: boolean;
  knowledgeBase: KnowledgeBaseSettings;
}

export interface CaptureStartConfig {
  sources: CaptureSourceTag[];
  answerTriggerMode: AnswerTriggerMode;
}

export interface RuntimeCaptureConfig {
  captureSourceMode: CaptureSourceMode;
  answerTriggerMode: AnswerTriggerMode;
}

export interface AudioChunkPayload {
  source: CaptureSourceTag;
  buffer: ArrayBuffer;
}

export interface OverlayApi {
  startCapture: (config: CaptureStartConfig) => Promise<void>;
  stopCapture: () => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  clearFeed: () => Promise<void>;
  enableLoopbackAudio: () => Promise<void>;
  disableLoopbackAudio: () => Promise<void>;
  sendAudioChunk: (payload: AudioChunkPayload) => void;
  getRuntimeCaptureConfig: () => Promise<RuntimeCaptureConfig>;
  getDemoMode: () => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<void>;
  onDemoMode: (handler: (enabled: boolean) => void) => () => void;
  onTranscript: (handler: (payload: TranscriptMessage) => void) => () => void;
  onAnswerStart: (handler: (payload: AnswerStartMessage) => void) => () => void;
  onAnswerChunk: (handler: (payload: AnswerChunkMessage) => void) => () => void;
  onAnswerSources: (handler: (payload: AnswerSourcesMessage) => void) => () => void;
  onAnswerDone: (handler: () => void) => () => void;
  onStatus: (handler: (status: ConnectionStatus) => void) => () => void;
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings>;
  updateTopic: (topic: string) => Promise<void>;
  updateApiKeys: (apiKeys: ApiKeys) => Promise<void>;
  updateCaptureSourceMode: (mode: CaptureSourceMode) => Promise<void>;
  updateAnswerTriggerMode: (mode: AnswerTriggerMode) => Promise<void>;
  updateOverlayPrefs: (prefs: Partial<OverlayPrefs>) => Promise<void>;
  updateDemoMode: (enabled: boolean) => Promise<void>;
  updateKnowledgeBaseSettings: (settings: KnowledgeBaseSettings) => Promise<void>;
  getKnowledgeBaseStatus: () => Promise<KnowledgeBaseStatus>;
  syncKnowledgeBase: () => Promise<KnowledgeBaseStatus>;
}
