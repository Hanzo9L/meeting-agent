import assert from "node:assert/strict";
import test from "node:test";
import type { LiveAssistProjection } from "@shared/types";
import { updateProjectionFeed } from "./projectionFeed";

function projection(
  answerRunId: string,
  state: LiveAssistProjection["state"],
  question = "Identical question?"
): LiveAssistProjection {
  return {
    sessionId: "session-1",
    conversationId: "conversation-1",
    userMessageId: `user:${answerRunId}`,
    answerRunId,
    question,
    state,
    answerText: state === "answered" ? `Answer ${answerRunId}` : null,
    answerability: state === "answered" ? "answered" : null,
    sources: [],
    timestamp: 1
  };
}

test("projection feed keys cards by durable answer run, not question text", () => {
  const first = projection("run-1", "executing");
  const second = projection("run-2", "executing");
  const feed = updateProjectionFeed(
    updateProjectionFeed([], first),
    second
  );
  assert.deepEqual(
    feed.map((item) => item.answerRunId),
    ["run-1", "run-2"]
  );

  const completedFirst = updateProjectionFeed(
    feed,
    projection("run-1", "answered")
  );
  assert.equal(completedFirst.length, 2);
  assert.equal(
    completedFirst.find((item) => item.answerRunId === "run-1")
      ?.answerText,
    "Answer run-1"
  );
  assert.equal(
    completedFirst.find((item) => item.answerRunId === "run-2")
      ?.answerText,
    null
  );
});

test("later projections cannot append into or replace an earlier answer card", () => {
  const first = projection("run-1", "answered", "How do you renew a certificate?");
  const second = projection(
    "run-2",
    "answered",
    "How do you troubleshoot one-way audio?"
  );
  const feed = updateProjectionFeed(updateProjectionFeed([], first), second);
  assert.equal(feed.length, 2);
  assert.equal(
    feed.find((item) => item.answerRunId === "run-1")?.answerText,
    "Answer run-1"
  );
  assert.equal(
    feed.find((item) => item.answerRunId === "run-2")?.answerText,
    "Answer run-2"
  );
  assert.equal(
    feed.find((item) => item.answerRunId === "run-1")?.question,
    "How do you renew a certificate?"
  );
});
