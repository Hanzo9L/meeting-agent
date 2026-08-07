import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  chunkKnowledgeDocument,
  createKnowledgeV2SqliteStore,
  FakeEmbeddingProvider,
  parseCanonicalDocument
} from "../index";
import type { AcquiredDocumentInput } from "../parse";
import { extractQueryIntent } from "../../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../retrievalV2/domainPolicies";
import { retrieveExactMatches } from "../../retrievalV2/exactMatchRetriever";
import { retrieveLexicalCandidates } from "../../retrievalV2/lexicalRetriever";
import { retrieveSemanticCandidates } from "../../retrievalV2/semanticRetriever";
import { retrieveHybridCandidates } from "../../retrievalV2/hybridRetriever";
import { DocumentIndexingJob } from "./documentIndexingJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-cg01c-"));
  return join(root, "knowledge-v2.sqlite");
}

async function loadFixture(name: string): Promise<AcquiredDocumentInput> {
  const raw = await readFile(resolve(`src/main/services/knowledgeV2/parse/fixtures/${name}`), "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

function makeSetCsFixture(version: string): AcquiredDocumentInput {
  return {
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
      "Specifies identity marker" + version,
      "",
      "### -OnlineVoiceRoutingPolicy",
      "",
      "Specifies routing policy value marker" + version
    ].join("\n"),
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/office-docs-powershell",
      branch: "main",
      commitSha: `setcs-${version}`,
      blobSha: `setcs-blob-${version}`,
      path: "teams/teams-ps/MicrosoftTeams/Set-CsOnlineVoiceRoutingPolicy.md"
    }
  };
}

function makeJob(params: {
  dbPath: string;
  provider: FakeEmbeddingProvider;
  parserVersion?: string;
  chunkerVersion?: string;
  model?: string;
  schema?: string;
}): DocumentIndexingJob {
  return new DocumentIndexingJob({
    storeDatabasePath: params.dbPath,
    migrationsDir: MIGRATIONS_DIR,
    parserVersion: params.parserVersion ?? "cg01c-parser-v1",
    chunkerVersion: params.chunkerVersion ?? "cg01a-v1",
    embeddingIdentity: {
      providerId: params.provider.providerId,
      model: params.model ?? "fake-cg01c-v1",
      dimensions: 8,
      embeddingSchemaVersion: params.schema ?? "v1"
    },
    embeddingBatchSize: 4,
    embeddingProvider: params.provider
  });
}

test("plan mode is dry-run and performs no persistent mutation", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const job = makeJob({ dbPath, provider });
  const plan = await job.run({
    mode: "plan",
    acquiredDocuments: [await loadFixture("teams-admin-learn-direct-routing.json")]
  });
  assert.equal(plan.documents.length, 1);
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: MIGRATIONS_DIR
  });
  try {
    store.initializeDatabase();
    const inspection = store.inspect();
    assert.equal(inspection.documentCount, 0);
    assert.equal(store.countActiveChunks(), 0);
    assert.equal(store.listChunkEmbeddings({}).length, 0);
  } finally {
    store.close();
  }
});

test("Direct Routing fixture indexes end-to-end and is consumable by lexical/semantic/hybrid retrieval", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const job = makeJob({ dbPath, provider });
  const acquired = await loadFixture("teams-admin-learn-direct-routing.json");
  const run = await job.run({ mode: "execute", acquiredDocuments: [acquired] });
  const doc = run.documents[0];
  assert.ok(doc);
  assert.equal(doc?.parse.status, "parse_required_new_document");
  assert.equal(doc?.chunks.newCount, 35);
  assert.equal(doc?.chunks.ftsInserted, 35);
  assert.equal(doc?.embeddings.generatedCount, 35);
  assert.equal(doc?.readiness, "semantic_ready");

  const intent = extractQueryIntent("How does Teams Direct Routing voice routing work?").intent;
  const scope = routeQueryIntent(intent).scope;
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.length > 0);
  const semantic = await retrieveSemanticCandidates({
    databasePath: dbPath,
    scope,
    embeddingProvider: provider,
    embeddingRuntimeConfig: { model: "fake-cg01c-v1", embeddingSchemaVersion: "v1" }
  });
  assert.ok(semantic.candidates.length > 0);
  const hybrid = await retrieveHybridCandidates({
    databasePath: dbPath,
    scope,
    embeddingProvider: provider,
    embeddingRuntimeConfig: { model: "fake-cg01c-v1", embeddingSchemaVersion: "v1" }
  });
  assert.ok(hybrid.candidates.length > 0);
  assert.ok(hybrid.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-admin"));
});

