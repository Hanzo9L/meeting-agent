import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { performance } from "node:perf_hooks";
import {
  formatEvidenceCardHeading,
  listEvidenceCardSources,
  parseEvidenceCardContent
} from "@shared/evidenceCard";
import { HelpdeskService } from "../conversations/helpdeskService";
import { LiveAssistService } from "../conversations/liveAssistService";
import { EvidenceAnswerExecutionPort } from "../conversations/evidenceAnswerExecutionPort";
import { createSqliteConversationStore } from "../conversations/sqliteConversationStore";
import { createEvidenceSearchClient } from "./evidenceSearchClient";
import { LearnRagChild } from "./learnRagChild";

const QUESTIONS = {
  L1: "A user can use Teams but cannot call external numbers. How do you troubleshoot?",
  L2: "Explain Direct Routing and how the SBC fits into the call flow.",
  L3: "How would you configure an AudioCodes Mediant SBC for Teams Direct Routing?",
  L4: "A user is complaining of poor audio. How would you determine where the problem is?",
  L5: "What does Get-CsOnlineUser return?",
  L6: "A Linux service is failing intermittently. How would you investigate it?",
  Q1: "Explain Direct Routing and the role of the SBC.",
  Q2: "What does the certificate do?",
  Q3: "What happens if the SBC fails?"
};

const child = new LearnRagChild({ startTimeoutMs: 120_000 });
const client = createEvidenceSearchClient(child);
const latencies: number[] = [];
const notes: Record<string, unknown> = {};

before(async () => {
  const started = performance.now();
  assert.equal(child.getStatus(), "starting");
  const warming = child.start();
  assert.equal(child.getStatus(), "warming");
  await warming;
  notes.coldStartMs = Math.round(performance.now() - started);
  assert.equal(child.getStatus(), "ready");
  assert.equal(child.getReadyInfo()?.searchHash, "252e9b3ced85b9b0");
  assert.equal(child.getReadyInfo()?.scopeHash, "2a8caaabd00f4b08");
});

after(async () => {
  child.dispose();
  await child.waitUntilStopped();
  mkdirSync("eval/runs/live-i8", { recursive: true });
  writeFileSync(
    "eval/runs/live-i8/latency.json",
    JSON.stringify({ latencies, notes }, null, 2)
  );
});

async function ask(question: string) {
  const root = await mkdtemp(join(tmpdir(), "relay-i8-live-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const helpdesk = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  const live = new LiveAssistService(store, helpdesk, {
    sessionChanged() {},
    projectionChanged() {},
    conversationUpdated() {}
  });
  const conversation = store.createConversation({ title: question.slice(0, 40) });
  live.start(conversation.id, "qa_assist");
  const started = performance.now();
  await live.acceptQuestion(question, "system");
  const elapsed = performance.now() - started;
  latencies.push(elapsed);
  const view = helpdesk.loadConversation(conversation.id);
  store.close();
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  return { view, elapsed };
}

function publishersOf(content: string): string[] {
  const parsed = parseEvidenceCardContent(content);
  if (!parsed) return [];
  return listEvidenceCardSources(parsed.payload).map(
    (source) => source.publisher
  );
}

function blob(content: string): string {
  const parsed = parseEvidenceCardContent(content);
  if (!parsed) return content.toLowerCase();
  return listEvidenceCardSources(parsed.payload)
    .map((source) => `${source.title}\n${source.section}\n${source.body}\n${source.url}`)
    .join("\n")
    .toLowerCase();
}

test("L1 Teams Voice / Direct Routing evidence", { timeout: 30_000 }, async () => {
  const { view } = await ask(QUESTIONS.L1);
  const assistant = view.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  assert.match(
    blob(assistant.content),
    /direct routing|calling plan|voice route|pstn|session border|sbc|operator connect/i
  );
  notes.L1 = {
    publishers: publishersOf(assistant.content),
    heading: formatEvidenceCardHeading(parseEvidenceCardContent(assistant.content)!.payload)
  };
});

test("L2 Direct Routing / SBC, Microsoft and possibly AudioCodes", { timeout: 30_000 }, async () => {
  const { view } = await ask(QUESTIONS.L2);
  const assistant = view.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  const publishers = publishersOf(assistant.content);
  assert.ok(publishers.includes("Microsoft") || publishers.includes("AudioCodes"));
  assert.match(blob(assistant.content), /direct routing|sbc|session border/i);
  const parsed = parseEvidenceCardContent(assistant.content)!;
  const audiocodes = listEvidenceCardSources(parsed.payload).filter(
    (source) => source.publisher === "AudioCodes"
  );
  for (const source of audiocodes) {
    assert.notEqual(source.publisher, "Microsoft");
    assert.match(source.url, /audiocodes\.com/i);
  }
  notes.L2 = {
    publishers,
    heading: formatEvidenceCardHeading(parsed.payload)
  };
});

