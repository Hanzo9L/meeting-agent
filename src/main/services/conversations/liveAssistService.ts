import type {
  CaptureSourceTag,
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";
import { HelpdeskService } from "./helpdeskService";
import type {
  ConversationStore,
  LiveAssistCaptureStatus,
  LiveAssistSessionProfile,
  LiveAssistSessionRecord
} from "./types";

function toView(
  session: LiveAssistSessionRecord
): LiveAssistSessionView {
  return { ...session };
}

export interface MicrophoneRejectedEvent {
  sessionId: string;
  conversationId: string;
  reason: "qa_assist_microphone_excluded";
  timestamp: number;
}

export interface LiveAssistServiceEvents {
  sessionChanged(session: LiveAssistSessionView | null): void;
  projectionChanged(projection: LiveAssistProjection): void;
  conversationUpdated(conversationId: string): void;
  /**
   * Fired when a microphone-sourced accepted utterance reaches the
   * ingestion boundary during an active QA Assist session. This is a
   * defense-in-depth backstop only: normal QA Assist system-only capture
   * never instantiates a microphone provider in the first place.
   */
  microphoneRejected?(event: MicrophoneRejectedEvent): void;
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

  start(
    conversationId: string,
    profile: LiveAssistSessionProfile = "live_assist"
  ): LiveAssistSessionView {
    const session = this.store.startLiveAssistSession(
      conversationId,
      profile
    );
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

  async acceptQuestion(
    question: string,
    source: CaptureSourceTag = "microphone"
  ): Promise<void> {
    const text = question.trim();
    const session = this.store.getActiveLiveAssistSession();
    if (!text || !session) return;

    if (session.profile === "qa_assist" && source === "microphone") {
      // Defense-in-depth only: normal QA Assist system-only capture never
      // creates a microphone provider, so this utterance should never
      // reach this boundary in practice. Reject before any durable user
      // message, answer run, or grounded execution is created.
      this.events.microphoneRejected?.({
        sessionId: session.id,
        conversationId: session.conversationId,
        reason: "qa_assist_microphone_excluded",
        timestamp: Date.now()
      });
      return;
    }

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
      content: text,
      captureSource: source
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
