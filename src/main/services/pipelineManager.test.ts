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

  diagnostic(): void {
    this.events?.onDiagnostic?.({
      event: "utterance_end",
      timestamp: 1234,
      transcriptLength: 0,
      transcriptPreview: null,
      isFinal: null,
      speechFinal: null
    });
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

test("raw STT diagnostics are bound to their live session and source", async () => {
  const provider = new FakeSttProvider();
  const diagnostics: Array<{
    sessionId: string;
    source: string;
    event: string;
  }> = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    onAcceptedQuestion: async () => undefined,
    sendStatus: () => undefined,
    sendTranscript: () => undefined,
    onSttDiagnostic: (diagnostic) =>
      diagnostics.push(diagnostic)
  });
  await manager.start({
    sessionId: "live:raw-events",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });

  provider.diagnostic();

  assert.deepEqual(diagnostics, [{
    sessionId: "live:raw-events",
    source: "system",
    event: "utterance_end",
    timestamp: 1234,
    transcriptLength: 0,
    transcriptPreview: null,
    isFinal: null,
    speechFinal: null
  }]);
  await manager.stop();
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

test("an immediate-return handler accepts a second question while the first answer is still running", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  let releaseFirst!: () => void;
  const firstWork = new Promise<void>((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    onAcceptedQuestion: (question) => {
      accepted.push(question);
      if (accepted.length === 1) {
        void firstWork;
      }
      return Promise.resolve();
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
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(accepted, ["First", "Second"]);
  releaseFirst();
  await manager.stop();
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

test("both mode suppresses a duplicate microphone copy before question detection", async () => {
  const microphone = new FakeSttProvider();
  const system = new FakeSttProvider();
  const providers = [microphone, system];
  const accepted: Array<{ question: string; source: string }> = [];
  const diagnostics: Array<{ outcome: string; retainedSource: string | null }> =
    [];
  const manager = new PipelineManager({
    sttProviderFactory: () => providers.shift()!,
    onAcceptedQuestion: async (question, source) => {
      accepted.push({ question, source });
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined,
    onArbitrationDiagnostic: (diagnostic) =>
      diagnostics.push(diagnostic)
  });
  await manager.start({
    sessionId: "live:both-duplicate",
    sources: ["microphone", "system"],
    answerTriggerMode: "questions_only"
  });

  microphone.utterance(
    "How do Microsoft Teams Calling Plans work?",
    "mic:duplicate"
  );
  system.utterance(
    "How do Microsoft Teams Calling Plans work?",
    "system:duplicate"
  );
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );

  assert.deepEqual(accepted, [
    {
      question: "How do Microsoft Teams Calling Plans work?",
      source: "system"
    }
  ]);
  assert.equal(diagnostics[0]?.outcome, "duplicate_suppressed");
  assert.equal(diagnostics[0]?.retainedSource, "system");
  await manager.stop();
});

test("both mode preserves distinct simultaneous completed utterances", async () => {
  const microphone = new FakeSttProvider();
  const system = new FakeSttProvider();
  const providers = [microphone, system];
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => providers.shift()!,
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sessionId: "live:both-distinct",
    sources: ["microphone", "system"],
    answerTriggerMode: "questions_only"
  });

  microphone.utterance(
    "Which policy controls meetings?",
    "mic:distinct"
  );
  system.utterance(
    "What is a Calling Plan?",
    "system:distinct"
  );
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 700)
  );

  assert.deepEqual(accepted, [
    "Which policy controls meetings?",
    "What is a Calling Plan?"
  ]);
  await manager.stop();
});

test("Stop clears a pending both-mode utterance before promotion", async () => {
  const microphone = new FakeSttProvider();
  const system = new FakeSttProvider();
  const providers = [microphone, system];
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => providers.shift()!,
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sessionId: "live:both-stop",
    sources: ["microphone", "system"],
    answerTriggerMode: "questions_only"
  });
  microphone.utterance("Should this be accepted?", "mic:pending");
  await manager.stop();

  assert.deepEqual(accepted, []);
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

test("incomplete interrogative fragment is not promoted", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  const transcripts: Array<{ text: string; isFinal: boolean }> = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: (payload) => {
      transcripts.push({
        text: payload.text,
        isFinal: payload.isFinal
      });
    }
  });
  await manager.start({
    sources: ["microphone"],
    answerTriggerMode: "questions_only"
  });
  provider.utterance("How do Microsoft Teams");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, []);
  assert.ok(
    transcripts.some((entry) =>
      entry.text.includes(
        "incomplete utterance — waiting for next question"
      )
    )
  );
  provider.utterance(
    "How do Microsoft Teams Calling Plans work?"
  );
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, [
    "How do Microsoft Teams Calling Plans work?"
  ]);
  await manager.stop();
});

