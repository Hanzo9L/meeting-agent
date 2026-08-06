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
  /** When true, overlay is visible in screen shares (capture exclusion off). */
  demoMode: boolean;
  knowledgeBase: KnowledgeBaseSettings;
}

export interface OverlayApi {
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  clearFeed: () => Promise<void>;
  enableLoopbackAudio: () => Promise<void>;
  disableLoopbackAudio: () => Promise<void>;
  sendAudioChunk: (buffer: ArrayBuffer) => void;
  getDemoMode: () => Promise<boolean>;
  onDemoMode: (handler: (enabled: boolean) => void) => () => void;
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
  updateDemoMode: (enabled: boolean) => Promise<void>;
  updateKnowledgeBaseSettings: (settings: KnowledgeBaseSettings) => Promise<void>;
  getKnowledgeBaseStatus: () => Promise<KnowledgeBaseStatus>;
  syncKnowledgeBase: () => Promise<KnowledgeBaseStatus>;
}
