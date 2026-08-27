import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { LiveAssistProjection } from "@shared/types";
import { updateProjectionFeed } from "@shared/projectionFeed";
import {
  isOverflowScroller,
  lastTurnSpacerHeight,
  resolveTurnFocusAction,
  scrollTopToAlignStart,
  TURN_FOCUS_TOP_RESERVE_PX,
  type TurnFocusMemory
} from "./turnFocus";

const empty: TurnFocusMemory = {
  conversationId: null,
  userMessageId: null
};

test("a new accepted question focuses the start of that turn once", () => {
  const first = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: empty
  });
  assert.equal(first.focusUserMessageId, "q1");
  const again = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: first.nextFocused
  });
  assert.equal(again.focusUserMessageId, null);
});

test("answer completion does not scroll to the bottom or refocus the same question", () => {
  const afterQuestion = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: empty
  });
  const afterLongAnswer = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: afterQuestion.nextFocused
  });
  assert.equal(afterLongAnswer.focusUserMessageId, null);
  assert.equal(afterLongAnswer.nextFocused.userMessageId, "q1");
});

test("evidence arrival and projection status updates do not create a focus action", () => {
  const focused = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: empty
  });
  const evidenceArrived = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: focused.nextFocused
  });
  const hydrated = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: evidenceArrived.nextFocused
  });
  assert.equal(evidenceArrived.focusUserMessageId, null);
  assert.equal(hydrated.focusUserMessageId, null);
});

test("a newer question owns focus and older completion cannot steal it", () => {
  const q1 = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q1",
    lastFocused: empty
  });
  const q2 = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q2",
    lastFocused: q1.nextFocused
  });
  assert.equal(q2.focusUserMessageId, "q2");
  const q1Late = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q2",
    lastFocused: q2.nextFocused
  });
  assert.equal(q1Late.focusUserMessageId, null);
  assert.equal(q1Late.nextFocused.userMessageId, "q2");
});

test("expand/collapse and ordinary rerenders do not create a new focus action", () => {
  const focused = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q3",
    lastFocused: empty
  });
  const expanded = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q3",
    lastFocused: focused.nextFocused
  });
  const collapsed = resolveTurnFocusAction({
    conversationId: "conv-1",
    newestUserMessageId: "q3",
    lastFocused: expanded.nextFocused
  });
  assert.equal(expanded.focusUserMessageId, null);
  assert.equal(collapsed.focusUserMessageId, null);
});

test("personal, mixed, and technical turns share the same newest-question focus rule", () => {
  for (const id of ["personal-q", "mixed-q", "technical-q"]) {
    const first = resolveTurnFocusAction({
      conversationId: "conv-1",
      newestUserMessageId: id,
      lastFocused: empty
    });
    assert.equal(first.focusUserMessageId, id);
    const later = resolveTurnFocusAction({
      conversationId: "conv-1",
      newestUserMessageId: id,
      lastFocused: first.nextFocused
    });
    assert.equal(later.focusUserMessageId, null);
  }
});

test("scroll alignment pins the turn start and spacer keeps the last question at the top", () => {
  assert.equal(isOverflowScroller("auto"), true);
  assert.equal(isOverflowScroller("scroll"), true);
  assert.equal(isOverflowScroller("visible"), false);
  assert.equal(
    scrollTopToAlignStart({
      scrollerTop: 40,
      elementTop: 40,
      currentScrollTop: 0,
      scrollMarginTop: 8
    }),
    0
  );
  assert.equal(
    scrollTopToAlignStart({
      scrollerTop: 40,
      elementTop: 240,
      currentScrollTop: 80,
      scrollMarginTop: 8
    }),
    272
  );
  assert.equal(lastTurnSpacerHeight(400), 400 - TURN_FOCUS_TOP_RESERVE_PX);
  assert.equal(lastTurnSpacerHeight(50, 96), 0);
});

test("helpdesk and overlay do not scroll a bottom sentinel", () => {
  const helpdesk = readFileSync(
    resolve("src/renderer/helpdesk/App.tsx"),
    "utf8"
  );
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  const focus = readFileSync(resolve("src/renderer/turnFocus.ts"), "utf8");
  const overlayCss = readFileSync(
    resolve("src/renderer/overlay/styles.css"),
    "utf8"
  );
  const helpdeskCss = readFileSync(
    resolve("src/renderer/helpdesk/styles.css"),
    "utf8"
  );
  for (const source of [helpdesk, overlay]) {
    assert.match(source, /useNewestTurnFocus/);
    assert.match(source, /data-turn-anchor/);
    assert.doesNotMatch(source, /block:\s*"end"/);
    assert.doesNotMatch(source, /\b(feedEndRef|endRef)\b/);
  }
  assert.match(focus, /scroller\.scrollTop = scrollTopToAlignStart/);
  assert.doesNotMatch(focus, /scrollIntoView/);
  assert.doesNotMatch(focus, /block: "end"/);
  assert.match(overlayCss, /overflow-anchor:\s*none/);
  assert.match(overlayCss, /flex:\s*1/);
  assert.match(overlayCss, /\.feed::after/);
  assert.match(overlayCss, /min-height:\s*calc\(100% - 96px\)/);
  assert.match(helpdeskCss, /overflow-anchor:\s*none/);
  assert.match(helpdeskCss, /\.timeline::after/);
  assert.match(helpdeskCss, /min-height:\s*calc\(100% - 120px\)/);
});

