import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLegacyBaseline } from "../harness/legacyScorer";

test("runs baseline harness and serializes artifacts", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "meeting-agent-baseline-"));
  const { artifact, artifactPath, summaryPath } = await runLegacyBaseline({
    datasetPath: "eval/datasets/teams-admin-powershell.seed.jsonl",
    indexCachePath: "eval/fixtures/index-cache.fixture.json",
    outputDir,
    topK: 4,
    includeAnswers: false,
    topic: "Microsoft Teams developer platform",
    topicPromptTemplate: "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}."
  });

  assert.equal(artifact.pipelineVersion, "legacy-v1");
  assert.equal(artifact.usesKnowledgeEngineV2, false);
  assert.ok(artifact.results.length >= 1);
  assert.ok(artifact.summary.totalQuestions >= 1);

  const jsonArtifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    pipelineVersion: string;
    usesKnowledgeEngineV2: boolean;
    results: Array<{ retrieval: { ordered: Array<{ rank: number; path: string }> } }>;
  };
  assert.equal(jsonArtifact.pipelineVersion, "legacy-v1");
  assert.equal(jsonArtifact.usesKnowledgeEngineV2, false);
  assert.ok(jsonArtifact.results[0]?.retrieval.ordered[0]?.rank === 1);

  const markdownSummary = await readFile(summaryPath, "utf8");
  assert.ok(markdownSummary.includes("# Legacy Baseline Summary"));
});

test("captures retrieval ordering and missing-api-key answer behavior", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "meeting-agent-baseline-"));
  const { artifact } = await runLegacyBaseline({
    datasetPath: "eval/datasets/teams-admin-powershell.seed.jsonl",
    indexCachePath: "eval/fixtures/index-cache.fixture.json",
    outputDir,
    topK: 2,
    includeAnswers: true,
    openAiApiKey: "",
    topic: "Microsoft Teams developer platform",
    topicPromptTemplate: "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}."
  });

  const first = artifact.results.find((item) => item.questionId === "Q-001");
  assert.ok(first, "Q-001 should be present");
  assert.ok(first!.retrieval.ordered.length >= 1, "retrieval should return at least one item");
  assert.equal(first!.retrieval.ordered[0]?.rank, 1);
  assert.equal(first!.answer.status, "missing_api_key");
  assert.equal(first!.answer.attempted, false);
});

test("does not reference Knowledge Engine V2 modules", async () => {
  const scorerSource = await readFile("eval/harness/legacyScorer.ts", "utf8");
  assert.equal(scorerSource.includes("retrievalV2"), false);
  assert.equal(scorerSource.includes("knowledgeV2"), false);
});

