import type {
  HelpdeskAnswerRun,
  HelpdeskConversation,
  HelpdeskConversationView,
  HelpdeskMessage,
  SubmitHelpdeskMessageInput,
  SubmitHelpdeskMessageResult
} from "@shared/helpdesk";
import type { CaptureSourceTag } from "@shared/types";
import { isAuthoritativeEvidenceUrl } from "@shared/evidenceCard";
import type { AnswerExecutionPort } from "./answerExecutionPort";
import type {
  AnswerRunRecord,
  ConversationMessage,
  ConversationRecord,
  ConversationStore,
  StartedAnswerRun
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

export interface BegunHelpdeskTurn {
  started: StartedAnswerRun;
  completion: Promise<SubmitHelpdeskMessageResult>;
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
    captureSource: record.captureSource,
    answerability: record.answerability,
    presentationProfile: record.presentationProfile,
    groundingSnapshotId: record.groundingSnapshotId,
    citations: record.citations.map((citation) => ({
      citationId: citation.citationId,
      factualRangeId: citation.factualRangeId,
      claimId: citation.claimId,
      answerRangeStart: citation.answerRangeStart,
      answerRangeEnd: citation.answerRangeEnd,
      evidenceId: citation.evidenceId,
      spanId: citation.spanId,
      supportingSpanIds: [...citation.supportingSpanIds],
      documentId: citation.documentId,
      sourceTitle: citation.sourceTitle,
      canonicalUrl: citation.canonicalUrl,
      sourceId: citation.sourceId,
      authorityRole: citation.authorityRole,
      headingPath: [...citation.headingPath],
      sectionId: citation.sectionId,
      sourceStatus: citation.sourceStatus,
      preview: citation.preview,
      groundingSnapshotId: citation.groundingSnapshotId
    })),
    contextReferences: record.contextReferences.map((reference) => ({
      contextBlockId: reference.contextBlockId,
      evidenceId: reference.evidenceId,
      documentId: reference.documentId,
      chunkId: reference.chunkId,
      sourceTitle: reference.sourceTitle,
      canonicalUrl: reference.canonicalUrl,
      sourceId: reference.sourceId,
      authorityRole: reference.authorityRole,
      headingPath: [...reference.headingPath],
      sectionId: reference.sectionId,
      sourceStartOffset: reference.sourceStartOffset,
      sourceEndOffset: reference.sourceEndOffset,
      sourceContentHash: reference.sourceContentHash,
      contextType: reference.contextType,
      preview: reference.preview,
      groundingSnapshotId: reference.groundingSnapshotId
    })),
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
  private readonly executionQueues = new Map<
    string,
    Promise<void>
  >();

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

  getActionableCitationUrl(
    messageId: string,
    citationId: string
  ): string {
    const citation = this.store.getMessageCitation(
      messageId,
      citationId
    );
    if (!citation) {
      throw new HelpdeskServiceError(
        "not_found",
        "Citation not found."
      );
    }
    try {
      const parsed = new URL(citation.canonicalUrl);
      if (!isAuthoritativeEvidenceUrl(citation.canonicalUrl)) {
        throw new Error("untrusted citation URL");
      }
      return parsed.toString();
    } catch {
      throw new HelpdeskServiceError(
        "operation_failed",
        "This citation cannot be opened safely."
      );
    }
  }

  async submitMessage(
    input: SubmitHelpdeskMessageInput
  ): Promise<SubmitHelpdeskMessageResult> {
    return this.submitTurn(input);
  }

  async submitLiveQuestion(input: {
    conversationId: string;
    content: string;
    captureSource?: CaptureSourceTag;
    presentationSynthesis?: "optional" | "disabled";
  }): Promise<SubmitHelpdeskMessageResult> {
    return this.beginLiveQuestion(input).completion;
  }

  beginLiveQuestion(input: {
    conversationId: string;
    content: string;
    captureSource?: CaptureSourceTag;
    presentationSynthesis?: "optional" | "disabled";
  }): BegunHelpdeskTurn {
    return this.beginTurn({
      conversationId: input.conversationId,
      content: input.content,
      inputOrigin: "live_transcript",
      captureSource: input.captureSource ?? "microphone",
      presentationSynthesis: input.presentationSynthesis ?? "optional"
    });
  }

  private async submitTurn(input: {
    conversationId: string;
    content: string;
    inputOrigin: "typed" | "pasted" | "live_transcript";
    captureSource?: CaptureSourceTag;
  }): Promise<SubmitHelpdeskMessageResult> {
    return this.beginTurn(input).completion;
  }

  private beginTurn(input: {
    conversationId: string;
    content: string;
    inputOrigin: "typed" | "pasted" | "live_transcript";
    captureSource?: CaptureSourceTag;
    presentationSynthesis?: "optional" | "disabled";
  }): BegunHelpdeskTurn {
    const content = input.content.trim();
    if (!content) {
      throw new HelpdeskServiceError("invalid_request", "Message text is required.");
    }

    const started = this.store.appendUserMessageAndCreateAnswerRun({
      conversationId: input.conversationId,
      content,
      inputOrigin: input.inputOrigin,
      captureSource:
        input.inputOrigin === "live_transcript"
          ? input.captureSource ?? null
          : null
    });
    const completion = this.enqueueExecution(
      input.conversationId,
      () =>
        this.executeStartedTurn({
          conversationId: input.conversationId,
          content,
          started,
          presentationProfile:
            input.inputOrigin === "live_transcript"
              ? "live_assist_quick"
              : "helpdesk_detailed",
          presentationSynthesis:
            input.presentationSynthesis ?? "optional"
        })
    );
    return { started, completion };
  }

  private enqueueExecution<T>(
    conversationId: string,
    execute: () => Promise<T>
  ): Promise<T> {
    const previous =
      this.executionQueues.get(conversationId) ??
      Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(execute);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.executionQueues.set(conversationId, tail);
    void tail.finally(() => {
      if (this.executionQueues.get(conversationId) === tail) {
        this.executionQueues.delete(conversationId);
      }
    });
    return result;
  }

  private async executeStartedTurn(params: {
    conversationId: string;
    content: string;
    started: StartedAnswerRun;
    presentationProfile:
      | "helpdesk_detailed"
      | "live_assist_quick";
    presentationSynthesis: "optional" | "disabled";
  }): Promise<SubmitHelpdeskMessageResult> {
    const { conversationId, content, started } = params;
    this.store.updateAnswerRun({
      answerRunId: started.answerRun.id,
      state: "retrieving"
    });

    let result: Awaited<
      ReturnType<AnswerExecutionPort["execute"]>
    >;
    try {
      result = await this.answerExecution.execute({
        conversationId,
        userMessageId: started.message.id,
        question: content,
        presentationProfile: params.presentationProfile,
        presentationSynthesis: params.presentationSynthesis
      });
    } catch {
      result = {
        ok: false,
        code: "grounding_execution_failed",
        stage: "retrieval_grounding",
        userSafeMessage:
          "Relay could not complete the grounded answer request."
      };
    }

    if (!result.ok) {
      this.store.updateAnswerRun({
        answerRunId: started.answerRun.id,
        state: "failed",
        failureCode: result.code,
        failureDetails: {
          stage: result.stage,
          userMessage: result.userSafeMessage
        }
      });
      return {
        view: this.loadConversation(conversationId),
        outcome: "failed"
      };
    }

    this.store.updateAnswerRun({
      answerRunId: started.answerRun.id,
      state: "planning"
    });
    this.store.updateAnswerRun({
      answerRunId: started.answerRun.id,
      state: "executing_answer"
    });
    this.store.updateAnswerRun({
      answerRunId: started.answerRun.id,
      state: "validating",
      snapshot: result.snapshot
    });
    try {
      this.store.appendGroundedAssistantMessage({
        answerRunId: started.answerRun.id,
        content: result.answerText,
        answerability: result.answerability,
        presentationProfile: result.presentationProfile,
        snapshot: result.snapshot,
        citations: result.citations.map((citation) => ({
          citationId: citation.citationId,
          factualRangeId: citation.factualRangeId,
          claimId: citation.claimId,
          answerRangeStart: citation.answerRange.startOffset,
          answerRangeEnd: citation.answerRange.endOffset,
          evidenceId: citation.evidenceId,
          spanId: citation.spanId,
          supportingSpanIds: [...citation.supportingSpanIds],
          documentId: citation.documentId,
          sourceTitle: citation.sourceTitle,
          canonicalUrl: citation.canonicalUrl,
          sourceId: citation.sourceId,
          authorityRole: citation.authorityRole,
          headingPath: [...citation.headingPath],
          sectionId: citation.sectionId,
          sourceStatus: citation.sourceStatus,
          preview: citation.preview
        })),
        contextReferences: result.contextReferences.map((reference) => ({
          contextBlockId: reference.contextBlockId,
          evidenceId: reference.evidenceId,
          documentId: reference.documentId,
          chunkId: reference.chunkId,
          sourceTitle: reference.sourceTitle,
          canonicalUrl: reference.canonicalUrl,
          sourceId: reference.sourceId,
          authorityRole: reference.authorityRole,
          headingPath: [...reference.headingPath],
          sectionId: reference.sectionId,
          sourceStartOffset: reference.sourceStartOffset,
          sourceEndOffset: reference.sourceEndOffset,
          sourceContentHash: reference.sourceContentHash,
          contextType: reference.contextType,
          preview: reference.preview
        }))
      });
    } catch {
      this.store.updateAnswerRun({
        answerRunId: started.answerRun.id,
        state: "failed",
        failureCode: "grounded_answer_persistence_failed",
        failureDetails: {
          userMessage:
            "Relay could not safely persist the validated answer."
        }
      });
      return {
        view: this.loadConversation(conversationId),
        outcome: "failed"
      };
    }
    return {
      view: this.loadConversation(conversationId),
      outcome: result.answerability
    };
  }
}
