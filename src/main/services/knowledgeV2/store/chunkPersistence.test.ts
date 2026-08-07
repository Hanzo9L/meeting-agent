import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chunkKnowledgeDocument } from "../chunking";
import type { AcquiredDocumentInput, KnowledgeDocument } from "../parse";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "./sqliteStore";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-cg01b-"));
  return join(root, "knowledge-v2.sqlite");
}

async function loadFixture(name: string): Promise<AcquiredDocumentInput> {
  const raw = await readFile(resolve(`src/main/services/knowledgeV2/parse/fixtures/${name}`), "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

function parseFixture(input: AcquiredDocumentInput): KnowledgeDocument {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

function mkSetCsDoc(versionSuffix: string): KnowledgeDocument {
  const acquired: AcquiredDocumentInput = {
    sourceId: "ms-teams-powershell",
    trackId: "ga",
    transport: "github",
    canonicalUrl:
      "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
    rawMarkdown: [
      "---",
      "title: Set-CsOnlineVoiceRoutingPolicy",
      "---",
      "",
      "# Set-CsOnlineVoiceRoutingPolicy",
      "",
      "## SYNOPSIS",
      "",
      "Sets an online voice routing policy.",
      "",
      "## PARAMETERS",
      "",
      "### -Identity",
      "",
      "Specifies the identity of the policy assignment.",
      "",
      "### -OnlineVoiceRoutingPolicy",
      "",
      `Specifies the policy name marker${versionSuffix}only.`
    ].join("\n"),
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/office-docs-powershell",
      branch: "main",
      commitSha: `setcs-${versionSuffix}`,
      blobSha: `setcs-blob-${versionSuffix}`,
      path: "teams/teams-ps/MicrosoftTeams/Set-CsOnlineVoiceRoutingPolicy.md"
    }
  };
  return parseFixture(acquired);
}

test("CG-01A chunks persist with full round-trip fidelity and stable IDs", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = parseFixture(await loadFixture("teams-powershell-cmdlet.json"));
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-test-v1" });
    const chunked = chunkKnowledgeDocument(document);
    const result = store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    assert.equal(result.newChunkCount, chunked.chunks.length);
    assert.equal(result.inserted, chunked.chunks.length);
    assert.equal(result.tombstoned, 0);
    assert.equal(store.countActiveChunks({ documentId: saved.documentId }), chunked.chunks.length);
    const persisted = store.listChunksForDocument({ documentId: saved.documentId });
    assert.equal(persisted.length, chunked.chunks.length);

    const source = chunked.chunks[0];
    assert.ok(source);
    const loaded = store.getChunk(source.chunkId);
    assert.ok(loaded);
    assert.equal(loaded?.chunkId, source.chunkId);
    assert.equal(loaded?.retrievalText, source.retrievalText);
    assert.equal(loaded?.contentHash, source.contentHash);
    assert.equal(loaded?.chunkerVersion, source.chunkerVersion);
    assert.deepEqual(loaded?.headingPath, source.headingPath);
    assert.equal((loaded?.metadata.inheritedMetadata as { sourceId: string }).sourceId, source.sourceId);
    assert.deepEqual(loaded?.metadata.exactEntities, source.exactEntities);
    assert.equal((loaded?.provenance.sourcePath as string).length > 0, true);
    assert.equal(store.listChunkEmbeddings({}).length, 0);
  } finally {
    store.close();
  }
});

test("Direct Routing fixture persists 35 chunks and becomes searchable in FTS", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = parseFixture(await loadFixture("teams-admin-learn-direct-routing.json"));
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-test-v1" });
    const chunked = chunkKnowledgeDocument(document);
    assert.equal(chunked.chunks.length, 35);
    const result = store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    assert.equal(result.inserted, 35);
    const hits = store.lexicalSearchChunks({
      query: "Direct Routing voice routing",
      sourceId: document.sourceId,
      trackId: document.trackId,
      limit: 5
    });
    assert.ok(hits.length > 0);
    assert.ok(hits.some((hit) => hit.chunkText.toLowerCase().includes("direct routing")));
  } finally {
    store.close();
  }
});

test("PowerShell cmdlet and parameter chunks persist and are searchable via FTS", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = mkSetCsDoc("v1");
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-test-v1" });
    const chunked = chunkKnowledgeDocument(document);
    store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });

    const cmdletHits = store.lexicalSearchChunks({
      query: "Set-CsOnlineVoiceRoutingPolicy",
      sourceId: document.sourceId,
      trackId: document.trackId
    });
    assert.ok(cmdletHits.length > 0);
    const parameterHits = store.lexicalSearchChunks({
      query: "-Identity",
      sourceId: document.sourceId,
      trackId: document.trackId
    });
    assert.ok(parameterHits.length > 0);
    const parameterChunk = chunked.chunks.find((chunk) =>
      chunk.exactEntities.some((entity) => entity.type === "parameter" && entity.value === "-Identity")
    );
    assert.ok(parameterChunk);
    const persistedParameter = parameterChunk ? store.getChunk(parameterChunk.chunkId) : null;
    assert.ok(persistedParameter);
    assert.ok(
      (persistedParameter?.metadata.exactEntities as Array<{ type: string; value: string }>).some(
        (entity) => entity.type === "parameter" && entity.value === "-Identity"
      )
    );
  } finally {
    store.close();
  }
});

