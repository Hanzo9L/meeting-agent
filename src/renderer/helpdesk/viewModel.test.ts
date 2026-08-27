import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { HelpdeskConversationView } from "@shared/helpdesk";
import {
  HELP_DESK_ACTIVE_CONVERSATION_KEY,
  buildHelpdeskTimeline,
  copyAnswerText,
  groupHelpdeskInterviewTurns,
  newestTurnUserMessageId,
  resolveComposerInputOrigin,
  resolveInitialConversationId,
  resolveSubmitConversationId
} from "./viewModel";

test("composer origin tracks any paste without semantic analysis", () => {
  assert.equal(resolveComposerInputOrigin(false), "typed");
  assert.equal(resolveComposerInputOrigin(true), "pasted");
});

test("typed submit reuses the active conversation id and never invents one", () => {
  assert.equal(resolveSubmitConversationId("conv-active"), "conv-active");
  assert.equal(resolveSubmitConversationId(null), null);
  assert.equal(resolveSubmitConversationId(""), null);
});

test("reload restores the stored conversation when it still exists", () => {
  const conversations = [{ id: "newest" }, { id: "selected" }];
  assert.equal(
    resolveInitialConversationId(conversations, "selected"),
    "selected"
  );
  assert.equal(
    resolveInitialConversationId(conversations, "missing"),
    "newest"
  );
  assert.equal(resolveInitialConversationId([], "selected"), null);
});

test("timeline preserves message order and renders execution failure as non-message status", () => {
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
        captureSource: null,
        answerability: null,
        presentationProfile: null,
        groundingSnapshotId: null,
        citations: [],
        contextReferences: [],
        createdAt: "2026-08-08T00:00:01.000Z"
      },
      {
        id: "msg-1",
        conversationId: "conv-1",
        turnIndex: 1,
        role: "user",
        content: "First",
        inputOrigin: "typed",
        captureSource: null,
        answerability: null,
        presentationProfile: null,
        groundingSnapshotId: null,
        citations: [],
        contextReferences: [],
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
        failureCode: "grounding_execution_failed",
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
      "status:Relay could not complete and validate this answer. No factual answer was saved.",
      "message:Second"
    ]
  );
  assert.equal(rows.filter((row) => row.kind === "message").length, 2);
  const turns = groupHelpdeskInterviewTurns(rows);
  assert.deepEqual(
    turns.map((turn) =>
      turn.kind === "turn"
        ? `turn:${turn.userMessageId}:${turn.rows.length}`
        : `orphan:${turn.row.id}`
    ),
    ["turn:msg-1:2", "turn:msg-2:1"]
  );
  assert.equal(newestTurnUserMessageId(turns), "msg-2");
});

