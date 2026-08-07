import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createKnowledgeV2SqliteStore,
  type AcquiredDocumentInput,
  parseCanonicalDocument
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { retrieveExactMatches } from "./exactMatchRetriever";
import { buildSafeLexicalQueryForScope, retrieveLexicalCandidates } from "./lexicalRetriever";
import { extractQueryIntent } from "./queryIntentRules";
import { retrieveScopedCandidates } from "./scopedCandidateRetriever";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb14-"));
  return join(root, "knowledge-v2.sqlite");
}

function fixtureDoc(input: AcquiredDocumentInput) {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

function markdown(title: string, body: string, meta: Record<string, string> = {}): string {
  const frontMatter = [
    "---",
    `title: ${title}`,
    ...Object.entries(meta).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
    `# ${title}`,
    "",
    body
  ].join("\n");
  return frontMatter;
}

async function seedRetrievalFixture() {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: MIGRATIONS_DIR
  });
  store.initializeDatabase();

  const docs = {
    teamsAdmin: fixtureDoc({
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      rawMarkdown: markdown(
        "Direct Routing planning",
        "Direct Routing and voice routing describe Teams SBC call flows."
      ),
      revision: {
        transport: "learn_mcp",
        canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
        locale: "en-us",
        retrievedAt: new Date().toISOString(),
        contentHash: "learn-admin-1"
      }
    }),
    teamsPsCmdlet: fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown(
        "Set-CsOnlineVoiceRoutingPolicy",
        "The Set-CsOnlineVoiceRoutingPolicy cmdlet assigns a voice routing policy."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "ps-cmdlet-1",
        blobSha: "ps-cmdlet-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/set-csonlinevoiceroutingpolicy.md"
      }
    }),
    teamsPsConceptual: fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/voice-routing-overview",
      rawMarkdown: markdown(
        "Voice routing overview",
        "Use PowerShell to validate voice routing policy assignments and SBC settings."
      ),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "ps-concept-1",
        blobSha: "ps-concept-blob-1",
        path: "teams/docs-conceptual/voice-routing-overview.md"
      }
    }),
    entra: fixtureDoc({
      sourceId: "ms-entra-docs",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept",
      rawMarkdown: markdown(
        "Conditional Access for unmanaged devices",
        "Conditional Access controls Teams access for unmanaged devices."
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
    graphGa: fixtureDoc({
      sourceId: "ms-graph-docs",
      trackId: "v1-ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/en-us/graph/api/team-list?view=graph-rest-1.0",
      rawMarkdown: markdown(
        "List teams",
        "Microsoft Graph v1.0 exposes Teams data through list teams API."
      ),
      revision: {
        transport: "github",
        repository: "microsoftgraph/microsoft-graph-docs-contrib",
        branch: "main",
        commitSha: "graph-ga-1",
        blobSha: "graph-ga-blob-1",
        path: "api-reference/v1.0/api/team-list.md"
      }
    }),
    graphBeta: fixtureDoc({
      sourceId: "ms-graph-docs",
      trackId: "beta-preview",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/en-us/graph/api/team-list?view=graph-rest-beta",
      rawMarkdown: markdown(
        "List teams (beta)",
        "Microsoft Graph beta API exposes preview Teams meeting data."
      ),
      revision: {
        transport: "github",
        repository: "microsoftgraph/microsoft-graph-docs-contrib",
        branch: "main",
        commitSha: "graph-beta-1",
        blobSha: "graph-beta-blob-1",
        path: "api-reference/beta/api/team-list.md"
      }
    }),
    teamsDev: fixtureDoc({
      sourceId: "ms-teams-dev-docs",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/overview",
      rawMarkdown: markdown("Tabs overview", "Teams app manifest and tab platform guidance."),
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

  for (const doc of Object.values(docs)) {
    store.saveKnowledgeDocument(doc, { parserVersion: "wb14-test-v1" });
  }

  store.saveChunkPlaceholder({
    chunkId: "chunk-teams-admin-dr",
    documentId: docs.teamsAdmin.documentId,
    sectionId: "section-direct-routing",
    headingPath: ["Direct Routing planning"],
    chunkKind: "configuration",
    text: "Direct Routing voice routing requires SBC and policy alignment.",
    sourceOrder: 1,
    contentHash: "hash-admin-dr",
    provenance: { sourceId: docs.teamsAdmin.sourceId },
    metadata: { tags: ["direct routing", "voice routing"] }
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-teams-admin-ca",
    documentId: docs.teamsAdmin.documentId,
    sectionId: "section-ca-teams-impact",
    headingPath: ["Conditional Access impact on Teams"],
    chunkKind: "configuration",
    text: "Teams admin guidance for unmanaged devices references Conditional Access requirements.",
    sourceOrder: 2,
    contentHash: "hash-admin-ca",
    provenance: { sourceId: docs.teamsAdmin.sourceId },
    metadata: { tags: ["conditional access", "unmanaged devices"] }
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-teams-ps-cmdlet",
    documentId: docs.teamsPsCmdlet.documentId,
    sectionId: "section-cmdlet",
    headingPath: ["Set-CsOnlineVoiceRoutingPolicy"],
    chunkKind: "powershell_syntax",
    text: "Set-CsOnlineVoiceRoutingPolicy assigns the online voice routing policy to a user.",
    sourceOrder: 1,
    contentHash: "hash-ps-cmdlet",
    provenance: { sourceId: docs.teamsPsCmdlet.sourceId },
    metadata: { cmdlet: "Set-CsOnlineVoiceRoutingPolicy" }
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-teams-ps-context",
    documentId: docs.teamsPsConceptual.documentId,
    sectionId: "section-context",
    headingPath: ["Voice routing overview"],
    chunkKind: "configuration",
    text: "PowerShell validates voice routing and SBC policy state.",
    sourceOrder: 2,
    contentHash: "hash-ps-context",
    provenance: { sourceId: docs.teamsPsConceptual.sourceId },
    metadata: { tags: ["voice routing"] }
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-entra-ca",
    documentId: docs.entra.documentId,
    sectionId: "section-conditional-access",
    headingPath: ["Conditional Access"],
    chunkKind: "configuration",
    text: "Conditional Access policy for unmanaged devices can limit Teams access.",
    sourceOrder: 1,
    contentHash: "hash-entra-ca",
    provenance: { sourceId: docs.entra.sourceId },
    metadata: {}
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-graph-ga",
    documentId: docs.graphGa.documentId,
    sectionId: "section-graph-v1",
    headingPath: ["Graph v1.0"],
    chunkKind: "reference",
    text: "Graph v1.0 Teams endpoints return team metadata.",
    sourceOrder: 1,
    contentHash: "hash-graph-ga",
    provenance: { sourceId: docs.graphGa.sourceId },
    metadata: {}
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-graph-beta",
    documentId: docs.graphBeta.documentId,
    sectionId: "section-graph-beta",
    headingPath: ["Graph beta"],
    chunkKind: "reference",
    text: "Graph beta exposes preview Teams meeting data fields.",
    sourceOrder: 1,
    contentHash: "hash-graph-beta",
    provenance: { sourceId: docs.graphBeta.sourceId },
    metadata: {}
  });
  store.saveChunkPlaceholder({
    chunkId: "chunk-teams-dev",
    documentId: docs.teamsDev.documentId,
    sectionId: "section-tabs",
    headingPath: ["Teams tabs"],
    chunkKind: "reference",
    text: "Teams app manifest defines tabs, bots, and messaging extensions.",
    sourceOrder: 1,
    contentHash: "hash-teams-dev",
    provenance: { sourceId: docs.teamsDev.sourceId },
    metadata: {}
  });

  const writable = new Database(dbPath);
  writable
    .prepare(
      `
        INSERT INTO chunk_entities (chunk_id, entity_index, entity_type, entity_value)
        VALUES (?, ?, ?, ?)
      `
    )
    .run("chunk-teams-ps-cmdlet", 0, "cmdlet", "Set-CsOnlineVoiceRoutingPolicy");
  writable.close();
  store.close();
  return { dbPath, docs };
}

function buildScope(question: string) {
  const intent = extractQueryIntent(question).intent;
  return routeQueryIntent(intent).scope;
}

test("exact cmdlet match succeeds and preserves exact identity", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("What does Set-CsOnlineVoiceRoutingPolicy do?");
  const exact = retrieveExactMatches({ databasePath: dbPath, scope });
  assert.ok(exact.candidates.length > 0);
  const cmdlet = exact.candidates.find((candidate) =>
    candidate.text.includes("Set-CsOnlineVoiceRoutingPolicy")
  );
  assert.ok(cmdlet);
  assert.equal(cmdlet?.exactMatch?.directiveType, "cmdlet");
  assert.equal(cmdlet?.exactMatch?.directiveValue, "Set-CsOnlineVoiceRoutingPolicy");
});

test("missing required exact match is surfaced diagnostically", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("What does Set-CsOnlineImaginaryPolicy do?");
  const exact = retrieveExactMatches({ databasePath: dbPath, scope });
  assert.equal(exact.candidates.length, 0);
  assert.ok(exact.diagnostics.missedRequired.length > 0);
});

test("direct routing lexical retrieval finds relevant scoped candidates", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.length > 0);
  assert.ok(
    lexical.candidates.some((candidate) =>
      candidate.text.toLowerCase().includes("direct routing")
    )
  );
  assert.ok(!lexical.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-dev-docs"));
});

test("conditional access respects cross-domain scope and excludes powershell", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("How does Conditional Access affect Teams on unmanaged devices?");
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.some((candidate) => candidate.authority.sourceId === "ms-entra-docs"));
  assert.ok(lexical.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-admin"));
  assert.ok(!lexical.candidates.some((candidate) => candidate.authority.sourceId === "ms-teams-powershell"));
});

