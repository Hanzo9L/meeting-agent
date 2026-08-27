import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { HelpdeskService } from "./helpdeskService";
import { createSqliteConversationStore } from "./sqliteConversationStore";
import { EvidenceAnswerExecutionPort } from "./evidenceAnswerExecutionPort";
import type { EvidenceSearchClient, EvidenceSearchResult } from "../evidence/evidenceTypes";
import { parseEvidenceCardContent } from "@shared/evidenceCard";

function hit(parentId: string, title: string): EvidenceSearchResult {
  return {
    ok: true,
    query: title,
    route: {
      confidence: "HIGH",
      service: "msteams-ps",
      repo: "teams-ps",
      reason: "powershell"
    },
    results: [
      {
        parentId,
        title,
        section: "Synopsis",
        url: `https://learn.microsoft.com/en-us/powershell/module/teams/${parentId}`,
        body: `${title} returns the requested Microsoft 365 user object.`,
        score: 0.9,
        matchedBy: ["lexical"]
      }
    ],
    timing: { total_ms: 8 },
    topK: 5,
    engine: "learn-rag-r0.4",
    corpusFingerprint: "corpus",
    indexFingerprint: "index"
  };
}

class ScriptedClient implements EvidenceSearchClient {
  constructor(private readonly responses: EvidenceSearchResult[]) {}
  readonly questions: string[] = [];
  async search(query: string): Promise<EvidenceSearchResult> {
    this.questions.push(query);
    return this.responses.shift() ?? { ok: false, code: "empty", message: "none" };
  }
}

test("typed turns isolate evidence cards and do not call the interview generator", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-port-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const client = new ScriptedClient([
    hit("get-csonlineuser", "Get-CsOnlineUser"),
    hit("get-csonlineuser-audit", "Get-CsOnlineUser audit")
  ]);
  const service = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  try {
    const conversation = service.createConversation("Evidence");
    const first = await service.submitMessage({
      conversationId: conversation.conversation.id,
      content: "What does Get-CsOnlineUser return?",
      inputOrigin: "typed"
    });
    const second = await service.submitMessage({
      conversationId: conversation.conversation.id,
      content: "How would you use PowerShell to audit Teams Voice users?",
      inputOrigin: "typed"
    });
    assert.equal(first.outcome, "answered");
    assert.equal(second.outcome, "answered");
    const firstRun = first.view.answerRuns[0]!;
    const secondRun = second.view.answerRuns[1]!;
    assert.notEqual(firstRun.id, secondRun.id);
    assert.notEqual(firstRun.triggeringUserMessageId, secondRun.triggeringUserMessageId);
    assert.notEqual(firstRun.assistantMessageId, secondRun.assistantMessageId);
    const firstAssistant = first.view.messages.find(
      (message) => message.id === firstRun.assistantMessageId
    )!;
    const secondAssistant = second.view.messages.find(
      (message) => message.id === secondRun.assistantMessageId
    )!;
    assert.ok(firstAssistant.citations.length > 0);
    assert.equal(firstAssistant.citations[0]?.canonicalUrl.includes("learn.microsoft.com"), true);
    assert.notEqual(
      firstAssistant.citations[0]?.citationId,
      secondAssistant.citations[0]?.citationId
    );
    assert.equal(
      firstAssistant.citations.every((citation) => citation.citationId),
      true
    );
    const parsed = parseEvidenceCardContent(firstAssistant.content);
    assert.ok(parsed);
    assert.match(parsed.visibleText, /Microsoft Evidence/);
    assert.doesNotMatch(firstAssistant.content, /This answers your question/);
    store.close();
    const reloaded = createSqliteConversationStore({
      databasePath: join(root, "conversations.sqlite")
    });
    const view = new HelpdeskService(
      reloaded,
      new EvidenceAnswerExecutionPort(client)
    ).loadConversation(conversation.conversation.id);
    assert.equal(view.messages.filter((message) => message.role === "user").length, 2);
    assert.equal(view.messages.filter((message) => message.role === "assistant").length, 2);
    const reloadFirst = view.messages.find(
      (message) => message.id === firstAssistant.id
    );
    const reloadSecond = view.messages.find(
      (message) => message.id === secondAssistant.id
    );
    assert.equal(reloadFirst?.content, firstAssistant.content);
    assert.equal(reloadSecond?.content, secondAssistant.content);
    assert.equal(reloadFirst?.citations[0]?.documentId, "get-csonlineuser");
    assert.equal(reloadSecond?.citations[0]?.documentId, "get-csonlineuser-audit");
      reloaded.close();
    } finally {
      try {
        store.close();
      } catch {
        // already closed
      }
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
});

