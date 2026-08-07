import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createKnowledgeV2SqliteStore,
  encodeFloat32Vector,
  FakeEmbeddingProvider,
  hashEmbeddingInput,
  parseCanonicalDocument,
  type AcquiredDocumentInput
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { scoreHybridCandidate } from "./hybridFusionPolicy";
import {
  HybridRetrievalAbortedError,
  retrieveHybridCandidates
} from "./hybridRetriever";
import { extractQueryIntent } from "./queryIntentRules";
import type { RetrievalCandidate } from "./retrievalCandidates";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");
const MODEL = "hybrid-test-model";
const SCHEMA = "wb16-v1";

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb16-"));
  return join(root, "knowledge-v2.sqlite");
}

function markdown(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", "", `# ${title}`, "", body].join("\n");
}

function fixtureDoc(input: AcquiredDocumentInput) {
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

function buildScope(question: string) {
  return routeQueryIntent(extractQueryIntent(question).intent).scope;
}

async function seedHybridFixture(extraDirectRoutingChunks = 0): Promise<{
  dbPath: string;
  provider: FakeEmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
}> {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: MIGRATIONS_DIR
  });
  store.initializeDatabase();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: MODEL,
    embeddingSchemaVersion: SCHEMA
  });

  const docs = {
    teamsAdmin: fixtureDoc({
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      rawMarkdown: markdown("Direct Routing planning", "Direct Routing conceptual behavior in Teams."),
      revision: {
        transport: "learn_mcp",
        canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
        locale: "en-us",
        retrievedAt: new Date().toISOString(),
        contentHash: "wb16-admin-1"
      }
    }),
    teamsPowerShell: fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown(
        "Set-CsOnlineVoiceRoutingPolicy",
        "Set-CsOnlineVoiceRoutingPolicy cmdlet assigns a voice routing policy."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "wb16-ps-1",
        blobSha: "wb16-ps-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/set-csonlinevoiceroutingpolicy.md"
      }
    }),
    teamsPowerShellGrant: fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/grant-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown(
        "Grant-CsOnlineVoiceRoutingPolicy",
        "Grant-CsOnlineVoiceRoutingPolicy grants voice routing policy to users."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "wb16-ps-grant-1",
        blobSha: "wb16-ps-grant-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/grant-csonlinevoiceroutingpolicy.md"
      }
    }),
    teamsPowerShellGet: fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/get-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown(
        "Get-CsOnlineVoiceRoutingPolicy",
        "Get-CsOnlineVoiceRoutingPolicy retrieves configured voice routing policy values."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "wb16-ps-get-1",
        blobSha: "wb16-ps-get-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/get-csonlinevoiceroutingpolicy.md"
      }
    }),
    teamsPowerShellRemove: fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/remove-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown(
        "Remove-CsOnlineVoiceRoutingPolicy",
        "Remove-CsOnlineVoiceRoutingPolicy removes a voice routing policy."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "wb16-ps-remove-1",
        blobSha: "wb16-ps-remove-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/remove-csonlinevoiceroutingpolicy.md"
      }
    }),
    entra: fixtureDoc({
      sourceId: "ms-entra-docs",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/en-us/entra/identity/conditional-access/unmanaged-devices",
      rawMarkdown: markdown(
        "Conditional Access unmanaged devices",
        "Conditional Access policy affects unmanaged device Teams access."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/entra-docs",
        branch: "main",
        commitSha: "wb16-entra-1",
        blobSha: "wb16-entra-blob-1",
        path: "docs/identity/conditional-access/unmanaged-devices.md"
      }
    }),
    graphGa: fixtureDoc({
      sourceId: "ms-graph-docs",
      trackId: "v1-ga",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/graph/api/team-list?view=graph-rest-1.0",
      rawMarkdown: markdown("List teams v1.0", "Graph v1.0 Teams endpoint semantics."),
      revision: {
        transport: "github",
        repository: "microsoftgraph/microsoft-graph-docs-contrib",
        branch: "main",
        commitSha: "wb16-graph-ga-1",
        blobSha: "wb16-graph-ga-blob-1",
        path: "api-reference/v1.0/api/team-list.md"
      }
    }),
    graphBeta: fixtureDoc({
      sourceId: "ms-graph-docs",
      trackId: "beta-preview",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/graph/api/team-list?view=graph-rest-beta",
      rawMarkdown: markdown("List teams beta", "Graph beta Teams endpoint semantics."),
      revision: {
        transport: "github",
        repository: "microsoftgraph/microsoft-graph-docs-contrib",
        branch: "main",
        commitSha: "wb16-graph-beta-1",
        blobSha: "wb16-graph-beta-blob-1",
        path: "api-reference/beta/api/team-list.md"
      }
    }),
    teamsDev: fixtureDoc({
      sourceId: "ms-teams-dev-docs",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/overview",
      rawMarkdown: markdown("Tabs overview", "Teams app manifest and tabs."),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/msteams-docs",
        branch: "main",
        commitSha: "wb16-dev-1",
        blobSha: "wb16-dev-blob-1",
        path: "msteams-platform/tabs/overview.md"
      }
    })
  };

  for (const doc of Object.values(docs)) {
    store.saveKnowledgeDocument(doc, { parserVersion: "wb16-test-v1" });
  }

  const chunks = [
    {
      chunkId: "chunk-dr-admin",
      documentId: docs.teamsAdmin.documentId,
      sectionId: "direct-routing-concept",
      text: "Direct Routing voice routing behavior depends on SBC and policy configuration.",
      sourceOrder: 1
    },
    {
      chunkId: "chunk-dr-ps",
      documentId: docs.teamsPowerShell.documentId,
      sectionId: "direct-routing-powershell",
      text: "PowerShell validates Direct Routing policy and SBC assignment checks.",
      sourceOrder: 2
    },
    {
      chunkId: "chunk-cmdlet",
      documentId: docs.teamsPowerShell.documentId,
      sectionId: "set-csonlinevoiceroutingpolicy",
      text: "Set-CsOnlineVoiceRoutingPolicy assigns a voice routing policy to a Teams user.",
      sourceOrder: 3
    },
    {
      chunkId: "chunk-cmdlet-grant",
      documentId: docs.teamsPowerShellGrant.documentId,
      sectionId: "grant-csonlinevoiceroutingpolicy",
      text: "Grant-CsOnlineVoiceRoutingPolicy assigns a voice routing policy to a Teams user.",
      sourceOrder: 4
    },
    {
      chunkId: "chunk-cmdlet-get",
      documentId: docs.teamsPowerShellGet.documentId,
      sectionId: "get-csonlinevoiceroutingpolicy",
      text: "Get-CsOnlineVoiceRoutingPolicy retrieves voice routing policy assignments.",
      sourceOrder: 5
    },
    {
      chunkId: "chunk-cmdlet-remove",
      documentId: docs.teamsPowerShellRemove.documentId,
      sectionId: "remove-csonlinevoiceroutingpolicy",
      text: "Remove-CsOnlineVoiceRoutingPolicy removes voice routing policy assignments.",
      sourceOrder: 6
    },
    {
      chunkId: "chunk-ca-entra",
      documentId: docs.entra.documentId,
      sectionId: "conditional-access",
      text: "Conditional Access determines unmanaged device access behavior for Teams sign-in.",
      sourceOrder: 1
    },
    {
      chunkId: "chunk-ca-teams",
      documentId: docs.teamsAdmin.documentId,
      sectionId: "teams-conditional-access-impact",
      text: "Teams admin guidance explains Conditional Access impact on Teams unmanaged devices.",
      sourceOrder: 7
    },
    {
      chunkId: "chunk-graph-ga",
      documentId: docs.graphGa.documentId,
      sectionId: "graph-v1",
      text: "Graph v1.0 exposes Teams data with stable API semantics.",
      sourceOrder: 1
    },
    {
      chunkId: "chunk-graph-beta",
      documentId: docs.graphBeta.documentId,
      sectionId: "graph-beta",
      text: "Graph beta API exposes preview Teams data fields.",
      sourceOrder: 1
    },
    {
      chunkId: "chunk-unrelated-admin",
      documentId: docs.teamsAdmin.documentId,
      sectionId: "holiday-message",
      text: "This section describes holiday messaging and is unrelated to voice routing cmdlets.",
      sourceOrder: 8
    },
    {
      chunkId: "chunk-dev",
      documentId: docs.teamsDev.documentId,
      sectionId: "tabs",
      text: "Teams app tab manifest schema and bot registration details.",
      sourceOrder: 1
    },
    {
      chunkId: "chunk-tie-a",
      documentId: docs.teamsAdmin.documentId,
      sectionId: "tie-a",
      text: "Direct Routing tie chunk A.",
      sourceOrder: 9
    },
    {
      chunkId: "chunk-tie-b",
      documentId: docs.teamsAdmin.documentId,
      sectionId: "tie-b",
      text: "Direct Routing tie chunk B.",
      sourceOrder: 10
    }
  ];
  for (let i = 0; i < extraDirectRoutingChunks; i += 1) {
    chunks.push({
      chunkId: `chunk-dr-extra-${i}`,
      documentId: docs.teamsAdmin.documentId,
      sectionId: `direct-routing-extra-${i}`,
      text: `Direct Routing additional chunk ${i} for candidate cap testing.`,
      sourceOrder: 100 + i
    });
  }

  for (const chunk of chunks) {
    store.saveChunkPlaceholder({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      sectionId: chunk.sectionId,
      headingPath: [chunk.sectionId],
      chunkKind: "configuration",
      text: chunk.text,
      sourceOrder: chunk.sourceOrder,
      contentHash: hashEmbeddingInput(chunk.text.trim()),
      provenance: {},
      metadata: {}
    });
  }

  const queryDirect = await provider.embedQuery(
    { id: "q-direct", text: "How does Teams Direct Routing voice routing work?" },
    { model: MODEL, embeddingSchemaVersion: SCHEMA }
  );
  const queryCmdlet = await provider.embedQuery(
    { id: "q-cmdlet", text: "What does Set-CsOnlineVoiceRoutingPolicy do?" },
    { model: MODEL, embeddingSchemaVersion: SCHEMA }
  );
  const queryConditional = await provider.embedQuery(
    { id: "q-ca", text: "How does Conditional Access affect Teams on unmanaged devices?" },
    { model: MODEL, embeddingSchemaVersion: SCHEMA }
  );
  const queryGraph = await provider.embedQuery(
    { id: "q-graph", text: "How does the Microsoft Graph beta API expose Teams data?" },
    { model: MODEL, embeddingSchemaVersion: SCHEMA }
  );

  const vectorByChunk = new Map<string, Float32Array>([
    ["chunk-dr-admin", normalize(queryDirect.vector)],
    ["chunk-dr-ps", withOffset(queryDirect.vector, 0.015)],
    ["chunk-cmdlet", normalize(queryCmdlet.vector)],
    ["chunk-cmdlet-grant", withOffset(queryCmdlet.vector, 0.02)],
    ["chunk-cmdlet-get", withOffset(queryCmdlet.vector, 0.03)],
    ["chunk-cmdlet-remove", withOffset(queryCmdlet.vector, 0.025)],
    ["chunk-ca-entra", normalize(queryConditional.vector)],
    ["chunk-ca-teams", withOffset(queryConditional.vector, 0.03)],
    ["chunk-graph-ga", withOffset(queryGraph.vector, 0.06)],
    ["chunk-graph-beta", normalize(queryGraph.vector)],
    ["chunk-unrelated-admin", withOffset(queryCmdlet.vector, 0.4)],
    ["chunk-dev", normalize(queryDirect.vector)],
    ["chunk-tie-a", withOffset(queryDirect.vector, 0.02)],
    ["chunk-tie-b", withOffset(queryDirect.vector, 0.02)]
  ]);
  for (let i = 0; i < extraDirectRoutingChunks; i += 1) {
    vectorByChunk.set(`chunk-dr-extra-${i}`, withOffset(queryDirect.vector, 0.05 + i * 0.0001));
  }

  for (const chunk of chunks) {
    const vector = vectorByChunk.get(chunk.chunkId) ?? normalize(queryDirect.vector);
    store.saveChunkEmbedding({
      chunkId: chunk.chunkId,
      providerId: provider.providerId,
      model: MODEL,
      dimensions: vector.length,
      embeddingSchemaVersion: SCHEMA,
      inputContentHash: hashEmbeddingInput(chunk.text.trim()),
      vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(vector))),
      usage: { requestCount: 1, batchSize: 1 }
    });
  }

  const writable = new Database(dbPath);
  writable
    .prepare(
      `
        INSERT INTO chunk_entities (chunk_id, entity_index, entity_type, entity_value)
        VALUES (?, ?, ?, ?)
      `
    )
    .run("chunk-cmdlet", 0, "cmdlet", "Set-CsOnlineVoiceRoutingPolicy");
  writable
    .prepare(
      `
        INSERT INTO chunk_entities (chunk_id, entity_index, entity_type, entity_value)
        VALUES (?, ?, ?, ?)
      `
    )
    .run("chunk-cmdlet-grant", 0, "cmdlet", "Grant-CsOnlineVoiceRoutingPolicy");
  writable
    .prepare(
      `
        INSERT INTO chunk_entities (chunk_id, entity_index, entity_type, entity_value)
        VALUES (?, ?, ?, ?)
      `
    )
    .run("chunk-cmdlet-get", 0, "cmdlet", "Get-CsOnlineVoiceRoutingPolicy");
  writable
    .prepare(
      `
        INSERT INTO chunk_entities (chunk_id, entity_index, entity_type, entity_value)
        VALUES (?, ?, ?, ?)
      `
    )
    .run("chunk-cmdlet-remove", 0, "cmdlet", "Remove-CsOnlineVoiceRoutingPolicy");
  writable.close();
  store.close();

  return {
    dbPath,
    provider,
    runtime: { model: MODEL, embeddingSchemaVersion: SCHEMA }
  };
}