test("declarative non-question remains governed by trigger policy", async () => {
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
  provider.utterance("Teams Calling Plans are useful.");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, []);
  await manager.stop();
});

test("system-only incomplete fragment is not promoted", async () => {
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
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });
  provider.utterance("How do Microsoft Teams");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, []);
  await manager.stop();
});

test("semantic live mode accumulates acoustic utterances before durable acceptance", async () => {
  const provider = new FakeSttProvider();
  const accepted: Array<{
    question: string;
    facets: number;
    sessionId: string | undefined;
  }> = [];
  let call = 0;
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    questionUnderstanding: {
      async understand(input) {
        call += 1;
        if (call === 1) {
          return {
            decision: "continue",
            confidence: 0.9,
            reason: "The speaker introduced context but not the full request."
          };
        }
        assert.match(
          input.text,
          /implemented Teams.*Exchange.*resource accounts/
        );
        return {
          decision: "complete",
          normalizedQuestion:
            "How did you implement Teams conference rooms, and how did Exchange resource accounts fit into the migration?",
          facets: [
            {
              id: "teams-rooms",
              label: "Teams rooms",
              query: "Teams conference room implementation"
            },
            {
              id: "exchange-resources",
              label: "Exchange resources",
              query: "Exchange room resource accounts migration"
            }
          ],
          confidence: 0.97,
          reason: "The complete compound request is present."
        };
      }
    },
    onAcceptedQuestion: async (
      question,
      _source,
      understanding,
      sessionId
    ) => {
      accepted.push({
        question,
        facets: understanding?.facets?.length ?? 0,
        sessionId
      });
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sessionId: "live:semantic-session",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });

  provider.utterance(
    "Tell me how you implemented Teams because we have large conference rooms"
  );
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, []);

  provider.utterance(
    "and how did Exchange and the resource accounts fit into that migration"
  );
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.deepEqual(accepted, [{
    question:
      "How did you implement Teams conference rooms, and how did Exchange resource accounts fit into the migration?",
    facets: 2,
    sessionId: "live:semantic-session"
  }]);
  await manager.stop();
});

test("V2.4 gates the exact compound interview thought until semantic complete", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  const diagnostics: Array<{
    semanticDecision: string;
    durableTurnCreated: boolean;
    retrievalStarted: boolean;
    synthesisStarted: boolean;
    projectionCreated: boolean;
  }> = [];
  let semanticCalls = 0;
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    requireSemanticCompletion: true,
    questionUnderstanding: {
      async understand() {
        semanticCalls += 1;
        if (semanticCalls < 3) {
          return {
            decision: "continue",
            confidence: 1,
            reason: "The interviewer is still building one thought."
          };
        }
        return {
          decision: "complete",
          normalizedQuestion:
            "What is your Teams experience with Calling Plans and Operator Connect, and how would you isolate client, network, or service issues?",
          facets: [
            {
              id: "environment",
              label: "Teams environment",
              query: "Teams Calling Plans Operator Connect environment"
            },
            {
              id: "isolation",
              label: "Fault isolation",
              query: "Teams client network service fault isolation"
            }
          ],
          confidence: 1,
          reason: "The complete compound request is present."
        };
      }
    },
    onAcceptedQuestion: async (_question, _source, understanding) => {
      accepted.push(understanding?.originalQuestion ?? "");
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined,
    onQuestionGateDiagnostic: (diagnostic) =>
      diagnostics.push(diagnostic)
  });
  await manager.start({
    sessionId: "live:v2.4-hard-gate",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });

  const utterances = [
    "What is your experience like with Teams",
    "in an environment like ours, where we use Calling Plans and Operator Connect",
    "how would you approach diagnosing issues and determining whether they are client based, network based, or service related"
  ];
  provider.utterance(utterances[0]!);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(accepted, []);
  provider.utterance(utterances[1]!);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(accepted, []);
  provider.utterance(utterances[2]!);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

  assert.deepEqual(accepted, [utterances.join(" ")]);
  assert.deepEqual(
    diagnostics.slice(0, 2).map((item) => ({
      semanticDecision: item.semanticDecision,
      durableTurnCreated: item.durableTurnCreated,
      retrievalStarted: item.retrievalStarted,
      synthesisStarted: item.synthesisStarted,
      projectionCreated: item.projectionCreated
    })),
    [
      {
        semanticDecision: "continue",
        durableTurnCreated: false,
        retrievalStarted: false,
        synthesisStarted: false,
        projectionCreated: false
      },
      {
        semanticDecision: "continue",
        durableTurnCreated: false,
        retrievalStarted: false,
        synthesisStarted: false,
        projectionCreated: false
      }
    ]
  );
  assert.equal(diagnostics[2]?.semanticDecision, "complete");
  assert.equal(diagnostics[2]?.durableTurnCreated, true);
  assert.equal(diagnostics[2]?.retrievalStarted, true);
  assert.equal(diagnostics[2]?.projectionCreated, true);
  await manager.stop();
});

