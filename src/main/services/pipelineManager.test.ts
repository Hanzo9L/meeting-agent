import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PipelineManager } from "./pipelineManager";
import type { SttEvents, SttProvider } from "./sttProvider";

class FakeSttProvider implements SttProvider {
  events: SttEvents | null = null;
  finalOnStop: string | null = null;

  async start(events: SttEvents): Promise<void> {
    this.events = events;
  }

  sendAudio(): void {}

  async stop(): Promise<void> {
    if (this.finalOnStop) {
      this.events?.onFinal(this.finalOnStop);
    }
    this.events = null;
  }

  final(text: string): void {
    this.events?.onFinal(text);
  }
}

test("existing question detection promotes only accepted final transcripts", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sources: ["microphone"],
    answerTriggerMode: "questions_only"
  });
  provider.final("This is a statement.");
  provider.final("How do Calling Plans work?");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, [
    "How do Calling Plans work?"
  ]);
});

test("accepted questions are serialized instead of dropped", async () => {
  const provider = new FakeSttProvider();
  const started: string[] = [];
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    onAcceptedQuestion: async (question) => {
      started.push(question);
      if (started.length === 1) await first;
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sources: ["microphone"],
    answerTriggerMode: "all_final"
  });
  provider.final("First");
  provider.final("Second");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(started, ["First"]);
  releaseFirst();
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(started, ["First", "Second"]);
});

test("stopping capture prevents provider flush from accepting another question", async () => {
  const provider = new FakeSttProvider();
  provider.finalOnStop = "Should this be accepted?";
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sources: ["microphone"],
    answerTriggerMode: "questions_only"
  });
  await manager.stop();
  assert.deepEqual(accepted, []);
});

test("active Live Assist pipeline contains no legacy factual generator", () => {
  const source = readFileSync(
    resolve("src/main/services/pipelineManager.ts"),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /(LlmProvider|OpenAiLlmProvider|streamAnswer|getKnowledgeContext|answerChunk)/
  );
});
