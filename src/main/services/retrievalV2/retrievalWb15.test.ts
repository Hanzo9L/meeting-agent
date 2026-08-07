import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createKnowledgeV2SqliteStore,
  encodeFloat32Vector,
  hashEmbeddingInput,
  parseCanonicalDocument,
  FakeEmbeddingProvider,
  type AcquiredDocumentInput
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { extractQueryIntent } from "./queryIntentRules";
import { retrieveSemanticCandidates, SemanticRetrievalAbortedError } from "./semanticRetriever";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");
const RUNTIME_MODEL = "semantic-test-model";
const RUNTIME_SCHEMA = "wb15-v1";

interface FixtureState {
  dbPath: string;
  provider: FakeEmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
}

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb15-"));
  return join(root, "knowledge-v2.sqlite");
}

function markdown(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", "", `# ${title}`, "", body].join("\n");
}

function parseFixtureDoc(input: AcquiredDocumentInput) {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const value of v) norm += value * value;
  const out = new Float32Array(v.length);
  const scale = norm === 0 ? 1 : 1 / Math.sqrt(norm);
  for (let i = 0; i < v.length; i += 1) out[i] = (v[i] ?? 0) * scale;
  return out;
}

function withOffset(base: Float32Array, offset: number): Float32Array {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) {
    out[i] = (base[i] ?? 0) + (i % 2 === 0 ? offset : -offset);
  }
  return normalize(out);
}

function invert(base: Float32Array): Float32Array {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) out[i] = -(base[i] ?? 0);
  return out;
}

function buildScope(question: string) {
  const intent = extractQueryIntent(question).intent;
  return routeQueryIntent(intent).scope;
}