test("PowerShell cmdlet fixture indexes end-to-end and exact retrieval works", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const job = makeJob({ dbPath, provider });
  const acquired = makeSetCsFixture("v1");
  const run = await job.run({ mode: "execute", acquiredDocuments: [acquired] });
  const doc = run.documents[0];
  assert.ok(doc);
  assert.ok((doc?.chunks.newCount ?? 0) > 0);
  assert.ok((doc?.embeddings.generatedCount ?? 0) > 0);

  const intent = extractQueryIntent("What does Set-CsOnlineVoiceRoutingPolicy do?").intent;
  const scope = routeQueryIntent(intent).scope;
  const exact = retrieveExactMatches({ databasePath: dbPath, scope });
  assert.ok(exact.candidates.length > 0);
  assert.ok(exact.candidates.some((candidate) => candidate.text.includes("Set-CsOnlineVoiceRoutingPolicy")));
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.length > 0);
  const semantic = await retrieveSemanticCandidates({
    databasePath: dbPath,
    scope,
    embeddingProvider: provider,
    embeddingRuntimeConfig: { model: "fake-cg01c-v1", embeddingSchemaVersion: "v1" }
  });
  assert.ok(semantic.candidates.length > 0);
});

test("identical second run reuses parse/chunks/fts/embeddings and makes zero embedding calls", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const job = makeJob({ dbPath, provider });
  const acquired = await loadFixture("teams-admin-learn-direct-routing.json");
  const first = await job.run({ mode: "execute", acquiredDocuments: [acquired] });
  assert.ok(first.documents[0]);
  const beforeCalls = provider.getDocumentCallCount();
  const second = await job.run({ mode: "execute", acquiredDocuments: [acquired] });
  const doc = second.documents[0];
  assert.ok(doc);
  assert.equal(doc?.parse.status, "parse_reused");
  assert.equal(doc?.chunks.status, "chunks_reused");
  assert.equal(doc?.chunks.inserted, 0);
  assert.equal(doc?.chunks.updated, 0);
  assert.equal(doc?.chunks.tombstoned, 0);
  assert.equal(doc?.chunks.ftsInserted, 0);
  assert.equal(doc?.chunks.ftsUpdated, 0);
  assert.equal(doc?.chunks.ftsRemoved, 0);
  assert.equal(doc?.embeddings.generatedCount, 0);
  assert.equal(doc?.embeddings.status, "embedding_reused");
  assert.equal(provider.getDocumentCallCount(), beforeCalls);
});

test("source content change reparses and reconciles chunks/fts while reusing unaffected docs", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const job = makeJob({ dbPath, provider });
  const directRouting = await loadFixture("teams-admin-learn-direct-routing.json");
  const cmdlet = makeSetCsFixture("v1");
  await job.run({ mode: "execute", acquiredDocuments: [directRouting, cmdlet] });

  const changed = {
    ...directRouting,
    rawMarkdown: `${directRouting.rawMarkdown}\n\n## CG01C Changed\n\nmarkerchangedcg01c`,
    revision:
      directRouting.revision.transport === "learn_mcp"
        ? { ...directRouting.revision, contentHash: "changed-content-hash" }
        : directRouting.revision
  };
  const rerun = await job.run({ mode: "execute", acquiredDocuments: [changed, cmdlet] });
  const changedDoc = rerun.documents[0];
  const unchangedDoc = rerun.documents[1];
  assert.ok(changedDoc && unchangedDoc);
  assert.equal(changedDoc?.parse.status, "parse_required_source_changed");
  assert.ok(
    (changedDoc?.chunks.updated ?? 0) > 0 ||
      (changedDoc?.chunks.inserted ?? 0) > 0 ||
      (changedDoc?.chunks.ftsUpdated ?? 0) > 0
  );
  assert.equal(unchangedDoc?.parse.status, "parse_reused");
  assert.equal(unchangedDoc?.chunks.status, "chunks_reused");
});