test("L3 AudioCodes provenance is visible", { timeout: 30_000 }, async () => {
  const { view } = await ask(QUESTIONS.L3);
  const assistant = view.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  const parsed = parseEvidenceCardContent(assistant.content);
  assert.ok(parsed);
  const sources = listEvidenceCardSources(parsed.payload);
  const vendor = sources.filter((source) => source.publisher === "AudioCodes");
  assert.ok(vendor.length > 0, "expected at least one AudioCodes source");
  for (const source of vendor) {
    assert.notEqual(source.publisher, "Microsoft");
    assert.equal(source.sourceRole, "vendor_implementation_reference");
  }
  notes.L3 = {
    publishers: sources.map((source) => source.publisher),
    heading: formatEvidenceCardHeading(parsed.payload)
  };
});

test("L4 poor audio / Call Analytics or CQD evidence", { timeout: 30_000 }, async () => {
  const { view } = await ask(QUESTIONS.L4);
  const assistant = view.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  assert.match(
    blob(assistant.content),
    /call analytics|cqd|quality|one-way|audio|jitter|packet|call quality/i
  );
  notes.L4 = {
    publishers: publishersOf(assistant.content),
    heading: formatEvidenceCardHeading(parseEvidenceCardContent(assistant.content)!.payload)
  };
});

test("L5 Get-CsOnlineUser PowerShell evidence", { timeout: 30_000 }, async () => {
  const { view } = await ask(QUESTIONS.L5);
  const assistant = view.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  assert.match(blob(assistant.content), /get-csonlineuser/i);
  notes.L5 = {
    publishers: publishersOf(assistant.content),
    heading: formatEvidenceCardHeading(parseEvidenceCardContent(assistant.content)!.payload)
  };
});

test("L6 Linux upstream evidence is allowed and not Microsoft-labeled", { timeout: 30_000 }, async () => {
  const { view } = await ask(QUESTIONS.L6);
  const assistant = view.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  const parsed = parseEvidenceCardContent(assistant.content);
  assert.ok(parsed);
  const sources = listEvidenceCardSources(parsed.payload);
  const linux = sources.filter((source) => source.publisher === "Linux");
  assert.ok(
    linux.length > 0 ||
      /journalctl|systemctl|systemd|man7\.org|freedesktop/.test(blob(assistant.content)),
    "expected Linux upstream evidence"
  );
  for (const source of linux) {
    assert.notEqual(source.publisher, "Microsoft");
    assert.doesNotMatch(source.url, /learn\.microsoft\.com/);
  }
  notes.L6 = {
    publishers: sources.map((source) => source.publisher),
    heading: formatEvidenceCardHeading(parsed.payload)
  };
});

test("rapid Q1/Q2/Q3 stay independent durable live turns", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-i8-rapid-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const helpdesk = new HelpdeskService(
    store,
    new EvidenceAnswerExecutionPort(client)
  );
  const live = new LiveAssistService(store, helpdesk, {
    sessionChanged() {},
    projectionChanged() {},
    conversationUpdated() {}
  });
  try {
    const conversation = store.createConversation({ title: "I8 rapid live" });
    live.start(conversation.id, "qa_assist");
    await live.acceptQuestion(QUESTIONS.Q1, "system");
    await live.acceptQuestion(QUESTIONS.Q2, "system");
    await live.acceptQuestion(QUESTIONS.Q3, "system");
    const view = helpdesk.loadConversation(conversation.id);
    const users = view.messages.filter((message) => message.role === "user");
    const assistants = view.messages.filter((message) => message.role === "assistant");
    assert.equal(users.length, 3);
    assert.equal(assistants.length, 3);
    assert.equal(view.answerRuns.length, 3);
    assert.equal(new Set(view.answerRuns.map((run) => run.id)).size, 3);
    assert.notEqual(assistants[0]?.content, assistants[1]?.content);
    notes.rapid = {
      q2Standalone: blob(assistants[1]?.content ?? "").includes("certificate"),
      q2Note:
        "Q2 treated independently. Weak standalone certificate context is a future follow-up issue, not solved in I8."
    };
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
