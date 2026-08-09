import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type {
  AnswerExecutionPort,
  AnswerExecutionRequest
} from "./answerExecutionPort";
import { HelpdeskService } from "./helpdeskService";
import {
  createSqliteConversationStore,
  type SqliteConversationStore
} from "./sqliteConversationStore";

class RecordingUnavailablePort implements AnswerExecutionPort {
  readonly requests: AnswerExecutionRequest[] = [];

  async execute(request: AnswerExecutionRequest) {
    this.requests.push(request);
    return { ok: false as const, code: "answer_unavailable" as const };
  }
}

async function makeStore(): Promise<{
  root: string;
  databasePath: string;
  store: SqliteConversationStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-helpdesk-service-"));
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
    new RecordingUnavailablePort()
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
    assert.equal(
      service.loadConversation(created.conversation.id).conversation.title,
      "Teams Voice"
    );

    assert.deepEqual(service.deleteConversation(created.conversation.id), {
      deleted: true
    });
    assert.equal(service.listConversations().length, 0);
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("typed and pasted submissions invoke only fail-closed port and persist no assistant content", async () => {
  const fixture = await makeStore();
  const port = new RecordingUnavailablePort();
  const service = new HelpdeskService(fixture.store, port);
  try {
    const created = service.createConversation("Origins");

    const typed = await service.submitMessage({
      conversationId: created.conversation.id,
      content: "Typed question",
      inputOrigin: "typed"
    });
    const pasted = await service.submitMessage({
      conversationId: created.conversation.id,
      content: "Pasted question",
      inputOrigin: "pasted"
    });

    assert.equal(typed.outcome, "answer_unavailable");
    assert.equal(pasted.outcome, "answer_unavailable");
    assert.equal(port.requests.length, 2);
    assert.deepEqual(
      pasted.view.messages.map((message) => message.inputOrigin),
      ["typed", "pasted"]
    );
    assert.ok(pasted.view.messages.every((message) => message.role === "user"));
    assert.deepEqual(
      pasted.view.answerRuns.map((run) => [run.state, run.failureCode]),
      [
        ["failed", "answer_unavailable"],
        ["failed", "answer_unavailable"]
      ]
    );
  } finally {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("service data survives store restart and reload", async () => {
  const fixture = await makeStore();
  let conversationId = "";
  try {
    const firstService = new HelpdeskService(
      fixture.store,
      new RecordingUnavailablePort()
    );
    const created = firstService.createConversation("Restart");
    conversationId = created.conversation.id;
    await firstService.submitMessage({
      conversationId,
      content: "Persist this turn",
      inputOrigin: "typed"
    });
    fixture.store.close();

    const reopenedStore = createSqliteConversationStore({
      databasePath: fixture.databasePath
    });
    try {
      const reopenedService = new HelpdeskService(
        reopenedStore,
        new RecordingUnavailablePort()
      );
      const view = reopenedService.loadConversation(conversationId);
      assert.equal(view.messages.length, 1);
      assert.equal(view.messages[0]?.content, "Persist this turn");
      assert.equal(view.answerRuns[0]?.failureCode, "answer_unavailable");
    } finally {
      reopenedStore.close();
    }
  } finally {
    if (fixture.store) {
      try {
        fixture.store.close();
      } catch {
        // The first store is intentionally closed before reopening.
      }
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Slice 2 service has no legacy, retrieval, or grounding implementation imports", () => {
  const source = readFileSync(
    resolve("src/main/services/conversations/helpdeskService.ts"),
    "utf8"
  );
  const portSource = readFileSync(
    resolve("src/main/services/conversations/answerExecutionPort.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    `${source}\n${portSource}`,
    /(PipelineManager|OpenAiLlmProvider|knowledgeBase|retrievalV2|answerV2)/
  );
});
