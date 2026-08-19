import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { resolveKnowledgeV2DatabasePath } from "../knowledgeV2/store";
import { resolveConversationDatabasePath } from "./dbPaths";
import { CONVERSATION_MIGRATIONS } from "./migrations";
import {
  createSqliteConversationStore,
  type SqliteConversationStore
} from "./sqliteConversationStore";
import type { AnswerRunRecord, GroundingSnapshotReference } from "./types";

const SNAPSHOT_A: GroundingSnapshotReference = {
  snapshotId: "grounding:slice1-a",
  snapshotHash: "a".repeat(64),
  schemaVersion: "grounding-decision-snapshot/v1",
  resolverPolicyVersion: "wb18-evidence-policy/v1",
  corpusRevisionHash: "b".repeat(64),
  createdAt: "2026-08-08T20:00:00.000Z"
};

async function makeTempDatabase(): Promise<{ root: string; databasePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-conversations-"));
  return {
    root,
    databasePath: join(root, "conversations.sqlite")
  };
}

async function withStore(
  run: (store: SqliteConversationStore, databasePath: string) => void | Promise<void>
): Promise<void> {
  const temp = await makeTempDatabase();
  const store = createSqliteConversationStore({ databasePath: temp.databasePath });
  try {
    await run(store, temp.databasePath);
  } finally {
    store.close();
    await rm(temp.root, { recursive: true, force: true });
  }
}

function advanceToValidating(
  store: SqliteConversationStore,
  run: AnswerRunRecord
): AnswerRunRecord {
  let current = run;
  for (const state of [
    "resolving_context",
    "retrieving",
    "planning",
    "executing_answer",
    "validating"
  ] as const) {
    current = store.updateAnswerRun({
      answerRunId: current.id,
      state
    });
  }
  return current;
}

function createQuestionRun(
  store: SqliteConversationStore,
  params?: {
    title?: string;
    content?: string;
    inputOrigin?: "typed" | "pasted" | "live_transcript";
  }
): {
  conversationId: string;
  userMessageId: string;
  run: AnswerRunRecord;
} {
  const conversation = store.createConversation({ title: params?.title ?? "Teams help" });
  const message = store.appendUserMessage({
    conversationId: conversation.id,
    content: params?.content ?? "How do I assign a voice routing policy?",
    inputOrigin: params?.inputOrigin ?? "typed"
  });
  return {
    conversationId: conversation.id,
    userMessageId: message.id,
    run: store.createAnswerRun({
      conversationId: conversation.id,
      triggeringUserMessageId: message.id
    })
  };
}