test("retrieval failure cannot fall back to the interview generator", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-fail-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const client: EvidenceSearchClient = {
    async search() {
      return {
        ok: false,
        code: "python_unavailable",
        message: "Microsoft evidence retrieval is unavailable."
      };
    }
  };
  const service = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  try {
    const conversation = service.createConversation("Evidence");
    const submitted = await service.submitMessage({
      conversationId: conversation.conversation.id,
      content: "What does Get-CsOnlineUser return?",
      inputOrigin: "typed"
    });
    assert.equal(submitted.outcome, "failed");
    assert.equal(submitted.view.answerRuns[0]?.state, "failed");
    assert.equal(submitted.view.answerRuns[0]?.assistantMessageId, null);
    assert.equal(
      submitted.view.messages.some((message) => message.role === "assistant"),
      false
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production wiring and evidence port do not import interview execution", () => {
  const port = readFileSync(
    resolve("src/main/services/conversations/evidenceAnswerExecutionPort.ts"),
    "utf8"
  );
  const main = readFileSync(resolve("src/main/index.ts"), "utf8");
  assert.match(main, /EvidenceAnswerExecutionPort/);
  assert.doesNotMatch(main, /GroundedAnswerExecutionPort/);
  assert.doesNotMatch(main, /createConfiguredGroundedSynthesisProvider/);
  assert.doesNotMatch(port, /runQuestionToEvidenceBundle/);
  assert.doesNotMatch(port, /expandInterviewQuickClaims/);
  assert.doesNotMatch(port, /attemptGroundedSynthesis/);
  assert.doesNotMatch(port, /routeInterviewPacks/);
});

test("STT and audio files were not edited for typed evidence", () => {
  for (const file of [
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts"
  ]) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(source, /EvidenceAnswerExecutionPort/);
    assert.doesNotMatch(source, /learn-rag/);
  }
});

test("personal questions present a Personal Response card instead of Microsoft evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-personal-card-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const client = new ScriptedClient([
    hit("get-csonlineuser", "Get-CsOnlineUser")
  ]);
  const service = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  try {
    const conversation = service.createConversation("Personal");
    const submitted = await service.submitMessage({
      conversationId: conversation.conversation.id,
      content: "Tell me about the hardest UC problem you solved.",
      inputOrigin: "typed"
    });
    assert.equal(submitted.outcome, "answered");
    assert.deepEqual(client.questions, [
      "Tell me about the hardest UC problem you solved."
    ]);
    const assistant = submitted.view.messages.find(
      (message) => message.role === "assistant"
    )!;
    const parsed = parseEvidenceCardContent(assistant.content);
    assert.ok(parsed);
    assert.equal(parsed.payload.responseMode, "personal_response");
    assert.match(parsed.visibleText, /^Personal Response/);
    assert.match(parsed.visibleText, /This question calls for your own experience/);
    assert.match(
      parsed.visibleText,
      /No approved personal story is stored for this question yet/
    );
    assert.doesNotMatch(parsed.visibleText, /^Microsoft Evidence/);
    assert.doesNotMatch(parsed.visibleText, /I solved|I diagnosed|I wrote/);
    assert.equal(parsed.payload.personal?.storyText, null);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("mixed personal questions keep technical evidence secondary", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-mixed-card-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const client = new ScriptedClient([
    hit("get-csonlineuser", "Get-CsOnlineUser")
  ]);
  const service = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  try {
    const conversation = service.createConversation("Mixed");
    const submitted = await service.submitMessage({
      conversationId: conversation.conversation.id,
      content:
        "Tell me about a PowerShell script you wrote to fix a systemic UC issue.",
      inputOrigin: "typed"
    });
    assert.equal(submitted.outcome, "answered");
    const assistant = submitted.view.messages.find(
      (message) => message.role === "assistant"
    )!;
    const parsed = parseEvidenceCardContent(assistant.content);
    assert.ok(parsed);
    assert.equal(parsed.payload.responseMode, "mixed_personal_technical");
    assert.match(parsed.visibleText, /^Personal Response/);
    assert.match(parsed.visibleText, /Supporting Technical Evidence/);
    assert.match(parsed.visibleText, /Get-CsOnlineUser/);
    assert.doesNotMatch(parsed.visibleText, /^Microsoft Evidence/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("personal questions still answer when retrieval fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-personal-fail-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const client: EvidenceSearchClient = {
    async search() {
      return {
        ok: false,
        code: "python_unavailable",
        message: "Microsoft evidence retrieval is unavailable."
      };
    }
  };
  const service = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  try {
    const conversation = service.createConversation("Personal fail");
    const submitted = await service.submitMessage({
      conversationId: conversation.conversation.id,
      content: "Tell me about a time you diagnosed a difficult issue.",
      inputOrigin: "typed"
    });
    assert.equal(submitted.outcome, "answered");
    const assistant = submitted.view.messages.find(
      (message) => message.role === "assistant"
    )!;
    const parsed = parseEvidenceCardContent(assistant.content);
    assert.ok(parsed);
    assert.equal(parsed.payload.responseMode, "personal_response");
    assert.match(parsed.visibleText, /^Personal Response/);
    assert.doesNotMatch(parsed.visibleText, /Supporting Technical Evidence/);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