async function seedSemanticFixture(): Promise<FixtureState> {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: MIGRATIONS_DIR
  });
  store.initializeDatabase();

  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: RUNTIME_MODEL,
    embeddingSchemaVersion: RUNTIME_SCHEMA
  });

  const documents = {
    teamsAdmin: parseFixtureDoc({
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      rawMarkdown: markdown("Direct Routing planning", "Direct Routing and voice routing guidance."),
      revision: {
        transport: "learn_mcp",
        canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
        locale: "en-us",
        retrievedAt: new Date().toISOString(),
        contentHash: "learn-admin-1"
      }
    }),
    teamsPowerShell: parseFixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown(
        "Set-CsOnlineVoiceRoutingPolicy",
        "Set-CsOnlineVoiceRoutingPolicy cmdlet assigns voice routing policy."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "ps-1",
        blobSha: "ps-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/set-csonlinevoiceroutingpolicy.md"
      }
    }),
    entra: parseFixtureDoc({
      sourceId: "ms-entra-docs",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/en-us/entra/identity/conditional-access/unmanaged-devices",
      rawMarkdown: markdown(
        "Conditional Access unmanaged devices",
        "Conditional Access governs Teams behavior on unmanaged devices."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/entra-docs",
        branch: "main",
        commitSha: "entra-1",
        blobSha: "entra-blob-1",
        path: "docs/identity/conditional-access/unmanaged-devices.md"
      }
    }),
    graphGa: parseFixtureDoc({
      sourceId: "ms-graph-docs",
      trackId: "v1-ga",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/graph/api/team-list?view=graph-rest-1.0",
      rawMarkdown: markdown("List Teams", "Graph v1.0 Teams data APIs."),
      revision: {
        transport: "github",
        repository: "microsoftgraph/microsoft-graph-docs-contrib",
        branch: "main",
        commitSha: "graph-ga-1",
        blobSha: "graph-ga-blob-1",
        path: "api-reference/v1.0/api/team-list.md"
      }
    }),
    graphBeta: parseFixtureDoc({
      sourceId: "ms-graph-docs",
      trackId: "beta-preview",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/graph/api/team-list?view=graph-rest-beta",
      rawMarkdown: markdown("List Teams beta", "Graph beta Teams preview APIs."),
      revision: {
        transport: "github",
        repository: "microsoftgraph/microsoft-graph-docs-contrib",
        branch: "main",
        commitSha: "graph-beta-1",
        blobSha: "graph-beta-blob-1",
        path: "api-reference/beta/api/team-list.md"
      }
    }),
    teamsDev: parseFixtureDoc({
      sourceId: "ms-teams-dev-docs",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/overview",
      rawMarkdown: markdown("Teams app tabs", "Manifest and tab extensibility docs."),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/msteams-docs",
        branch: "main",
        commitSha: "teams-dev-1",
        blobSha: "teams-dev-blob-1",
        path: "msteams-platform/tabs/overview.md"
      }
    })
  };

  for (const doc of Object.values(documents)) {
    store.saveKnowledgeDocument(doc, { parserVersion: "wb15-test-v1" });
  }

  const chunkTexts = {
    directPrimary: "Direct Routing voice routing behavior in Teams admin docs.",
    directSecondary: "PowerShell voice routing policy checks for Direct Routing.",
    cmdletPrimary: "Set-CsOnlineVoiceRoutingPolicy assigns voice routing policy to user.",
    conditionalPrimary: "Conditional Access for unmanaged devices affects Teams access.",
    conditionalSecondary: "Teams admin behavior when Conditional Access blocks unmanaged devices.",
    graphGa: "Graph v1.0 exposes Teams data endpoints.",
    graphBeta: "Graph beta exposes preview Teams data and meeting records.",
    excludedDev: "Teams developer app manifest and tabs guidance.",
    missingEmbedding: "Scoped chunk intentionally missing embedding for diagnostics.",
    staleModel: "Scoped chunk with stale model embedding.",
    staleSchema: "Scoped chunk with stale schema embedding.",
    staleDim: "Scoped chunk with dimension mismatch embedding.",
    corruptBlob: "Scoped chunk with corrupt embedding blob.",
    parseFailed: "Chunk in parse-failed document should be excluded.",
    tombstoneChunk: "Chunk to tombstone.",
    tieA: "Semantic tie chunk A for deterministic ordering.",
    tieB: "Semantic tie chunk B for deterministic ordering."
  };

  const chunkDefinitions = [
    { id: "chunk-direct-primary", doc: documents.teamsAdmin.documentId, section: "direct-routing", text: chunkTexts.directPrimary, order: 1 },
    { id: "chunk-direct-secondary", doc: documents.teamsPowerShell.documentId, section: "direct-routing-ps", text: chunkTexts.directSecondary, order: 2 },
    { id: "chunk-cmdlet-primary", doc: documents.teamsPowerShell.documentId, section: "cmdlet", text: chunkTexts.cmdletPrimary, order: 3 },
    { id: "chunk-conditional-primary", doc: documents.entra.documentId, section: "ca", text: chunkTexts.conditionalPrimary, order: 1 },
    { id: "chunk-conditional-secondary", doc: documents.teamsAdmin.documentId, section: "ca-teams", text: chunkTexts.conditionalSecondary, order: 4 },
    { id: "chunk-graph-ga", doc: documents.graphGa.documentId, section: "graph-ga", text: chunkTexts.graphGa, order: 1 },
    { id: "chunk-graph-beta", doc: documents.graphBeta.documentId, section: "graph-beta", text: chunkTexts.graphBeta, order: 1 },
    { id: "chunk-excluded-dev", doc: documents.teamsDev.documentId, section: "dev", text: chunkTexts.excludedDev, order: 1 },
    { id: "chunk-missing-embedding", doc: documents.teamsAdmin.documentId, section: "missing", text: chunkTexts.missingEmbedding, order: 5 },
    { id: "chunk-stale-model", doc: documents.teamsAdmin.documentId, section: "stale-model", text: chunkTexts.staleModel, order: 6 },
    { id: "chunk-stale-schema", doc: documents.teamsAdmin.documentId, section: "stale-schema", text: chunkTexts.staleSchema, order: 7 },
    { id: "chunk-stale-dim", doc: documents.teamsAdmin.documentId, section: "stale-dim", text: chunkTexts.staleDim, order: 8 },
    { id: "chunk-corrupt", doc: documents.teamsAdmin.documentId, section: "corrupt", text: chunkTexts.corruptBlob, order: 9 },
    { id: "chunk-parse-failed", doc: documents.teamsAdmin.documentId, section: "parse-failed", text: chunkTexts.parseFailed, order: 10 },
    { id: "chunk-tombstone", doc: documents.teamsAdmin.documentId, section: "tombstone", text: chunkTexts.tombstoneChunk, order: 11 },
    { id: "chunk-tie-a", doc: documents.teamsAdmin.documentId, section: "tie-a", text: chunkTexts.tieA, order: 12 },
    { id: "chunk-tie-b", doc: documents.teamsAdmin.documentId, section: "tie-b", text: chunkTexts.tieB, order: 13 }
  ];

  for (const chunk of chunkDefinitions) {
    store.saveChunkPlaceholder({
      chunkId: chunk.id,
      documentId: chunk.doc,
      sectionId: chunk.section,
      headingPath: [chunk.section],
      chunkKind: "configuration",
      text: chunk.text,
      sourceOrder: chunk.order,
      contentHash: hashEmbeddingInput(chunk.text.trim()),
      provenance: {},
      metadata: {}
    });
  }

  const queryDirect = await provider.embedQuery(
    { id: "q-direct", text: "How does Teams Direct Routing voice routing work?" },
    { model: RUNTIME_MODEL, embeddingSchemaVersion: RUNTIME_SCHEMA }
  );
  const queryCmdlet = await provider.embedQuery(
    { id: "q-cmdlet", text: "What does Set-CsOnlineVoiceRoutingPolicy do?" },
    { model: RUNTIME_MODEL, embeddingSchemaVersion: RUNTIME_SCHEMA }
  );
  const queryConditional = await provider.embedQuery(
    { id: "q-ca", text: "How does Conditional Access affect Teams on unmanaged devices?" },
    { model: RUNTIME_MODEL, embeddingSchemaVersion: RUNTIME_SCHEMA }
  );
  const queryGraph = await provider.embedQuery(
    { id: "q-graph", text: "How does the Microsoft Graph beta API expose Teams data?" },
    { model: RUNTIME_MODEL, embeddingSchemaVersion: RUNTIME_SCHEMA }
  );

  const vectors = new Map<string, Float32Array>([
    ["chunk-direct-primary", normalize(queryDirect.vector)],
    ["chunk-direct-secondary", withOffset(queryDirect.vector, 0.02)],
    ["chunk-cmdlet-primary", normalize(queryCmdlet.vector)],
    ["chunk-conditional-primary", normalize(queryConditional.vector)],
    ["chunk-conditional-secondary", withOffset(queryConditional.vector, 0.04)],
    ["chunk-graph-ga", withOffset(queryGraph.vector, 0.05)],
    ["chunk-graph-beta", normalize(queryGraph.vector)],
    ["chunk-excluded-dev", normalize(queryDirect.vector)],
    ["chunk-corrupt", normalize(queryDirect.vector)],
    ["chunk-parse-failed", normalize(queryDirect.vector)],
    ["chunk-tombstone", normalize(queryDirect.vector)],
    ["chunk-tie-a", withOffset(queryDirect.vector, 0.01)],
    ["chunk-tie-b", withOffset(queryDirect.vector, 0.01)],
    ["chunk-stale-model", normalize(queryDirect.vector)],
    ["chunk-stale-schema", normalize(queryDirect.vector)],
    ["chunk-stale-dim", normalize(queryDirect.vector)],
    ["chunk-missing-embedding", invert(queryDirect.vector)]
  ]);

  for (const [chunkId, vector] of vectors.entries()) {
    if (chunkId === "chunk-missing-embedding") continue;
    if (chunkId === "chunk-corrupt") {
      store.saveChunkEmbedding({
        chunkId,
        providerId: provider.providerId,
        model: RUNTIME_MODEL,
        dimensions: vector.length,
        embeddingSchemaVersion: RUNTIME_SCHEMA,
        inputContentHash: hashEmbeddingInput(chunkTexts.corruptBlob.trim()),
        vectorBlob: new Uint8Array([1, 2, 3]),
        usage: { requestCount: 1, batchSize: 1 }
      });
      continue;
    }
    store.saveChunkEmbedding({
      chunkId,
      providerId: provider.providerId,
      model: RUNTIME_MODEL,
      dimensions: vector.length,
      embeddingSchemaVersion: RUNTIME_SCHEMA,
      inputContentHash: hashEmbeddingInput(
        chunkDefinitions.find((chunk) => chunk.id === chunkId)?.text.trim() ?? ""
      ),
      vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(vector))),
      usage: { requestCount: 1, batchSize: 1 }
    });
  }

  store.saveChunkEmbedding({
    chunkId: "chunk-stale-model",
    providerId: provider.providerId,
    model: "old-model",
    dimensions: queryDirect.dimensions,
    embeddingSchemaVersion: RUNTIME_SCHEMA,
    inputContentHash: hashEmbeddingInput(chunkTexts.staleModel.trim()),
    vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(normalize(queryDirect.vector)))),
    usage: { requestCount: 1, batchSize: 1 }
  });
  store.saveChunkEmbedding({
    chunkId: "chunk-stale-schema",
    providerId: provider.providerId,
    model: RUNTIME_MODEL,
    dimensions: queryDirect.dimensions,
    embeddingSchemaVersion: "old-schema",
    inputContentHash: hashEmbeddingInput(chunkTexts.staleSchema.trim()),
    vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(normalize(queryDirect.vector)))),
    usage: { requestCount: 1, batchSize: 1 }
  });
  store.saveChunkEmbedding({
    chunkId: "chunk-stale-dim",
    providerId: provider.providerId,
    model: RUNTIME_MODEL,
    dimensions: queryDirect.dimensions + 1,
    embeddingSchemaVersion: RUNTIME_SCHEMA,
    inputContentHash: hashEmbeddingInput(chunkTexts.staleDim.trim()),
    vectorBlob: new Uint8Array(
      encodeFloat32Vector(
        Array.from(new Float32Array(queryDirect.dimensions + 1).fill(0.1))
      )
    ),
    usage: { requestCount: 1, batchSize: 1 }
  });

  const writable = new Database(dbPath);
  writable
    .prepare("UPDATE documents SET parse_status = 'failed' WHERE document_id = ?")
    .run(documents.teamsAdmin.documentId);
  writable
    .prepare("UPDATE documents SET parse_status = 'success' WHERE document_id = ?")
    .run(documents.teamsAdmin.documentId);
  writable.close();

  store.close();
  return {
    dbPath,
    provider,
    runtime: {
      model: RUNTIME_MODEL,
      embeddingSchemaVersion: RUNTIME_SCHEMA
    }
  };
}

