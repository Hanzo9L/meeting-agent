import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { LiveAssistProjection } from "@shared/types";
import {
  formatEvidenceSourceRoleLabel,
  parseEvidenceCardContent
} from "@shared/evidenceCard";
import { parseEvidenceBridgeResponse } from "../evidence/evidenceSearchClient";
import type {
  EvidenceSearchClient,
  EvidenceSearchResult,
  EvidenceParentResult
} from "../evidence/evidenceTypes";
import { HelpdeskService } from "./helpdeskService";
import { LiveAssistService } from "./liveAssistService";
import { EvidenceAnswerExecutionPort } from "./evidenceAnswerExecutionPort";
import { createSqliteConversationStore } from "./sqliteConversationStore";

const LEARN = resolve("C:/Users/joegc/projects/learn-rag/learn-rag");

function sha16(rel: string): string {
  return createHash("sha256")
    .update(readFileSync(join(LEARN, rel)))
    .digest("hex")
    .slice(0, 16);
}

function hit(overrides: Partial<EvidenceParentResult> & Pick<EvidenceParentResult, "parentId" | "title" | "url" | "body">): EvidenceParentResult {
  return {
    section: "Overview",
    score: 0.9,
    matchedBy: ["lexical"],
    ...overrides
  };
}

function success(
  results: EvidenceParentResult[],
  query = "q"
): EvidenceSearchResult {
  return {
    ok: true,
    query,
    route: {
      confidence: "HIGH",
      service: "msteams",
      repo: "teams-docs",
      reason: "direct-routing"
    },
    results,
    timing: { total_ms: 12 },
    topK: 5,
    engine: "learn-rag-r0.4",
    corpusFingerprint: "c".repeat(16),
    indexFingerprint: "i".repeat(16)
  };
}

class ScriptedEvidenceClient implements EvidenceSearchClient {
  readonly questions: string[] = [];
  constructor(private readonly responses: EvidenceSearchResult[]) {}
  async search(query: string): Promise<EvidenceSearchResult> {
    this.questions.push(query);
    return (
      this.responses.shift() ?? {
        ok: false,
        code: "search_failed",
        message: "Microsoft evidence retrieval is unavailable."
      }
    );
  }
}

