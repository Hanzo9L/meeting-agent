import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type {
  AnswerExecutionPort,
  AnswerExecutionRequest,
  AnswerExecutionResult
} from "./answerExecutionPort";
import { HelpdeskService } from "./helpdeskService";
import {
  createSqliteConversationStore,
  type SqliteConversationStore
} from "./sqliteConversationStore";

const ANSWER_TEXT =
  "Microsoft Teams Calling Plans provide PSTN connectivity for Teams Phone.";

function success(
  answerability:
    | "answered"
    | "partial"
    | "insufficient_evidence" = "answered"
): AnswerExecutionResult {
  const answerText =
    answerability === "insufficient_evidence"
      ? "Unable to provide a factual answer from the approved evidence."
      : ANSWER_TEXT;
  return {
    ok: true,
    answerability,
    answerText,
    factualAnswerText: answerText,
    presentationProfile: "helpdesk_detailed",
    helpdeskDetailedText: answerText,
    liveAssistQuickText: answerText,
    snapshot: {
      snapshotId: "grounding:slice3",
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
              citationId: "citation:slice3",
              factualRangeId: "factual-range:slice3",
              claimId: "claim:slice3",
              answerRange: {
                startOffset: 0,
                endOffset: ANSWER_TEXT.length
              },
              evidenceId: "evidence:slice3",
              spanId: "span:slice3",
              supportingSpanIds: [],
              documentId: "document:slice3",
              sourceTitle: "Microsoft Teams Calling Plans",
              canonicalUrl:
                "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365",
              sourceId: "ms-teams-admin",
              authorityRole: "teams_admin_primary",
              headingPath: ["Microsoft Teams Calling Plans"],
              sectionId: "calling-plans",
              sourceStatus: "ga",
              preview: false
            }
          ],
    contextReferences: [],
    diagnostics: {
      retrievalMs: 1,
      evidenceResolutionMs: 1,
      planningMs: 1,
      assemblyMs: 1,
      citationMappingMs: 1,
      contextBuildMs: 0,
      presentationPlanningMs: 0,
      presentationRenderMs: 0,
      synthesisMs: 0,
      pipelineTotalMs: 5,
      factualGroundingGenerationRequests: 0,
      presentationSynthesisRequests: 0,
      presentationSynthesisStatus: "not_configured",
      presentationSynthesisFallbackReason: null
    }
  };
}

function successWithContext(
  profile: "helpdesk_detailed" | "live_assist_quick"
): AnswerExecutionResult {
  const contextText = "Use sensitivity labels as additional context.";
  const answerText =
    profile === "helpdesk_detailed"
      ? `Summary\n${ANSWER_TEXT}\n\nAuthoritative context\n${contextText}`
      : `${ANSWER_TEXT}\n\n${contextText}`;
  const claimStart = answerText.indexOf(ANSWER_TEXT);
  const result = success();
  if (!result.ok) return result;
  return {
    ...result,
    answerText,
    presentationProfile: profile,
    helpdeskDetailedText:
      profile === "helpdesk_detailed"
        ? answerText
        : `Summary\n${ANSWER_TEXT}`,
    liveAssistQuickText:
      profile === "live_assist_quick" ? answerText : ANSWER_TEXT,
    citations: result.citations.map((citation) => ({
      ...citation,
      answerRange: {
        startOffset: claimStart,
        endOffset: claimStart + ANSWER_TEXT.length
      }
    })),
    contextReferences: [
      {
        contextBlockId: "context:labels",
        evidenceId: "evidence:labels",
        documentId: "document:labels",
        chunkId: "chunk:labels",
        sourceTitle: "Sensitivity labels",
        canonicalUrl:
          "https://learn.microsoft.com/en-us/purview/sensitivity-labels",
        sourceId: "ms-m365-docs",
        authorityRole: "m365_primary",
        headingPath: ["Sensitivity labels", "Overview"],
        sectionId: "overview",
        sourceStartOffset: 10,
        sourceEndOffset: 42,
        sourceContentHash: "c".repeat(64),
        contextType: "conceptual_explanation",
        preview: false
      }
    ]
  };
}