test("timeline groups each assistant card with its triggering turn despite completion order", () => {
  const baseMessage = {
    conversationId: "conv-rapid",
    inputOrigin: null,
    captureSource: null,
    answerability: null,
    presentationProfile: null,
    groundingSnapshotId: null,
    citations: [],
    contextReferences: [],
    createdAt: "2026-08-16T00:00:00.000Z"
  };
  const view: HelpdeskConversationView = {
    conversation: {
      id: "conv-rapid",
      title: "Rapid",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:04.000Z"
    },
    messages: [
      {
        ...baseMessage,
        id: "user-1",
        turnIndex: 1,
        role: "user",
        content: "Question 1",
        inputOrigin: "live_transcript"
      },
      {
        ...baseMessage,
        id: "user-2",
        turnIndex: 2,
        role: "user",
        content: "Question 2",
        inputOrigin: "live_transcript"
      },
      {
        ...baseMessage,
        id: "answer-1",
        turnIndex: 3,
        role: "assistant",
        content: "Answer 1",
        answerability: "answered",
        presentationProfile: "live_assist_quick"
      },
      {
        ...baseMessage,
        id: "answer-2",
        turnIndex: 4,
        role: "assistant",
        content: "Answer 2",
        answerability: "answered",
        presentationProfile: "live_assist_quick"
      }
    ],
    answerRuns: [
      {
        id: "run-1",
        conversationId: "conv-rapid",
        triggeringUserMessageId: "user-1",
        assistantMessageId: "answer-1",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-16T00:00:00.000Z",
        startedAt: "2026-08-16T00:00:00.000Z",
        completedAt: "2026-08-16T00:00:03.000Z"
      },
      {
        id: "run-2",
        conversationId: "conv-rapid",
        triggeringUserMessageId: "user-2",
        assistantMessageId: "answer-2",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-16T00:00:01.000Z",
        startedAt: "2026-08-16T00:00:03.000Z",
        completedAt: "2026-08-16T00:00:04.000Z"
      }
    ]
  };
  const rows = buildHelpdeskTimeline(view);
  assert.deepEqual(
    rows.map((row) =>
      row.kind === "message"
        ? `${row.message.content}:${row.run?.id ?? "user"}`
        : row.text
    ),
    [
      "Question 1:user",
      "Answer 1:run-1",
      "Question 2:user",
      "Answer 2:run-2"
    ]
  );
  const turns = groupHelpdeskInterviewTurns(rows);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.kind, "turn");
  assert.equal(turns[1]?.kind, "turn");
  if (turns[0]?.kind === "turn" && turns[1]?.kind === "turn") {
    assert.equal(turns[0].userMessageId, "user-1");
    assert.equal(turns[1].userMessageId, "user-2");
    assert.equal(
      turns[0].rows[0]?.kind === "message" && turns[0].rows[0].message.role,
      "user"
    );
    assert.equal(
      turns[0].rows[1]?.kind === "message" && turns[0].rows[1].message.role,
      "assistant"
    );
  }
  assert.equal(newestTurnUserMessageId(turns), "user-2");
});

test("three typed Q/A pairs stay visible in chronological order", () => {
  const baseMessage = {
    conversationId: "conv-typed",
    inputOrigin: "typed" as const,
    captureSource: null,
    answerability: null,
    presentationProfile: null,
    groundingSnapshotId: null,
    citations: [],
    contextReferences: [],
    createdAt: "2026-08-19T00:00:00.000Z"
  };
  const view: HelpdeskConversationView = {
    conversation: {
      id: "conv-typed",
      title: "Typed continuity",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:06.000Z"
    },
    messages: [
      {
        ...baseMessage,
        id: "user-1",
        turnIndex: 1,
        role: "user",
        content: "Q1"
      },
      {
        ...baseMessage,
        id: "user-2",
        turnIndex: 2,
        role: "user",
        content: "Q2"
      },
      {
        ...baseMessage,
        id: "user-3",
        turnIndex: 3,
        role: "user",
        content: "Q3"
      },
      {
        ...baseMessage,
        id: "answer-1",
        turnIndex: 4,
        role: "assistant",
        content: "Evidence 1",
        answerability: "answered",
        presentationProfile: "helpdesk_detailed"
      },
      {
        ...baseMessage,
        id: "answer-2",
        turnIndex: 5,
        role: "assistant",
        content: "Evidence 2",
        answerability: "answered",
        presentationProfile: "helpdesk_detailed"
      },
      {
        ...baseMessage,
        id: "answer-3",
        turnIndex: 6,
        role: "assistant",
        content: "Evidence 3",
        answerability: "answered",
        presentationProfile: "helpdesk_detailed"
      }
    ],
    answerRuns: [
      {
        id: "run-1",
        conversationId: "conv-typed",
        triggeringUserMessageId: "user-1",
        assistantMessageId: "answer-1",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-19T00:00:01.000Z",
        startedAt: "2026-08-19T00:00:01.000Z",
        completedAt: "2026-08-19T00:00:02.000Z"
      },
      {
        id: "run-2",
        conversationId: "conv-typed",
        triggeringUserMessageId: "user-2",
        assistantMessageId: "answer-2",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-19T00:00:03.000Z",
        startedAt: "2026-08-19T00:00:03.000Z",
        completedAt: "2026-08-19T00:00:04.000Z"
      },
      {
        id: "run-3",
        conversationId: "conv-typed",
        triggeringUserMessageId: "user-3",
        assistantMessageId: "answer-3",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-19T00:00:05.000Z",
        startedAt: "2026-08-19T00:00:05.000Z",
        completedAt: "2026-08-19T00:00:06.000Z"
      }
    ]
  };
  const rows = buildHelpdeskTimeline(view);
  assert.deepEqual(
    rows.map((row) =>
      row.kind === "message"
        ? `${row.message.content}:${row.run?.id ?? "user"}:${row.message.id}`
        : row.text
    ),
    [
      "Q1:user:user-1",
      "Evidence 1:run-1:answer-1",
      "Q2:user:user-2",
      "Evidence 2:run-2:answer-2",
      "Q3:user:user-3",
      "Evidence 3:run-3:answer-3"
    ]
  );
});

