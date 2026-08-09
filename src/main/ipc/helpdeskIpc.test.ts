import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IPC_CHANNELS } from "@shared/constants";
import type { HelpdeskResult } from "@shared/helpdesk";
import { registerHelpdeskIpcHandlers, type IpcEventLike } from "./helpdeskIpc";
import {
  createSqliteConversationStore,
  HelpdeskService,
  UnavailableAnswerExecutionPort
} from "../services/conversations";

test("typed Helpdesk IPC supports conversation lifecycle and unavailable submission", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-helpdesk-ipc-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const handlers = new Map<
    string,
    (event: IpcEventLike, ...args: unknown[]) => unknown
  >();
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    service: new HelpdeskService(store, new UnavailableAnswerExecutionPort()),
    isTrustedSender: (event) => event.sender.id === 7
  });

  const invoke = async <T>(
    channel: string,
    ...args: unknown[]
  ): Promise<HelpdeskResult<T>> => {
    const handler = handlers.get(channel);
    assert.ok(handler, `Missing handler for ${channel}`);
    return (await handler({ sender: { id: 7 } }, ...args)) as HelpdeskResult<T>;
  };

  try {
    const created = await invoke<{ conversation: { id: string } }>(
      IPC_CHANNELS.helpdeskCreateConversation,
      "IPC Chat"
    );
    if (!created.ok) throw new Error(created.error.message);
    assert.equal(created.ok, true);
    const conversationId = created.data.conversation.id;

    const listed = await invoke<Array<{ id: string }>>(
      IPC_CHANNELS.helpdeskListConversations
    );
    assert.equal(listed.ok && listed.data[0]?.id, conversationId);

    const renamed = await invoke<{ title: string }>(
      IPC_CHANNELS.helpdeskRenameConversation,
      { conversationId, title: "Renamed IPC Chat" }
    );
    assert.equal(renamed.ok && renamed.data.title, "Renamed IPC Chat");

    const submitted = await invoke<{
      outcome: string;
      view: {
        messages: Array<{ role: string; inputOrigin: string | null }>;
        answerRuns: Array<{ state: string; failureCode: string | null }>;
      };
    }>(IPC_CHANNELS.helpdeskSubmitMessage, {
      conversationId,
      content: "Pasted through IPC",
      inputOrigin: "pasted"
    });
    if (!submitted.ok) throw new Error(submitted.error.message);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.data.outcome, "answer_unavailable");
    assert.equal(submitted.data.view.messages.length, 1);
    assert.equal(submitted.data.view.messages[0]?.role, "user");
    assert.equal(submitted.data.view.messages[0]?.inputOrigin, "pasted");
    assert.equal(submitted.data.view.answerRuns[0]?.state, "failed");
    assert.equal(
      submitted.data.view.answerRuns[0]?.failureCode,
      "answer_unavailable"
    );

    const loaded = await invoke<{
      messages: Array<{ role: string }>;
    }>(IPC_CHANNELS.helpdeskLoadConversation, conversationId);
    assert.equal(loaded.ok && loaded.data.messages.length, 1);
    assert.equal(loaded.ok && loaded.data.messages[0]?.role, "user");

    const deleted = await invoke<{ deleted: boolean }>(
      IPC_CHANNELS.helpdeskDeleteConversation,
      conversationId
    );
    assert.equal(deleted.ok && deleted.data.deleted, true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Helpdesk IPC rejects untrusted senders and malformed messages safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-helpdesk-ipc-safe-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const handlers = new Map<
    string,
    (event: IpcEventLike, ...args: unknown[]) => unknown
  >();
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    service: new HelpdeskService(store, new UnavailableAnswerExecutionPort()),
    isTrustedSender: (event) => event.sender.id === 7
  });

  try {
    const listHandler = handlers.get(IPC_CHANNELS.helpdeskListConversations);
    assert.ok(listHandler);
    const unauthorized = (await listHandler({
      sender: { id: 99 }
    })) as HelpdeskResult<unknown>;
    assert.equal(unauthorized.ok, false);
    if (unauthorized.ok) throw new Error("Expected unauthorized result");
    assert.equal(unauthorized.error.code, "unauthorized");

    const submitHandler = handlers.get(IPC_CHANNELS.helpdeskSubmitMessage);
    assert.ok(submitHandler);
    const invalid = (await submitHandler(
      { sender: { id: 7 } },
      { conversationId: "x", content: "", inputOrigin: "unknown" }
    )) as HelpdeskResult<unknown>;
    assert.equal(invalid.ok, false);
    if (invalid.ok) throw new Error("Expected invalid request");
    assert.equal(invalid.error.code, "invalid_request");
    assert.doesNotMatch(invalid.error.message, /sqlite|stack|database/i);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
