import assert from "node:assert/strict";
import test from "node:test";
import {
  LiveQuestionCompletionCoordinator
} from "./liveQuestionCompletionCoordinator";
import {
  QuestionUnderstandingFailure
} from "./questionUnderstandingPort";
import type {
  QuestionUnderstandingInput,
  QuestionUnderstandingPort,
  QuestionUnderstandingResult
} from "./questionUnderstandingPort";
import type { SourceCompletedUtterance } from "./crossSourceUtteranceArbiter";

class ScriptedUnderstanding implements QuestionUnderstandingPort {
  readonly inputs: QuestionUnderstandingInput[] = [];

  constructor(
    private readonly results: QuestionUnderstandingResult[]
  ) {}

  async understand(
    input: QuestionUnderstandingInput
  ): Promise<QuestionUnderstandingResult> {
    this.inputs.push(input);
    return this.results.shift() ?? {
      decision: "continue",
      confidence: 0,
      reason: "no scripted result"
    };
  }
}

function utterance(
  sequence: number,
  text: string
): SourceCompletedUtterance {
  return {
    sessionId: "live:v2.1",
    source: "system",
    completedAtMs: sequence * 1_000,
    utterance: {
      utteranceId: `utterance:${sequence}`,
      text,
      completionSignal: "utterance_end",
      segmentCount: 1,
      sourceStartSeconds: sequence,
      sourceEndSeconds: sequence + 0.5,
      speechFinalObserved: true
    }
  };
}

test("retains deterministic fragments without spending a semantic call", async () => {
  const understanding = new ScriptedUnderstanding([]);
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  const outcome = await coordinator.submit(
    utterance(1, "How do Microsoft Teams")
  );

  assert.equal(outcome.state, "continue");
  assert.equal(
    outcome.state === "continue" && outcome.semanticCallMade,
    false
  );
  assert.equal(understanding.inputs.length, 0);
});

test("a narrow deterministic predicate cannot strand a multi-utterance thought", async () => {
  const understanding = new ScriptedUnderstanding([{
    decision: "complete",
    normalizedQuestion:
      "How did you implement Teams and migrate room accounts?",
    facets: [{
      id: "implementation",
      label: "Implementation and migration",
      query: "Teams implementation and room account migration"
    }],
    confidence: 0.9,
    reason: "The second utterance completes the request."
  }]);
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  await coordinator.submit(
    utterance(1, "How did you implement Teams")
  );
  const outcome = await coordinator.submit(
    utterance(2, "and migrate the room accounts")
  );

  assert.equal(outcome.state, "complete");
  assert.equal(understanding.inputs.length, 1);
  assert.equal(understanding.inputs[0]?.utteranceCount, 2);
});

test("accumulates utterance-end fragments until semantic completion", async () => {
  const understanding = new ScriptedUnderstanding([
    {
      decision: "continue",
      confidence: 0.92,
      reason: "The request still has a dangling because clause."
    },
    {
      decision: "complete",
      normalizedQuestion:
        "How did you implement Teams for large conference rooms, and how did Exchange room resource accounts fit into the migration?",
      facets: [
        {
          id: "teams-rooms",
          label: "Teams conference-room implementation",
          query:
            "Microsoft Teams implementation for large conference rooms"
        },
        {
          id: "exchange-resources",
          label: "Exchange room resources",
          query:
            "Exchange room resource accounts in a Teams migration"
        }
      ],
      confidence: 0.96,
      reason: "The implementation and migration requests are complete."
    }
  ]);
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  const first = await coordinator.submit(
    utterance(
      1,
      "Tell me how you implemented Teams because we have a large conference room environment"
    )
  );
  const second = await coordinator.submit(
    utterance(
      2,
      "and how did Exchange and the room resource accounts fit into that migration"
    )
  );

  assert.equal(first.state, "continue");
  assert.equal(second.state, "complete");
  assert.equal(understanding.inputs.length, 2);
  assert.match(
    understanding.inputs[1]!.text,
    /implemented Teams.*Exchange.*room resource accounts/
  );
  assert.equal(understanding.inputs[1]!.utteranceCount, 2);
  assert.equal(
    second.state === "complete"
      ? second.result.facets?.length
      : 0,
    2
  );
});

test("understanding failure keeps the current thought for a retry", async () => {
  let attempts = 0;
  const understanding: QuestionUnderstandingPort = {
    async understand(input) {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return {
        decision: "complete",
        normalizedQuestion: input.text,
        facets: [{
          id: "whole-question",
          label: "Whole question",
          query: input.text
        }],
        confidence: 0.8,
        reason: "Complete after retry."
      };
    }
  };
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  const failed = await coordinator.submit(
    utterance(1, "Explain Direct Routing architecture")
  );
  const retried = await coordinator.submit(
    utterance(2, "including the SBC role")
  );

  assert.equal(failed.state, "error");
  assert.equal(retried.state, "complete");
  assert.match(
    retried.state === "complete"
      ? retried.result.normalizedQuestion
      : "",
    /Direct Routing architecture including the SBC role/
  );
});

