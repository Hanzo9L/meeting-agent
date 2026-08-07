import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AcquiredDocumentInput, KnowledgeDocument } from "../parse";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "./sqliteStore";
import type { FindDocumentIdentityQuery } from "./types";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb08-"));
  return join(root, "knowledge-v2.sqlite");
}

async function loadAcquiredFixture(name: string): Promise<AcquiredDocumentInput> {
  const path = resolve(`src/main/services/knowledgeV2/parse/fixtures/${name}`);
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

async function parseFixture(name: string): Promise<KnowledgeDocument> {
  const acquired = await loadAcquiredFixture(name);
  const parsed = parseCanonicalDocument(acquired);
  assert.ok(parsed.document);
  return parsed.document;
}

function toIdentityQuery(document: KnowledgeDocument): FindDocumentIdentityQuery {
  return {
    sourceId: document.sourceId,
    trackId: document.trackId,
    transport: document.transport,
    canonicalUrl: document.canonicalUrl,
    sourcePath: document.sourcePath,
    locale:
      document.sourceRevision.transport === "learn_mcp" ? document.sourceRevision.locale : undefined
  };
}

test("initializes WB-08 database and applies migrations idempotently", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    assert.equal(store.getSchemaVersion(), 2);
    store.initializeDatabase();
    assert.equal(store.getSchemaVersion(), 2);
    const inspection = store.inspect();
    assert.equal(inspection.documentCount, 0);
    assert.ok(inspection.databasePath.includes("meeting-agent-wb08-"));
  } finally {
    store.close();
  }
});

test("round-trips Teams Admin Learn document without semantic loss", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = await parseFixture("teams-admin-learn-direct-routing.json");
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "wb08-test-v1" });
    assert.equal(saved.created, true);
    const loaded = store.getKnowledgeDocument(saved.documentId);
    assert.ok(loaded);
    assert.equal(loaded?.sourceRevision.transport, "learn_mcp");
    assert.equal(loaded?.rawMarkdown, document.rawMarkdown);
    assert.equal(loaded?.rawFrontMatter, document.rawFrontMatter);
    assert.deepEqual(loaded?.frontMatter, document.frontMatter);
    assert.deepEqual(loaded?.normalizedMetadata, document.normalizedMetadata);
    assert.deepEqual(loaded?.sections, document.sections);
    assert.deepEqual(loaded?.diagnostics, document.diagnostics);
  } finally {
    store.close();
  }
});

test("round-trips Teams PowerShell GitHub document provenance and structure", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = await parseFixture("teams-powershell-cmdlet.json");
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "wb08-test-v1" });
    const loaded = store.getKnowledgeDocument(saved.documentId);
    assert.ok(loaded);
    assert.equal(loaded?.sourceRevision.transport, "github");
    if (loaded?.sourceRevision.transport === "github") {
      assert.equal(loaded.sourceRevision.repository, document.sourceRevision.transport === "github" ? document.sourceRevision.repository : "");
      assert.equal(loaded.sourceRevision.path, document.sourceRevision.transport === "github" ? document.sourceRevision.path : "");
      assert.equal(loaded.sourceRevision.commitSha, document.sourceRevision.transport === "github" ? document.sourceRevision.commitSha : "");
    }
    assert.deepEqual(loaded?.sections, document.sections);
  } finally {
    store.close();
  }
});

test("preserves unknown metadata fields and exact raw source for future reparse", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const acquired: AcquiredDocumentInput = {
      sourceId: "ms-test",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://example.test/custom",
      rawMarkdown:
        "---\ncustomField: preserve\nms.topic: conceptual\ntitle: Custom\n---\n\n# Custom\n\nBody with `inline` code.",
      revision: {
        transport: "github",
        repository: "owner/repo",
        branch: "main",
        commitSha: "commit-a",
        blobSha: "blob-a",
        path: "custom.md"
      }
    };
    const parsed = parseCanonicalDocument(acquired);
    assert.ok(parsed.document);
    const saved = store.saveKnowledgeDocument(parsed.document, { parserVersion: "wb08-test-v1" });
    const loaded = store.getKnowledgeDocument(saved.documentId);
    assert.ok(loaded);
    assert.equal(loaded?.frontMatter.customField, "preserve");
    const raw = store.getDocumentRawSource(saved.documentId);
    assert.ok(raw);
    assert.equal(raw?.rawMarkdown, parsed.document.rawMarkdown);
  } finally {
    store.close();
  }
});

