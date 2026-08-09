import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { HelpdeskConversationView } from "@shared/helpdesk";
import {
  buildHelpdeskTimeline,
  resolveComposerInputOrigin
} from "./viewModel";

test("composer origin tracks any paste without semantic analysis", () => {
  assert.equal(resolveComposerInputOrigin(false), "typed");
  assert.equal(resolveComposerInputOrigin(true), "pasted");
});

test("timeline preserves message order and renders unavailable as non-message status", () => {
  const view: HelpdeskConversationView = {
    conversation: {
      id: "conv-1",
      title: "Chat",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:01.000Z"
    },
    messages: [
      {
        id: "msg-2",
        conversationId: "conv-1",
        turnIndex: 2,
        role: "user",
        content: "Second",
        inputOrigin: "pasted",
        answerability: null,
        groundingSnapshotId: null,
        createdAt: "2026-08-08T00:00:01.000Z"
      },
      {
        id: "msg-1",
        conversationId: "conv-1",
        turnIndex: 1,
        role: "user",
        content: "First",
        inputOrigin: "typed",
        answerability: null,
        groundingSnapshotId: null,
        createdAt: "2026-08-08T00:00:00.000Z"
      }
    ],
    answerRuns: [
      {
        id: "run-1",
        conversationId: "conv-1",
        triggeringUserMessageId: "msg-1",
        assistantMessageId: null,
        state: "failed",
        failureCode: "answer_unavailable",
        createdAt: "2026-08-08T00:00:00.000Z",
        startedAt: "2026-08-08T00:00:00.000Z",
        completedAt: "2026-08-08T00:00:00.000Z"
      }
    ]
  };

  const rows = buildHelpdeskTimeline(view);
  assert.deepEqual(
    rows.map((row) =>
      row.kind === "message"
        ? `message:${row.message.content}`
        : `status:${row.text}`
    ),
    [
      "message:First",
      "status:Answer engine not connected yet.",
      "message:Second"
    ]
  );
  assert.equal(rows.filter((row) => row.kind === "message").length, 2);
});

test("renderer sources have no raw database, filesystem, IPC, or Node access", () => {
  for (const filename of ["App.tsx", "viewModel.ts", "main.tsx"]) {
    const source = readFileSync(
      resolve(`src/renderer/helpdesk/${filename}`),
      "utf8"
    );
    assert.doesNotMatch(
      source,
      /(better-sqlite3|node:fs|node:path|ipcRenderer|require\s*\()/
    );
  }
});