test("creates, lists, loads, and reopens conversations", async () => {
  const temp = await makeTempDatabase();
  let conversationId = "";
  const first = createSqliteConversationStore({ databasePath: temp.databasePath });
  try {
    assert.equal(first.getSchemaVersion(), 7);
    const conversation = first.createConversation({ title: "Teams Voice" });
    conversationId = conversation.id;
    assert.equal(first.listConversations().length, 1);
    assert.equal(first.getConversation(conversation.id)?.title, "Teams Voice");
  } finally {
    first.close();
  }

  const reopened = createSqliteConversationStore({ databasePath: temp.databasePath });
  try {
    assert.equal(reopened.getConversation(conversationId)?.title, "Teams Voice");
  } finally {
    reopened.close();
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("version 2 migration preserves existing version 1 messages", async () => {
  const temp = await makeTempDatabase();
  const raw = new Database(temp.databasePath);
  try {
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    raw.exec(CONVERSATION_MIGRATIONS[0]!.sql);
    raw
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)"
      )
      .run(
        CONVERSATION_MIGRATIONS[0]!.name,
        "2026-08-08T00:00:00.000Z"
      );
    raw
      .prepare(
        `INSERT INTO conversations (
          conversation_id, title, created_at, updated_at, deleted_at
        ) VALUES ('conv-v1', 'Existing', ?, ?, NULL)`
      )
      .run(
        "2026-08-08T00:00:00.000Z",
        "2026-08-08T00:00:00.000Z"
      );
    raw
      .prepare(
        `INSERT INTO messages (
          message_id,
          conversation_id,
          turn_index,
          role,
          content,
          input_origin,
          answerability,
          grounding_snapshot_id,
          created_at
        ) VALUES (
          'msg-v1',
          'conv-v1',
          1,
          'user',
          'Existing question',
          'typed',
          NULL,
          NULL,
          ?
        )`
      )
      .run("2026-08-08T00:00:00.000Z");
  } finally {
    raw.close();
  }

  const migrated = createSqliteConversationStore({
    databasePath: temp.databasePath
  });
  try {
    assert.equal(migrated.getSchemaVersion(), 7);
    assert.equal(
      migrated.loadOrderedMessages("conv-v1")[0]?.content,
      "Existing question"
    );
  } finally {
    migrated.close();
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("renames an active conversation", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({ title: "Initial" });
    const renamed = store.renameConversation(conversation.id, "Direct Routing");
    assert.equal(renamed.title, "Direct Routing");
    assert.equal(store.getConversation(conversation.id)?.title, "Direct Routing");
  });
});

test("durably orders typed, pasted, and live-transcript user messages", async () => {
  await withStore((store) => {
    const conversation = store.createConversation();
    const typed = store.appendUserMessage({
      conversationId: conversation.id,
      content: "Typed",
      inputOrigin: "typed"
    });
    const pasted = store.appendUserMessage({
      conversationId: conversation.id,
      content: "Pasted",
      inputOrigin: "pasted"
    });
    const live = store.appendUserMessage({
      conversationId: conversation.id,
      content: "Live",
      inputOrigin: "live_transcript"
    });

    assert.deepEqual(
      [typed, pasted, live].map((message) => message.turnIndex),
      [1, 2, 3]
    );
    assert.deepEqual(
      store.loadOrderedMessages(conversation.id).map((message) => message.inputOrigin),
      ["typed", "pasted", "live_transcript"]
    );
  });
});

test("persists an answered assistant message only through atomic run completion", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);

    const completed = store.appendGroundedAssistantMessage({
      answerRunId: fixture.run.id,
      content: "Use the verified assignment command.",
      answerability: "answered",
      snapshot: SNAPSHOT_A,
      citations: []
    });

    assert.equal(completed.message.role, "assistant");
    assert.equal(completed.message.answerability, "answered");
    assert.equal(completed.message.groundingSnapshotId, SNAPSHOT_A.snapshotId);
    assert.equal(completed.answerRun.state, "completed");
    assert.equal(completed.answerRun.assistantMessageId, completed.message.id);
    assert.deepEqual(
      store.loadOrderedMessages(fixture.conversationId).map((message) => message.turnIndex),
      [1, 2]
    );
  });
});

test("persists partial as a valid grounded assistant message", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);

    const completed = store.appendGroundedAssistantMessage({
      answerRunId: fixture.run.id,
      content: "The supported portion is available; adjacent authority is missing.",
      answerability: "partial",
      snapshot: SNAPSHOT_A,
      citations: []
    });

    assert.equal(completed.message.answerability, "partial");
    assert.equal(completed.answerRun.state, "partial");
    assert.equal(store.loadOrderedMessages(fixture.conversationId).length, 2);
  });
});

test("persists insufficient evidence as a valid grounded assistant message", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    const text =
      "Unable to provide a factual answer from the approved evidence.";
    const completed = store.appendGroundedAssistantMessage({
      answerRunId: fixture.run.id,
      content: text,
      answerability: "insufficient_evidence",
      snapshot: SNAPSHOT_A,
      citations: []
    });
    assert.equal(completed.message.content, text);
    assert.equal(
      completed.message.answerability,
      "insufficient_evidence"
    );
    assert.equal(completed.answerRun.state, "completed");
  });
});