test("production pipeline cannot start without semantic completion", async () => {
  const manager = new PipelineManager({
    sttProviderFactory: () => new FakeSttProvider(),
    requireSemanticCompletion: true,
    onAcceptedQuestion: async () => undefined,
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await assert.rejects(
    () =>
      manager.start({
        sources: ["system"],
        answerTriggerMode: "all_final"
      }),
    /Semantic question completion is required/
  );
});

test("broad interview lead-in remains one live thought until the final ask", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    requireSemanticCompletion: true,
    questionUnderstanding: {
      async understand(input) {
        if (!input.text.includes("Microsoft service issue")) {
          return {
            decision: "continue",
            confidence: 1,
            reason: "The final ask is not present."
          };
        }
        return {
          decision: "complete",
          normalizedQuestion:
            "Describe Teams experience with Calling Plans and Operator Connect and isolate poor calling across client, network, and Microsoft service causes.",
          facets: [],
          confidence: 1,
          reason: "complete"
        };
      }
    },
    onAcceptedQuestion: async (_question, _source, understanding) => {
      accepted.push(understanding?.originalQuestion ?? "");
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });
  const utterances = [
    "Tell me about your experience with Teams",
    "especially in a Calling Plans and Operator Connect environment",
    "and how would you isolate whether poor calling is a client, network, or Microsoft service issue"
  ];
  for (let index = 0; index < utterances.length; index += 1) {
    provider.utterance(utterances[index]!);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    assert.equal(accepted.length, index === 2 ? 1 : 0);
  }
  assert.deepEqual(accepted, [utterances.join(" ")]);
  await manager.stop();
});

test("a simple semantic COMPLETE creates one turn without another utterance", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    requireSemanticCompletion: true,
    questionUnderstanding: {
      async understand() {
        return {
          decision: "complete",
          normalizedQuestion: "What does Get-CsOnlineUser return?",
          facets: [],
          confidence: 1,
          reason: "Specific self-contained question."
        };
      }
    },
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });
  provider.utterance("What does Get C S Online User return?");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(accepted, ["What does Get-CsOnlineUser return?"]);
  await manager.stop();
});

test("semantic complete is the sole question-shape authority", async () => {
  const provider = new FakeSttProvider();
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    requireSemanticCompletion: true,
    questionUnderstanding: {
      async understand() {
        return {
          decision: "complete",
          normalizedQuestion: "Teams implementation experience",
          facets: [],
          confidence: 1,
          reason: "complete"
        };
      }
    },
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });
  await manager.start({
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });
  provider.utterance("What is your Teams implementation experience?");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.deepEqual(accepted, ["Teams implementation experience"]);
  await manager.stop();
});

