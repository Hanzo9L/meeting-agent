import type {
  AudioChunkPayload,
  CaptureSourceTag,
  CaptureStartConfig,
  LiveAssistCaptureCommand,
  LiveAssistSessionView,
  OverlayVisibilityState,
  ProviderCredentialId,
  RelaySettingsSnapshot,
  TranscriptMessage,
  ConnectionStatus,
  UpdateRelaySettingsInput
} from "./types";

export type HelpdeskInputOrigin = "typed" | "pasted" | "live_transcript";
export type HelpdeskAnswerability =
  | "answered"
  | "partial"
  | "insufficient_evidence";
export type HelpdeskAnswerRunState =
  | "received"
  | "resolving_context"
  | "retrieving"
  | "planning"
  | "executing_answer"
  | "validating"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface HelpdeskConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface HelpdeskMessage {
  id: string;
  conversationId: string;
  turnIndex: number;
  role: "user" | "assistant";
  content: string;
  inputOrigin: HelpdeskInputOrigin | null;
  /**
   * The capture source that actually produced this accepted question, when
   * inputOrigin is "live_transcript". Always null for typed/pasted/assistant
   * messages. Never inferred from session settings; persisted exactly as
   * produced by the ingestion boundary.
   */
  captureSource: CaptureSourceTag | null;
  answerability: HelpdeskAnswerability | null;
  presentationProfile:
    | "helpdesk_detailed"
    | "live_assist_quick"
    | null;
  groundingSnapshotId: string | null;
  citations: HelpdeskCitation[];
  contextReferences: HelpdeskContextReference[];
  createdAt: string;
}

export interface HelpdeskCitation {
  citationId: string;
  factualRangeId: string;
  claimId: string | null;
  answerRangeStart: number;
  answerRangeEnd: number;
  evidenceId: string | null;
  spanId: string | null;
  supportingSpanIds: string[];
  documentId: string | null;
  sourceTitle: string;
  canonicalUrl: string;
  sourceId: string;
  authorityRole: string;
  headingPath: string[];
  sectionId: string;
  sourceStatus: string;
  preview: boolean;
  groundingSnapshotId: string;
}

export interface HelpdeskContextReference {
  contextBlockId: string;
  evidenceId: string;
  documentId: string;
  chunkId: string;
  sourceTitle: string;
  canonicalUrl: string;
  sourceId: string;
  authorityRole: string;
  headingPath: string[];
  sectionId: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceContentHash: string;
  contextType: string;
  preview: boolean;
  groundingSnapshotId: string;
}

export interface HelpdeskAnswerRun {
  id: string;
  conversationId: string;
  triggeringUserMessageId: string;
  assistantMessageId: string | null;
  state: HelpdeskAnswerRunState;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface HelpdeskConversationView {
  conversation: HelpdeskConversation;
  messages: HelpdeskMessage[];
  answerRuns: HelpdeskAnswerRun[];
}

export type HelpdeskErrorCode =
  | "invalid_request"
  | "not_found"
  | "operation_failed"
  | "unauthorized";

export type HelpdeskResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: HelpdeskErrorCode;
        message: string;
      };
    };

export interface SubmitHelpdeskMessageInput {
  conversationId: string;
  content: string;
  inputOrigin: "typed" | "pasted";
}

export interface SubmitHelpdeskMessageResult {
  view: HelpdeskConversationView;
  outcome:
    | "answered"
    | "partial"
    | "insufficient_evidence"
    | "failed";
}

export interface OpenHelpdeskCitationInput {
  messageId: string;
  citationId: string;
}

export interface HelpdeskApi {
  listConversations(): Promise<HelpdeskResult<HelpdeskConversation[]>>;
  createConversation(title?: string): Promise<HelpdeskResult<HelpdeskConversationView>>;
  loadConversation(conversationId: string): Promise<HelpdeskResult<HelpdeskConversationView>>;
  renameConversation(
    conversationId: string,
    title: string
  ): Promise<HelpdeskResult<HelpdeskConversation>>;
  deleteConversation(conversationId: string): Promise<HelpdeskResult<{ deleted: boolean }>>;
  submitMessage(
    input: SubmitHelpdeskMessageInput
  ): Promise<HelpdeskResult<SubmitHelpdeskMessageResult>>;
  openCitation(
    input: OpenHelpdeskCitationInput
  ): Promise<HelpdeskResult<{ opened: true }>>;
  getLiveAssistSession(): Promise<
    HelpdeskResult<LiveAssistSessionView | null>
  >;
  startLiveAssist(
    conversationId: string
  ): Promise<HelpdeskResult<LiveAssistSessionView>>;
  /**
   * Starts a system-audio-only QA Assist session: forces capture mode to
   * "system", so no microphone provider or MediaStream is ever created.
   */
  startQaAssist(
    conversationId: string
  ): Promise<HelpdeskResult<LiveAssistSessionView>>;
  stopLiveAssist(): Promise<
    HelpdeskResult<LiveAssistSessionView | null>
  >;
  onLiveAssistSession(
    handler: (session: LiveAssistSessionView | null) => void
  ): () => void;
  onConversationUpdated(
    handler: (conversationId: string) => void
  ): () => void;
  getRelaySettings(): Promise<
    HelpdeskResult<RelaySettingsSnapshot>
  >;
  updateRelaySettings(
    input: UpdateRelaySettingsInput
  ): Promise<HelpdeskResult<RelaySettingsSnapshot>>;
  setProviderCredential(
    provider: ProviderCredentialId,
    credential: string
  ): Promise<HelpdeskResult<RelaySettingsSnapshot>>;
  clearProviderCredential(
    provider: ProviderCredentialId
  ): Promise<HelpdeskResult<RelaySettingsSnapshot>>;
  getOverlayVisibility(): Promise<
    HelpdeskResult<OverlayVisibilityState>
  >;
  showOverlay(): Promise<
    HelpdeskResult<OverlayVisibilityState>
  >;
  hideOverlay(): Promise<
    HelpdeskResult<OverlayVisibilityState>
  >;
  startCapture(config: CaptureStartConfig): Promise<void>;
  stopCapture(sessionId: string): Promise<void>;
  reportLiveAssistCaptureError(sessionId: string): Promise<void>;
  enableLoopbackAudio(): Promise<void>;
  disableLoopbackAudio(): Promise<void>;
  sendAudioChunk(payload: AudioChunkPayload): void;
  onLiveAssistCaptureCommand(
    handler: (command: LiveAssistCaptureCommand) => void
  ): () => void;
  onTranscript(
    handler: (payload: TranscriptMessage) => void
  ): () => void;
  onConnectionStatus(
    handler: (status: ConnectionStatus) => void
  ): () => void;
}
