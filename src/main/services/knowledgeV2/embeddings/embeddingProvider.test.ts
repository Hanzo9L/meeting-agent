import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { decodeFloat32Vector, encodeFloat32Vector, EmbeddingCodecError } from "../store";
import { EmbeddingService } from "./embeddingService";
import { FakeEmbeddingProvider } from "./fakeEmbeddingProvider";
import { HostedOpenAiEmbeddingProvider } from "./hostedEmbeddingProvider";
import { EmbeddingProviderError } from "./types";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb09-"));
  return join(root, "knowledge-v2.sqlite");
}

async function saveSyntheticDocumentAndChunk(dbPath: string): Promise<{
  store: ReturnType<typeof createKnowledgeV2SqliteStore>;
  chunkId: string;
}> {
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();
  const parsed = parseCanonicalDocument({
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/doc",
    rawMarkdown: "# Demo\n\nChunk seed body",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "c1",
      blobSha: "b1",
      path: "doc.md"
    }
  });
  assert.ok(parsed.document);
  const saved = store.saveKnowledgeDocument(parsed.document, { parserVersion: "wb09-test" });
  const chunkId = "chunk-wb09";
  store.saveChunkPlaceholder({
    chunkId,
    documentId: saved.documentId,
    sectionId: "sec-1",
    headingPath: ["Demo"],
    chunkKind: "generic",
    text: "Chunk seed body",
    sourceOrder: 1,
    contentHash: "chunk-seed-hash",
    provenance: {},
    metadata: {}
  });
  return { store, chunkId };
}

test("provider abstraction supports document embeddings and query embeddings", async () => {
  const provider = new FakeEmbeddingProvider({ dimensions: 6 });
  const docs = await provider.embedDocuments([
    { id: "d1", text: "Enable Teams voice routing policy" },
    { id: "d2", text: "Grant-CsOnlineVoiceRoutingPolicy example" }
  ]);
  const query = await provider.embedQuery({
    id: "q1",
    text: "How to assign Teams voice routing policy?"
  });
  assert.equal(docs.length, 2);
  assert.equal(docs[0]?.dimensions, 6);
  assert.equal(query.dimensions, 6);
  assert.equal(docs[0]?.providerId, provider.providerId);
});

test("fake provider is deterministic for known input", async () => {
  const provider = new FakeEmbeddingProvider({ dimensions: 5, defaultModel: "fake-model" });
  const first = await provider.embedQuery({ id: "q", text: "same input" }, { model: "fake-model" });
  const second = await provider.embedQuery({ id: "q", text: "same input" }, { model: "fake-model" });
  assert.deepEqual(Array.from(first.vector), Array.from(second.vector));
  assert.equal(first.inputContentHash, second.inputContentHash);
});

test("float32 codec round-trips and preserves dimensions/byte length", () => {
  const vector = [0.125, -2.5, 99.5];
  const encoded = encodeFloat32Vector(vector);
  assert.equal(encoded.byteLength, vector.length * 4);
  const decoded = decodeFloat32Vector(encoded, 3);
  assert.equal(decoded.length, 3);
  for (let i = 0; i < decoded.length; i += 1) {
    assert.ok(Math.abs(decoded[i]! - vector[i]!) < 1e-6);
  }
});

test("float32 codec rejects malformed blob and non-finite values", () => {
  assert.throws(
    () => decodeFloat32Vector(Uint8Array.from([1, 2, 3])),
    (error) => error instanceof EmbeddingCodecError
  );
  assert.throws(
    () => encodeFloat32Vector([Number.NaN]),
    (error) => error instanceof EmbeddingCodecError
  );
  assert.throws(
    () => encodeFloat32Vector([Number.POSITIVE_INFINITY]),
    (error) => error instanceof EmbeddingCodecError
  );
});

test("persistence stores identity metadata and reloads synthetic embedding", async () => {
  const dbPath = await makeTempDbPath();
  const { store, chunkId } = await saveSyntheticDocumentAndChunk(dbPath);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "fake-model" });
    const service = new EmbeddingService(store);
    const result = await service.embedChunk({
      chunkId,
      text: "Teams Direct Routing chunk text",
      provider,
      model: "fake-model",
      embeddingSchemaVersion: "v1"
    });
    assert.equal(result.reused, false);

    const loaded = store.getChunkEmbedding({
      chunkId,
      providerId: provider.providerId,
      model: "fake-model",
      dimensions: 4,
      embeddingSchemaVersion: "v1",
      inputContentHash: result.inputContentHash
    });
    assert.ok(loaded);
    assert.equal(loaded?.providerId, provider.providerId);
    assert.equal(loaded?.model, "fake-model");
    assert.equal(loaded?.dimensions, 4);
  } finally {
    store.close();
  }
});

test("embedding reuse/invalidation rules are deterministic", async () => {
  const dbPath = await makeTempDbPath();
  const { store, chunkId } = await saveSyntheticDocumentAndChunk(dbPath);
  try {
    const provider = new FakeEmbeddingProvider({ dimensions: 4, defaultModel: "fake-model-a" });
    const service = new EmbeddingService(store);

    const first = await service.embedChunk({
      chunkId,
      text: "sample chunk text",
      provider,
      model: "fake-model-a",
      embeddingSchemaVersion: "v1"
    });
    assert.equal(first.reused, false);

    const same = await service.embedChunk({
      chunkId,
      text: "sample chunk text",
      provider,
      model: "fake-model-a",
      embeddingSchemaVersion: "v1"
    });
    assert.equal(same.reused, true);

    const changedText = await service.embedChunk({
      chunkId,
      text: "sample chunk text changed",
      provider,
      model: "fake-model-a",
      embeddingSchemaVersion: "v1"
    });
    assert.equal(changedText.reused, false);

    const changedModel = await service.embedChunk({
      chunkId,
      text: "sample chunk text changed",
      provider,
      model: "fake-model-b",
      embeddingSchemaVersion: "v1"
    });
    assert.equal(changedModel.reused, false);

    const changedSchema = await service.embedChunk({
      chunkId,
      text: "sample chunk text changed",
      provider,
      model: "fake-model-b",
      embeddingSchemaVersion: "v2"
    });
    assert.equal(changedSchema.reused, false);
  } finally {
    store.close();
  }
});

test("hosted provider fails clearly without API key and does not leak credentials", async () => {
  const provider = new HostedOpenAiEmbeddingProvider({
    apiKey: "",
    defaultModel: "text-embedding-3-small"
  });
  await assert.rejects(
    async () => {
      await provider.embedQuery({ id: "q1", text: "test text" });
    },
    (error: unknown) => {
      assert.ok(error instanceof EmbeddingProviderError);
      const message = error instanceof Error ? error.message : "";
      assert.equal(message.includes("sk-"), false);
      return true;
    }
  );
});

test("provider failures never fabricate vectors", async () => {
  const provider = new HostedOpenAiEmbeddingProvider({
    client: {
      embeddings: {
        async create(): Promise<{ data: Array<{ embedding: number[]; index: number }>; model: string }> {
          return {
            data: [],
            model: "text-embedding-3-small"
          };
        }
      }
    },
    defaultModel: "text-embedding-3-small"
  });

  await assert.rejects(
    async () => {
      await provider.embedDocuments([{ id: "d1", text: "text" }]);
    },
    (error: unknown) => error instanceof EmbeddingProviderError
  );
});