test("same chunk set rerun is idempotent with no duplicates or unnecessary churn", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = parseFixture(await loadFixture("teams-powershell-conceptual.json"));
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-test-v1" });
    const chunked = chunkKnowledgeDocument(document);
    const first = store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    const second = store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    assert.equal(first.inserted, chunked.chunks.length);
    assert.equal(second.reused, chunked.chunks.length);
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.tombstoned, 0);
    assert.equal(second.ftsInserted, 0);
    assert.equal(second.ftsUpdated, 0);
    assert.equal(second.ftsRemoved, 0);
    const active = store.countActiveChunks({ documentId: saved.documentId });
    assert.equal(active, chunked.chunks.length);
  } finally {
    store.close();
  }
});

test("changed document replaces affected chunks, tombstones removed chunks, and updates FTS only for changed content", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const docV1 = mkSetCsDoc("v1");
    const savedV1 = store.saveKnowledgeDocument(docV1, { parserVersion: "cg01b-test-v1" });
    const chunksV1 = chunkKnowledgeDocument(docV1);
    const first = store.replaceDocumentChunks({
      documentId: savedV1.documentId,
      chunkerVersion: chunksV1.chunkerVersion,
      chunks: chunksV1.chunks
    });
    assert.ok(first.inserted > 0);

    const docV2 = mkSetCsDoc("v2");
    const savedV2 = store.saveKnowledgeDocument(docV2, { parserVersion: "cg01b-test-v1" });
    assert.equal(savedV1.documentId, savedV2.documentId);
    const chunksV2 = chunkKnowledgeDocument(docV2);
    const second = store.replaceDocumentChunks({
      documentId: savedV2.documentId,
      chunkerVersion: chunksV2.chunkerVersion,
      chunks: chunksV2.chunks
    });
    assert.ok(second.updated + second.reused >= 1);
    assert.ok(second.ftsUpdated >= 1 || second.updated >= 1);
    const staleHits = store.lexicalSearchChunks({
      query: "markerv1only",
      sourceId: docV2.sourceId,
      trackId: docV2.trackId
    });
    assert.equal(staleHits.length, 0);
    const freshHits = store.lexicalSearchChunks({
      query: "markerv2only",
      sourceId: docV2.sourceId,
      trackId: docV2.trackId
    });
    assert.ok(freshHits.length > 0);
  } finally {
    store.close();
  }
});

test("chunker-version replacement tombstones old-version chunks and keeps only current set active", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = parseFixture(await loadFixture("teams-powershell-conceptual.json"));
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-test-v1" });
    const chunksV1 = chunkKnowledgeDocument(document, { chunkerVersion: "cg01a-v1" });
    store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunksV1.chunkerVersion,
      chunks: chunksV1.chunks
    });
    const chunksV2 = chunkKnowledgeDocument(document, { chunkerVersion: "cg01a-v2" });
    const replaced = store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunksV2.chunkerVersion,
      chunks: chunksV2.chunks
    });
    assert.ok(replaced.tombstoned >= chunksV1.chunks.length);
    const lifecycle = store.inspectChunkLifecycle({ documentId: saved.documentId });
    assert.equal(lifecycle.activeChunkCount, chunksV2.chunks.length);
    assert.equal(lifecycle.tombstonedChunkCount >= chunksV1.chunks.length, true);
  } finally {
    store.close();
  }
});

test("transaction rollback prevents half-replaced chunk state on failure", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const document = parseFixture(await loadFixture("teams-powershell-conceptual.json"));
    const saved = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-test-v1" });
    const chunked = chunkKnowledgeDocument(document);
    const first = store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    assert.equal(first.inserted, chunked.chunks.length);
    const brokenChunks = chunked.chunks.map((chunk, index) =>
      index === 0
        ? ({
            ...chunk,
            exactEntities: [{ type: "cmdlet", value: null as unknown as string }]
          } as KnowledgeDocument extends never ? never : typeof chunk)
        : chunk
    );
    assert.throws(() =>
      store.replaceDocumentChunks({
        documentId: saved.documentId,
        chunkerVersion: chunked.chunkerVersion,
        chunks: brokenChunks as typeof chunked.chunks
      })
    );
    const lifecycle = store.inspectChunkLifecycle({ documentId: saved.documentId });
    assert.equal(lifecycle.activeChunkCount, chunked.chunks.length);
    assert.equal(lifecycle.ftsRowCount, chunked.chunks.length);
  } finally {
    store.close();
  }
});

test("tombstoned chunks and tombstoned parent documents are excluded from FTS retrieval", async () => {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const doc = parseFixture(await loadFixture("teams-admin-learn-direct-routing.json"));
    const saved = store.saveKnowledgeDocument(doc, { parserVersion: "cg01b-test-v1" });
    const chunked = chunkKnowledgeDocument(doc);
    store.replaceDocumentChunks({
      documentId: saved.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    const before = store.lexicalSearchChunks({
      query: "Direct Routing",
      sourceId: doc.sourceId,
      trackId: doc.trackId
    });
    assert.ok(before.length > 0);

    store.tombstoneDocument(
      {
        sourceId: doc.sourceId,
        trackId: doc.trackId,
        transport: doc.transport,
        canonicalUrl: doc.canonicalUrl,
        sourcePath: doc.sourcePath,
        locale: doc.sourceRevision.transport === "learn_mcp" ? doc.sourceRevision.locale : undefined
      },
      "test_tombstone"
    );
    const after = store.lexicalSearchChunks({
      query: "Direct Routing",
      sourceId: doc.sourceId,
      trackId: doc.trackId
    });
    assert.equal(after.length, 0);
  } finally {
    store.close();
  }
});