test("graph beta inclusion follows route policy", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const betaScope = buildScope("How does the Microsoft Graph beta API expose Teams data?");
  const betaLexical = retrieveLexicalCandidates({ databasePath: dbPath, scope: betaScope });
  assert.ok(
    betaLexical.candidates.some(
      (candidate) => candidate.authority.sourceId === "ms-graph-docs" && candidate.authority.trackId === "beta-preview"
    )
  );

  const gaScope = buildScope("How does the Microsoft Graph API expose Teams data?");
  const gaLexical = retrieveLexicalCandidates({ databasePath: dbPath, scope: gaScope });
  assert.ok(!gaLexical.candidates.some((candidate) => candidate.authority.trackId === "beta-preview"));
});

test("source and track filters are enforced from scope", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("How does the Microsoft Graph API expose Teams data?");
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.every((candidate) => candidate.authority.sourceId !== "ms-teams-powershell"));
  assert.ok(lexical.candidates.every((candidate) => candidate.authority.trackId !== "beta-preview"));
});

test("candidate budgets are enforced with truncation diagnostics", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("How does the Microsoft Graph beta API expose Teams data?");
  const constrained = {
    ...scope,
    candidateBudget: {
      ...scope.candidateBudget,
      maxLexicalCandidates: 1
    }
  };
  const combined = retrieveScopedCandidates({ databasePath: dbPath, scope: constrained });
  assert.equal(combined.candidates.length, 1);
  assert.equal(combined.diagnostics.budget.truncated, true);
});

