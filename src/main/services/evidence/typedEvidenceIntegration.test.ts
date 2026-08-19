import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { performance } from "node:perf_hooks";
import { HelpdeskService } from "../conversations/helpdeskService";
import { EvidenceAnswerExecutionPort } from "../conversations/evidenceAnswerExecutionPort";
import { createSqliteConversationStore } from "../conversations/sqliteConversationStore";
import { createEvidenceSearchClient } from "./evidenceSearchClient";
import { LearnRagChild } from "./learnRagChild";
import { parseEvidenceCardContent } from "@shared/evidenceCard";

const QUESTIONS = {
  T1: "Explain the Direct Routing chain from voice-routing policy to PSTN usage to voice route to SBC/gateway.",
  T2: "How would you use PowerShell to audit Teams Voice users and their voice configuration?",
  T3: "What would you secure or review in SharePoint and OneDrive before rolling out Microsoft 365 Copilot?",
  T4: "How would you troubleshoot one-way audio on a Teams Direct Routing call?",
  T5: "What does Get-CsOnlineUser return?"
};

const child = new LearnRagChild({ startTimeoutMs: 120_000 });
const client = createEvidenceSearchClient(child);
let coldMs = 0;

function blob(result: Awaited<ReturnType<typeof client.search>>): string {
  if (!result.ok) return "";
  return result.results
    .map((hit) => `${hit.title}\n${hit.section}\n${hit.body}`)
    .join("\n")
    .toLowerCase();
}

before(async () => {
  const started = performance.now();
  await child.start();
  coldMs = performance.now() - started;
  console.info(`[evidence-i1] python cold startup/warmup ${Math.round(coldMs)}ms`);
  const ready = child.getReadyInfo();
  assert.equal(ready?.searchHash, "252e9b3ced85b9b0");
  assert.equal(ready?.scopeHash, "2a8caaabd00f4b08");
});

after(async () => {
  child.dispose();
  await child.waitUntilStopped();
});

test("T1 routing chain evidence is present", { timeout: 30_000 }, async () => {
  const started = performance.now();
  const result = await client.search(QUESTIONS.T1);
  console.info(`[evidence-i1] T1 warm retrieval ${Math.round(performance.now() - started)}ms`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.topK, 5);
  assert.match(blob(result), /voice routing|pstn usage|direct routing|session border|sbc/i);
});

test("T2 PowerShell uses R0.4 HIGH scope and Get-CsOnlineUser", { timeout: 30_000 }, async () => {
  const result = await client.search(QUESTIONS.T2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.route.confidence, "HIGH");
  assert.equal(result.route.service, "msteams-ps");
  assert.equal(result.route.repo, "teams-ps");
  assert.match(blob(result), /get-csonlineuser/i);
});

test("T3 Copilot governance evidence is present", { timeout: 30_000 }, async () => {
  const result = await client.search(QUESTIONS.T3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(
    blob(result),
    /sharepoint|onedrive|copilot|advanced management|oversharing|sensitivity/i
  );
});

test("T4 one-way audio presents evidence only", { timeout: 30_000 }, async () => {
  const result = await client.search(QUESTIONS.T4);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  if (result.results.length === 0) return;
  const persisted = (await import("./evidenceCardBuilder")).persistEvidenceCard(result);
  assert.match(persisted.content, /Evidence/);
  assert.doesNotMatch(persisted.content, /This answers your question/);
  assert.doesNotMatch(persisted.content, /No direct authoritative guidance found/);
  assert.ok(
    persisted.payload.primary!.body.startsWith(persisted.payload.primary!.preview)
  );
});

test("T5 narrow cmdlet uses PowerShell route", { timeout: 30_000 }, async () => {
  const result = await client.search(QUESTIONS.T5);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.route.confidence, "HIGH");
  assert.equal(result.route.service, "msteams-ps");
  assert.match(blob(result), /get-csonlineuser/i);
});

test(
  "typed Helpdesk T1/T2 isolate turns, persist citations, and survive reload",
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-evidence-typed-"));
    const databasePath = join(root, "conversations.sqlite");
    const store = createSqliteConversationStore({ databasePath });
    const service = new HelpdeskService(
      store,
      new EvidenceAnswerExecutionPort(client)
    );
    try {
      const conversation = service.createConversation("Typed evidence");
      const submitStarted = performance.now();
      const first = await service.submitMessage({
        conversationId: conversation.conversation.id,
        content: QUESTIONS.T1,
        inputOrigin: "typed"
      });
      const firstMs = performance.now() - submitStarted;
      const secondStarted = performance.now();
      const second = await service.submitMessage({
        conversationId: conversation.conversation.id,
        content: QUESTIONS.T2,
        inputOrigin: "typed"
      });
      console.info(
        `[evidence-i1] typed T1 persist ${Math.round(firstMs)}ms; T2 persist ${Math.round(performance.now() - secondStarted)}ms`
      );
      assert.equal(first.outcome, "answered");
      assert.equal(second.outcome, "answered");
      const firstRun = first.view.answerRuns[0]!;
      const secondRun = second.view.answerRuns[1]!;
      assert.notEqual(firstRun.id, secondRun.id);
      assert.notEqual(firstRun.assistantMessageId, secondRun.assistantMessageId);
      const firstAssistant = first.view.messages.find(
        (message) => message.id === firstRun.assistantMessageId
      )!;
      const secondAssistant = second.view.messages.find(
        (message) => message.id === secondRun.assistantMessageId
      )!;
      assert.ok(parseEvidenceCardContent(firstAssistant.content));
      assert.ok(parseEvidenceCardContent(secondAssistant.content));
      assert.notEqual(firstAssistant.content, secondAssistant.content);
      assert.ok(firstAssistant.citations.length > 0);
      assert.ok(secondAssistant.citations.length > 0);
      assert.notEqual(
        firstAssistant.citations[0]?.citationId,
        secondAssistant.citations[0]?.citationId
      );
      store.close();
      const reloadedStore = createSqliteConversationStore({ databasePath });
      const reloaded = new HelpdeskService(
        reloadedStore,
        new EvidenceAnswerExecutionPort(client)
      ).loadConversation(conversation.conversation.id);
      assert.equal(reloaded.messages[0]?.content, first.view.messages[0]?.content);
      assert.equal(
        reloaded.messages.find((message) => message.id === firstAssistant.id)
          ?.content,
        firstAssistant.content
      );
      assert.equal(
        reloaded.messages.find((message) => message.id === secondAssistant.id)
          ?.citations[0]?.documentId,
        secondAssistant.citations[0]?.documentId
      );
      reloadedStore.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