test("exact+lexical+semantic duplicates fuse into one candidate with signals preserved", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("What does Set-CsOnlineVoiceRoutingPolicy do?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  const cmdlet = result.candidates.find((candidate) => candidate.chunkId === "chunk-cmdlet");
  assert.ok(cmdlet);
  assert.deepEqual(cmdlet?.methods, ["exact", "lexical", "semantic"]);
  assert.ok(cmdlet?.methodSignals.exact.matched);
  assert.ok(cmdlet?.methodSignals.lexical.rank !== null);
  assert.ok(cmdlet?.methodSignals.semantic.rank !== null);
  assert.ok(cmdlet?.sourceDedup.mergedFromCandidateIds.length >= 3);
});

test("exact authoritative cmdlet strongly ranks with required exact success", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("What does Set-CsOnlineVoiceRoutingPolicy do?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.equal(result.candidates[0]?.chunkId, "chunk-cmdlet");
  assert.equal(result.candidates[0]?.authority.sourceId, "ms-teams-powershell");
  assert.equal(result.exact.diagnostics.missedRequired.length, 0);
});

test("generic policy wording does not create exact-match dominance", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("How do I assign a voice routing policy to a Teams user?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.equal(
    scope.exactMatchDirectives.some(
      (directive) => directive.type === "policy" && directive.value.toLowerCase() === "policy"
    ),
    false
  );
  assert.equal(result.exact.candidates.length, 0);
  assert.ok(
    result.candidates.slice(0, 5).some((candidate) =>
      candidate.provenance.canonicalUrl.includes("direct-routing")
    )
  );
});