test("a failed turn keeps adjacent question and answer cards intact", () => {
  const baseMessage = {
    conversationId: "conv-fail",
    inputOrigin: null as const,
    captureSource: null,
    answerability: null,
    presentationProfile: null,
    groundingSnapshotId: null,
    citations: [],
    contextReferences: [],
    createdAt: "2026-08-16T00:00:00.000Z"
  };
  const view: HelpdeskConversationView = {
    conversation: {
      id: "conv-fail",
      title: "Fail isolation",
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:03.000Z"
    },
    messages: [
      {
        ...baseMessage,
        id: "user-1",
        turnIndex: 1,
        role: "user",
        content: "Question 1",
        inputOrigin: "live_transcript"
      },
      {
        ...baseMessage,
        id: "user-2",
        turnIndex: 2,
        role: "user",
        content: "Question 2",
        inputOrigin: "live_transcript"
      },
      {
        ...baseMessage,
        id: "user-3",
        turnIndex: 3,
        role: "user",
        content: "Question 3",
        inputOrigin: "live_transcript"
      },
      {
        ...baseMessage,
        id: "answer-1",
        turnIndex: 4,
        role: "assistant",
        content: "Answer 1",
        answerability: "answered",
        presentationProfile: "live_assist_quick"
      },
      {
        ...baseMessage,
        id: "answer-3",
        turnIndex: 5,
        role: "assistant",
        content: "Answer 3",
        answerability: "answered",
        presentationProfile: "live_assist_quick"
      }
    ],
    answerRuns: [
      {
        id: "run-1",
        conversationId: "conv-fail",
        triggeringUserMessageId: "user-1",
        assistantMessageId: "answer-1",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-16T00:00:00.000Z",
        startedAt: "2026-08-16T00:00:00.000Z",
        completedAt: "2026-08-16T00:00:01.000Z"
      },
      {
        id: "run-2",
        conversationId: "conv-fail",
        triggeringUserMessageId: "user-2",
        assistantMessageId: null,
        state: "failed",
        failureCode: "grounding_execution_failed",
        createdAt: "2026-08-16T00:00:01.000Z",
        startedAt: "2026-08-16T00:00:01.000Z",
        completedAt: "2026-08-16T00:00:02.000Z"
      },
      {
        id: "run-3",
        conversationId: "conv-fail",
        triggeringUserMessageId: "user-3",
        assistantMessageId: "answer-3",
        state: "completed",
        failureCode: null,
        createdAt: "2026-08-16T00:00:02.000Z",
        startedAt: "2026-08-16T00:00:02.000Z",
        completedAt: "2026-08-16T00:00:03.000Z"
      }
    ]
  };
  const rows = buildHelpdeskTimeline(view);
  assert.deepEqual(
    rows.map((row) =>
      row.kind === "message"
        ? `${row.message.content}:${row.run?.id ?? "user"}`
        : `status:${row.run.id}`
    ),
    [
      "Question 1:user",
      "Answer 1:run-1",
      "Question 2:user",
      "status:run-2",
      "Question 3:user",
      "Answer 3:run-3"
    ]
  );
});