test("persists validated citation ranges with the exact answer", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    const content =
      "Calling Plans connect Teams Phone to the PSTN.";
    const completed = store.appendGroundedAssistantMessage({
      answerRunId: fixture.run.id,
      content,
      answerability: "answered",
      snapshot: SNAPSHOT_A,
      citations: [
        {
          citationId: "citation:calling-plans",
          factualRangeId: "factual-range:calling-plans",
          answerRangeStart: 0,
          answerRangeEnd: content.length,
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
      ]
    });
    assert.equal(completed.message.content, content);
    assert.equal(completed.message.citations.length, 1);
    assert.deepEqual(completed.message.citations[0], {
      messageId: completed.message.id,
      citationId: "citation:calling-plans",
      factualRangeId: "factual-range:calling-plans",
      claimId: null,
      answerRangeStart: 0,
      answerRangeEnd: content.length,
      evidenceId: null,
      spanId: null,
      supportingSpanIds: [],
      documentId: null,
      sourceTitle: "Microsoft Teams Calling Plans",
      canonicalUrl:
        "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365",
      sourceId: "ms-teams-admin",
      authorityRole: "teams_admin_primary",
      headingPath: ["Microsoft Teams Calling Plans"],
      sectionId: "calling-plans",
      sourceStatus: "ga",
      preview: false,
      groundingSnapshotId: SNAPSHOT_A.snapshotId
    });
  });
});

test("persists factual citations and explanation context as distinct atomic records", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    const claim = "SharePoint Restricted Content Discovery is available.";
    const content = `Summary\n${claim}\n\nAuthoritative context\nAdditional security context.`;
    const claimStart = content.indexOf(claim);
    const completed = store.appendGroundedAssistantMessage({
      answerRunId: fixture.run.id,
      content,
      answerability: "answered",
      presentationProfile: "helpdesk_detailed",
      snapshot: SNAPSHOT_A,
      citations: [
        {
          citationId: "citation:sharepoint",
          factualRangeId: "factual-range:sharepoint",
          claimId: "claim:sharepoint",
          answerRangeStart: claimStart,
          answerRangeEnd: claimStart + claim.length,
          evidenceId: "evidence:sharepoint",
          spanId: "span:sharepoint",
          supportingSpanIds: ["span:supporting"],
          documentId: "document:sharepoint",
          sourceTitle: "Restricted Content Discovery",
          canonicalUrl:
            "https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery",
          sourceId: "ms-sharepoint-docs",
          authorityRole: "sharepoint_admin_primary",
          headingPath: ["Restricted Content Discovery", "Overview"],
          sectionId: "overview",
          sourceStatus: "ga",
          preview: false
        }
      ],
      contextReferences: [
        {
          contextBlockId: "context:oversharing",
          evidenceId: "evidence:oversharing",
          documentId: "document:oversharing",
          chunkId: "chunk:oversharing",
          sourceTitle: "Data security and governance",
          canonicalUrl:
            "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-data-privacy",
          sourceId: "ms-m365-docs",
          authorityRole: "m365_primary",
          headingPath: ["Data security", "Oversharing"],
          sectionId: "oversharing",
          sourceStartOffset: 12,
          sourceEndOffset: 48,
          sourceContentHash: "c".repeat(64),
          contextType: "conceptual_explanation",
          preview: false
        }
      ]
    });

    assert.equal(completed.message.presentationProfile, "helpdesk_detailed");
    assert.equal(completed.message.citations.length, 1);
    assert.equal(completed.message.contextReferences.length, 1);
    assert.equal(
      content.slice(
        completed.message.citations[0]!.answerRangeStart,
        completed.message.citations[0]!.answerRangeEnd
      ),
      claim
    );
    assert.equal(
      completed.message.contextReferences[0]!.canonicalUrl,
      "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-data-privacy"
    );
  });
});

test("invalid context reference rolls back assistant, citations, and context atomically", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    assert.throws(
      () =>
        store.appendGroundedAssistantMessage({
          answerRunId: fixture.run.id,
          content: "A valid factual answer.",
          answerability: "answered",
          snapshot: SNAPSHOT_A,
          citations: [],
          contextReferences: [
            {
              contextBlockId: "context:invalid",
              evidenceId: "evidence:invalid",
              documentId: "document:invalid",
              chunkId: "chunk:invalid",
              sourceTitle: "Invalid context",
              canonicalUrl:
                "https://learn.microsoft.com/en-us/microsoftteams/",
              sourceId: "ms-teams-admin",
              authorityRole: "teams_admin_primary",
              headingPath: ["Invalid"],
              sectionId: "invalid",
              sourceStartOffset: 4,
              sourceEndOffset: 4,
              sourceContentHash: "d".repeat(64),
              contextType: "supporting_context",
              preview: false
            }
          ]
        }),
      /invalid source range/
    );
    assert.equal(store.loadOrderedMessages(fixture.conversationId).length, 1);
    assert.equal(store.getAnswerRun(fixture.run.id)?.state, "validating");
    assert.equal(store.getAnswerRun(fixture.run.id)?.assistantMessageId, null);
  });
});

