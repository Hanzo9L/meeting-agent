export type ConnectionStatus = "idle" | "capturing" | "transcribing" | "answering" | "error";
export type CaptureSourceMode = "system" | "microphone" | "both";
export type CaptureSourceTag = "system" | "microphone";
export type AnswerTriggerMode = "questions_only" | "all_final";

export interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  timestamp: number;
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
  sessionId: string;
  sources: CaptureSourceTag[];
}

export interface RuntimeCaptureConfig {
  captureSourceMode: CaptureSourceMode;
  answerTriggerMode: AnswerTriggerMode;
}

export interface AudioChunkPayload {
  sessionId: string;
  source: CaptureSourceTag;
  buffer: ArrayBuffer;
}

export interface LiveAssistSessionView {
  id: string;
  conversationId: string;
  state: "active" | "inactive";
  captureStatus:
    | "starting"
    | "capturing"
    | "error"
    | "stopped"
    | "interrupted";
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
}

export interface LiveAssistCaptureCommand {
  action: "start" | "stop";
  sessionId: string;
}

export interface LiveAssistProjectionSource {
  messageId: string;
  citationId: string;
  title: string;
}

export interface LiveAssistProjection {
  sessionId: string;
  conversationId: string;
  question: string;
  state:
    | "accepted"
    | "executing"
    | "answered"
    | "partial"
    | "insufficient_evidence"
    | "failed";
  answerText: string | null;
  answerability:
    | "answered"
    | "partial"
    | "insufficient_evidence"
    | null;
  sources: LiveAssistProjectionSource[];
  timestamp: number;
}

export interface OverlayApi {
  getLiveAssistSession: () => Promise<LiveAssistSessionView | null>;
  reportLiveAssistCaptureError: (
    sessionId: string
  ) => Promise<void>;
  startCapture: (config: CaptureStartConfig) => Promise<void>;
  stopCapture: (sessionId: string) => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  enableLoopbackAudio: () => Promise<void>;
  disableLoopbackAudio: () => Promise<void>;
  sendAudioChunk: (payload: AudioChunkPayload) => void;
  getRuntimeCaptureConfig: () => Promise<RuntimeCaptureConfig>;
  getDemoMode: () => Promise<boolean>;
  openLiveCitation: (
    messageId: string,
    citationId: string
  ) => Promise<void>;
  onLiveAssistCaptureCommand: (
    handler: (command: LiveAssistCaptureCommand) => void
  ) => () => void;
  onLiveAssistProjection: (
    handler: (projection: LiveAssistProjection) => void
  ) => () => void;
  onLiveAssistSession: (
    handler: (session: LiveAssistSessionView | null) => void
  ) => () => void;
  onDemoMode: (handler: (enabled: boolean) => void) => () => void;
  onTranscript: (handler: (payload: TranscriptMessage) => void) => () => void;
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