async function liveFixture(responses: EvidenceSearchResult[]) {
  const root = await mkdtemp(join(tmpdir(), "relay-live-evidence-i8-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const client = new ScriptedEvidenceClient(responses);
  const helpdesk = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  const projections: LiveAssistProjection[] = [];
  const live = new LiveAssistService(store, helpdesk, {
    sessionChanged() {},
    projectionChanged(projection) {
      projections.push(projection);
    },
    conversationUpdated() {}
  });
  return { root, store, client, helpdesk, live, projections };
}

test("I8 freeze: retrieval files and hashes are unchanged", () => {
  assert.equal(sha16("service/search.py"), "252e9b3ced85b9b0");
  assert.equal(sha16("service/scope_select.py"), "2a8caaabd00f4b08");
  for (const file of [
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts"
  ]) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(source, /EvidenceAnswerExecutionPort/);
    assert.doesNotMatch(source, /LearnRagChild/);
  }
  const assembler = readFileSync(
    resolve("src/main/services/deepgramUtteranceAssembler.ts"),
    "utf8"
  );
  assert.match(assembler, /message\.type === "UtteranceEnd"/);
  assert.match(assembler, /complete\("utterance_end"\)/);
  assert.doesNotMatch(assembler, /is_final.*complete human question/i);
});

test("I8 production still uses one EvidenceAnswerExecutionPort and prewarms one child", () => {
  const main = readFileSync(resolve("src/main/index.ts"), "utf8");
  assert.equal([...main.matchAll(/new LearnRagChild/g)].length, 1);
  assert.equal([...main.matchAll(/new EvidenceAnswerExecutionPort/g)].length, 1);
  assert.match(main, /void evidenceChild\.start\(\)/);
  assert.match(main, /onStatusChange: sendEvidenceStatus/);
  assert.match(main, /sourceModeForProfile/);
  assert.doesNotMatch(main, /GroundedAnswerExecutionPort/);
  assert.doesNotMatch(main, /createConfiguredGroundedSynthesisProvider/);
  const overlayPreload = readFileSync(
    resolve("src/preload/overlayPreload.ts"),
    "utf8"
  );
  assert.match(overlayPreload, /onEvidenceStatus/);
  assert.match(overlayPreload, /liveAssistEvidenceStatus/);
  const pipeline = readFileSync(
    resolve("src/main/services/pipelineManager.ts"),
    "utf8"
  );
  assert.doesNotMatch(pipeline, /createEvidenceSearchClient|LearnRagChild/);
});

test("I8 Linux sources are allowed and AudioCodes is not labeled Microsoft", () => {
  const linux = parseEvidenceBridgeResponse(
    {
      ok: true,
      query: "journalctl",
      route: {
        confidence: "NONE",
        service: null,
        repo: null,
        reason: "none"
      },
      results: [
        {
          parentId: "linux-1",
          title: "journalctl(1)",
          section: "Description",
          url: "https://man7.org/linux/man-pages/man1/journalctl.1.html",
          body: "journalctl may be used to query the systemd journal.",
          score: 0.7,
          matchedBy: ["lexical"],
          repo: "linux"
        }
      ],
      timing: {},
      topK: 5
    },
    {
      engine: "learn-rag-r0.4",
      corpusFingerprint: "c",
      indexFingerprint: "i"
    }
  );
  assert.equal(linux.ok, true);
  if (!linux.ok) return;
  assert.equal(linux.results[0]?.publisher, "Linux");
  assert.notEqual(linux.results[0]?.publisher, "Microsoft");

  const vendor = parseEvidenceBridgeResponse(
    {
      ok: true,
      query: "mediant",
      route: {
        confidence: "HIGH",
        service: "msteams",
        repo: "teams-docs",
        reason: "direct-routing"
      },
      results: [
        {
          parentId: "ac-1",
          title: "AudioCodes Mediant",
          section: "Pairing",
          url: "https://www.audiocodes.com/media/note.pdf",
          body: "Configure the Mediant SBC.",
          score: 0.8,
          matchedBy: ["lexical"],
          repo: "audiocodes"
        }
      ],
      timing: {},
      topK: 5
    },
    {
      engine: "learn-rag-r0.4",
      corpusFingerprint: "c",
      indexFingerprint: "i"
    }
  );
  assert.equal(vendor.ok, true);
  if (!vendor.ok) return;
  assert.equal(vendor.results[0]?.publisher, "AudioCodes");
  assert.equal(
    formatEvidenceSourceRoleLabel(vendor.results[0]!),
    "AudioCodes · vendor implementation"
  );
  assert.notEqual(vendor.results[0]?.publisher, "Microsoft");
});

test("accepted live question uses EvidenceAnswerExecutionPort and keeps Q1/Q2/Q3 independent", async () => {
  const context = await liveFixture([
    success(
      [
        hit({
          parentId: "dr",
          title: "Plan Direct Routing",
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
          body: "Direct Routing connects a certified SBC to Microsoft Phone System."
        })
      ],
      "Explain Direct Routing and the role of the SBC."
    ),
    success(
      [
        hit({
          parentId: "cert",
          title: "Certificate for Direct Routing",
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-certificates",
          body: "The SBC certificate must be from a public trusted CA."
        })
      ],
      "What does the certificate do?"
    ),
    success(
      [
        hit({
          parentId: "fail",
          title: "SBC high availability",
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-sbc",
          body: "If the paired SBC is unavailable, Direct Routing cannot send PSTN calls."
        })
      ],
      "What happens if the SBC fails?"
    )
  ]);
  try {
    const conversation = context.store.createConversation({
      title: "I8 rapid"
    });
    context.live.start(conversation.id, "qa_assist");
    const questions = [
      "Explain Direct Routing and the role of the SBC.",
      "What does the certificate do?",
      "What happens if the SBC fails?"
    ];
    for (const question of questions) {
      await context.live.acceptQuestion(question, "system");
    }
    const messages = context.store.loadOrderedMessages(conversation.id);
    const users = messages.filter((message) => message.role === "user");
    const assistants = messages.filter((message) => message.role === "assistant");
    const runs = context.store.loadAnswerRuns(conversation.id);
    assert.equal(users.length, 3);
    assert.equal(assistants.length, 3);
    assert.equal(new Set(runs.map((run) => run.id)).size, 3);
    assert.deepEqual(
      users.map((message) => message.content),
      questions
    );
    const cards = assistants.map((message) => parseEvidenceCardContent(message.content));
    assert.ok(cards.every(Boolean));
    assert.notEqual(assistants[0]?.content, assistants[1]?.content);
    assert.notEqual(assistants[1]?.content, assistants[2]?.content);
    const completed = context.projections.filter(
      (projection) => projection.state === "answered"
    );
    assert.equal(completed.length, 3);
    assert.equal(new Set(completed.map((item) => item.answerRunId)).size, 3);
    assert.ok(completed.every((item) => item.sources[0]?.publisher === "Microsoft"));
    assert.deepEqual(context.client.questions, questions);
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("live projection preserves AudioCodes publisher and does not label it Microsoft", async () => {
  const context = await liveFixture([
    success([
      hit({
        parentId: "ac-1",
        title: "AudioCodes Mediant: Connecting to Microsoft Teams Direct Routing",
        section: "Pairing",
        url: "https://www.audiocodes.com/media/note.pdf",
        body: "Configure the Mediant SBC pairing toward Teams Direct Routing.",
        repo: "audiocodes"
      })
    ])
  ]);
  try {
    const conversation = context.store.createConversation({
      title: "I8 vendor"
    });
    context.live.start(conversation.id, "qa_assist");
    await context.live.acceptQuestion(
      "How would you configure an AudioCodes Mediant SBC for Teams Direct Routing?",
      "system"
    );
    const view = context.helpdesk.loadConversation(conversation.id);
    assert.notEqual(
      view.answerRuns[0]?.state,
      "failed",
      view.answerRuns[0]?.failureCode ?? "failed without code"
    );
    const answered = context.projections.find(
      (projection) => projection.state === "answered"
    );
    assert.equal(answered?.sources[0]?.publisher, "AudioCodes");
    assert.notEqual(answered?.sources[0]?.publisher, "Microsoft");
    const parsed = parseEvidenceCardContent(answered?.answerText ?? "");
    assert.ok(parsed);
    assert.equal(parsed.payload.primary?.publisher, "AudioCodes");
    assert.match(parsed.visibleText, /AudioCodes · vendor implementation/);
    assert.doesNotMatch(parsed.visibleText, /^Microsoft Evidence/);
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("failed live retrieval ends the answer run cleanly with no invented answer", async () => {
  const context = await liveFixture([
    {
      ok: false,
      code: "search_timeout",
      message: "Microsoft evidence retrieval timed out."
    }
  ]);
  try {
    const conversation = context.store.createConversation({
      title: "I8 fail"
    });
    context.live.start(conversation.id, "qa_assist");
    await context.live.acceptQuestion(
      "A user can use Teams but cannot call external numbers. How do you troubleshoot?",
      "system"
    );
    const view = context.helpdesk.loadConversation(conversation.id);
    assert.equal(view.messages.length, 1);
    assert.equal(view.messages[0]?.role, "user");
    assert.equal(view.answerRuns[0]?.state, "failed");
    assert.equal(context.projections.at(-1)?.state, "failed");
    assert.equal(context.projections.at(-1)?.answerText, null);
    assert.doesNotMatch(
      JSON.stringify(context.projections),
      /Best answer|AI answer|This answers your question/
    );
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("reload hydration preserves live evidence cards and publisher", async () => {
  const context = await liveFixture([
    success([
      hit({
        parentId: "ac-1",
        title: "AudioCodes Mediant",
        url: "https://www.audiocodes.com/media/note.pdf",
        body: "Pair the Mediant toward Teams.",
        repo: "audiocodes"
      }),
      hit({
        parentId: "ms-1",
        title: "Plan Direct Routing",
        url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
        body: "Use a certified Session Border Controller."
      })
    ])
  ]);
  try {
    const conversation = context.store.createConversation({
      title: "I8 hydrate"
    });
    context.live.start(conversation.id, "qa_assist");
    await context.live.acceptQuestion(
      "Explain Direct Routing and how the SBC fits into the call flow.",
      "system"
    );
    const original = context.helpdesk.loadConversation(conversation.id);
    const assistant = original.messages.find((message) => message.role === "assistant");
    assert.ok(assistant);
    context.store.close();
    const reloaded = createSqliteConversationStore({
      databasePath: join(context.root, "conversations.sqlite")
    });
    try {
      const view = new HelpdeskService(
        reloaded,
        new EvidenceAnswerExecutionPort(new ScriptedEvidenceClient([]))
      ).loadConversation(conversation.id);
      const restored = view.messages.find((message) => message.id === assistant.id);
      assert.equal(restored?.content, assistant.content);
      const parsed = parseEvidenceCardContent(restored?.content ?? "");
      assert.ok(parsed);
      assert.equal(parsed.payload.primary?.publisher, "AudioCodes");
      assert.equal(parsed.payload.additional[0]?.publisher, "Microsoft");
      assert.equal(view.answerRuns[0]?.id, original.answerRuns[0]?.id);
      assert.equal(view.messages[0]?.id, original.messages[0]?.id);
    } finally {
      reloaded.close();
    }
  } finally {
    context.store.close();
    await rm(context.root, { recursive: true, force: true }).catch(() => undefined);
  }
});