test("Direct Routing applies contextual authority with Teams Admin prominent and PowerShell support", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.candidates.slice(0, 4).some((candidate) => candidate.authority.sourceId === "ms-teams-admin"));
  assert.ok(result.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-powershell"));
  assert.ok(!result.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-dev-docs"));
});

test("Q004-style query keeps voice-routing material in semantic scored population", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("Which cmdlet can I use to grant a voice routing policy to a Teams user?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(
    result.semantic.candidates.some(
      (candidate) =>
        candidate.provenance.canonicalUrl.includes("direct-routing") ||
        candidate.provenance.canonicalUrl.includes("set-csonlinevoiceroutingpolicy")
    )
  );
});

test("implicit set cmdlet intent discovers Set-* authority prominently", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("How do I change a Teams voice routing policy with PowerShell?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(
    result.candidates.slice(0, 5).some((candidate) =>
      candidate.provenance.canonicalUrl.toLowerCase().includes("set-csonlinevoiceroutingpolicy")
    )
  );
});

test("implicit get cmdlet intent discovers Get-* authority prominently", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("Which PowerShell command retrieves a user's voice routing policy?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(
    result.candidates.slice(0, 8).some((candidate) =>
      candidate.provenance.canonicalUrl.toLowerCase().includes("get-csonlinevoiceroutingpolicy")
    )
  );
});

