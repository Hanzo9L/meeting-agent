import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureSourceTag } from "@shared/types";
import {
  CROSS_SOURCE_ARBITRATION_WINDOW_MS,
  CrossSourceUtteranceArbiter,
  transcriptSimilarity,
  type CrossSourceArbitrationDiagnostic,
  type SourceCompletedUtterance
} from "./crossSourceUtteranceArbiter";
import type { CompletedSttUtterance } from "./sttProvider";

class FakeScheduler {
  nowMs = 1000;
  private nextId = 1;
  private readonly tasks = new Map<
    number,
    { dueAt: number; callback: () => void }
  >();

  now = (): number => this.nowMs;

  set = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, {
      dueAt: this.nowMs + delayMs,
      callback
    });
    return id;
  };

  clear = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  advance(milliseconds: number): void {
    this.nowMs += milliseconds;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= this.nowMs)
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.dueAt - right.dueAt || leftId - rightId
        )[0];
      if (!next) return;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
  }
}

function utterance(
  id: string,
  text: string,
  sourceEndSeconds = 5
): CompletedSttUtterance {
  return {
    utteranceId: id,
    text,
    completionSignal: "utterance_end",
    segmentCount: 1,
    sourceStartSeconds: sourceEndSeconds - 1,
    sourceEndSeconds,
    speechFinalObserved: true
  };
}

function fixture(bothMode = true) {
  const scheduler = new FakeScheduler();
  const accepted: SourceCompletedUtterance[] = [];
  const diagnostics: CrossSourceArbitrationDiagnostic[] = [];
  const arbiter = new CrossSourceUtteranceArbiter({
    sessionId: "live:test",
    bothMode,
    accept: (input) => accepted.push(input),
    diagnostic: (diagnostic) => diagnostics.push(diagnostic),
    scheduler
  });
  const submit = (
    source: CaptureSourceTag,
    id: string,
    text: string,
    sourceEndSeconds = 5
  ) =>
    arbiter.submit({
      source,
      utterance: utterance(id, text, sourceEndSeconds),
      completedAtMs: scheduler.now()
    });
  return { scheduler, accepted, diagnostics, arbiter, submit };
}

test("overlapping identical microphone/system utterances accept only system", () => {
  const context = fixture();
  context.submit(
    "microphone",
    "mic:1",
    "How do Microsoft Teams calling plans work?"
  );
  context.scheduler.advance(316);
  context.submit(
    "system",
    "system:1",
    "How do Microsoft Teams calling plans work?"
  );

  assert.deepEqual(
    context.accepted.map((item) => item.source),
    ["system"]
  );
  assert.equal(context.diagnostics[0]?.outcome, "duplicate_suppressed");
  assert.equal(context.diagnostics[0]?.suppressedSource, "microphone");
  assert.equal(context.diagnostics[0]?.completionDeltaMs, 316);
  assert.equal(context.diagnostics[0]?.similarity, 1);
});

test("minor deterministic STT variation still deduplicates", () => {
  const context = fixture();
  context.submit(
    "microphone",
    "mic:variation",
    "How do my Teams calling plans work?"
  );
  context.scheduler.advance(250);
  context.submit(
    "system",
    "system:variation",
    "How do Microsoft Teams calling plans work?"
  );

  assert.ok(
    Math.abs(
      transcriptSimilarity(
      "How do my Teams calling plans work?",
      "How do Microsoft Teams calling plans work?"
      ) -
        6 / 7
    ) < Number.EPSILON
  );
  assert.equal(context.accepted.length, 1);
  assert.equal(context.accepted[0]?.source, "system");
});

test("different simultaneous utterances are both preserved in completion order", () => {
  const context = fixture();
  context.submit(
    "microphone",
    "mic:meetings",
    "Which policy controls meetings?",
    5
  );
  context.scheduler.advance(100);
  context.submit(
    "system",
    "system:calling",
    "What is a Calling Plan?",
    5.05
  );

  context.scheduler.advance(
    CROSS_SOURCE_ARBITRATION_WINDOW_MS - 100
  );
  assert.deepEqual(
    context.accepted.map((item) => item.utterance.utteranceId),
    ["mic:meetings"]
  );
  context.scheduler.advance(100);
  assert.deepEqual(
    context.accepted.map((item) => item.utterance.utteranceId),
    ["mic:meetings", "system:calling"]
  );
});

test("the same duplicated question asked later is accepted again", () => {
  const context = fixture();
  context.submit("microphone", "mic:first", "What is a Calling Plan?");
  context.scheduler.advance(200);
  context.submit("system", "system:first", "What is a Calling Plan?");
  context.scheduler.advance(
    CROSS_SOURCE_ARBITRATION_WINDOW_MS + 1
  );
  context.submit("microphone", "mic:later", "What is a Calling Plan?", 20);
  context.scheduler.advance(200);
  context.submit("system", "system:later", "What is a Calling Plan?", 20);

  assert.deepEqual(
    context.accepted.map((item) => item.utterance.utteranceId),
    ["system:first", "system:later"]
  );
});

test("microphone-only and system-only modes add no arbitration delay", () => {
  for (const source of ["microphone", "system"] as const) {
    const context = fixture(false);
    context.submit(source, `${source}:single`, "What is a Calling Plan?");
    assert.equal(context.accepted.length, 1);
    assert.equal(
      context.diagnostics[0]?.reason,
      "single_source_mode"
    );
    assert.equal(
      context.diagnostics[0]?.arbitrationDelayMs,
      0
    );
  }
});

test("both-mode arbitration delay is bounded by the centralized window", () => {
  const context = fixture();
  context.submit("microphone", "mic:only", "Which policy applies?");
  context.scheduler.advance(
    CROSS_SOURCE_ARBITRATION_WINDOW_MS - 1
  );
  assert.equal(context.accepted.length, 0);
  context.scheduler.advance(1);
  assert.equal(context.accepted.length, 1);
  assert.equal(
    context.diagnostics[0]?.arbitrationDelayMs,
    CROSS_SOURCE_ARBITRATION_WINDOW_MS
  );
});

test("word timing incompatibility prevents a false duplicate", () => {
  const context = fixture();
  context.submit(
    "microphone",
    "mic:timing",
    "What is a Calling Plan?",
    2
  );
  context.scheduler.advance(100);
  context.submit(
    "system",
    "system:timing",
    "What is a Calling Plan?",
    8
  );
  context.scheduler.advance(CROSS_SOURCE_ARBITRATION_WINDOW_MS);

  assert.equal(context.accepted.length, 2);
});

test("Stop clears pending arbitration without accepting it", () => {
  const context = fixture();
  context.submit(
    "microphone",
    "mic:pending",
    "Should this be accepted?"
  );
  context.scheduler.advance(100);
  context.arbiter.stop();
  context.scheduler.advance(CROSS_SOURCE_ARBITRATION_WINDOW_MS);

  assert.equal(context.accepted.length, 0);
  assert.equal(context.diagnostics[0]?.outcome, "cleared_on_stop");
});