test("arbitrary GitHub context URL fails closed before assistant persistence", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    assert.throws(
      () =>
        store.appendGroundedAssistantMessage({
          answerRunId: fixture.run.id,
          content: "A valid factual answer.",
          answerability: "answered",
          snapshot: SNAPSHOT_A,
          citations: [],
          contextReferences: [
            {
              contextBlockId: "context:github-untrusted",
              evidenceId: "evidence:github-untrusted",
              documentId: "document:github-untrusted",
              chunkId: "chunk:github-untrusted",
              sourceTitle: "Untrusted GitHub context",
              canonicalUrl:
                "https://github.com/arbitrary/project/blob/main/docs/context.md",
              sourceId: "unregistered-source",
              authorityRole: "unknown",
              headingPath: ["Context"],
              sectionId: "context",
              sourceStartOffset: 0,
              sourceEndOffset: 8,
              sourceContentHash: "d".repeat(64),
              contextType: "supporting_context",
              preview: false
            }
          ]
        }),
      /does not have an actionable evidence URL/
    );
    assert.equal(store.loadOrderedMessages(fixture.conversationId).length, 1);
    assert.equal(store.getAnswerRun(fixture.run.id)?.state, "validating");
    assert.equal(store.getAnswerRun(fixture.run.id)?.assistantMessageId, null);
  });
});

test("rejects an unvalidated citation URL before assistant persistence", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    const content = "A factual answer.";
    assert.throws(
      () =>
        store.appendGroundedAssistantMessage({
          answerRunId: fixture.run.id,
          content,
          answerability: "answered",
          snapshot: SNAPSHOT_A,
          citations: [
            {
              citationId: "citation:untrusted",
              factualRangeId: "factual-range:untrusted",
              answerRangeStart: 0,
              answerRangeEnd: content.length,
              sourceTitle: "Untrusted",
              canonicalUrl: "https://example.com/not-authoritative",
              sourceId: "unknown",
              authorityRole: "teams_admin_primary",
              headingPath: [],
              sectionId: "unknown",
              sourceStatus: "unknown",
              preview: false
            }
          ]
        }),
      /actionable evidence URL/
    );
    assert.equal(
      store.loadOrderedMessages(fixture.conversationId).length,
      1
    );
  });
});

test("zero-length factual citation fails closed without partial persistence", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    assert.throws(
      () =>
        store.appendGroundedAssistantMessage({
          answerRunId: fixture.run.id,
          content: "A factual answer.",
          answerability: "answered",
          snapshot: SNAPSHOT_A,
          citations: [
            {
              citationId: "citation:zero",
              factualRangeId: "factual-range:zero",
              answerRangeStart: 0,
              answerRangeEnd: 0,
              sourceTitle: "Microsoft Teams",
              canonicalUrl:
                "https://learn.microsoft.com/en-us/microsoftteams/",
              sourceId: "ms-teams-admin",
              authorityRole: "teams_admin_primary",
              headingPath: ["Microsoft Teams"],
              sectionId: "overview",
              sourceStatus: "ga",
              preview: false
            }
          ]
        }),
      /invalid answer range/
    );
    assert.equal(store.loadOrderedMessages(fixture.conversationId).length, 1);
    assert.equal(store.getAnswerRun(fixture.run.id)?.state, "validating");
    assert.equal(store.getAnswerRun(fixture.run.id)?.assistantMessageId, null);
  });
});