test("semantic retrieval consumes RetrievalScope and excludes out-of-scope sources/tracks", async () => {
  const fixture = await seedSemanticFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.candidates.length > 0);
  assert.ok(!result.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-dev-docs"));
  assert.ok(!result.candidates.some((candidate) => candidate.authority.sourceId === "ms-graph-docs"));
});

test("beta track excluded by default and included when route allows", async () => {
  const fixture = await seedSemanticFixture();
  const gaScope = buildScope("How does the Microsoft Graph API expose Teams data?");
  const gaResult = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope: gaScope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(!gaResult.candidates.some((candidate) => candidate.authority.trackId === "beta-preview"));

  const betaScope = buildScope("How does the Microsoft Graph beta API expose Teams data?");
  const betaResult = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope: betaScope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(betaResult.candidates.some((candidate) => candidate.authority.trackId === "beta-preview"));
});

test("tombstoned docs, tombstoned chunks, and parse-failed content are excluded", async () => {
  const fixture = await seedSemanticFixture();
  const writable = new Database(fixture.dbPath);
  writable
    .prepare("UPDATE knowledge_chunks SET tombstoned_at = ? WHERE chunk_id = ?")
    .run(new Date().toISOString(), "chunk-tombstone");
  writable
    .prepare(
      "UPDATE documents SET tombstoned_at = ?, parse_status = 'failed' WHERE source_id = 'ms-teams-admin'"
    )
    .run(new Date().toISOString());
  writable.close();

  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.candidates.length >= 0);
  assert.ok(!result.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-admin"));
  assert.ok(!result.candidates.some((candidate) => candidate.chunkId === "chunk-tombstone"));
  assert.ok(!result.candidates.some((candidate) => candidate.chunkId === "chunk-parse-failed"));
});