test("live thought display combines retained clauses with the current acoustic preview", async () => {
  const provider = new FakeSttProvider();
  const transcripts: string[] = [];
  const semanticInputs: string[] = [];
  const accepted: Array<{
    normalized: string;
    original: string | undefined;
  }> = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    questionUnderstanding: {
      async understand(input) {
        semanticInputs.push(input.text);
        if (semanticInputs.length < 3) {
          return {
            decision: "continue",
            confidence: 1,
            reason: "waiting for the complete thought"
          };
        }
        return {
          decision: "complete",
          normalizedQuestion:
            "How did you implement Teams conference rooms, including Exchange room resource accounts?",
          facets: [],
          confidence: 1,
          reason: "complete"
        };
      }
    },
    onAcceptedQuestion: async (
      question,
      _source,
      understanding
    ) => {
      accepted.push({
        normalized: question,
        original: understanding?.originalQuestion
      });
    },
    sendStatus: () => undefined,
    sendTranscript: (payload) => transcripts.push(payload.text)
  });
  await manager.start({
    sessionId: "live:three-clause-display",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });

  const u1 = "Tell me how you implemented Teams";
  const u2 = "because we have a large conference room environment";
  const u3 =
    "and how did Exchange and the room resource accounts fit into that migration";

  provider.utterance(u1);
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.equal(transcripts.at(-1), u1);

  provider.interim(u2);
  assert.equal(transcripts.at(-1), `${u1} ${u2}`);
  provider.utterance(u2);
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.equal(transcripts.at(-1), `${u1} ${u2}`);

  provider.interim(u3);
  assert.equal(transcripts.at(-1), `${u1} ${u2} ${u3}`);
  provider.utterance(u3);
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );

  assert.deepEqual(semanticInputs, [
    u1,
    `${u1} ${u2}`,
    `${u1} ${u2} ${u3}`
  ]);
  assert.deepEqual(accepted, [{
    normalized:
      "How did you implement Teams conference rooms, including Exchange room resource accounts?",
    original: `${u1} ${u2} ${u3}`
  }]);
  assert.equal(transcripts.at(-1), "");
  await manager.stop();
});

test("live thought display retains finalized clauses while semantic evaluation is in flight", async () => {
  const provider = new FakeSttProvider();
  const transcripts: string[] = [];
  let call = 0;
  let releaseSecond!: () => void;
  const secondDecision = new Promise<void>((resolvePromise) => {
    releaseSecond = resolvePromise;
  });
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    questionUnderstanding: {
      async understand() {
        call += 1;
        if (call === 2) await secondDecision;
        return {
          decision: "continue",
          confidence: 1,
          reason: "waiting"
        };
      }
    },
    onAcceptedQuestion: async () => undefined,
    sendStatus: () => undefined,
    sendTranscript: (payload) => transcripts.push(payload.text)
  });
  await manager.start({
    sessionId: "live:slow-semantic-display",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });

  const u1 = "Tell me how you implemented Teams";
  const u2 = "because we have a large conference room environment";
  const u3 = "and how did Exchange fit into that migration";
  provider.utterance(u1);
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  provider.utterance(u2);
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );

  provider.interim(u3);
  assert.equal(transcripts.at(-1), `${u1} ${u2} ${u3}`);

  releaseSecond();
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  assert.equal(transcripts.at(-1), `${u1} ${u2} ${u3}`);
  await manager.stop();
});

test("stopping and starting a new session clears semantic thought state", async () => {
  const provider = new FakeSttProvider();
  const inputs: string[] = [];
  const accepted: string[] = [];
  const manager = new PipelineManager({
    sttProviderFactory: () => provider,
    questionUnderstanding: {
      async understand(input) {
        inputs.push(input.text);
        if (inputs.length === 1) {
          return {
            decision: "continue",
            confidence: 1,
            reason: "waiting"
          };
        }
        return {
          decision: "complete",
          normalizedQuestion: input.text,
          facets: [],
          confidence: 1,
          reason: "complete"
        };
      }
    },
    onAcceptedQuestion: async (question) => {
      accepted.push(question);
    },
    sendStatus: () => undefined,
    sendTranscript: () => undefined
  });

  await manager.start({
    sessionId: "live:first",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });
  provider.utterance("Tell me how you implemented Teams");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );
  await manager.stop();

  await manager.start({
    sessionId: "live:second",
    sources: ["system"],
    answerTriggerMode: "questions_only"
  });
  provider.utterance("What does Get-CsOnlineUser return?");
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 0)
  );

  assert.deepEqual(inputs, [
    "Tell me how you implemented Teams",
    "What does Get-CsOnlineUser return?"
  ]);
  assert.deepEqual(accepted, [
    "What does Get-CsOnlineUser return?"
  ]);
  await manager.stop();
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
  assert.doesNotMatch(source, /\bTTS\b|speakText|speechSynthesis/);
  assert.doesNotMatch(
    source,
    /normalizeCmdlet|canonicalizeCmdlet|spoken.?cmdlet/i
  );
});
