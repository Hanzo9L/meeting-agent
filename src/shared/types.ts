export type ConnectionStatus = "idle" | "capturing" | "transcribing" | "answering" | "error";
export type CaptureSourceMode = "system" | "microphone" | "both";
export type CaptureSourceTag = "system" | "microphone";
export type AnswerTriggerMode = "questions_only" | "all_final";
/**
 * QA Assist is a system-audio-only Live Assist session profile for
 * interview/technical-QA/troubleshooting/support use. It forces
 * `sources = ["system"]` and never instantiates a microphone provider.
 * "live_assist" is the existing configurable microphone/system/both profile.
 */
export type LiveAssistSessionProfile = "live_assist" | "qa_assist";
export type EvidenceReadinessStatus =
  | "starting"
  | "warming"
  | "ready"
  | "failed";

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

export type ProviderCredentialId =
  | "deepgram"
  | "openai_embeddings";

export interface ProviderCredentialStatus {
  provider: ProviderCredentialId;
  state: "configured" | "missing" | "invalid";
  source: "environment" | "secure_store" | "missing";
  externallyManaged: boolean;
  maskedSuffix: string | null;
}

export interface V2ReadinessStatus {
  state: "ready" | "misconfigured" | "provider_error";
  model: string | null;
  semanticReady: boolean;
  synthesisReady: boolean;
  reason: string | null;
}

export interface RelaySettingsSnapshot {
  providers: {
    deepgram: ProviderCredentialStatus;
    openAiEmbeddings: ProviderCredentialStatus;
  };
  /**
   * Main-process V2 provider readiness. Older isolated SettingsStore callers
   * may omit this; production IPC always supplies it.
   */
  v2?: V2ReadinessStatus;
  speech: {
    captureSourceMode: CaptureSourceMode;
    answerTriggerMode: AnswerTriggerMode;
    microphoneDeviceId: string | null;
    microphoneLabel: string | null;
  };
  overlay: OverlayPrefs & {
    autoShow: boolean;
    visibleInScreenShare: boolean;
  };
  privacy: {
    persistsRawAudio: false;
    persistsContinuousTranscript: false;
  };
}

export interface UpdateRelaySettingsInput {
  captureSourceMode: CaptureSourceMode;
  answerTriggerMode: AnswerTriggerMode;
  microphoneDeviceId: string | null;
  microphoneLabel: string | null;
  overlayAutoShow: boolean;
  overlay: Pick<OverlayPrefs, "width" | "height" | "opacity">;
  visibleInScreenShare: boolean;
}

export interface OverlayVisibilityState {
  created: boolean;
  visible: boolean;
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
  profile: LiveAssistSessionProfile;
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
  /**
   * Present only for "start". Main dictates the exact capture mode to use;
   * for QA Assist this is always forced to "system" regardless of the
   * user's configured Relay settings capture mode.
   */
  sourceMode?: CaptureSourceMode;
}

export interface LiveAssistProjectionSource {
  messageId: string;
  citationId: string;
  title: string;
  documentId?: string;
  publisher?: string;
  sourceRole?: string;
  section?: string;
  url?: string;
}

export interface LiveAssistProjection {
  sessionId: string;
  conversationId: string;
  /** Durable identity of this accepted user/STT turn. */
  userMessageId: string;
  /** Durable presentation identity for this turn's execution/card. */
  answerRunId: string;
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

export interface LiveAssistHydration {
  session: LiveAssistSessionView | null;
  projections: LiveAssistProjection[];
  transcript: TranscriptMessage | null;
  status: ConnectionStatus;
  evidenceStatus: EvidenceReadinessStatus;
}

export interface OverlayApi {
  getLiveAssistHydration: () => Promise<LiveAssistHydration>;
  hideOverlay: () => Promise<OverlayVisibilityState>;
  getDemoMode: () => Promise<boolean>;
  openLiveCitation: (
    messageId: string,
    citationId: string
  ) => Promise<void>;
  onLiveAssistProjection: (
    handler: (projection: LiveAssistProjection) => void
  ) => () => void;
  onLiveAssistSession: (
    handler: (session: LiveAssistSessionView | null) => void
  ) => () => void;
  onEvidenceStatus: (
    handler: (status: EvidenceReadinessStatus) => void
  ) => () => void;
  onDemoMode: (handler: (enabled: boolean) => void) => () => void;
  onTranscript: (handler: (payload: TranscriptMessage) => void) => () => void;
  onStatus: (handler: (status: ConnectionStatus) => void) => () => void;
}