test("stable identity prevents duplicates and changed content updates same logical document", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const initialAcquired = await loadAcquiredFixture("teams-powershell-conceptual.json");
    const initialParsed = parseCanonicalDocument(initialAcquired);
    assert.ok(initialParsed.document);
    const first = store.saveKnowledgeDocument(initialParsed.document, { parserVersion: "wb08-test-v1" });

    const updatedAcquired: AcquiredDocumentInput = {
      ...initialAcquired,
      rawMarkdown: `${initialAcquired.rawMarkdown}\n\n## WB08 Added Section\n\nThis proves update behavior.`,
      revision:
        initialAcquired.revision.transport === "github"
          ? { ...initialAcquired.revision, commitSha: "commit-updated", blobSha: "blob-updated" }
          : initialAcquired.revision
    };
    const updatedParsed = parseCanonicalDocument(updatedAcquired);
    assert.ok(updatedParsed.document);
    const second = store.saveKnowledgeDocument(updatedParsed.document, { parserVersion: "wb08-test-v1" });

    assert.equal(first.documentId, second.documentId);
    const bySource = store.listDocumentsBySource({ sourceId: updatedParsed.document.sourceId, trackId: updatedParsed.document.trackId });
    assert.equal(bySource.length, 1);
    const loaded = store.getKnowledgeDocument(second.documentId);
    assert.ok(loaded?.rawMarkdown.includes("WB08 Added Section"));
  } finally {
    store.close();
  }
});

test("persists GitHub and Learn sync checkpoints independently from registry state", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    store.saveSyncCheckpoint({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      status: "ok",
      lastRevisionFingerprint: "github:commit-1",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      checkpointPayload: {
        commitSha: "commit-1",
        repository: "MicrosoftDocs/office-docs-powershell"
      }
    });
    store.saveSyncCheckpoint({
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp",
      status: "ok",
      lastRevisionFingerprint: "learn:content-hash-1",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      checkpointPayload: {
        canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
        locale: "en-us",
        contentHash: "content-hash-1"
      }
    });

    const github = store.getSyncCheckpoint({ sourceId: "ms-teams-powershell", trackId: "ga" });
    const learn = store.getSyncCheckpoint({ sourceId: "ms-teams-admin", trackId: "ga" });
    assert.ok(github && learn);
    assert.equal(github?.transport, "github");
    assert.equal(learn?.transport, "learn_mcp");
    assert.equal(typeof github?.checkpointPayload["commitSha"], "string");
    assert.equal(typeof learn?.checkpointPayload["canonicalUrl"], "string");
  } finally {
    store.close();
  }
});

test("failed transactional write does not leave partial document rows", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = await parseFixture("teams-powershell-cmdlet.json");
    assert.equal(document.sourceRevision.transport, "github");
    if (document.sourceRevision.transport !== "github") throw new Error("Expected github fixture");

    const broken: KnowledgeDocument = {
      ...document,
      sourceId: "ms-broken",
      sourceRevision: {
        ...document.sourceRevision,
        commitSha: ""
      }
    };

    assert.throws(() => {
      store.saveKnowledgeDocument(broken, { parserVersion: "wb08-test-v1" });
    });

    const loaded = store.findDocumentBySourceIdentity(toIdentityQuery(broken));
    assert.equal(loaded, null);
  } finally {
    store.close();
  }
});

test("temporary source failure checkpoint does not imply document deletion", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = await parseFixture("teams-admin-learn-direct-routing.json");
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "wb08-test-v1" });
    store.saveSyncCheckpoint({
      sourceId: document.sourceId,
      trackId: document.trackId,
      transport: document.transport,
      status: "error",
      lastRevisionFingerprint: "error-state",
      lastSyncedAt: new Date().toISOString(),
      lastError: "network_error",
      checkpointPayload: { code: "network_error" }
    });
    const loaded = store.getKnowledgeDocument(saved.documentId);
    assert.ok(loaded);
    const listed = store.listDocumentsBySource({ sourceId: document.sourceId, trackId: document.trackId });
    assert.equal(listed.length, 1);
  } finally {
    store.close();
  }
});

test("supports future embedding binary persistence with synthetic vectors", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = await parseFixture("teams-powershell-cmdlet.json");
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "wb08-test-v1" });
    store.saveChunkPlaceholder({
      chunkId: "chunk-1",
      documentId: saved.documentId,
      sectionId: "sec-1",
      headingPath: ["Root", "Section"],
      chunkKind: "generic",
      text: "sample chunk",
      sourceOrder: 1,
      contentHash: "chunkhash-1",
      provenance: { source: "test" },
      metadata: {}
    });

    const vector = new Uint8Array(Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer));
    store.saveChunkEmbedding({
      chunkId: "chunk-1",
      providerId: "test-provider",
      model: "test-model",
      dimensions: 3,
      embeddingSchemaVersion: "v1",
      inputContentHash: "chunkhash-1",
      vectorBlob: vector,
      usage: { requestCount: 1, batchSize: 1 }
    });
    const loaded = store.getChunkEmbedding({
      chunkId: "chunk-1",
      providerId: "test-provider",
      model: "test-model",
      dimensions: 3,
      embeddingSchemaVersion: "v1",
      inputContentHash: "chunkhash-1"
    });
    assert.ok(loaded);
    assert.equal(loaded?.dimensions, 3);
    assert.deepEqual(Array.from(loaded?.vectorBlob ?? []), Array.from(vector));
  } finally {
    store.close();
  }
});
