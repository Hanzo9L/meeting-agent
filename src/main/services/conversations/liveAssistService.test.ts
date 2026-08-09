import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type {
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";
import type {
  AnswerExecutionPort,
  AnswerExecutionResult
} from "./answerExecutionPort";
import { HelpdeskService } from "./helpdeskService";
import { LiveAssistService } from "./liveAssistService";
import { createSqliteConversationStore } from "./sqliteConversationStore";
import { PipelineManager } from "../pipelineManager";
import type {
  CompletedSttUtterance,
  SttEvents,
  SttProvider
} from "../sttProvider";

class CompletedUtteranceProvider implements SttProvider {
  private events: SttEvents | null = null;

  async start(events: SttEvents): Promise<void> {
    this.events = events;
  }

  sendAudio(): void {}

  async stop(): Promise<void> {
    this.events = null;
  }

  emit(utterance: CompletedSttUtterance): void {
    this.events?.onUtterance(utterance);
  }
}

function success(
  answerability:
    | "answered"
    | "partial"
    | "insufficient_evidence" = "answered"
): AnswerExecutionResult {
  const answerText =
    answerability === "insufficient_evidence"
      ? "Unable to provide a factual answer from the approved evidence."
      : "Calling Plans connect Teams Phone to the PSTN.";
  return {
    ok: true,
    answerability,
    answerText,
    snapshot: {
      snapshotId: `grounding:${answerability}`,
      snapshotHash: "a".repeat(64),
      schemaVersion: "grounding-decision-snapshot/v1",
      resolverPolicyVersion:
        "proposition-aware-evidence-policy/r2.2",
      corpusRevisionHash: "b".repeat(64),
      createdAt: "2026-08-09T00:00:00.000Z"
    },
    citations:
      answerability === "insufficient_evidence"
        ? []
        : [
            {
              citationId: `citation:${answerability}`,
              factualRangeId: `range:${answerability}`,
              answerRange: {
                startOffset: 0,
                endOffset: answerText.length
              },
              sourceTitle: "Microsoft Teams Calling Plans",
              canonicalUrl:
                "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365",
              sourceId: "ms-teams-admin",
              authorityRole: "teams_admin_primary",
              headingPath: ["Calling Plans"],
              sectionId: "calling-plans",
              sourceStatus: "ga",
              preview: false
            }
          ],
    diagnostics: {
      retrievalMs: 1,
      evidenceResolutionMs: 1,
      planningMs: 1,
      assemblyMs: 1,
      citationMappingMs: 1,
      pipelineTotalMs: 5,
      answerGenerationRequestCount: 0
    }
  };
}

class SequencePort implements AnswerExecutionPort {
  readonly questions: string[] = [];

  constructor(
    private readonly results: AnswerExecutionResult[]
  ) {}

  async execute(request: {
    question: string;
  }): Promise<AnswerExecutionResult> {
    this.questions.push(request.question);
    return (
      this.results.shift() ?? {
        ok: false,
        code: "grounding_execution_failed",
        stage: "retrieval_grounding",
        userSafeMessage: "Grounding failed."
      }
    );
  }
}

async function fixture(results: AnswerExecutionResult[]) {
  const root = await mkdtemp(join(tmpdir(), "relay-live-assist-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const port = new SequencePort(results);
  const helpdesk = new HelpdeskService(store, port);
  const sessions: Array<LiveAssistSessionView | null> = [];
  const projections: LiveAssistProjection[] = [];
  const updated: string[] = [];
  const live = new LiveAssistService(store, helpdesk, {
    sessionChanged: (session) => sessions.push(session),
    projectionChanged: (projection) =>
      projections.push(projection),
    conversationUpdated: (conversationId) =>
      updated.push(conversationId)
  });
  return {
    root,
    store,
    port,
    helpdesk,
    live,
    sessions,
    projections,
    updated
  };
}

test("accepted question becomes a durable live_transcript turn using the shared answer port", async () => {
  const context = await fixture([success()]);
  try {
    const conversation = context.store.createConversation({
      title: "Live"
    });
    const session = context.live.start(conversation.id);
    context.live.setCaptureStatus("capturing");
    await context.live.acceptQuestion(
      "How do Calling Plans work?"
    );

    const messages =
      context.store.loadOrderedMessages(conversation.id);
    assert.equal(messages[0]?.inputOrigin, "live_transcript");
    assert.equal(
      messages[0]?.content,
      "How do Calling Plans work?"
    );
    assert.equal(messages[1]?.role, "assistant");
    assert.equal(messages[1]?.citations.length, 1);
    assert.deepEqual(context.port.questions, [
      "How do Calling Plans work?"
    ]);
    assert.deepEqual(
      context.projections.map((item) => item.state),
      ["accepted", "executing", "answered"]
    );
    const final = context.projections.at(-1);
    assert.equal(final?.answerText, messages[1]?.content);
    assert.equal(
      final?.sources[0]?.citationId,
      messages[1]?.citations[0]?.citationId
    );
    assert.equal(context.updated[0], conversation.id);
    assert.equal(session.conversationId, conversation.id);
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("one completed STT utterance creates one durable turn and one grounded execution", async () => {
  const context = await fixture([success()]);
  const provider = new CompletedUtteranceProvider();
  try {
    const conversation = context.store.createConversation({
      title: "Assembled utterance"
    });
    context.live.start(conversation.id);
    const pipeline = new PipelineManager({
      sttProviderFactory: () => provider,
      onAcceptedQuestion: async (question) => {
        await context.live.acceptQuestion(question);
      },
      sendStatus: () => undefined,
      sendTranscript: () => undefined
    });
    await pipeline.start({
      sources: ["microphone"],
      answerTriggerMode: "questions_only"
    });

    provider.emit({
      utteranceId: "utterance:assembled-question",
      text: "How do Microsoft Teams calling plans work?",
      completionSignal: "utterance_end",
      segmentCount: 2,
      sourceStartSeconds: 1,
      sourceEndSeconds: 3,
      speechFinalObserved: true
    });
    for (
      let attempts = 0;
      attempts < 20 && context.port.questions.length === 0;
      attempts += 1
    ) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 1)
      );
    }

    const messages =
      context.store.loadOrderedMessages(conversation.id);
    assert.equal(
      messages.filter(
        (message) => message.inputOrigin === "live_transcript"
      ).length,
      1
    );
    assert.equal(
      messages.filter((message) => message.role === "assistant")
        .length,
      1
    );
    assert.deepEqual(context.port.questions, [
      "How do Microsoft Teams calling plans work?"
    ]);
    await pipeline.stop();
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("partial and insufficient live answers preserve frozen pipeline outcomes", async () => {
  const context = await fixture([
    success("partial"),
    success("insufficient_evidence")
  ]);
  try {
    const conversation = context.store.createConversation({
      title: "Live outcomes"
    });
    context.live.start(conversation.id);
    await context.live.acceptQuestion("Partial question?");
    await context.live.acceptQuestion("Unknown cmdlet?");
    const assistants = context.store
      .loadOrderedMessages(conversation.id)
      .filter((message) => message.role === "assistant");
    assert.deepEqual(
      assistants.map((message) => message.answerability),
      ["partial", "insufficient_evidence"]
    );
    assert.equal(assistants[1]?.citations.length, 0);
    assert.deepEqual(
      context.projections
        .filter(
          (projection) =>
            projection.answerability !== null
        )
        .map((projection) => projection.state),
      ["partial", "insufficient_evidence"]
    );
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("stopping prevents future accepted questions while accepted work may finish", async () => {
  const context = await fixture([success()]);
  try {
    const conversation = context.store.createConversation({
      title: "Stopped"
    });
    context.live.start(conversation.id);
    context.live.stop();
    await context.live.acceptQuestion(
      "This must not become durable."
    );
    assert.equal(
      context.store.loadOrderedMessages(conversation.id).length,
      0
    );
    assert.deepEqual(context.port.questions, []);
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("execution failure persists only the live user turn and failed run", async () => {
  const context = await fixture([
    {
      ok: false,
      code: "grounding_execution_failed",
      stage: "retrieval_grounding",
      userSafeMessage: "Grounding failed."
    }
  ]);
  try {
    const conversation = context.store.createConversation({
      title: "Failure"
    });
    context.live.start(conversation.id);
    await context.live.acceptQuestion("Fail safely?");
    const view = context.helpdesk.loadConversation(conversation.id);
    assert.equal(view.messages.length, 1);
    assert.equal(view.messages[0]?.role, "user");
    assert.equal(view.answerRuns[0]?.state, "failed");
    assert.equal(context.projections.at(-1)?.state, "failed");
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("Slice 4 persists no raw audio or continuous transcript and adds no TTS path", () => {
  const migrations = readFileSync(
    resolve(
      "src/main/services/conversations/migrations.ts"
    ),
    "utf8"
  );
  const main = readFileSync(
    resolve("src/main/index.ts"),
    "utf8"
  );
  const overlay = readFileSync(
    resolve("src/renderer/overlay/App.tsx"),
    "utf8"
  );
  const overlayPreload = readFileSync(
    resolve("src/preload/overlayPreload.ts"),
    "utf8"
  );
  const capture = readFileSync(
    resolve(
      "src/renderer/audio-capture/captureLoopbackAudio.ts"
    ),
    "utf8"
  );
  const overlayWindow = readFileSync(
    resolve("src/main/windows/overlayWindow.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    migrations,
    /(audio_blob|audio_recording|continuous_transcript|raw_transcript)/
  );
  assert.doesNotMatch(main, /OpenAiLlmProvider/);
  assert.match(
    main,
    /payload\?\.sessionId !== activeSession\.id/
  );
  assert.match(
    main,
    /config\.sessionId !== activeSession\.id/
  );
  assert.doesNotMatch(
    overlay,
    /(onAnswerChunk|draftAnswer|speechSynthesis|textToSpeech|readAloud)/
  );
  assert.match(overlayPreload, /Object\.freeze/);
  assert.doesNotMatch(
    overlayPreload,
    /(openExternalUrl|answerChunk|answerSources)/
  );
  assert.match(capture, /sessionId/);
  assert.match(overlayWindow, /setWindowOpenHandler/);
  assert.match(overlayWindow, /will-navigate/);
});
