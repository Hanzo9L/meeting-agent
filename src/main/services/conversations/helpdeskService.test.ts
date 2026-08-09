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
  return {
    ok: true,
    answerability,
    answerText:
      answerability === "insufficient_evidence"
        ? "Unable to provide a factual answer from the approved evidence."
        : ANSWER_TEXT,
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
              answerRange: {
                startOffset: 0,
                endOffset: ANSWER_TEXT.length
              },
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
  assert.match(mainSource, /new GroundedAnswerExecutionPort\(\)/);
  assert.doesNotMatch(
    mainSource,
    /new UnavailableAnswerExecutionPort\(\)/
  );
});