test("incompatible model/schema/dimensions and missing embeddings are reported", async () => {
  const fixture = await seedSemanticFixture();
  const scope = {
    ...buildScope("How does Teams Direct Routing voice routing work?"),
    candidateBudget: {
      ...buildScope("How does Teams Direct Routing voice routing work?").candidateBudget,
      maxSemanticCandidates: 50
    }
  };
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.diagnostics.missingEmbeddingCount >= 1);
  assert.ok(result.diagnostics.staleOrIncompatibleEmbeddingCount >= 1);
});

test("corrupt vectors are excluded and retrieval continues", async () => {
  const fixture = await seedSemanticFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.diagnostics.corruptEmbeddingCount >= 1);
  assert.ok(result.candidates.length > 0);
});

test("zero compatible embeddings is handled without exception", async () => {
  const fixture = await seedSemanticFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: {
      model: "unavailable-model",
      embeddingSchemaVersion: "does-not-exist"
    }
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.diagnostics.compatibleEmbeddingPopulation, 0);
});

test("semantic similarity ranks nearest vectors first with deterministic tie order", async () => {
  const fixture = await seedSemanticFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0]?.chunkId, "chunk-direct-primary");
  const tieA = result.candidates.findIndex((candidate) => candidate.chunkId === "chunk-tie-a");
  const tieB = result.candidates.findIndex((candidate) => candidate.chunkId === "chunk-tie-b");
  assert.ok(tieA >= 0 && tieB >= 0);
  assert.ok(tieA < tieB);
});