test("failed answer run creates no factual assistant message", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    store.updateAnswerRun({
      answerRunId: fixture.run.id,
      state: "executing_answer",
      snapshot: SNAPSHOT_A
    });
    const failed = store.updateAnswerRun({
      answerRunId: fixture.run.id,
      state: "failed",
      failureCode: "answer_unavailable",
      failureDetails: { retryable: false }
    });

    assert.equal(failed.state, "failed");
    assert.equal(failed.failureCode, "answer_unavailable");
    assert.equal(failed.assistantMessageId, null);
    assert.equal(failed.groundingSnapshotId, SNAPSHOT_A.snapshotId);
    assert.equal(store.loadOrderedMessages(fixture.conversationId).length, 1);
  });
});

test("cancelled answer run creates no factual assistant message", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    const cancelled = store.updateAnswerRun({
      answerRunId: fixture.run.id,
      state: "cancelled",
      failureCode: "user_cancelled"
    });

    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.assistantMessageId, null);
    assert.equal(store.loadOrderedMessages(fixture.conversationId).length, 1);
  });
});

test("grounded completion rolls back when snapshot identity conflicts", async () => {
  await withStore((store) => {
    const first = createQuestionRun(store);
    advanceToValidating(store, first.run);
    store.appendGroundedAssistantMessage({
      answerRunId: first.run.id,
      content: "First answer",
      answerability: "answered",
      snapshot: SNAPSHOT_A,
      citations: []
    });

    const secondUser = store.appendUserMessage({
      conversationId: first.conversationId,
      content: "What about removing it?",
      inputOrigin: "typed"
    });
    const secondRun = store.createAnswerRun({
      conversationId: first.conversationId,
      triggeringUserMessageId: secondUser.id
    });
    advanceToValidating(store, secondRun);

    assert.throws(
      () =>
        store.appendGroundedAssistantMessage({
          answerRunId: secondRun.id,
          content: "This content must roll back.",
          answerability: "answered",
          snapshot: { ...SNAPSHOT_A, snapshotHash: "c".repeat(64) },
          citations: []
        }),
      /snapshot identity conflict/
    );

    assert.equal(store.loadOrderedMessages(first.conversationId).length, 3);
    const unchanged = store.getAnswerRun(secondRun.id);
    assert.equal(unchanged?.state, "validating");
    assert.equal(unchanged?.assistantMessageId, null);
  });
});

test("repeated deterministic snapshot identity tolerates a later observation timestamp", async () => {
  await withStore((store) => {
    const first = createQuestionRun(store);
    advanceToValidating(store, first.run);
    store.appendGroundedAssistantMessage({
      answerRunId: first.run.id,
      content: "First answer",
      answerability: "answered",
      snapshot: SNAPSHOT_A,
      citations: []
    });
    const secondUser = store.appendUserMessage({
      conversationId: first.conversationId,
      content: "Repeat the same deterministic question",
      inputOrigin: "typed"
    });
    const secondRun = store.createAnswerRun({
      conversationId: first.conversationId,
      triggeringUserMessageId: secondUser.id
    });
    advanceToValidating(store, secondRun);
    const completed = store.appendGroundedAssistantMessage({
      answerRunId: secondRun.id,
      content: "Repeated answer",
      answerability: "answered",
      snapshot: {
        ...SNAPSHOT_A,
        createdAt: "2026-08-09T01:00:00.000Z"
      },
      citations: []
    });
    assert.equal(completed.answerRun.state, "completed");
  });
});