class RecordingPort implements AnswerExecutionPort {
  readonly requests: AnswerExecutionRequest[] = [];

  constructor(private readonly result: AnswerExecutionResult) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    this.requests.push(request);
    return structuredClone(this.result);
  }
}

async function makeStore(): Promise<{
  root: string;
  databasePath: string;
  store: SqliteConversationStore;
}> {
  const root = await mkdtemp(
    join(tmpdir(), "meeting-agent-helpdesk-service-")
  );
  const databasePath = join(root, "conversations.sqlite");
  return {
    root,
    databasePath,
    store: createSqliteConversationStore({ databasePath })
  };
}

test("create, list, load, rename, and delete flow stays main-process owned", async () => {
  const fixture = await makeStore();
  const service = new HelpdeskService(
    fixture.store,
    new RecordingPort(success())
  );
  try {
    const created = service.createConversation();
    assert.equal(created.conversation.title, "New conversation");
    assert.equal(service.listConversations().length, 1);
    assert.equal(
      service.loadConversation(created.conversation.id).conversation.id,
      created.conversation.id
    );
    const renamed = service.renameConversation(
      created.conversation.id,
      "Teams Voice"
    );
    assert.equal(renamed.title, "Teams Voice");
    assert.deepEqual(service.deleteConversation(created.conversation.id), {
      deleted: true
    });
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("typed and pasted turns reach the same grounded execution port", async () => {
  const fixture = await makeStore();
  const port = new RecordingPort(success());
  const service = new HelpdeskService(fixture.store, port);
  try {
    const created = service.createConversation("Origins");
    await service.submitMessage({
      conversationId: created.conversation.id,
      content: "Typed question",
      inputOrigin: "typed"
    });
    const pasted = await service.submitMessage({
      conversationId: created.conversation.id,
      content: "Pasted question",
      inputOrigin: "pasted"
    });
    assert.equal(port.requests.length, 2);
    assert.deepEqual(
      port.requests.map((request) => request.question),
      ["Typed question", "Pasted question"]
    );
    assert.deepEqual(
      pasted.view.messages
        .filter((message) => message.role === "user")
        .map((message) => message.inputOrigin),
      ["typed", "pasted"]
    );
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("typed Q1 Q2 Q3 stay on one conversation and reload with unique turns", async () => {
  const fixture = await makeStore();
  class EchoPort implements AnswerExecutionPort {
    readonly requests: AnswerExecutionRequest[] = [];
    async execute(
      request: AnswerExecutionRequest
    ): Promise<AnswerExecutionResult> {
      this.requests.push(request);
      const answerText = `Evidence for: ${request.question}`;
      const base = success();
      if (!base.ok) return base;
      return {
        ...structuredClone(base),
        answerText,
        factualAnswerText: answerText,
        helpdeskDetailedText: answerText,
        liveAssistQuickText: answerText,
        citations: base.citations.map((citation) => ({
          ...citation,
          citationId: `citation:${request.userMessageId}`,
          answerRange: {
            startOffset: 0,
            endOffset: answerText.length
          }
        }))
      };
    }
  }
  const port = new EchoPort();
  const service = new HelpdeskService(fixture.store, port);
  const questions = [
    "Explain the Direct Routing chain from voice-routing policy to PSTN usage to voice route to SBC/gateway.",
    "How would you use PowerShell to audit Teams Voice users and their voice configuration?",
    "What does Get-CsOnlineUser return?"
  ];
  try {
    const created = service.createConversation("Typed continuity");
    const conversationId = created.conversation.id;
    const submitted = [];
    for (const content of questions) {
      submitted.push(
        await service.submitMessage({
          conversationId,
          content,
          inputOrigin: "typed"
        })
      );
    }
    assert.equal(
      new Set(submitted.map((item) => item.view.conversation.id)).size,
      1
    );
    assert.equal(submitted[2]?.view.conversation.id, conversationId);
    const finalView = submitted[2]!.view;
    const userMessages = finalView.messages.filter(
      (message) => message.role === "user"
    );
    const assistantMessages = finalView.messages.filter(
      (message) => message.role === "assistant"
    );
    assert.deepEqual(
      userMessages.map((message) => message.content),
      questions
    );
    assert.equal(userMessages.length, 3);
    assert.equal(assistantMessages.length, 3);
    assert.equal(finalView.answerRuns.length, 3);
    assert.equal(new Set(userMessages.map((message) => message.id)).size, 3);
    assert.equal(
      new Set(assistantMessages.map((message) => message.id)).size,
      3
    );
    assert.equal(new Set(finalView.answerRuns.map((run) => run.id)).size, 3);
    assert.deepEqual(
      assistantMessages.map((message) => message.content),
      questions.map((question) => `Evidence for: ${question}`)
    );
    assert.equal(service.listConversations().length, 1);

    fixture.store.close();
    const reopenedStore = createSqliteConversationStore({
      databasePath: fixture.databasePath
    });
    const reopened = new HelpdeskService(reopenedStore, port);
    const reloaded = reopened.loadConversation(conversationId);
    assert.equal(reloaded.conversation.id, conversationId);
    assert.deepEqual(
      reloaded.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content),
      questions
    );
    assert.equal(reloaded.answerRuns.length, 3);
    assert.deepEqual(
      reloaded.answerRuns.map((run) => run.id),
      finalView.answerRuns.map((run) => run.id)
    );

    const newer = reopened.createConversation("New Chat");
    assert.notEqual(newer.conversation.id, conversationId);
    await reopened.submitMessage({
      conversationId: newer.conversation.id,
      content: "What does Get-CsTenant return?",
      inputOrigin: "typed"
    });
    const original = reopened.loadConversation(conversationId);
    const switched = reopened.loadConversation(newer.conversation.id);
    assert.deepEqual(
      original.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content),
      questions
    );
    assert.equal(
      original.messages.some((message) =>
        message.content.includes("Get-CsTenant")
      ),
      false
    );
    assert.deepEqual(
      switched.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content),
      ["What does Get-CsTenant return?"]
    );
    reopenedStore.close();
  } finally {
    try {
      fixture.store.close();
    } catch {
      // already closed for reload
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("live questions persist the actual capture source; typed/pasted never carry one", async () => {
  const fixture = await makeStore();
  const service = new HelpdeskService(
    fixture.store,
    new RecordingPort(success())
  );
  try {
    const created = service.createConversation("Provenance");
    await service.submitLiveQuestion({
      conversationId: created.conversation.id,
      content: "System-sourced live question",
      captureSource: "system"
    });
    await service.submitMessage({
      conversationId: created.conversation.id,
      content: "Typed question",
      inputOrigin: "typed"
    });
    const view = service.loadConversation(created.conversation.id);
    const userMessages = view.messages.filter(
      (message) => message.role === "user"
    );
    assert.deepEqual(
      userMessages.map((message) => message.captureSource),
      ["system", null]
    );
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("typed and live turns persist immediately and execute in accepted order", async () => {
  const fixture = await makeStore();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  const requests: string[] = [];
  const port: AnswerExecutionPort = {
    execute: async (request) => {
      requests.push(request.question);
      if (requests.length === 1) await firstGate;
      return structuredClone(success());
    }
  };
  const service = new HelpdeskService(fixture.store, port);
  try {
    const created = service.createConversation("Mixed input");
    const live = service.submitLiveQuestion({
      conversationId: created.conversation.id,
      content: "Live question"
    });
    const typed = service.submitMessage({
      conversationId: created.conversation.id,
      content: "Typed question",
      inputOrigin: "typed"
    });
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 0)
    );
    assert.deepEqual(requests, ["Live question"]);
    assert.deepEqual(
      service
        .loadConversation(created.conversation.id)
        .messages.map((message) => message.inputOrigin),
      ["live_transcript", "typed"]
    );

    releaseFirst();
    await Promise.all([live, typed]);
    assert.deepEqual(requests, [
      "Live question",
      "Typed question"
    ]);
    const completed = service.loadConversation(
      created.conversation.id
    );
    assert.deepEqual(
      completed.answerRuns.map((run) => run.state),
      ["completed", "completed"]
    );
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("three rapid live questions own durable runs, answers, and citations across restart", async () => {
  const fixture = await makeStore();
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  let executionCount = 0;
  const port: AnswerExecutionPort = {
    execute: async (request) => {
      executionCount += 1;
      if (executionCount === 1) await firstGate;
      const base = success();
      assert.equal(base.ok, true);
      if (!base.ok) return base;
      const answerText = `Answer for ${request.question}`;
      return {
        ...base,
        answerText,
        factualAnswerText: answerText,
        helpdeskDetailedText: answerText,
        liveAssistQuickText: answerText,
        citations: base.citations.map((citation) => ({
          ...citation,
          citationId: `citation:${request.userMessageId}`,
          factualRangeId: `range:${request.userMessageId}`,
          claimId: `claim:${request.userMessageId}`,
          answerRange: {
            startOffset: 0,
            endOffset: answerText.length
          },
          evidenceId: `evidence:${request.userMessageId}`,
          spanId: `span:${request.userMessageId}`
        }))
      };
    }
  };
  const service = new HelpdeskService(fixture.store, port);
  const questions = [
    "How do you renew a certificate?",
    "How do you troubleshoot one-way audio?",
    "How would you secure SharePoint before Copilot?"
  ];
  let conversationId = "";
  try {
    const created = service.createConversation("I2 rapid turns");
    conversationId = created.conversation.id;
    const begun = questions.map((content) =>
      service.beginLiveQuestion({
        conversationId,
        content,
        captureSource: "system",
        presentationSynthesis: "disabled"
      })
    );
    const pending = service.loadConversation(conversationId);
    assert.deepEqual(
      pending.messages.map((message) => message.content),
      questions
    );
    assert.equal(new Set(begun.map((turn) => turn.started.message.id)).size, 3);
    assert.equal(new Set(begun.map((turn) => turn.started.answerRun.id)).size, 3);
    assert.deepEqual(
      pending.answerRuns.map((run) => run.state),
      ["received", "received", "received"]
    );

    releaseFirst();
    await Promise.all(begun.map((turn) => turn.completion));
    const completed = service.loadConversation(conversationId);
    for (const turn of begun) {
      const run = completed.answerRuns.find(
        (entry) => entry.id === turn.started.answerRun.id
      );
      const answer = completed.messages.find(
        (message) => message.id === run?.assistantMessageId
      );
      assert.equal(
        answer?.content,
        `Answer for ${turn.started.message.content}`
      );
      assert.equal(answer?.citations.length, 1);
      assert.equal(
        answer?.citations[0]?.citationId,
        `citation:${turn.started.message.id}`
      );
    }
    fixture.store.close();

    const reopenedStore = createSqliteConversationStore({
      databasePath: fixture.databasePath
    });
    try {
      const reopened = new HelpdeskService(
        reopenedStore,
        port
      ).loadConversation(conversationId);
      assert.deepEqual(
        reopened.answerRuns.map((run) => ({
          userMessageId: run.triggeringUserMessageId,
          assistantMessageId: run.assistantMessageId,
          state: run.state
        })),
        completed.answerRuns.map((run) => ({
          userMessageId: run.triggeringUserMessageId,
          assistantMessageId: run.assistantMessageId,
          state: run.state
        }))
      );
      assert.deepEqual(
        reopened.messages.map((message) => ({
          id: message.id,
          content: message.content,
          citations: message.citations.map(
            (citation) => citation.citationId
          )
        })),
        completed.messages.map((message) => ({
          id: message.id,
          content: message.content,
          citations: message.citations.map(
            (citation) => citation.citationId
          )
        }))
      );
    } finally {
      reopenedStore.close();
    }
  } finally {
    try {
      fixture.store.close();
    } catch {
      // Closed for the restart assertion.
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a failed rapid question cannot corrupt either adjacent turn", async () => {
  const fixture = await makeStore();
  let call = 0;
  const port: AnswerExecutionPort = {
    execute: async () => {
      call += 1;
      if (call === 2) {
        return {
          ok: false,
          code: "grounding_execution_failed",
          stage: "retrieval_grounding",
          userSafeMessage: "No grounded answer."
        };
      }
      return structuredClone(success());
    }
  };
  const service = new HelpdeskService(fixture.store, port);
  try {
    const conversation = service.createConversation("Adjacent failure");
    const turns = ["Q1", "Q2", "Q3"].map((content) =>
      service.beginLiveQuestion({
        conversationId: conversation.conversation.id,
        content,
        captureSource: "system",
        presentationSynthesis: "disabled"
      })
    );
    await Promise.all(turns.map((turn) => turn.completion));
    const view = service.loadConversation(conversation.conversation.id);
    const runFor = (question: string) => {
      const user = view.messages.find(
        (message) =>
          message.role === "user" && message.content === question
      );
      return view.answerRuns.find(
        (run) => run.triggeringUserMessageId === user?.id
      );
    };
    assert.equal(runFor("Q1")?.state, "completed");
    assert.ok(runFor("Q1")?.assistantMessageId);
    assert.equal(runFor("Q2")?.state, "failed");
    assert.equal(runFor("Q2")?.assistantMessageId, null);
    assert.equal(runFor("Q3")?.state, "completed");
    assert.ok(runFor("Q3")?.assistantMessageId);
    assert.deepEqual(
      view.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content),
      ["Q1", "Q2", "Q3"]
    );
    assert.equal(
      view.messages.filter(
        (message) => message.role === "assistant"
      ).length,
      2
    );
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

for (const answerability of [
  "answered",
  "partial",
  "insufficient_evidence"
] as const) {
  test(`${answerability} persists a successful assistant message`, async () => {
    const fixture = await makeStore();
    const service = new HelpdeskService(
      fixture.store,
      new RecordingPort(success(answerability))
    );
    try {
      const created = service.createConversation(answerability);
      const submitted = await service.submitMessage({
        conversationId: created.conversation.id,
        content: "Question",
        inputOrigin: "typed"
      });
      assert.equal(submitted.outcome, answerability);
      const assistant = submitted.view.messages.find(
        (message) => message.role === "assistant"
      );
      assert.ok(assistant);
      const expected = success(answerability);
      assert.equal(expected.ok, true);
      if (!expected.ok) return;
      assert.equal(assistant.content, expected.answerText);
      assert.equal(assistant.answerability, answerability);
      assert.equal(
        assistant.citations.length,
        answerability === "insufficient_evidence" ? 0 : 1
      );
    } finally {
      fixture.store.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test("execution failure persists no assistant factual message", async () => {
  const fixture = await makeStore();
  const service = new HelpdeskService(
    fixture.store,
    new RecordingPort({
      ok: false,
      code: "citation_validation_failed",
      stage: "citation_mapping",
      userSafeMessage: "Sources could not be validated."
    })
  );
  try {
    const created = service.createConversation("Failure");
    const submitted = await service.submitMessage({
      conversationId: created.conversation.id,
      content: "Question",
      inputOrigin: "typed"
    });
    assert.equal(submitted.outcome, "failed");
    assert.ok(
      submitted.view.messages.every(
        (message) => message.role === "user"
      )
    );
    assert.equal(submitted.view.answerRuns[0]?.state, "failed");
    assert.equal(
      submitted.view.answerRuns[0]?.failureCode,
      "citation_validation_failed"
    );
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("exact answer and citations survive store restart", async () => {
  const fixture = await makeStore();
  let conversationId = "";
  try {
    const service = new HelpdeskService(
      fixture.store,
      new RecordingPort(success())
    );
    const created = service.createConversation("Restart");
    conversationId = created.conversation.id;
    await service.submitMessage({
      conversationId,
      content: "Persist this turn",
      inputOrigin: "typed"
    });
    fixture.store.close();

    const reopenedStore = createSqliteConversationStore({
      databasePath: fixture.databasePath
    });
    try {
      const reopened = new HelpdeskService(
        reopenedStore,
        new RecordingPort(success())
      ).loadConversation(conversationId);
      const assistant = reopened.messages.find(
        (message) => message.role === "assistant"
      );
      assert.equal(assistant?.content, ANSWER_TEXT);
      assert.equal(assistant?.citations.length, 1);
      assert.equal(
        assistant?.citations[0]?.canonicalUrl,
        "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365"
      );
      assert.equal(
        assistant?.citations[0]?.answerRangeEnd,
        ANSWER_TEXT.length
      );
    } finally {
      reopenedStore.close();
    }
  } finally {
    try {
      fixture.store.close();
    } catch {
      // Closed before the restart assertion.
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Detailed presentation coordinates and context references survive restart separately", async () => {
  const fixture = await makeStore();
  let conversationId = "";
  const expected = successWithContext("helpdesk_detailed");
  assert.equal(expected.ok, true);
  if (!expected.ok) return;
  try {
    const service = new HelpdeskService(
      fixture.store,
      new RecordingPort(expected)
    );
    const created = service.createConversation("Detailed persistence");
    conversationId = created.conversation.id;
    const submitted = await service.submitMessage({
      conversationId,
      content:
        "How would you secure SharePoint data for Copilot?",
      inputOrigin: "typed"
    });
    const before = submitted.view.messages.find(
      (message) => message.role === "assistant"
    );
    assert.ok(before);
    assert.equal(before.content, expected.answerText);
    assert.equal(before.presentationProfile, "helpdesk_detailed");
    assert.equal(before.citations.length, 1);
    assert.equal(before.contextReferences.length, 1);
    assert.equal(
      before.content.slice(
        before.citations[0]!.answerRangeStart,
        before.citations[0]!.answerRangeEnd
      ),
      ANSWER_TEXT
    );
    assert.ok(
      before.citations.every(
        (citation) => citation.answerRangeEnd > citation.answerRangeStart
      )
    );
    fixture.store.close();

    const reopenedStore = createSqliteConversationStore({
      databasePath: fixture.databasePath
    });
    try {
      const after = new HelpdeskService(
        reopenedStore,
        new RecordingPort(expected)
      )
        .loadConversation(conversationId)
        .messages.find((message) => message.role === "assistant");
      assert.deepEqual(after, before);
      assert.equal(
        after?.contextReferences[0]?.sourceContentHash,
        "c".repeat(64)
      );
    } finally {
      reopenedStore.close();
    }
  } finally {
    try {
      fixture.store.close();
    } catch {
      // Closed before restart.
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Live Assist Quick persists visible citation coordinates and profile", async () => {
  const fixture = await makeStore();
  const expected = successWithContext("live_assist_quick");
  assert.equal(expected.ok, true);
  if (!expected.ok) return;
  const service = new HelpdeskService(
    fixture.store,
    new RecordingPort(expected)
  );
  try {
    const created = service.createConversation("Quick persistence");
    const submitted = await service.submitLiveQuestion({
      conversationId: created.conversation.id,
      content: "What should I say?",
      captureSource: "system"
    });
    const assistant = submitted.view.messages.find(
      (message) => message.role === "assistant"
    );
    assert.equal(assistant?.presentationProfile, "live_assist_quick");
    assert.equal(assistant?.content, expected.answerText);
    assert.equal(
      assistant?.content.slice(
        assistant.citations[0]!.answerRangeStart,
        assistant.citations[0]!.answerRangeEnd
      ),
      ANSWER_TEXT
    );
    assert.equal(assistant?.contextReferences.length, 1);
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Helpdesk service consumes only the execution port contract", () => {
  const serviceSource = readFileSync(
    resolve("src/main/services/conversations/helpdeskService.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    serviceSource,
    /(answerV2|retrievalV2|PipelineManager|OpenAiLlmProvider)/
  );
  const mainSource = readFileSync(
    resolve("src/main/index.ts"),
    "utf8"
  );
  assert.match(
    mainSource,
    /new EvidenceAnswerExecutionPort\(\s*createEvidenceSearchClient\(evidenceChild\)\s*\)/
  );
  assert.doesNotMatch(mainSource, /new GroundedAnswerExecutionPort\(/);
  assert.doesNotMatch(
    mainSource,
    /OpenAiGroundedAnswerGenerator|OpenAiLlmProvider/
  );
  assert.doesNotMatch(
    mainSource,
    /new UnavailableAnswerExecutionPort\(\)/
  );
});