test("copy answer writes the exact R4 text without transformation", async () => {
  const writes: string[] = [];
  const answer =
    "First exact line.\n\nSecond exact line with `code`.";
  await copyAnswerText(answer, {
    async writeText(value) {
      writes.push(value);
    }
  });
  assert.deepEqual(writes, [answer]);
});

test("helpdesk renderer keeps interview turns as independent user bubbles and answer cards", () => {
  const app = readFileSync(resolve("src/renderer/helpdesk/App.tsx"), "utf8");
  assert.match(app, /data-user-message-id/);
  assert.match(app, /data-turn-anchor/);
  assert.match(app, /helpdeskTurn/);
  assert.match(app, /useNewestTurnFocus/);
  assert.match(app, /data-answer-run-id=\{row\.run\?\.id\}/);
  assert.match(app, /interview-quick/);
  assert.match(app, /Interview Quick/);
  assert.match(app, /Interviewer/);
  assert.doesNotMatch(app, /appendChild\(.*answer/);
});

test("renderer sources have no raw database, filesystem, IPC, or Node access", () => {
  for (const filename of ["App.tsx", "viewModel.ts", "main.tsx"]) {
    const source = readFileSync(
      resolve(`src/renderer/helpdesk/${filename}`),
      "utf8"
    );
    assert.doesNotMatch(
      source,
      /(better-sqlite3|node:fs|node:path|ipcRenderer|answerV2|retrievalV2|require\s*\()/
    );
  }
});

test("typed Helpdesk submit reuses the selected conversation and pins the composer", () => {
  const app = readFileSync(resolve("src/renderer/helpdesk/App.tsx"), "utf8");
  const styles = readFileSync(
    resolve("src/renderer/helpdesk/styles.css"),
    "utf8"
  );
  const viewModel = readFileSync(
    resolve("src/renderer/helpdesk/viewModel.ts"),
    "utf8"
  );
  assert.match(app, /resolveSubmitConversationId\(activeId\)/);
  assert.match(app, /sessionStorage\.setItem\(HELP_DESK_ACTIVE_CONVERSATION_KEY/);
  assert.match(app, /resolveInitialConversationId/);
  assert.match(app, /data-conversation-id=\{activeId \?\? ""\}/);
  assert.match(app, /onCreate=\{\(\) => void createConversation\(\)\}/);
  assert.match(app, /className="conversation-banners"/);
  const submitStart = app.indexOf("const submitMessage");
  const submitEnd = app.indexOf("return (", submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.doesNotMatch(
    app.slice(submitStart, submitEnd),
    /createConversation/
  );
  assert.match(styles, /\.conversation-pane \{\s*display: flex;/);
  assert.match(styles, /\.timeline \{[\s\S]*?flex: 1;/);
  assert.match(styles, /\.composer-shell \{\s*flex-shrink: 0;/);
  assert.doesNotMatch(styles, /grid-template-rows: auto auto minmax/);
  assert.ok(viewModel.includes(HELP_DESK_ACTIVE_CONVERSATION_KEY));
});

test("ask-question composer stays visible for empty, evidence, and long timelines", () => {
  const app = readFileSync(resolve("src/renderer/helpdesk/App.tsx"), "utf8");
  const styles = readFileSync(
    resolve("src/renderer/helpdesk/styles.css"),
    "utf8"
  );
  const composer = app.slice(
    app.indexOf("function Composer"),
    app.indexOf("export function HelpdeskApp")
  );
  const timeline = app.slice(
    app.indexOf("function ConversationTimeline"),
    app.indexOf("function Composer")
  );
  assert.match(composer, /className="composer-heading"/);
  assert.match(composer, /Ask a question/);
  assert.match(composer, /placeholder=\{\s*props\.hasConversation\s*\?\s*"Ask a question…"/);
  assert.doesNotMatch(composer, /parseEvidenceCardContent/);
  assert.doesNotMatch(composer, /rows\.length/);
  assert.match(app, /<ConversationTimeline[\s\S]*?<Composer/);
  assert.match(app, /hasConversation=\{activeId !== null\}/);
  assert.match(timeline, /return \(\s*<div className="timeline"/);
  assert.doesNotMatch(timeline, /if \(props\.loading\) \{\s*return /);
  assert.match(styles, /\.composer-heading \{/);
  assert.match(styles, /\.timeline \{[\s\S]*?flex: 1;/);
  assert.match(styles, /\.composer-shell \{\s*flex-shrink: 0;/);
  assert.doesNotMatch(
    styles,
    /\.center-state \{\s*display: grid;\s*min-height: 100%;/
  );
});

test("I2 conversation continuity does not change retrieval or STT/audio", () => {
  const retrievalFiles = [
    "src/main/services/evidence/evidenceSearchClient.ts",
    "src/main/services/evidence/learnRagChild.ts",
    "src/main/services/evidence/evidenceCardBuilder.ts",
    "src/main/services/conversations/evidenceAnswerExecutionPort.ts"
  ];
  const sttFiles = [
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts",
    "src/renderer/audio-capture/captureLoopbackAudio.ts"
  ];
  for (const file of [...retrievalFiles, ...sttFiles]) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(
      source,
      /HELP_DESK_ACTIVE_CONVERSATION_KEY|resolveSubmitConversationId|conversation-banners/
    );
  }
  const sttDiff = execFileSync(
    "git",
    ["diff", "--name-only", "HEAD", "--", ...sttFiles],
    { encoding: "utf8", cwd: resolve(".") }
  ).trim();
  assert.equal(sttDiff, "");
});

test("evidence cards render retrieved sources as independent peer items", () => {
  const app = readFileSync(resolve("src/renderer/helpdesk/App.tsx"), "utf8");
  const styles = readFileSync(
    resolve("src/renderer/helpdesk/styles.css"),
    "utf8"
  );
  assert.match(app, /listEvidenceCardSources\(payload\)/);
  assert.doesNotMatch(app, /orderEvidenceByAuthority|orderEvidenceForPresentation/);
  assert.match(app, /className="evidence-item"/);
  assert.match(app, /toggleExpandedEvidenceSource\(current, sourceId\)/);
  assert.match(app, /props\.expanded \? "Collapse" : "Expand"/);
  assert.match(app, /tokenizeEvidenceMarkup/);
  assert.match(app, /className="evidence-md-code"/);
  assert.match(app, /personal-card/);
  assert.match(app, /PERSONAL_RESPONSE_PROMPT/);
  assert.match(app, /SUPPORTING_EVIDENCE_HEADING/);
  assert.doesNotMatch(
    app,
    /Best source|Best answer|Recommended answer|Primary answer/
  );
  assert.doesNotMatch(app, /Additional Microsoft sources/);
  assert.doesNotMatch(app, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(app, /EVIDENCE_PAYLOAD_SENTINEL/);
  assert.match(styles, /\.evidence-item \{/);
  assert.match(styles, /\.evidence-md-code \{/);
  assert.doesNotMatch(styles, /\.evidence-kicker/);
});

test("I3 presentation does not change retrieval or STT/audio", () => {
  const retrievalFiles = [
    "src/main/services/evidence/evidenceSearchClient.ts"
  ];
  const sttFiles = [
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts",
    "src/renderer/audio-capture/captureLoopbackAudio.ts"
  ];
  for (const file of [...retrievalFiles, ...sttFiles]) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(
      source,
      /toggleExpandedEvidenceSource|evidence-item|PYTHONIOENCODING/
    );
  }
  const sttDiff = execFileSync(
    "git",
    ["diff", "--name-only", "HEAD", "--", ...sttFiles],
    { encoding: "utf8", cwd: resolve(".") }
  ).trim();
  assert.equal(sttDiff, "");
});