test("tombstoned and ineligible chunks are excluded", async () => {
  const { dbPath, docs } = await seedRetrievalFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const db = new Database(dbPath);
  db.prepare("UPDATE knowledge_chunks SET tombstoned_at = ? WHERE chunk_id = ?")
    .run(new Date().toISOString(), "chunk-teams-ps-context");
  db.prepare("UPDATE documents SET tombstoned_at = ? WHERE document_id = ?")
    .run(new Date().toISOString(), docs.teamsAdmin.documentId);
  db.close();

  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(!lexical.candidates.some((candidate) => candidate.chunkId === "chunk-teams-ps-context"));
  assert.ok(!lexical.candidates.some((candidate) => candidate.documentId === docs.teamsAdmin.documentId));
});

test("duplicate logical results are controlled and deterministic", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("What does Set-CsOnlineVoiceRoutingPolicy do?");
  const first = retrieveScopedCandidates({ databasePath: dbPath, scope });
  const second = retrieveScopedCandidates({ databasePath: dbPath, scope });
  const ids = first.candidates.map((candidate) => candidate.chunkId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(first.candidates, second.candidates);
});

test("fts special characters and injection-like input are safely handled", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope('What does Set-CsOnlineVoiceRoutingPolicy do? " OR 1=1 --');
  const query = buildSafeLexicalQueryForScope(scope);
  assert.ok(!query.query.includes("--"));
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.diagnostics.eligiblePopulation >= lexical.diagnostics.returnedPopulation);
});

test("hyphenated cmdlets remain searchable and provenance is complete", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("What does Set-CsOnlineVoiceRoutingPolicy do?");
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  const hit = lexical.candidates.find((candidate) => candidate.text.includes("Set-CsOnlineVoiceRoutingPolicy"));
  assert.ok(hit);
  assert.ok(hit?.provenance.canonicalUrl.length);
  assert.ok(hit?.provenance.sourcePath.length);
  assert.ok(hit?.provenance.sectionId.length);
});

test("authority metadata remains separate from lexical score with counts reported", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  assert.ok(lexical.candidates.every((candidate) => typeof candidate.scores.lexical === "number"));
  assert.ok(lexical.candidates.every((candidate) => candidate.authority.authorityRoles.length > 0));
  assert.ok(lexical.diagnostics.eligiblePopulation >= 0);
  assert.ok(lexical.diagnostics.matchedPopulation >= lexical.diagnostics.returnedPopulation);
});

test("retrieval path does not invoke network, mcp, llm, or embeddings", async () => {
  const { dbPath } = await seedRetrievalFixture();
  const scope = buildScope("How does Teams Direct Routing voice routing work?");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_should_not_be_used");
  }) as typeof fetch;
  try {
    const result = retrieveScopedCandidates({ databasePath: dbPath, scope });
    assert.ok(result.candidates.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

