import type {
  CaptureSourceTag,
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";
import {
  listEvidenceCardSources,
  parseEvidenceCardContent
} from "@shared/evidenceCard";
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
    source: CaptureSourceTag = "microphone",
    expectedSessionId?: string
  ): Promise<void> {
    const text = question.trim();
    const session = this.store.getActiveLiveAssistSession();
    if (!text || !session) return;
    if (expectedSessionId && session.id !== expectedSessionId) return;

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

    const begun = this.helpdesk.beginLiveQuestion({
      conversationId: session.conversationId,
      content: text,
      captureSource: source,
      presentationSynthesis:
        session.profile === "qa_assist" ? "disabled" : "optional"
    });
    const base = {
      sessionId: session.id,
      conversationId: session.conversationId,
      userMessageId: begun.started.message.id,
      answerRunId: begun.started.answerRun.id,
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
    // Make the durable user turn visible immediately, without waiting for any
    // earlier answer in this conversation's serial execution queue.
    this.events.conversationUpdated(session.conversationId);

    const submitted = await begun.completion;
    const run = submitted.view.answerRuns.find(
      (entry) => entry.id === begun.started.answerRun.id
    );
    const assistant = run?.assistantMessageId
      ? submitted.view.messages.find(
          (message) => message.id === run.assistantMessageId
        )
      : undefined;
    if (
      submitted.outcome === "failed" ||
      !assistant ||
      !run
    ) {
      this.events.projectionChanged({
        ...base,
        state: "failed"
      });
    } else {
      const parsed = parseEvidenceCardContent(assistant.content);
      const cardSources = parsed
        ? listEvidenceCardSources(parsed.payload)
        : [];
      this.events.projectionChanged({
        ...base,
        state: submitted.outcome,
        answerText: assistant.content,
        answerability: assistant.answerability,
        sources: assistant.citations.map((citation) => {
          const card = cardSources.find(
            (source) => source.parentId === citation.documentId
          );
          const publisher =
            card?.publisher ??
            (citation.sourceId === "audiocodes"
              ? "AudioCodes"
              : citation.sourceId === "linux-upstream"
                ? "Linux"
                : citation.sourceId === "microsoft-learn"
                  ? "Microsoft"
                  : undefined);
          return {
            messageId: assistant.id,
            citationId: citation.citationId,
            title: citation.sourceTitle,
            documentId: citation.documentId ?? undefined,
            publisher,
            sourceRole: card?.sourceRole,
            section: card?.section,
            url: citation.canonicalUrl
          };
        })
      });
    }
    this.events.conversationUpdated(session.conversationId);
  }
}
