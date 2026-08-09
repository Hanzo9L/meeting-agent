import type {
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";
import { HelpdeskService } from "./helpdeskService";
import type {
  ConversationStore,
  LiveAssistCaptureStatus,
  LiveAssistSessionRecord
} from "./types";

function toView(
  session: LiveAssistSessionRecord
): LiveAssistSessionView {
  return { ...session };
}

export interface LiveAssistServiceEvents {
  sessionChanged(session: LiveAssistSessionView | null): void;
  projectionChanged(projection: LiveAssistProjection): void;
  conversationUpdated(conversationId: string): void;
}

export class LiveAssistService {
  constructor(
    private readonly store: ConversationStore,
    private readonly helpdesk: HelpdeskService,
    private readonly events: LiveAssistServiceEvents
  ) {}

  getActiveSession(): LiveAssistSessionView | null {
    const session = this.store.getActiveLiveAssistSession();
    return session ? toView(session) : null;
  }

  start(conversationId: string): LiveAssistSessionView {
    const session =
      this.store.startLiveAssistSession(conversationId);
    const view = toView(session);
    this.events.sessionChanged(view);
    return view;
  }

  setCaptureStatus(
    status: Exclude<
      LiveAssistCaptureStatus,
      "stopped" | "interrupted"
    >
  ): LiveAssistSessionView | null {
    const active = this.store.getActiveLiveAssistSession();
    if (!active) return null;
    const updated = this.store.updateLiveAssistCaptureStatus(
      active.id,
      status
    );
    const view = toView(updated);
    this.events.sessionChanged(view);
    return view;
  }

  stop(reason = "user_stopped"): LiveAssistSessionView | null {
    const active = this.store.getActiveLiveAssistSession();
    if (!active) return null;
    const stopped = this.store.stopLiveAssistSession(
      active.id,
      reason
    );
    const view = toView(stopped);
    this.events.sessionChanged(view);
    return view;
  }

  async acceptQuestion(question: string): Promise<void> {
    const text = question.trim();
    const session = this.store.getActiveLiveAssistSession();
    if (!text || !session) return;
    const base = {
      sessionId: session.id,
      conversationId: session.conversationId,
      question: text,
      answerText: null,
      answerability: null,
      sources: [],
      timestamp: Date.now()
    } satisfies Omit<LiveAssistProjection, "state">;
    this.events.projectionChanged({
      ...base,
      state: "accepted"
    });
    this.events.projectionChanged({
      ...base,
      state: "executing"
    });

    const submitted = await this.helpdesk.submitLiveQuestion({
      conversationId: session.conversationId,
      content: text
    });
    const liveUserMessages = submitted.view.messages.filter(
      (message) =>
        message.role === "user" &&
        message.inputOrigin === "live_transcript" &&
        message.content === text
    );
    const userMessage = liveUserMessages.at(-1);
    const run = userMessage
      ? submitted.view.answerRuns.find(
          (entry) =>
            entry.triggeringUserMessageId === userMessage.id
        )
      : undefined;
    const assistant = run?.assistantMessageId
      ? submitted.view.messages.find(
          (message) => message.id === run.assistantMessageId
        )
      : undefined;
    if (
      submitted.outcome === "failed" ||
      !assistant ||
      !userMessage
    ) {
      this.events.projectionChanged({
        ...base,
        state: "failed"
      });
    } else {
      this.events.projectionChanged({
        ...base,
        state: submitted.outcome,
        answerText: assistant.content,
        answerability: assistant.answerability,
        sources: assistant.citations.map((citation) => ({
          messageId: assistant.id,
          citationId: citation.citationId,
          title: citation.sourceTitle
        }))
      });
    }
    this.events.conversationUpdated(session.conversationId);
  }
}
