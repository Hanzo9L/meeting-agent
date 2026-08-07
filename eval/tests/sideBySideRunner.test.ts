import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runLegacyBaseline } from "../harness/legacyScorer";
import { runSideBySideEvaluation } from "../../src/main/services/eval/sideBySideRunner";
import {
  createKnowledgeV2SqliteStore,
  encodeFloat32Vector,
  FakeEmbeddingProvider,
  hashEmbeddingInput,
  parseCanonicalDocument,
  type AcquiredDocumentInput
} from "../../src/main/services/knowledgeV2";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

function markdown(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", "", `# ${title}`, "", body].join("\n");
}

function fixtureDoc(input: AcquiredDocumentInput) {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

async function seedMinimalV2Db(path: string): Promise<void> {
  const store = createKnowledgeV2SqliteStore({
    databasePath: path,
    migrationsDir: MIGRATIONS_DIR
  });
  store.initializeDatabase();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "test-model",
    embeddingSchemaVersion: "test-v1"
  });

  const doc = fixtureDoc({
    sourceId: "ms-teams-admin",
    trackId: "ga",
    transport: "learn_mcp",
    canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
    rawMarkdown: markdown("Direct Routing", "Direct Routing guidance."),
    revision: {
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      locale: "en-us",
      retrievedAt: new Date().toISOString(),
      contentHash: "wb17-test-content"
    }
  });
  store.saveKnowledgeDocument(doc, { parserVersion: "wb17-test-v1" });
  const chunkText = "Direct Routing policy assignment checks for Teams users.";
  store.saveChunkPlaceholder({
    chunkId: "chunk-1",
    documentId: doc.documentId,
    sectionId: "s1",
    headingPath: ["s1"],
    chunkKind: "configuration",
    text: chunkText,
    sourceOrder: 1,
    contentHash: hashEmbeddingInput(chunkText),
    provenance: {},
    metadata: {}
  });
  const query = await provider.embedQuery(
    { id: "q", text: "Direct Routing policy assignment checks?" },
    { model: "test-model", embeddingSchemaVersion: "test-v1" }
  );
  store.saveChunkEmbedding({
    chunkId: "chunk-1",
    providerId: provider.providerId,
    model: "test-model",
    dimensions: query.dimensions,
    embeddingSchemaVersion: "test-v1",
    inputContentHash: hashEmbeddingInput(chunkText),
    vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(query.vector))),
    usage: { requestCount: 1, batchSize: 1 }
  });
  store.close();
}

test("runs side-by-side and serializes JSON/JSONL/Markdown artifacts", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "meeting-agent-wb17-run-"));
  const legacyOutputDir = await mkdtemp(join(tmpdir(), "meeting-agent-wb17-legacy-"));
  const v2Dir = await mkdtemp(join(tmpdir(), "meeting-agent-wb17-v2-"));
  const v2DbPath = join(v2Dir, "knowledge-v2.sqlite");
  await seedMinimalV2Db(v2DbPath);

  const legacy = await runLegacyBaseline({
    datasetPath: "eval/datasets/teams-admin-powershell.seed.jsonl",
    indexCachePath: "eval/fixtures/index-cache.fixture.json",
    outputDir: legacyOutputDir,
    topK: 4,
    includeAnswers: false,
    topic: "Microsoft Teams developer platform",
    topicPromptTemplate: "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}."
  });

  const result = await runSideBySideEvaluation({
    datasetPath: "eval/datasets/teams-admin-powershell.seed.jsonl",
    legacyArtifactPath: legacy.artifactPath,
    outputDir,
    v2DatabasePath: v2DbPath
  });

  assert.equal(result.artifact.pipelineVersion, "side-by-side-wb17");
  assert.equal(result.artifact.questions.length, 8);
  assert.ok(result.artifact.corpus.documentCount >= 1);
  assert.equal(result.artifact.freeze.routingRulesUnchanged, true);
  assert.equal(result.artifact.freeze.fusionPolicyUnchanged, true);
  assert.equal(result.artifact.freeze.budgetsUnchanged, true);

  const json = JSON.parse(await readFile(result.artifactPath, "utf8")) as {
    pipelineVersion: string;
    questions: Array<{ question: { questionId: string } }>;
  };
  assert.equal(json.pipelineVersion, "side-by-side-wb17");
  assert.ok(json.questions.some((q) => q.question.questionId === "Q-001"));

  const jsonl = await readFile(result.jsonlPath, "utf8");
  assert.ok(jsonl.includes('"questionId":"Q-001"'));
  const markdown = await readFile(result.markdownPath, "utf8");
  assert.ok(markdown.includes("WB-17 Side-by-side Retrieval Report"));
});