test("permanent provider failure resets the thought before the next question", async () => {
  let attempts = 0;
  const understanding: QuestionUnderstandingPort = {
    async understand(input) {
      attempts += 1;
      if (attempts === 1) {
        throw new QuestionUnderstandingFailure(
          "model_not_configured",
          "permanent"
        );
      }
      return {
        decision: "complete",
        normalizedQuestion: input.text,
        facets: [],
        confidence: 1,
        reason: "provider restored"
      };
    }
  };
  const diagnostics: Array<{
    resetReason: string | null;
    requestAttempted: boolean;
  }> = [];
  const coordinator = new LiveQuestionCompletionCoordinator(
    understanding,
    (diagnostic) => diagnostics.push(diagnostic)
  );

  const failed = await coordinator.submit(
    utterance(1, "Tell me how you implemented Teams")
  );
  const fresh = await coordinator.submit(
    utterance(2, "What does Get-CsOnlineUser return?")
  );

  assert.equal(failed.state, "error");
  assert.equal(
    failed.state === "error" && failed.bufferReset,
    true
  );
  assert.equal(fresh.state, "complete");
  assert.equal(attempts, 2);
  assert.equal(
    fresh.state === "complete"
      ? fresh.result.originalQuestion
      : "",
    "What does Get-CsOnlineUser return?"
  );
  assert.equal(
    diagnostics[0]?.resetReason,
    "permanent_provider_failure"
  );
  assert.equal(diagnostics[0]?.requestAttempted, true);
});

test("transient failures get one bounded recovery opportunity", async () => {
  let attempts = 0;
  const inputs: string[] = [];
  const understanding: QuestionUnderstandingPort = {
    async understand(input) {
      attempts += 1;
      inputs.push(input.text);
      if (attempts <= 2) throw new Error("network timeout");
      return {
        decision: "complete",
        normalizedQuestion: input.text,
        facets: [],
        confidence: 1,
        reason: "provider recovered"
      };
    }
  };
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  const first = await coordinator.submit(
    utterance(1, "Explain Direct Routing")
  );
  const exhausted = await coordinator.submit(
    utterance(2, "and the SBC role")
  );
  const fresh = await coordinator.submit(
    utterance(3, "What does Get-CsOnlineUser return?")
  );

  assert.equal(first.state, "error");
  assert.equal(
    first.state === "error" && first.bufferReset,
    false
  );
  assert.equal(exhausted.state, "error");
  assert.equal(
    exhausted.state === "error" && exhausted.bufferReset,
    true
  );
  assert.equal(fresh.state, "complete");
  assert.equal(inputs[1], "Explain Direct Routing and the SBC role");
  assert.equal(inputs[2], "What does Get-CsOnlineUser return?");
});

test("a recovery CONTINUE does not restore unlimited failure retention", async () => {
  let attempts = 0;
  const inputs: string[] = [];
  const understanding: QuestionUnderstandingPort = {
    async understand(input) {
      attempts += 1;
      inputs.push(input.text);
      if (attempts === 1 || attempts === 3) {
        throw new Error("network timeout");
      }
      if (attempts === 2) {
        return {
          decision: "continue",
          confidence: 1,
          reason: "thought continues"
        };
      }
      return {
        decision: "complete",
        normalizedQuestion: input.text,
        facets: [],
        confidence: 1,
        reason: "fresh question"
      };
    }
  };
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  await coordinator.submit(
    utterance(1, "Explain Direct Routing")
  );
  await coordinator.submit(
    utterance(2, "including the SBC role")
  );
  const exhausted = await coordinator.submit(
    utterance(3, "and geographic redundancy")
  );
  const fresh = await coordinator.submit(
    utterance(4, "What does Get-CsOnlineUser return?")
  );

  assert.equal(exhausted.state, "error");
  assert.equal(
    exhausted.state === "error" && exhausted.bufferReset,
    true
  );
  assert.equal(fresh.state, "complete");
  assert.equal(
    inputs[2],
    "Explain Direct Routing including the SBC role and geographic redundancy"
  );
  assert.equal(inputs[3], "What does Get-CsOnlineUser return?");
});

test("session reset clears a retained thought", async () => {
  const understanding = new ScriptedUnderstanding([
    {
      decision: "continue",
      confidence: 1,
      reason: "waiting"
    },
    {
      decision: "complete",
      normalizedQuestion: "What does Get-CsOnlineUser return?",
      facets: [],
      confidence: 1,
      reason: "complete"
    }
  ]);
  const coordinator =
    new LiveQuestionCompletionCoordinator(understanding);

  await coordinator.submit(
    utterance(1, "Tell me how you implemented Teams")
  );
  coordinator.reset();
  const fresh = await coordinator.submit(
    utterance(2, "What does Get-CsOnlineUser return?")
  );

  assert.equal(fresh.state, "complete");
  assert.equal(
    understanding.inputs[1]?.text,
    "What does Get-CsOnlineUser return?"
  );
  assert.equal(understanding.inputs[1]?.utteranceCount, 1);
});