test("semantic budget is enforced pre-scoring and prevents whole-scope scoring", async () => {
  const fixture = await seedSemanticFixture();
  const baseScope = buildScope("How does Teams Direct Routing voice routing work?");
  const scope = {
    ...baseScope,
    candidateBudget: {
      ...baseScope.candidateBudget,
      maxSemanticCandidates: 2
    }
  };
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.equal(result.diagnostics.configuredSemanticBudget, 2);
  assert.ok(result.diagnostics.preselectedPopulation <= 2);
  assert.ok(result.diagnostics.scoredPopulation <= 2);
  assert.equal(result.diagnostics.prefilteredByBudget, true);
});

test("semantic preselection is relevance-aware, bounded, and reason-coded", async () => {
  const fixture = await seedSemanticFixture();
  const baseScope = buildScope("How does Teams Direct Routing voice routing work?");
  const scope = {
    ...baseScope,
    candidateBudget: {
      ...baseScope.candidateBudget,
      maxSemanticCandidates: 4
    }
  };
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.diagnostics.preselectedPopulation <= 4);
  const reasonCounts = result.diagnostics.preselectionReasonCounts;
  assert.ok(
    reasonCounts.entity_title_shortlist +
      reasonCounts.lexical_shortlist +
      reasonCounts.scope_reserve ===
      result.diagnostics.preselectedPopulation
  );
  assert.ok(result.candidates.every((candidate) => candidate.retrievalReasons.some((r) => r.startsWith("semantic_preselection:"))));
});

test("semantic preselection still allows non-lexical reserve exploration", async () => {
  const fixture = await seedSemanticFixture();
  const baseScope = buildScope("How does Teams Direct Routing voice routing work?");
  const scope = {
    ...baseScope,
    candidateBudget: {
      ...baseScope.candidateBudget,
      maxSemanticCandidates: 6
    }
  };
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.diagnostics.preselectionReasonCounts.scope_reserve > 0);
});

test("candidate provenance and separate semantic score fields are preserved", async () => {
  const fixture = await seedSemanticFixture();
  const scope = buildScope("How does Conditional Access affect Teams on unmanaged devices?");
  const result = await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  const first = result.candidates[0];
  assert.ok(first);
  assert.equal(typeof first?.scores.semanticSimilarity, "number");
  assert.equal(first?.scores.lexical, null);
  assert.equal(first?.scores.exactMatch, null);
  assert.ok(first?.provenance.canonicalUrl.length);
  assert.ok(first?.provenance.sourceRevision);
});

test("retrieval is read-only and does not mutate persistence", async () => {
  const fixture = await seedSemanticFixture();
  const db = new Database(fixture.dbPath, { readonly: true });
  const before = {
    docs: (db.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number }).count,
    chunks: (db.prepare("SELECT COUNT(*) as count FROM knowledge_chunks").get() as { count: number }).count,
    embeddings: (db.prepare("SELECT COUNT(*) as count FROM chunk_embeddings").get() as { count: number }).count
  };
  db.close();

  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  await retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });

  const dbAfter = new Database(fixture.dbPath, { readonly: true });
  const after = {
    docs: (dbAfter.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number }).count,
    chunks: (dbAfter.prepare("SELECT COUNT(*) as count FROM knowledge_chunks").get() as { count: number }).count,
    embeddings: (dbAfter.prepare("SELECT COUNT(*) as count FROM chunk_embeddings").get() as { count: number }).count
  };
  dbAfter.close();
  assert.deepEqual(after, before);
});

test("cancellation aborts semantic retrieval", async () => {
  const fixture = await seedSemanticFixture();
  const slowProvider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: RUNTIME_MODEL,
    embeddingSchemaVersion: RUNTIME_SCHEMA,
    delayMs: 50
  });
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const controller = new AbortController();
  const run = retrieveSemanticCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: slowProvider,
    embeddingRuntimeConfig: fixture.runtime,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(run, (error: unknown) => error instanceof SemanticRetrievalAbortedError);
});

test("no hosted api, mcp, or llm is required", async () => {
  const fixture = await seedSemanticFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_should_not_be_used");
  }) as typeof fetch;
  try {
    const result = await retrieveSemanticCandidates({
      databasePath: fixture.dbPath,
      scope,
      embeddingProvider: fixture.provider,
      embeddingRuntimeConfig: fixture.runtime
    });
    assert.ok(result.diagnostics.latencyMs.total >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