test("restart recovery marks interrupted nonterminal run failed without assistant content", async () => {
  const temp = await makeTempDatabase();
  let conversationId = "";
  let runId = "";
  const first = createSqliteConversationStore({ databasePath: temp.databasePath });
  try {
    const fixture = createQuestionRun(first);
    conversationId = fixture.conversationId;
    runId = fixture.run.id;
    first.updateAnswerRun({
      answerRunId: runId,
      state: "executing_answer"
    });
  } finally {
    first.close();
  }

  const recovered = createSqliteConversationStore({ databasePath: temp.databasePath });
  try {
    const run = recovered.getAnswerRun(runId);
    assert.equal(run?.state, "failed");
    assert.equal(run?.failureCode, "interrupted");
    assert.equal(run?.assistantMessageId, null);
    assert.equal(recovered.loadOrderedMessages(conversationId).length, 1);
  } finally {
    recovered.close();
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("context resolution stores prior-message references without evidence semantics", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    advanceToValidating(store, fixture.run);
    const answered = store.appendGroundedAssistantMessage({
      answerRunId: fixture.run.id,
      content: "Assign the policy with the supported command.",
      answerability: "answered",
      snapshot: SNAPSHOT_A,
      citations: []
    });
    const followUp = store.appendUserMessage({
      conversationId: fixture.conversationId,
      content: "What about removing it?",
      inputOrigin: "typed"
    });

    const resolution = store.saveContextResolution({
      sourceUserMessageId: followUp.id,
      originalText: followUp.content,
      resolvedQuestion: "How do I remove the voice routing policy assignment?",
      priorMessageIds: [fixture.userMessageId, answered.message.id]
    });

    assert.deepEqual(resolution.priorMessageIds, [
      fixture.userMessageId,
      answered.message.id
    ]);
    assert.equal(
      store.getContextResolution(followUp.id)?.resolvedQuestion,
      "How do I remove the voice routing policy assignment?"
    );
    assert.equal("evidence" in resolution, false);
    assert.equal("groundingSnapshotId" in resolution, false);
  });
});

test("conversation deletion is logical, hides product data, and cancels active runs", async () => {
  const temp = await makeTempDatabase();
  const store = createSqliteConversationStore({ databasePath: temp.databasePath });
  let conversationId = "";
  let runId = "";
  try {
    const fixture = createQuestionRun(store);
    conversationId = fixture.conversationId;
    runId = fixture.run.id;
    assert.equal(store.deleteConversation(conversationId), true);
    assert.equal(store.getConversation(conversationId), null);
    assert.equal(store.listConversations().length, 0);
    assert.equal(store.loadOrderedMessages(conversationId).length, 0);
    assert.equal(store.getAnswerRun(runId), null);
    assert.equal(store.deleteConversation(conversationId), false);
  } finally {
    store.close();
  }

  const raw = new Database(temp.databasePath, { readonly: true });
  try {
    const conversation = raw
      .prepare(
        "SELECT deleted_at FROM conversations WHERE conversation_id = ?"
      )
      .get(conversationId) as { deleted_at: string | null };
    const run = raw
      .prepare("SELECT state, failure_code FROM answer_runs WHERE answer_run_id = ?")
      .get(runId) as { state: string; failure_code: string | null };
    assert.ok(conversation.deleted_at);
    assert.equal(run.state, "cancelled");
    assert.equal(run.failure_code, "conversation_deleted");
  } finally {
    raw.close();
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("clear history logically removes all active conversations", async () => {
  await withStore((store) => {
    store.createConversation({ title: "One" });
    store.createConversation({ title: "Two" });
    assert.equal(store.clearHistory(), 2);
    assert.equal(store.listConversations().length, 0);
  });
});

test("Live Assist session remains bound to its original conversation", async () => {
  await withStore((store) => {
    const firstConversation = store.createConversation({
      title: "Live conversation"
    });
    const secondConversation = store.createConversation({
      title: "Other conversation"
    });
    const session = store.startLiveAssistSession(
      firstConversation.id
    );
    assert.equal(session.state, "active");
    assert.equal(
      session.conversationId,
      firstConversation.id
    );
    assert.throws(
      () =>
        store.startLiveAssistSession(secondConversation.id),
      /already attached/
    );
    assert.equal(
      store.updateLiveAssistCaptureStatus(
        session.id,
        "capturing"
      ).captureStatus,
      "capturing"
    );
    const stopped = store.stopLiveAssistSession(
      session.id,
      "user_stopped"
    );
    assert.equal(stopped.state, "inactive");
    assert.equal(stopped.captureStatus, "stopped");
    assert.equal(store.getActiveLiveAssistSession(), null);
  });
});

test("QA Assist session persists a qa_assist profile distinct from live_assist", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      title: "QA Assist conversation"
    });
    const session = store.startLiveAssistSession(
      conversation.id,
      "qa_assist"
    );
    assert.equal(session.profile, "qa_assist");
    assert.equal(
      store.getActiveLiveAssistSession()?.profile,
      "qa_assist"
    );
    assert.equal(
      store.getLiveAssistSession(session.id)?.profile,
      "qa_assist"
    );
  });
});