test("implicit remove cmdlet intent can surface Remove-* authority", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("Which command removes a Teams voice routing policy from a user?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(
    result.candidates.slice(0, 12).some((candidate) =>
      candidate.provenance.canonicalUrl.toLowerCase().includes("remove-csonlinevoiceroutingpolicy")
    )
  );
});

test("Conditional Access and Graph authority routing are applied contextually", async () => {
  const fixture = await seedHybridFixture();
  const caScope = buildScope("How does Conditional Access affect Teams on unmanaged devices?");
  const ca = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope: caScope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.equal(ca.candidates[0]?.authority.sourceId, "ms-entra-docs");
  assert.ok(ca.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-admin"));

  const graphScope = buildScope("How does the Microsoft Graph beta API expose Teams data?");
  const graph = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope: graphScope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.equal(graph.candidates[0]?.authority.sourceId, "ms-graph-docs");
});

test("beta remains excluded by default and explicit beta can rank beta evidence", async () => {
  const fixture = await seedHybridFixture();
  const gaScope = buildScope("How does the Microsoft Graph API expose Teams data?");
  const ga = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope: gaScope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(!ga.candidates.some((candidate) => candidate.authority.trackId === "beta-preview"));

  const betaScope = buildScope("How does the Microsoft Graph beta API expose Teams data?");
  const beta = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope: betaScope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.equal(beta.candidates[0]?.authority.trackId, "beta-preview");
});

test("raw method scores and authority signals remain independently observable", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  const first = result.candidates[0];
  assert.ok(first);
  assert.ok(first?.fusion.contributions.exactScore >= 0);
  assert.ok(first?.fusion.contributions.lexicalRank >= 0);
  assert.ok(first?.fusion.contributions.semanticRank >= 0);
  assert.ok(first?.fusion.contributions.routePriority >= 0);
  assert.equal(typeof first?.scores.lexical, "number");
  assert.equal(typeof first?.scores.semanticSimilarity, "number");
  assert.ok(first?.authority.authorityRoles.length);
});

