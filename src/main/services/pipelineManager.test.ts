import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PipelineManager } from "./pipelineManager";
import type { SttEvents, SttProvider } from "./sttProvider";

class FakeSttProvider implements SttProvider {
  events: SttEvents | null = null;
  finalOnStop: string | null = null;
  private sequence = 0;

  async start(events: SttEvents): Promise<void> {
    this.events = events;
  }

  sendAudio(): void {}

  async stop(): Promise<void> {
    if (this.finalOnStop) {
      this.utterance(this.finalOnStop);
    }
    this.events = null;
  }

  interim(text: string): void {
    this.events?.onInterim(text);
  }

  utterance(text: string, utteranceId?: string): void {
    this.sequence += 1;
    this.events?.onUtterance({
      utteranceId:
        utteranceId ?? `fake-utterance:${this.sequence}`,
      text,
      completionSignal: "utterance_end",
      segmentCount: 1,
      sourceStartSeconds: this.sequence,
      sourceEndSeconds: this.sequence + 0.5,
      speechFinalObserved: true
    });
  }
}

test("question detection promotes only completed utterances", async () => {
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
  provider.interim("How do Microsoft");
  provider.utterance("This is a statement.");
  provider.utterance("How do Calling Plans work?");
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
  provider.utterance("First");
  provider.utterance("Second");
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

test("one completed utterance ID is promoted at most once", async () => {
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

  provider.utterance(
    "How do Microsoft Teams Calling Plans work?",
    "utterance:one"
  );
  provider.utterance(
    "How do Microsoft Teams Calling Plans work?",
    "utterance:one"
  );
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );

  assert.deepEqual(accepted, [
    "How do Microsoft Teams Calling Plans work?"
  ]);
});

test("the same question in a later utterance remains eligible", async () => {
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

  provider.utterance("How do Calling Plans work?", "utterance:first");
  provider.utterance("How do Calling Plans work?", "utterance:later");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );

  assert.deepEqual(accepted, [
    "How do Calling Plans work?",
    "How do Calling Plans work?"
  ]);
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
