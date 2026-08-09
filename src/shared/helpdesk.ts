export type HelpdeskInputOrigin = "typed" | "pasted" | "live_transcript";
export type HelpdeskAnswerability = "answered" | "partial";
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
  answerability: HelpdeskAnswerability | null;
  groundingSnapshotId: string | null;
  createdAt: string;
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
  outcome: "answer_unavailable";
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
}