test("required exact miss is retained and does not fabricate cmdlet hit", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("What does Set-CsDefinitelyNotARealCmdlet do?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(result.exact.diagnostics.missedRequired.length > 0);
  assert.ok(result.warnings.includes("required_exact_match_missing"));
  assert.ok(!result.candidates.some((candidate) => candidate.chunkId === "chunk-cmdlet" && candidate.methodSignals.exact.matched));
});

test("final hybrid candidate count is bounded and deterministic", async () => {
  const fixture = await seedHybridFixture(40);
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const first = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  const second = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  assert.ok(first.candidates.length <= first.fusionDiagnostics.cap.finalCandidateCap);
  assert.deepEqual(
    first.candidates.map((candidate) => candidate.chunkId),
    second.candidates.map((candidate) => candidate.chunkId)
  );
});

test("tie ordering, provenance, source metadata, and method-overlap diagnostics survive fusion", async () => {
  const fixture = await seedHybridFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  const tieA = result.candidates.findIndex((candidate) => candidate.chunkId === "chunk-tie-a");
  const tieB = result.candidates.findIndex((candidate) => candidate.chunkId === "chunk-tie-b");
  assert.ok(tieA >= 0 && tieB >= 0);
  assert.ok(tieA < tieB);
  assert.ok(result.candidates.every((candidate) => candidate.provenance.canonicalUrl.length > 0));
  assert.ok(result.candidates.every((candidate) => candidate.authority.trackId.length > 0));
  assert.ok(result.fusionDiagnostics.methodOverlapCounts.allThree >= 0);
});

