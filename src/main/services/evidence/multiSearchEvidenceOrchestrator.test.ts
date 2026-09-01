import assert from "node:assert/strict";
import test from "node:test";
import { MultiSearchEvidenceOrchestrator } from "./multiSearchEvidenceOrchestrator";
import type {
  EvidenceSearchClient,
  EvidenceSearchSuccess
} from "./evidenceTypes";

function result(
  query: string,
  ids: string[]
): EvidenceSearchSuccess {
  return {
    ok: true,
    query,
    route: {
      confidence: "HIGH",
      service: "msteams",
      repo: "teams",
      reason: "test"
    },
    results: ids.map((id, index) => ({
      parentId: id,
      title: `Title ${id}`,
      section: `Section ${id}`,
      url: `https://learn.microsoft.com/en-us/test/${id}`,
      body: `Body ${id}`,
      score: 1 - index / 10,
      matchedBy: ["lexical"]
    })),
    timing: { total_ms: 10 },
    topK: 5,
    engine: "learn-rag-r0.4",
    corpusFingerprint: "corpus",
    indexFingerprint: "index"
  };
}

test("preserves facet order and binds deduplicated evidence to every supporting facet", async () => {
  const responses = [
    result("first", ["shared", "one", "overflow-a"]),
    result("second", ["shared", "two", "overflow-b"])
  ];
  const client: EvidenceSearchClient = {
    async search() {
      return responses.shift()!;
    }
  };
  const run = await new MultiSearchEvidenceOrchestrator(client).execute({
    question: "Combined question",
    facets: [
      { id: "f1", label: "First", query: "first" },
      { id: "f2", label: "Second", query: "second" }
    ]
  });

  assert.equal(run.ok, true);
  if (!run.ok) return;
  assert.deepEqual(run.facets.map((facet) => facet.id), ["f1", "f2"]);
  assert.deepEqual(
    run.evidence.map((item) => item.evidenceId),
    ["E1", "E2", "E3", "E4", "E5"]
  );
  assert.deepEqual(run.evidence[0]?.facetIds, ["f1", "f2"]);
  assert.deepEqual(
    run.facetCoverage.map((facet) => facet.evidenceIds),
    [["E1", "E2", "E4"], ["E1", "E3", "E5"]]
  );
  assert.equal(run.result.results.length, 5);
});
