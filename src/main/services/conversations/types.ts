export type ConversationMessageRole = "user" | "assistant";
export type ConversationInputOrigin = "typed" | "pasted" | "live_transcript";
export type PersistedAnswerability = "answered" | "partial";

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
  answerability: PersistedAnswerability | null;
  groundingSnapshotId: string | null;
  createdAt: string;
}

export interface GroundingSnapshotReference {
  snapshotId: string;
  snapshotHash: string;
  schemaVersion: string;
  resolverPolicyVersion: string;
  corpusRevisionHash: string;
  createdAt: string;
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

export interface ConversationStore {
  createConversation(input?: CreateConversationInput): ConversationRecord;
  listConversations(): ConversationRecord[];
  getConversation(conversationId: string): ConversationRecord | null;
  renameConversation(conversationId: string, title: string): ConversationRecord;
  deleteConversation(conversationId: string): boolean;
  clearHistory(): number;
  appendUserMessage(input: AppendUserMessageInput): ConversationMessage;
  appendGroundedAssistantMessage(
    input: AppendGroundedAssistantMessageInput
  ): CompletedAnswerRun;
  loadOrderedMessages(conversationId: string): ConversationMessage[];
  createAnswerRun(input: CreateAnswerRunInput): AnswerRunRecord;
  updateAnswerRun(input: UpdateAnswerRunInput): AnswerRunRecord;
  getAnswerRun(answerRunId: string): AnswerRunRecord | null;
  saveContextResolution(input: SaveContextResolutionInput): ContextResolutionRecord;
  getContextResolution(sourceUserMessageId: string): ContextResolutionRecord | null;
  recoverInterruptedAnswerRuns(): number;
  getSchemaVersion(): number;
  close(): void;
}
