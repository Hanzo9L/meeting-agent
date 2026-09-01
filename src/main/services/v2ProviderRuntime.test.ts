import assert from "node:assert/strict";
import test from "node:test";
import { V2ProviderRuntime } from "./v2ProviderRuntime";
import {
  classifyQuestionUnderstandingFailure,
  QuestionUnderstandingFailure
} from "./questionUnderstandingPort";

test("missing V2 model is misconfigured and constructs no providers", () => {
  const previous = process.env["RELAY_V2_MODEL"];
  delete process.env["RELAY_V2_MODEL"];
  let constructions = 0;
  try {
    const runtime = new V2ProviderRuntime({
      getApiKey: () => "test-key",
      factories: {
        understanding: () => {
          constructions += 1;
          throw new Error("must not construct");
        },
        synthesis: () => {
          constructions += 1;
          throw new Error("must not construct");
        }
      }
    });

    assert.deepEqual(runtime.refresh(), {
      state: "misconfigured",
      model: null,
      semanticReady: false,
      synthesisReady: false,
      reason: "model_not_configured"
    });
    assert.equal(constructions, 0);
  } finally {
    if (previous === undefined) delete process.env["RELAY_V2_MODEL"];
    else process.env["RELAY_V2_MODEL"] = previous;
  }
});

test("missing API key is misconfigured and does not expose a model", () => {
  const runtime = new V2ProviderRuntime({
    getApiKey: () => "",
    model: "configured-v2-model"
  });

  assert.deepEqual(runtime.refresh(), {
    state: "misconfigured",
    model: null,
    semanticReady: false,
    synthesisReady: false,
    reason: "api_key_missing"
  });
});

test("provider construction failure is not falsely marked ready", () => {
  const runtime = new V2ProviderRuntime({
    getApiKey: () => "test-key",
    model: "configured-v2-model",
    factories: {
      understanding: () => {
        throw new Error("construction failed");
      },
      synthesis: () => {
        throw new Error("construction failed");
      }
    }
  });

  assert.deepEqual(runtime.refresh(), {
    state: "provider_error",
    model: "configured-v2-model",
    semanticReady: false,
    synthesisReady: false,
    reason: "provider_construction_failed"
  });
});

test("semantic and synthesis providers share one configured model", async () => {
  const models: string[] = [];
  const runtime = new V2ProviderRuntime({
    getApiKey: () => "test-key",
    model: "gpt-5.6-sol",
    factories: {
      understanding: ({ model }) => {
        models.push(model);
        return {
          async understand(input) {
            return {
              decision: "complete",
              normalizedQuestion: input.text,
              facets: [],
              confidence: 1,
              reason: "test",
              diagnostics: {
                provider: "test",
                model,
                latencyMs: 1
              }
            };
          }
        };
      },
      synthesis: ({ model }) => {
        models.push(model);
        return {
          async synthesize() {
            return {
              directAnswer: null,
              bullets: [],
              unsupportedFacets: [],
              confidence: "low",
              diagnostics: {
                configuredModel: model,
                actualModel: model,
                reasoningEffort: "medium",
                latencyMs: 1,
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                estimatedCostUsd: null
              }
            };
          }
        };
      }
    }
  });

  assert.deepEqual(runtime.refresh(), {
    state: "ready",
    model: "gpt-5.6-sol",
    semanticReady: true,
    synthesisReady: true,
    reason: null
  });
  assert.deepEqual(models, ["gpt-5.6-sol", "gpt-5.6-sol"]);
  const result = await runtime.understand({
    text: "What does Get-CsOnlineUser return?",
    source: "system",
    utteranceCount: 1
  });
  assert.equal(result.diagnostics?.model, "gpt-5.6-sol");
});

test("permanent semantic configuration failure disables future provider calls", async () => {
  let calls = 0;
  const runtime = new V2ProviderRuntime({
    getApiKey: () => "test-key",
    model: "invalid-model",
    factories: {
      understanding: () => ({
        async understand() {
          calls += 1;
          throw new QuestionUnderstandingFailure(
            "invalid_model_configuration",
            "permanent"
          );
        }
      }),
      synthesis: () => ({
        async synthesize() {
          throw new Error("not used");
        }
      })
    }
  });
  runtime.refresh();

  await assert.rejects(
    runtime.understand({
      text: "What does Get-CsOnlineUser return?",
      source: "system",
      utteranceCount: 1
    }),
    /invalid_model_configuration/
  );
  await assert.rejects(
    runtime.understand({
      text: "What does Get-CsOnlineUser return?",
      source: "system",
      utteranceCount: 1
    }),
    /invalid_model_configuration/
  );
  assert.equal(calls, 1);
  assert.deepEqual(runtime.getReadiness(), {
    state: "provider_error",
    model: "invalid-model",
    semanticReady: false,
    synthesisReady: false,
    reason: "invalid_model_configuration"
  });
});

test("HTTP configuration failures are permanent while throttling is transient", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const failure = classifyQuestionUnderstandingFailure(
      Object.assign(new Error(`HTTP ${status}`), { status })
    );
    assert.equal(failure.kind, "permanent");
  }
  for (const status of [408, 409, 429, 500, 503]) {
    const failure = classifyQuestionUnderstandingFailure(
      Object.assign(new Error(`HTTP ${status}`), { status })
    );
    assert.equal(failure.kind, "transient");
  }
});