test("parser version change reparses, chunker version change rechunks without reparse, and embedding model change only re-embeds", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const acquired = await loadFixture("teams-powershell-conceptual.json");
  const jobV1 = makeJob({
    dbPath,
    provider,
    parserVersion: "parser-v1",
    chunkerVersion: "cg01a-v1",
    model: "fake-cg01c-v1",
    schema: "v1"
  });
  await jobV1.run({ mode: "execute", acquiredDocuments: [acquired] });

  const jobParserV2 = makeJob({
    dbPath,
    provider,
    parserVersion: "parser-v2",
    chunkerVersion: "cg01a-v1",
    model: "fake-cg01c-v1",
    schema: "v1"
  });
  const parserRun = await jobParserV2.run({ mode: "execute", acquiredDocuments: [acquired] });
  assert.equal(parserRun.documents[0]?.parse.status, "parse_required_parser_version_changed");

  const jobChunkerV2 = makeJob({
    dbPath,
    provider,
    parserVersion: "parser-v2",
    chunkerVersion: "cg01a-v2",
    model: "fake-cg01c-v1",
    schema: "v1"
  });
  const chunkerRun = await jobChunkerV2.run({ mode: "execute", acquiredDocuments: [acquired] });
  assert.equal(chunkerRun.documents[0]?.parse.status, "parse_reused");
  assert.equal(chunkerRun.documents[0]?.chunks.status, "chunked");
  assert.ok((chunkerRun.documents[0]?.chunks.tombstoned ?? 0) >= 1);

  const modelCallsBefore = provider.getDocumentCallCount();
  const jobEmbeddingV2 = makeJob({
    dbPath,
    provider,
    parserVersion: "parser-v2",
    chunkerVersion: "cg01a-v2",
    model: "fake-cg01c-v2",
    schema: "v1"
  });
  const embeddingRun = await jobEmbeddingV2.run({ mode: "execute", acquiredDocuments: [acquired] });
  assert.equal(embeddingRun.documents[0]?.parse.status, "parse_reused");
  assert.equal(embeddingRun.documents[0]?.chunks.status, "chunks_reused");
  assert.ok((embeddingRun.documents[0]?.embeddings.generatedCount ?? 0) > 0);
  assert.ok(provider.getDocumentCallCount() > modelCallsBefore);
});

test("parse failure is isolated and does not block other documents", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1"
  });
  const job = makeJob({ dbPath, provider });
  const broken: AcquiredDocumentInput = {
    sourceId: "ms-teams-admin",
    trackId: "ga",
    transport: "learn_mcp",
    canonicalUrl: "https://learn.microsoft.com/microsoftteams/broken",
    rawMarkdown: "---\ntitle: broken\nms.topic: [oops\n\n# Broken\n\nBody",
    revision: {
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/microsoftteams/broken",
      locale: "en-us",
      retrievedAt: new Date().toISOString(),
      contentHash: "broken"
    }
  };
  const good = await loadFixture("teams-powershell-conceptual.json");
  const run = await job.run({
    mode: "execute",
    acquiredDocuments: [broken, good]
  });
  assert.equal(run.documents.length, 2);
  assert.equal(run.documents[0]?.parse.status, "parse_failed");
  assert.equal(run.documents[0]?.readiness, "failed");
  assert.equal(run.documents[1]?.readiness, "semantic_ready");
});

test("embedding partial failure keeps lexical index usable and reports semantic_partial", async () => {
  const dbPath = await makeTempDbPath();
  const acquired = await loadFixture("teams-powershell-cmdlet.json");
  const parsed = parseCanonicalDocument(acquired);
  assert.ok(parsed.document);
  const chunks = chunkKnowledgeDocument(parsed.document!);
  const failingChunk = chunks.chunks[0]?.chunkId;
  assert.ok(failingChunk);
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1",
    failInputIds: failingChunk ? [failingChunk] : []
  });
  const job = makeJob({ dbPath, provider });
  const run = await job.run({ mode: "execute", acquiredDocuments: [acquired] });
  const doc = run.documents[0];
  assert.ok(doc);
  assert.equal(doc?.embeddings.status, "embedding_partial");
  assert.equal(doc?.readiness, "semantic_partial");
  const intent = extractQueryIntent("What does Add-TeamChannelUser do?").intent;
  const scope = routeQueryIntent(intent).scope;
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.length > 0);
});

test("cancellation stops scheduling new work and preserves committed progress", async () => {
  const dbPath = await makeTempDbPath();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: "fake-cg01c-v1",
    embeddingSchemaVersion: "v1",
    delayMs: 40
  });
  const job = makeJob({ dbPath, provider });
  const acquired1 = await loadFixture("teams-admin-learn-direct-routing.json");
  const acquired2 = await loadFixture("teams-powershell-conceptual.json");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const run = await job.run({
    mode: "execute",
    acquiredDocuments: [acquired1, acquired2],
    signal: controller.signal
  });
  assert.equal(run.summary.cancelled, true);
  assert.ok(run.summary.processedCount >= 1);
});
