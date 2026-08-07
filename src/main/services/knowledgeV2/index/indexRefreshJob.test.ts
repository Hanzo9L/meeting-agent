import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { hashEmbeddingInput } from "../embeddings";
import { FakeEmbeddingProvider } from "../embeddings/fakeEmbeddingProvider";
import type { EmbeddingInput, EmbeddingOptions, EmbeddingProvider, EmbeddingResult } from "../embeddings/types";
import { ReembeddingIndexRefreshJob } from "./indexRefreshJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb10-"));
  return join(root, "knowledge-v2.sqlite");
}

async function seedStore(chunkTexts: string[]): Promise<{
  store: ReturnType<typeof createKnowledgeV2SqliteStore>;
  chunkIds: string[];
  documentId: string;
}> {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();
  const parsed = parseCanonicalDocument({
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/wb10",
    rawMarkdown: "# WB10\n\nSeed document",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "c1",
      blobSha: "b1",
      path: "wb10.md"
    }
  });
  assert.ok(parsed.document);
  const saved = store.saveKnowledgeDocument(parsed.document, { parserVersion: "wb10-parser-v1" });

  const chunkIds = chunkTexts.map((_, index) => `chunk-${index + 1}`);
  chunkIds.forEach((chunkId, index) => {
    store.saveChunkPlaceholder({
      chunkId,
      documentId: saved.documentId,
      sectionId: "sec-1",
      headingPath: ["WB10"],
      chunkKind: "generic",
      text: chunkTexts[index] ?? "",
      sourceOrder: index,
      contentHash: `chunk-hash-${index}`,
      provenance: {},
      metadata: {}
    });
  });

  return { store, chunkIds, documentId: saved.documentId };
}

function makeJob(
  store: ReturnType<typeof createKnowledgeV2SqliteStore>,
  provider: FakeEmbeddingProvider,
  model: string,
  schemaVersion: string,
  dimensions = 4,
  batchSize = 2
): ReembeddingIndexRefreshJob {
  return new ReembeddingIndexRefreshJob({
    store,
    provider,
    desired: {
      providerId: provider.providerId,
      model,
      dimensions,
      embeddingSchemaVersion: schemaVersion
    },
    batchSize
  });
}

class UsageBatchMockProvider implements EmbeddingProvider {
  readonly providerId = "usage-batch-mock";
  private readonly dimensions: number;
  private readonly model: string;
  private readonly schema: string;
  private readonly batchTokenSchedule: number[];
  private callIndex = 0;

  constructor(params: {
    dimensions: number;
    model: string;
    schema: string;
    batchTokenSchedule: number[];
  }) {
    this.dimensions = params.dimensions;
    this.model = params.model;
    this.schema = params.schema;
    this.batchTokenSchedule = [...params.batchTokenSchedule];
  }

  async embedDocuments(inputs: EmbeddingInput[], options?: EmbeddingOptions): Promise<EmbeddingResult[]> {
    const scheduledTokens = this.batchTokenSchedule[this.callIndex] ?? 0;
    this.callIndex += 1;
    const model = options?.model ?? this.model;
    const schema = options?.embeddingSchemaVersion ?? this.schema;
    const createdAt = new Date().toISOString();
    return inputs.map((input, idx) => ({
      inputId: input.id,
      providerId: this.providerId,
      model,
      dimensions: this.dimensions,
      embeddingSchemaVersion: schema,
      inputContentHash: hashEmbeddingInput(input.text),
      vector: Float32Array.from(Array.from({ length: this.dimensions }, () => idx + 1)),
      createdAt,
      usage: {
        requestCount: 1,
        batchSize: inputs.length,
        inputTokens: scheduledTokens
      }
    }));
  }

  async embedQuery(_: EmbeddingInput): Promise<EmbeddingResult> {
    throw new Error("not_used_in_usage_batch_tests");
  }
}

test("compatible embedding is reused and provider is not called", async () => {
  const { store, chunkIds } = await seedStore(["alpha"]);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    const first = makeJob(store, provider, "model-v1", "schema-v1");
    await first.execute();
    const beforeCalls = provider.getDocumentCallCount();

    const second = makeJob(store, provider, "model-v1", "schema-v1");
    const run = await second.execute();
    assert.equal(run.summary.reusedCount, 1);
    assert.equal(run.summary.generatedCount, 0);
    assert.equal(provider.getDocumentCallCount(), beforeCalls);
    const item = run.items.find((entry) => entry.chunkId === chunkIds[0]);
    assert.equal(item?.reason, "compatible_embedding_exists");
  } finally {
    store.close();
  }
});