test("overlay and helpdesk keep stable turn keys", () => {
  const helpdesk = readFileSync(
    resolve("src/renderer/helpdesk/App.tsx"),
    "utf8"
  );
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  const viewModel = readFileSync(
    resolve("src/renderer/helpdesk/viewModel.ts"),
    "utf8"
  );
  assert.match(overlay, /key=\{item\.answerRunId\}/);
  assert.match(helpdesk, /key=\{turn\.id\}/);
  assert.match(viewModel, /id: `turn:\$\{row\.message\.id\}`/);
  assert.doesNotMatch(overlay, /key=\{index\}/);
  assert.doesNotMatch(helpdesk, /key=\{index\}/);
});

test("expand/collapse controls stay local and independent", () => {
  const helpdesk = readFileSync(
    resolve("src/renderer/helpdesk/App.tsx"),
    "utf8"
  );
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  for (const source of [helpdesk, overlay]) {
    assert.match(source, /props\.expanded \? "Collapse" : "Expand"/);
    assert.match(source, /toggleExpandedEvidenceSource\(current, sourceId\)/);
  }
  assert.doesNotMatch(helpdesk, /scrollIntoView/);
  assert.doesNotMatch(overlay, /scrollIntoView/);
});

test("simulated live Q1 Q2 Q3 keeps chronological turns and newest-question focus", () => {
  const questions = [
    "What does Get-CsOnlineUser return?",
    "How would you troubleshoot a user who cannot call external numbers?",
    "What happens if the SBC fails?"
  ];
  let feed: LiveAssistProjection[] = [];
  let lastFocused: TurnFocusMemory = {
    conversationId: null,
    userMessageId: null
  };
  const focused: string[] = [];
  for (const [index, question] of questions.entries()) {
    const runId = `run-${index + 1}`;
    feed = updateProjectionFeed(feed, {
      sessionId: "session-1",
      conversationId: "conversation-1",
      userMessageId: `user-${index + 1}`,
      answerRunId: runId,
      question,
      state: "executing",
      answerText: null,
      answerability: null,
      sources: [],
      timestamp: index + 1
    });
    const action = resolveTurnFocusAction({
      conversationId: "conversation-1",
      newestUserMessageId: feed[feed.length - 1]?.userMessageId ?? null,
      lastFocused
    });
    lastFocused = action.nextFocused;
    if (action.focusUserMessageId) focused.push(action.focusUserMessageId);
    feed = updateProjectionFeed(feed, {
      sessionId: "session-1",
      conversationId: "conversation-1",
      userMessageId: `user-${index + 1}`,
      answerRunId: runId,
      question,
      state: "answered",
      answerText: `Answer ${runId}`,
      answerability: "answered",
      sources: [],
      timestamp: index + 1
    });
    const afterAnswer = resolveTurnFocusAction({
      conversationId: "conversation-1",
      newestUserMessageId: feed[feed.length - 1]?.userMessageId ?? null,
      lastFocused
    });
    lastFocused = afterAnswer.nextFocused;
    assert.equal(afterAnswer.focusUserMessageId, null);
  }

  const lateQ1 = updateProjectionFeed(feed, {
    ...feed[0]!,
    state: "answered",
    answerText: "Answer run-1 late"
  });
  assert.deepEqual(
    lateQ1.map((item) => item.answerRunId),
    ["run-1", "run-2", "run-3"]
  );
  const afterLateQ1 = resolveTurnFocusAction({
    conversationId: "conversation-1",
    newestUserMessageId: lateQ1[lateQ1.length - 1]?.userMessageId ?? null,
    lastFocused
  });
  assert.equal(afterLateQ1.focusUserMessageId, null);
  assert.equal(afterLateQ1.nextFocused.userMessageId, "user-3");
  assert.deepEqual(
    feed.map((item) => item.question),
    questions
  );
  assert.deepEqual(focused, ["user-1", "user-2", "user-3"]);
  assert.equal(new Set(feed.map((item) => item.answerRunId)).size, 3);
  assert.equal(new Set(feed.map((item) => item.userMessageId)).size, 3);
});

test("retrieval, intent, persistence, and STT files are not part of turn-focus", () => {
  const forbidden = [
    "src/main/services/conversations/evidenceAnswerExecutionPort.ts",
    "src/shared/questionIntent.ts",
    "src/main/services/evidence/evidenceSearchClient.ts",
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts",
    "src/renderer/audio-capture/captureLoopbackAudio.ts",
    "src/main/services/conversations/migrations.ts"
  ];
  for (const file of forbidden) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(source, /useNewestTurnFocus|resolveTurnFocusAction|data-turn-anchor/);
  }
});
