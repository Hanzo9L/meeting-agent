import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCompatibleEmbeddingSpace,
  normalizeEmbeddingInputForCache
} from "../../src/main/services/eval/wb17l0Spike";

test("cache normalization is deterministic and whitespace-stable", () => {
  const a = normalizeEmbeddingInputForCache("  Which   cmdlet retrieves voice routing policy?  ");
  const b = normalizeEmbeddingInputForCache("Which cmdlet retrieves voice routing policy?");
  assert.equal(a, b);
});

test("compatible embedding identity is accepted", () => {
  assert.doesNotThrow(() =>
    assertCompatibleEmbeddingSpace({
      corpus: {
        providerId: "openai",
        model: "text-embedding-3-small",
        schema: "v1",
        dimensions: 1536
      },
      query: {
        providerId: "openai",
        model: "text-embedding-3-small",
        schema: "v1",
        dimensions: 1536
      }
    })
  );
});

test("cross-model comparison is rejected", () => {
  assert.throws(
    () =>
      assertCompatibleEmbeddingSpace({
        corpus: {
          providerId: "openai",
          model: "text-embedding-3-small",
          schema: "v1",
          dimensions: 1536
        },
        query: {
          providerId: "local-minilm",
          model: "Xenova/all-MiniLM-L6-v2",
          schema: "local-spike-v1",
          dimensions: 384
        }
      }),
    /cross_model_vector_comparison_not_allowed/
  );
});