test("irrelevant primary authority cannot outrank relevant supporting candidate solely from authority", () => {
  const irrelevantPrimary = {
    candidateId: "c1",
    method: "semantic",
    documentId: "d1",
    chunkId: "chunk-irrelevant",
    sectionId: "s1",
    headingPath: [],
    title: "irrelevant",
    text: "irrelevant",
    authority: {
      sourceId: "ms-teams-admin",
      trackId: "ga",
      sourceStatus: "ga",
      authorityTier: "tier1",
      authorityRoles: ["teams_admin_primary"],
      routePriority: "primary"
    },
    provenance: {
      sourcePath: "x",
      canonicalUrl: "x",
      sourceRevision: {},
      headingPath: [],
      sectionId: "s1"
    },
    scores: { lexical: null, exactMatch: null, semanticSimilarity: 0.01 },
    retrievalReasons: []
  } satisfies RetrievalCandidate;
  const relevantSupporting = {
    ...irrelevantPrimary,
    candidateId: "c2",
    chunkId: "chunk-relevant",
    authority: {
      ...irrelevantPrimary.authority,
      sourceId: "ms-teams-powershell",
      authorityRoles: ["teams_powershell_cmdlet_primary"],
      routePriority: "supporting"
    },
    scores: { lexical: 0.0001, exactMatch: 1, semanticSimilarity: 0.99 }
  } satisfies RetrievalCandidate;

  const intent = extractQueryIntent("What does Set-CsOnlineVoiceRoutingPolicy do?").intent;
  const left = scoreHybridCandidate({
    candidate: irrelevantPrimary,
    intent,
    methodSignals: {
      methods: ["semantic"],
      exact: { matched: false, score: null, rank: null },
      lexical: { score: null, rank: null },
      semantic: { similarity: 0.01, rank: 20 }
    }
  });
  const right = scoreHybridCandidate({
    candidate: relevantSupporting,
    intent,
    methodSignals: {
      methods: ["exact", "lexical", "semantic"],
      exact: { matched: true, score: 1, rank: 1 },
      lexical: { score: 0.0001, rank: 1 },
      semantic: { similarity: 0.99, rank: 1 }
    }
  });
  assert.ok(right.contributions.total > left.contributions.total);
});

test("hybrid cancellation propagates and no MCP/LLM or evidence bundle is produced", async () => {
  const fixture = await seedHybridFixture();
  const slowProvider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: MODEL,
    embeddingSchemaVersion: SCHEMA,
    delayMs: 60
  });
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const controller = new AbortController();
  const run = retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: slowProvider,
    embeddingRuntimeConfig: fixture.runtime,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(run, (error: unknown) => error instanceof HybridRetrievalAbortedError);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_should_not_be_used");
  }) as typeof fetch;
  try {
    const ok = await retrieveHybridCandidates({
      databasePath: fixture.dbPath,
      scope,
      embeddingProvider: fixture.provider,
      embeddingRuntimeConfig: fixture.runtime
    });
    assert.ok(ok.diagnostics.orchestrationMode === "overlap_semantic_with_exact_lexical");
    assert.equal("evidenceBundle" in (ok as unknown as Record<string, unknown>), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