test("missing embeddings are generated", async () => {
  const { store } = await seedStore(["alpha"]);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    const run = await makeJob(store, provider, "model-v1", "schema-v1").execute();
    assert.equal(run.summary.generatedCount, 1);
    assert.equal(run.items[0]?.reason, "missing");
  } finally {
    store.close();
  }
});

test("model/schema/provider/content/dimension changes trigger regeneration reasons", async () => {
  const { store, chunkIds } = await seedStore(["alpha"]);
  try {
    const baseProvider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    await makeJob(store, baseProvider, "model-v1", "schema-v1").execute();

    const modelRun = await makeJob(store, baseProvider, "model-v2", "schema-v1").execute();
    assert.equal(modelRun.items.find((item) => item.chunkId === chunkIds[0])?.reason, "model_changed");

    const schemaRun = await makeJob(store, baseProvider, "model-v2", "schema-v2").execute();
    assert.equal(schemaRun.items.find((item) => item.chunkId === chunkIds[0])?.reason, "schema_changed");

    const dimensionsRun = await makeJob(store, baseProvider, "model-v2", "schema-v2", 8).execute();
    assert.equal(
      dimensionsRun.items.find((item) => item.chunkId === chunkIds[0])?.reason,
      "dimensions_changed"
    );

    store.saveChunkPlaceholder({
      chunkId: chunkIds[0]!,
      documentId: (store.listChunkInputs({ chunkIds: [chunkIds[0]!] })[0] ?? {}).documentId ?? "",
      sectionId: "sec-1",
      headingPath: ["WB10"],
      chunkKind: "generic",
      text: "alpha changed",
      sourceOrder: 0,
      contentHash: "changed",
      provenance: {},
      metadata: {}
    });
    const contentRun = await makeJob(store, baseProvider, "model-v2", "schema-v2", 8).execute();
    assert.equal(contentRun.items.find((item) => item.chunkId === chunkIds[0])?.reason, "content_changed");

    const otherProvider = new FakeEmbeddingProvider({
      providerId: "fake-alt",
      dimensions: 8,
      defaultModel: "model-v2"
    });
    const providerRun = await makeJob(store, otherProvider, "model-v2", "schema-v2", 8).execute();
    assert.equal(providerRun.items.find((item) => item.chunkId === chunkIds[0])?.reason, "provider_changed");
  } finally {
    store.close();
  }
});

test("corrupt blob is detected and replaced", async () => {
  const { store, chunkIds } = await seedStore(["alpha"]);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    const inputHash = hashEmbeddingInput("alpha");
    store.saveChunkEmbedding({
      chunkId: chunkIds[0]!,
      providerId: provider.providerId,
      model: "model-v1",
      dimensions: 4,
      embeddingSchemaVersion: "schema-v1",
      inputContentHash: inputHash,
      vectorBlob: Uint8Array.from([1, 2, 3]), // invalid float32 payload
      usage: { requestCount: 1, batchSize: 1 }
    });

    const run = await makeJob(store, provider, "model-v1", "schema-v1").execute();
    const item = run.items.find((entry) => entry.chunkId === chunkIds[0]);
    assert.equal(item?.status, "generated");
    assert.equal(item?.reason, "corrupt");
    const loaded = store.getChunkEmbedding({
      chunkId: chunkIds[0]!,
      providerId: provider.providerId,
      model: "model-v1",
      dimensions: 4,
      embeddingSchemaVersion: "schema-v1",
      inputContentHash: inputHash
    });
    assert.ok(loaded);
    assert.equal(loaded?.vectorBlob.byteLength, 16);
  } finally {
    store.close();
  }
});

test("model-v1 to model-v2 migration preserves canonical document unchanged", async () => {
  const { store, chunkIds, documentId } = await seedStore(["alpha", "beta"]);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    await makeJob(store, provider, "model-v1", "schema-v1").execute();

    const beforeDoc = store.getKnowledgeDocument(documentId);
    const beforeRaw = store.getDocumentRawSource(documentId);
    assert.ok(beforeDoc && beforeRaw);

    const migrationRun = await makeJob(store, provider, "model-v2", "schema-v1").execute();
    assert.equal(migrationRun.summary.generatedCount, chunkIds.length);

    const afterDoc = store.getKnowledgeDocument(documentId);
    const afterRaw = store.getDocumentRawSource(documentId);
    assert.ok(afterDoc && afterRaw);
    assert.equal(afterDoc?.rawMarkdown, beforeDoc?.rawMarkdown);
    assert.deepEqual(afterDoc?.sections, beforeDoc?.sections);
    assert.deepEqual(afterDoc?.sourceRevision, beforeDoc?.sourceRevision);
    const records = store.listDocumentsBySource({ sourceId: "ms-test", trackId: "ga" });
    assert.equal(records[0]?.parserVersion, "wb10-parser-v1");

    const secondRunCalls = provider.getDocumentCallCount();
    const secondRun = await makeJob(store, provider, "model-v2", "schema-v1").execute();
    assert.equal(secondRun.summary.generatedCount, 0);
    assert.equal(secondRun.summary.reusedCount, chunkIds.length);
    assert.equal(provider.getDocumentCallCount(), secondRunCalls);
  } finally {
    store.close();
  }
});

