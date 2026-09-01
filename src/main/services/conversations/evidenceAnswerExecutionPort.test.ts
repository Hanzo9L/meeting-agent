import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { HelpdeskService } from "./helpdeskService";
import { createSqliteConversationStore } from "./sqliteConversationStore";
import {
  EvidenceAnswerExecutionPort,
  type EvidenceLatencyEvent
} from "./evidenceAnswerExecutionPort";
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
    assert.equal(parsed.payload.liveFallback, null);
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

test("compound live plans run at most four searches and persist one deduplicated evidence card", async () => {
  const duplicateByUrl = hit(
    "shared-alias",
    "Shared architecture duplicate"
  );
  if (duplicateByUrl.ok) {
    duplicateByUrl.results[0]!.url =
      "https://learn.microsoft.com/en-us/powershell/module/teams/shared";
  }
  const client = new ScriptedClient([
    hit("shared", "Shared architecture"),
    duplicateByUrl,
    hit("exchange", "Exchange room resources"),
    hit("migration", "Teams migration")
  ]);
  const result = await new EvidenceAnswerExecutionPort(client).execute({
    conversationId: "conversation:v2.1",
    userMessageId: "message:v2.1",
    question:
      "How did Teams rooms, Exchange resources, and migration sequencing fit together?",
    presentationProfile: "live_assist_quick",
    presentationSynthesis: "disabled",
    retrievalQueries: [
      { id: "one", label: "One", query: "teams rooms" },
      { id: "two", label: "Two", query: "room architecture" },
      { id: "three", label: "Three", query: "exchange resources" },
      { id: "four", label: "Four", query: "migration sequencing" },
      { id: "five", label: "Five", query: "must not execute" }
    ]
  });

  assert.deepEqual(client.questions, [
    "teams rooms",
    "room architecture",
    "exchange resources",
    "migration sequencing"
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = parseEvidenceCardContent(result.answerText);
  assert.ok(parsed);
  assert.equal(parsed.payload.query, result.ok
    ? "How did Teams rooms, Exchange resources, and migration sequencing fit together?"
    : "");
  assert.deepEqual(
    [
      parsed.payload.primary,
      ...parsed.payload.additional
    ]
      .filter(Boolean)
      .map((source) => source!.parentId),
    ["shared", "exchange", "migration"]
  );
  assert.equal(
    result.diagnostics.factualGroundingGenerationRequests,
    0
  );
  assert.equal(
    result.diagnostics.presentationSynthesisRequests,
    0
  );
});

test("compound aggregation fails closed across incompatible corpus snapshots", async () => {
  const first = hit("first", "First");
  const second = hit("second", "Second");
  if (second.ok) second.corpusFingerprint = "different-corpus";
  const client = new ScriptedClient([first, second]);

  const result = await new EvidenceAnswerExecutionPort(client).execute({
    conversationId: "conversation:snapshot",
    userMessageId: "message:snapshot",
    question: "Compare the two systems.",
    retrievalQueries: [
      { id: "first", label: "First", query: "first system" },
      { id: "second", label: "Second", query: "second system" }
    ]
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "evidence_retrieval_failed");
  assert.match(result.userSafeMessage, /incompatible corpus snapshots/i);
});

test("live evidence receives exactly one synthesis call and persists one interview card", async () => {
  const client = new ScriptedClient([
    hit("get-csonlineuser", "Get-CsOnlineUser")
  ]);
  let synthesisCalls = 0;
  const latencyEvents: EvidenceLatencyEvent[] = [];
  const port = new EvidenceAnswerExecutionPort(client, {
    onLatencyEvent: (event) => latencyEvents.push(event),
    synthesis: {
      async synthesize(input) {
        synthesisCalls += 1;
        assert.equal(
          input.originalQuestion,
          "what does get c s online user return"
        );
        assert.equal(
          input.normalizedQuestion,
          "What does Get-CsOnlineUser return?"
        );
        assert.deepEqual(
          input.facetCoverage[0]?.evidenceIds,
          ["E1"]
        );
        return {
          directAnswer: {
            text: "It returns the requested Microsoft 365 user object.",
            evidenceIds: ["E1"]
          },
          bullets: [{
            text: "Use it to retrieve the relevant user object.",
            facetId: "cmdlet",
            evidenceIds: ["E1"]
          }],
          unsupportedFacets: [],
          confidence: "high",
          diagnostics: {
            configuredModel: "account-v2-alias",
            actualModel: "resolved-model",
            reasoningEffort: "medium",
            latencyMs: 25,
            inputTokens: 100,
            outputTokens: 30,
            totalTokens: 130,
            estimatedCostUsd: null
          }
        };
      }
    }
  });

  const result = await port.execute({
    conversationId: "conversation:synthesis",
    userMessageId: "message:synthesis",
    originalQuestion: "what does get c s online user return",
    question: "What does Get-CsOnlineUser return?",
    presentationProfile: "live_assist_quick",
    retrievalQueries: [{
      id: "cmdlet",
      label: "Cmdlet return value",
      query: "Get-CsOnlineUser return value"
    }]
  });

  assert.equal(synthesisCalls, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = parseEvidenceCardContent(result.answerText);
  assert.ok(parsed?.payload.interviewAnswer);
  assert.match(
    parsed.visibleText,
    /^It returns the requested Microsoft 365 user object\./
  );
  assert.equal(result.diagnostics.presentationSynthesisRequests, 1);
  assert.equal(result.diagnostics.presentationSynthesisStatus, "succeeded");
  assert.equal(
    result.diagnostics.interviewSynthesis?.actualModel,
    "resolved-model"
  );
  assert.deepEqual(
    latencyEvents.map((event) => event.event),
    [
      "retrieval_started",
      "retrieval_completed",
      "synthesis_started",
      "synthesis_completed"
    ]
  );
  assert.equal(
    latencyEvents.every(
      (event, index) =>
        index === 0 ||
        event.timestampMs >= latencyEvents[index - 1]!.timestampMs
    ),
    true
  );
  assert.equal(latencyEvents[3]?.inputTokens, 100);
  assert.equal(latencyEvents[3]?.outputTokens, 30);
});

test("one failed live synthesis call renders one compact card with collapsed-source payload", async () => {
  const client = new ScriptedClient([
    hit("get-csonlineuser", "Get-CsOnlineUser")
  ]);
  let synthesisCalls = 0;
  const port = new EvidenceAnswerExecutionPort(client, {
    synthesis: {
      async synthesize() {
        synthesisCalls += 1;
        throw new Error("provider_rejected_model");
      }
    }
  });
  const result = await port.execute({
    conversationId: "conversation:fallback",
    userMessageId: "message:fallback",
    question: "What does Get-CsOnlineUser return?",
    presentationProfile: "live_assist_quick"
  });

  assert.equal(synthesisCalls, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = parseEvidenceCardContent(result.answerText);
  assert.equal(parsed?.payload.interviewAnswer, null);
  assert.deepEqual(parsed?.payload.liveFallback, {
    message: "Answer synthesis unavailable.",
    status: "Authoritative evidence available — expand sources."
  });
  assert.equal(parsed?.visibleText, [
    "Answer synthesis unavailable.",
    "Authoritative evidence available — expand sources."
  ].join("\n"));
  assert.doesNotMatch(parsed?.visibleText ?? "", /Microsoft Evidence/);
  assert.doesNotMatch(parsed?.visibleText ?? "", /Get-CsOnlineUser/);
  assert.equal(parsed?.payload.primary?.title, "Get-CsOnlineUser");
  assert.equal(
    result.diagnostics.presentationSynthesisStatus,
    "provider_failed"
  );
  assert.deepEqual(
    parseEvidenceCardContent(result.answerText)?.payload.synthesis,
    {
      attempted: true,
      status: "provider_failed",
      model: null,
      fallbackReason: "provider_rejected_model"
    }
  );
});

test("live insufficient evidence renders a compact status without document previews", async () => {
  const client = new ScriptedClient([{
    ok: true,
    query: "Unknown live question",
    route: {
      confidence: "NONE",
      service: null,
      repo: null,
      reason: "no_match"
    },
    results: [],
    timing: { total_ms: 1 },
    topK: 5,
    engine: "learn-rag-r0.4",
    corpusFingerprint: "corpus",
    indexFingerprint: "index"
  }]);
  const result = await new EvidenceAnswerExecutionPort(client).execute({
    conversationId: "conversation:insufficient",
    userMessageId: "message:insufficient",
    question: "Unknown live question",
    presentationProfile: "live_assist_quick"
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const parsed = parseEvidenceCardContent(result.answerText);
  assert.equal(parsed?.visibleText, "Answer synthesis unavailable.");
  assert.deepEqual(parsed?.payload.liveFallback, {
    message: "Answer synthesis unavailable.",
    status: null
  });
  assert.equal(
    result.diagnostics.presentationSynthesisStatus,
    "bypassed_insufficient_evidence"
  );
});

test("missing model skips synthesis and persists an explicit fallback reason", async () => {
  const client = new ScriptedClient([
    hit("get-csonlineuser", "Get-CsOnlineUser")
  ]);
  let synthesisCalls = 0;
  const port = new EvidenceAnswerExecutionPort(client, {
    synthesis: {
      getReadiness: () => ({
        state: "misconfigured",
        model: null,
        semanticReady: false,
        synthesisReady: false,
        reason: "model_not_configured"
      }),
      async synthesize() {
        synthesisCalls += 1;
        throw new Error("must not be called");
      }
    }
  });

  const result = await port.execute({
    conversationId: "conversation:missing-model",
    userMessageId: "message:missing-model",
    question: "What does Get-CsOnlineUser return?",
    presentationProfile: "live_assist_quick"
  });

  assert.equal(result.ok, true);
  assert.equal(synthesisCalls, 0);
  if (!result.ok) return;
  assert.equal(
    result.diagnostics.presentationSynthesisStatus,
    "not_configured"
  );
  assert.equal(
    result.diagnostics.presentationSynthesisFallbackReason,
    "model_not_configured"
  );
  assert.deepEqual(
    parseEvidenceCardContent(result.answerText)?.payload.synthesis,
    {
      attempted: false,
      status: "not_configured",
      model: null,
      fallbackReason: "model_not_configured"
    }
  );
});
