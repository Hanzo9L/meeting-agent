import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepgramUtteranceAssembler,
  DeepgramUtteranceProcessor
} from "./deepgramUtteranceAssembler";

test("Deepgram is_final and speech_final wait for UtteranceEnd", () => {
  const processor = new DeepgramUtteranceProcessor();
  const first = processor.process({
    type: "Results",
    is_final: true,
    speech_final: true,
    start: 1,
    duration: 0.8,
    channel: {
      alternatives: [{ transcript: "How do Microsoft" }]
    }
  });
  const second = processor.process({
    type: "Results",
    is_final: true,
    speech_final: true,
    start: 1.8,
    duration: 1,
    channel: {
      alternatives: [
        { transcript: "Teams calling plans work?" }
      ]
    }
  });

  assert.equal(first.completedUtterance, null);
  assert.equal(second.completedUtterance, null);
  const completed = processor.process({ type: "UtteranceEnd" });
  assert.equal(
    completed.completedUtterance?.text,
    "How do Microsoft Teams calling plans work?"
  );
  assert.equal(
    processor.process({ type: "UtteranceEnd" })
      .completedUtterance,
    null
  );
});

test("Deepgram interim results update presentation without completion", () => {
  const processor = new DeepgramUtteranceProcessor();
  const result = processor.process({
    type: "Results",
    is_final: false,
    channel: {
      alternatives: [{ transcript: "How do Microsoft" }]
    }
  });

  assert.equal(result.interimText, "How do Microsoft");
  assert.equal(result.completedUtterance, null);
});

test("is_final fragments remain buffered until utterance completion", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "How do Microsoft",
    start: 1,
    duration: 0.8
  });

  assert.equal(assembler.bufferedText, "How do Microsoft");
});

test("ordered finalized fragments form one completed utterance", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "How do Microsoft",
    start: 1,
    duration: 0.8
  });
  assembler.observeSpeechFinal();
  assembler.addFinalSegment({
    text: "Teams calling plans work?",
    start: 1.8,
    duration: 1
  });

  const utterance = assembler.complete("utterance_end");
  assert.equal(
    utterance?.text,
    "How do Microsoft Teams calling plans work?"
  );
  assert.equal(utterance?.segmentCount, 2);
  assert.equal(utterance?.speechFinalObserved, true);
});

test("speech_final mode can complete the buffered utterance without segment promotion", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "What does Calling Plans mean?",
    start: 2,
    duration: 1
  });
  assembler.observeSpeechFinal();

  const utterance = assembler.complete("speech_final");
  assert.equal(
    utterance?.text,
    "What does Calling Plans mean?"
  );
  assert.equal(utterance?.completionSignal, "speech_final");
});

test("UtteranceEnd completes an utterance without speech_final", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "Which cmdlet assigns the policy?",
    start: 3,
    duration: 1
  });

  const utterance = assembler.complete("utterance_end");
  assert.equal(
    utterance?.text,
    "Which cmdlet assigns the policy?"
  );
  assert.equal(utterance?.speechFinalObserved, false);
});

test("speech_final followed by UtteranceEnd cannot complete twice", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "How does Direct Routing work?",
    start: 4,
    duration: 1
  });
  assembler.observeSpeechFinal();

  const first = assembler.complete("utterance_end");
  const duplicate = assembler.complete("utterance_end");
  assert.equal(first?.text, "How does Direct Routing work?");
  assert.equal(duplicate, null);
});

test("overlapping or repeated timed segments do not duplicate words", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "How do Microsoft Teams",
    start: 5,
    duration: 1
  });
  assembler.addFinalSegment({
    text: "Microsoft Teams Calling Plans work?",
    start: 6,
    duration: 1
  });
  assembler.addFinalSegment({
    text: "Microsoft Teams Calling Plans work?",
    start: 6,
    duration: 1
  });

  assert.equal(
    assembler.complete("utterance_end")?.text,
    "How do Microsoft Teams Calling Plans work?"
  );
});

test("separate utterances and repeated later questions get distinct identities", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "How do Calling Plans work?"
  });
  const first = assembler.complete("utterance_end");
  assembler.addFinalSegment({
    text: "How do Calling Plans work?"
  });
  const second = assembler.complete("utterance_end");

  assert.equal(first?.text, second?.text);
  assert.notEqual(first?.utteranceId, second?.utteranceId);
});

test("clear discards a pending utterance without promotion", () => {
  const assembler = new DeepgramUtteranceAssembler();
  assembler.addFinalSegment({
    text: "Should this pending fragment",
    start: 30,
    duration: 1
  });
  assembler.clear();

  assert.equal(assembler.bufferedText, "");
  assert.equal(assembler.complete("utterance_end"), null);
});