test("per-item failure does not corrupt previous valid embedding", async () => {
  const { store, chunkIds } = await seedStore(["alpha", "beta"]);
  try {
    const okProvider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    await makeJob(store, okProvider, "model-v1", "schema-v1").execute();

    const failProvider = new FakeEmbeddingProvider({
      dimensions: 4,
      defaultModel: "model-v2",
      failInputIds: [chunkIds[1]!]
    });
    const run = await makeJob(store, failProvider, "model-v2", "schema-v1").execute();
    assert.equal(run.summary.failedCount, 2);

    const oldEmbedding = store.getChunkEmbedding({
      chunkId: chunkIds[1]!,
      providerId: "fake",
      model: "model-v1",
      dimensions: 4,
      embeddingSchemaVersion: "schema-v1",
      inputContentHash: hashEmbeddingInput("beta")
    });
    assert.ok(oldEmbedding);
  } finally {
    store.close();
  }
});

test("cancellation stops new work safely and bounded batching limits provider calls", async () => {
  const { store } = await seedStore(["a", "b", "c", "d", "e"]);
  try {
    const provider = new FakeEmbeddingProvider({
      dimensions: 4,
      defaultModel: "model-v1",
      delayMs: 40
    });
    const job = makeJob(store, provider, "model-v1", "schema-v1", 4, 2);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 55);
    const run = await job.execute({ signal: controller.signal });
    assert.equal(run.summary.cancelled, true);
    assert.ok(run.summary.cancelledCount > 0);
    assert.ok(provider.getDocumentCallCount() <= 2);
  } finally {
    store.close();
  }
});

test("re-embedding path does not require source acquisition or network", async () => {
  const { store } = await seedStore(["alpha"]);
  const originalFetch = globalThis.fetch;
  try {
    // If source acquisition/network were attempted, this would fail.
    // Re-embedding must run from persisted local data only.
    globalThis.fetch = (() => {
      throw new Error("network_not_allowed_in_wb10_test");
    }) as typeof fetch;

    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    const run = await makeJob(store, provider, "model-v1", "schema-v1").execute();
    assert.equal(run.summary.generatedCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
});

test("plan diagnostics include deterministic reason counts", async () => {
  const { store } = await seedStore(["alpha", "beta"]);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "model-v1" });
    await makeJob(store, provider, "model-v1", "schema-v1").execute();
    const plan = makeJob(store, provider, "model-v1", "schema-v1").createPlan();
    assert.equal(plan.length, 2);
    assert.ok(plan.every((item) => item.decision.reason === "compatible_embedding_exists"));
  } finally {
    store.close();
  }
});

test("single provider batch usage is counted once, not per embedding", async () => {
  const { store } = await seedStore(Array.from({ length: 10 }, (_, i) => `chunk-${i}`));
  try {
    const provider = new UsageBatchMockProvider({
      dimensions: 4,
      model: "usage-model",
      schema: "usage-v1",
      batchTokenSchedule: [100]
    });
    const job = new ReembeddingIndexRefreshJob({
      store,
      provider,
      desired: {
        providerId: provider.providerId,
        model: "usage-model",
        dimensions: 4,
        embeddingSchemaVersion: "usage-v1"
      },
      batchSize: 10
    });
    const run = await job.execute();
    assert.equal(run.summary.generatedCount, 10);
    assert.equal(run.summary.providerRequestCount, 1);
    assert.equal(run.summary.providerInputTokens, 100);
  } finally {
    store.close();
  }
});

test("multiple provider batches aggregate request-level usage correctly", async () => {
  const { store } = await seedStore(Array.from({ length: 15 }, (_, i) => `chunk-${i}`));
  try {
    const provider = new UsageBatchMockProvider({
      dimensions: 4,
      model: "usage-model",
      schema: "usage-v1",
      batchTokenSchedule: [100, 60]
    });
    const job = new ReembeddingIndexRefreshJob({
      store,
      provider,
      desired: {
        providerId: provider.providerId,
        model: "usage-model",
        dimensions: 4,
        embeddingSchemaVersion: "usage-v1"
      },
      batchSize: 10
    });
    const run = await job.execute();
    assert.equal(run.summary.generatedCount, 15);
    assert.equal(run.summary.providerRequestCount, 2);
    assert.equal(run.summary.providerInputTokens, 160);
  } finally {
    store.close();
  }
});
