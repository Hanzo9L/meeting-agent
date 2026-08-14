export type ConversationMessageRole = "user" | "assistant";
export type ConversationInputOrigin = "typed" | "pasted" | "live_transcript";
export type PersistedAnswerability =
  | "answered"
  | "partial"
  | "insufficient_evidence";
/** The capture source that actually produced an accepted live-transcript question. */
export type MessageCaptureSource = "system" | "microphone";
/**
 * "live_assist" is the existing configurable microphone/system/both profile.
 * "qa_assist" forces system-only capture and excludes the microphone by
 * construction (see PipelineManager.start / LiveAssistService).
 */
export type LiveAssistSessionProfile = "live_assist" | "qa_assist";

export type AnswerRunState =
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

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  turnIndex: number;
  role: ConversationMessageRole;
  content: string;
  inputOrigin: ConversationInputOrigin | null;
  /**
   * The capture source that actually produced this message when
   * inputOrigin is "live_transcript"; null otherwise. Never inferred from
   * session/settings state after the fact.
   */
  captureSource: MessageCaptureSource | null;
  answerability: PersistedAnswerability | null;
  groundingSnapshotId: string | null;
  citations: MessageCitationRecord[];
  createdAt: string;
}

export interface MessageCitationRecord {
  messageId: string;
  citationId: string;
  factualRangeId: string;
  answerRangeStart: number;
  answerRangeEnd: number;
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

export interface GroundingSnapshotReference {
  snapshotId: string;
  snapshotHash: string;
  schemaVersion: string;
  resolverPolicyVersion: string;
  corpusRevisionHash: string;
  createdAt: string;
}

export type LiveAssistCaptureStatus =
  | "starting"
  | "capturing"
  | "error"
  | "stopped"
  | "interrupted";

export interface LiveAssistSessionRecord {
  id: string;
  conversationId: string;
  profile: LiveAssistSessionProfile;
  state: "active" | "inactive";
  captureStatus: LiveAssistCaptureStatus;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
}

export interface AnswerRunRecord {
  id: string;
  conversationId: string;
  triggeringUserMessageId: string;
  assistantMessageId: string | null;
  groundingSnapshotId: string | null;
  state: AnswerRunState;
  failureCode: string | null;
  failureDetails: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ContextResolutionRecord {
  id: string;
  sourceUserMessageId: string;
  originalText: string;
  resolvedQuestion: string;
  priorMessageIds: string[];
  createdAt: string;
}

export interface CreateConversationInput {
  title?: string;
}

export interface AppendUserMessageInput {
  conversationId: string;
  content: string;
  inputOrigin: ConversationInputOrigin;
  /**
   * Required (and must be "system" or "microphone") when inputOrigin is
   * "live_transcript"; must be omitted/null otherwise. Not inferred from
   * settings — pass exactly what produced the accepted utterance.
   */
  captureSource?: MessageCaptureSource | null;
}

export interface CreateAnswerRunInput {
  conversationId: string;
  triggeringUserMessageId: string;
}

export interface UpdateAnswerRunInput {
  answerRunId: string;
  state: Exclude<AnswerRunState, "completed" | "partial">;
  snapshot?: GroundingSnapshotReference;
  failureCode?: string;
  failureDetails?: Record<string, unknown>;
}

export interface AppendGroundedAssistantMessageInput {
  answerRunId: string;
  content: string;
  answerability: PersistedAnswerability;
  snapshot: GroundingSnapshotReference;
  citations: Array<
    Omit<MessageCitationRecord, "messageId" | "groundingSnapshotId">
  >;
}

export interface SaveContextResolutionInput {
  sourceUserMessageId: string;
  originalText: string;
  resolvedQuestion: string;
  priorMessageIds: string[];
}

export interface CompletedAnswerRun {
  message: ConversationMessage;
  answerRun: AnswerRunRecord;
}

export interface StartedAnswerRun {
  message: ConversationMessage;
  answerRun: AnswerRunRecord;
}

export interface ConversationStore {
  createConversation(input?: CreateConversationInput): ConversationRecord;
  listConversations(): ConversationRecord[];
  getConversation(conversationId: string): ConversationRecord | null;
  renameConversation(conversationId: string, title: string): ConversationRecord;
  deleteConversation(conversationId: string): boolean;
  clearHistory(): number;
  appendUserMessage(input: AppendUserMessageInput): ConversationMessage;
  appendUserMessageAndCreateAnswerRun(input: AppendUserMessageInput): StartedAnswerRun;
  appendGroundedAssistantMessage(
    input: AppendGroundedAssistantMessageInput
  ): CompletedAnswerRun;
  loadOrderedMessages(conversationId: string): ConversationMessage[];
  getMessageCitation(
    messageId: string,
    citationId: string
  ): MessageCitationRecord | null;
  startLiveAssistSession(
    conversationId: string,
    profile?: LiveAssistSessionProfile
  ): LiveAssistSessionRecord;
  getActiveLiveAssistSession(): LiveAssistSessionRecord | null;
  getLiveAssistSession(
    sessionId: string
  ): LiveAssistSessionRecord | null;
  updateLiveAssistCaptureStatus(
    sessionId: string,
    status: Exclude<LiveAssistCaptureStatus, "stopped" | "interrupted">
  ): LiveAssistSessionRecord;
  stopLiveAssistSession(
    sessionId: string,
    reason: string
  ): LiveAssistSessionRecord;
  recoverInterruptedLiveAssistSessions(): number;
  loadAnswerRuns(conversationId: string): AnswerRunRecord[];
  createAnswerRun(input: CreateAnswerRunInput): AnswerRunRecord;
  updateAnswerRun(input: UpdateAnswerRunInput): AnswerRunRecord;
  getAnswerRun(answerRunId: string): AnswerRunRecord | null;
  saveContextResolution(input: SaveContextResolutionInput): ContextResolutionRecord;
  getContextResolution(sourceUserMessageId: string): ContextResolutionRecord | null;
  recoverInterruptedAnswerRuns(): number;
  getSchemaVersion(): number;
  close(): void;
}
