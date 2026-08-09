import type {
  HelpdeskAnswerRun,
  HelpdeskConversation,
  HelpdeskConversationView,
  HelpdeskMessage,
  SubmitHelpdeskMessageInput,
  SubmitHelpdeskMessageResult
} from "@shared/helpdesk";
import type { AnswerExecutionPort } from "./answerExecutionPort";
import type {
  AnswerRunRecord,
  ConversationMessage,
  ConversationRecord,
  ConversationStore
} from "./types";

export class HelpdeskServiceError extends Error {
  constructor(
    readonly code: "invalid_request" | "not_found" | "operation_failed",
    message: string
  ) {
    super(message);
    this.name = "HelpdeskServiceError";
  }
}

function toConversation(record: ConversationRecord): HelpdeskConversation {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toMessage(record: ConversationMessage): HelpdeskMessage {
  return {
    id: record.id,
    conversationId: record.conversationId,
    turnIndex: record.turnIndex,
    role: record.role,
    content: record.content,
    inputOrigin: record.inputOrigin,
    answerability: record.answerability,
    groundingSnapshotId: record.groundingSnapshotId,
    createdAt: record.createdAt
  };
}

function toAnswerRun(record: AnswerRunRecord): HelpdeskAnswerRun {
  return {
    id: record.id,
    conversationId: record.conversationId,
    triggeringUserMessageId: record.triggeringUserMessageId,
    assistantMessageId: record.assistantMessageId,
    state: record.state,
    failureCode: record.failureCode,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt
  };
}

export class HelpdeskService {
  constructor(
    private readonly store: ConversationStore,
    private readonly answerExecution: AnswerExecutionPort
  ) {}

  listConversations(): HelpdeskConversation[] {
    return this.store.listConversations().map(toConversation);
  }

  createConversation(title?: string): HelpdeskConversationView {
    const conversation = this.store.createConversation({
      title: title?.trim() || "New conversation"
    });
    return this.loadConversation(conversation.id);
  }

  loadConversation(conversationId: string): HelpdeskConversationView {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) {
      throw new HelpdeskServiceError("not_found", "Conversation not found.");
    }
    return {
      conversation: toConversation(conversation),
      messages: this.store.loadOrderedMessages(conversation.id).map(toMessage),
      answerRuns: this.store.loadAnswerRuns(conversation.id).map(toAnswerRun)
    };
  }

  renameConversation(conversationId: string, title: string): HelpdeskConversation {
    try {
      return toConversation(
        this.store.renameConversation(
          conversationId,
          title.trim()
        )
      );
    } catch (error) {
      if (error instanceof Error && /must not be empty/i.test(error.message)) {
        throw new HelpdeskServiceError("invalid_request", "Conversation title is required.");
      }
      if (error instanceof Error && /not found/i.test(error.message)) {
        throw new HelpdeskServiceError("not_found", "Conversation not found.");
      }
      throw error;
    }
  }

  deleteConversation(conversationId: string): { deleted: boolean } {
    return {
      deleted: this.store.deleteConversation(conversationId)
    };
  }

  async submitMessage(
    input: SubmitHelpdeskMessageInput
  ): Promise<SubmitHelpdeskMessageResult> {
    const content = input.content.trim();
    if (!content) {
      throw new HelpdeskServiceError("invalid_request", "Message text is required.");
    }

    const started = this.store.appendUserMessageAndCreateAnswerRun({
      conversationId: input.conversationId,
      content,
      inputOrigin: input.inputOrigin
    });

    let failureCode = "answer_unavailable";
    try {
      const result = await this.answerExecution.execute({
        conversationId: input.conversationId,
        userMessageId: started.message.id,
        question: content
      });
      failureCode = result.code;
    } catch {
      failureCode = "answer_unavailable";
    }

    this.store.updateAnswerRun({
      answerRunId: started.answerRun.id,
      state: "failed",
      failureCode,
      failureDetails: {
        userMessage: "Answer engine not connected yet."
      }
    });

    return {
      view: this.loadConversation(input.conversationId),
      outcome: "answer_unavailable"
    };
  }
}