test("Live Assist session defaults to the live_assist profile", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      title: "Default profile"
    });
    const session = store.startLiveAssistSession(conversation.id);
    assert.equal(session.profile, "live_assist");
  });
});

test("live-transcript messages persist the actual capture source that produced them", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      title: "Source provenance"
    });
    const systemMessage = store.appendUserMessage({
      conversationId: conversation.id,
      content: "System-sourced question",
      inputOrigin: "live_transcript",
      captureSource: "system"
    });
    const micMessage = store.appendUserMessage({
      conversationId: conversation.id,
      content: "Microphone-sourced question",
      inputOrigin: "live_transcript",
      captureSource: "microphone"
    });
    assert.equal(systemMessage.captureSource, "system");
    assert.equal(micMessage.captureSource, "microphone");
    assert.deepEqual(
      store
        .loadOrderedMessages(conversation.id)
        .map((message) => message.captureSource),
      ["system", "microphone"]
    );
  });
});

test("typed and pasted messages never carry a capture source", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      title: "Typed and pasted"
    });
    const typed = store.appendUserMessage({
      conversationId: conversation.id,
      content: "Typed question",
      inputOrigin: "typed"
    });
    assert.equal(typed.captureSource, null);
    assert.throws(
      () =>
        store.appendUserMessage({
          conversationId: conversation.id,
          content: "Invalid typed with capture source",
          inputOrigin: "typed",
          captureSource: "system"
        }),
      /captureSource must not be set/
    );
  });
});

test("active Live Assist session is recovered as interrupted after restart", async () => {
  const temp = await makeTempDatabase();
  const first = createSqliteConversationStore({
    databasePath: temp.databasePath
  });
  const conversation = first.createConversation({
    title: "Interrupted session"
  });
  const session = first.startLiveAssistSession(conversation.id);
  first.close();

  const reopened = createSqliteConversationStore({
    databasePath: temp.databasePath
  });
  try {
    assert.equal(reopened.getActiveLiveAssistSession(), null);
    const recovered = reopened.getLiveAssistSession(session.id);
    assert.equal(recovered?.state, "inactive");
    assert.equal(recovered?.captureStatus, "interrupted");
    assert.equal(
      recovered?.stopReason,
      "application_interrupted"
    );
  } finally {
    reopened.close();
    await rm(temp.root, { recursive: true, force: true });
  }
});

test("each user message can own only one answer run", async () => {
  await withStore((store) => {
    const fixture = createQuestionRun(store);
    assert.throws(
      () =>
        store.createAnswerRun({
          conversationId: fixture.conversationId,
          triggeringUserMessageId: fixture.userMessageId
        }),
      /UNIQUE constraint failed: answer_runs\.triggering_user_message_id/
    );
  });
});

test("conversation database path is separate from Knowledge V2", () => {
  const userDataPath = resolve("test-user-data");
  const conversationPath = resolveConversationDatabasePath({ userDataPath, env: {} });
  const knowledgePath = resolveKnowledgeV2DatabasePath({ userDataPath, env: {} });
  assert.notEqual(conversationPath, knowledgePath);
  assert.match(conversationPath, /conversations[\\/]conversations\.sqlite$/);
  assert.match(knowledgePath, /knowledge-v2[\\/]knowledge-v2\.sqlite$/);
});

test("only the execution-port adapter imports frozen grounding implementations", () => {
  const productionFiles = [
    "types.ts",
    "dbPaths.ts",
    "migrations.ts",
    "migrationRunner.ts",
    "sqliteConversationStore.ts",
    "helpdeskService.ts",
    "liveAssistService.ts",
    "index.ts"
  ];
  for (const filename of productionFiles) {
    const source = readFileSync(
      resolve(`src/main/services/conversations/${filename}`),
      "utf8"
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*(answerV2|retrievalV2|knowledgeV2)/);
  }
  const adapter = readFileSync(
    resolve(
      "src/main/services/conversations/answerExecutionPort.ts"
    ),
    "utf8"
  );
  assert.match(adapter, /from\s+["']\.\.\/answerV2["']/);
  assert.doesNotMatch(
    adapter,
    /(PipelineManager|OpenAiLlmProvider|groundedAnswerService)/
  );
});
