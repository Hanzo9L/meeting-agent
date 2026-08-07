import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { encodeFloat32Vector } from "../store/embeddingCodec";
import type { LearnMcpClient, LearnMcpTool } from "../acquisition/learnMcpClient";
import {
  TEAMS_ADMIN_DISCOVERY_QUERIES,
  TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION
} from "./queryManifest";
import { TEAMS_ADMIN_TAXONOMY } from "./taxonomy";
import { TeamsAdminDiscoveryJob } from "./teamsAdminDiscoveryJob";
import { normalizeLearnUrl } from "./urlNormalization";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempPaths(): Promise<{ dbPath: string; artifactsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-cg01e1-"));
  return {
    dbPath: join(root, "knowledge-v2.sqlite"),
    artifactsDir: join(root, "artifacts")
  };
}

function buildMockClient(searchDataByQuery: Record<string, unknown>): LearnMcpClient {
  const tools: LearnMcpTool[] = [
    { name: "microsoft_docs_search", description: "Search Microsoft Docs" },
    { name: "microsoft_docs_fetch", description: "Fetch Microsoft Docs page" }
  ];
  return {
    async initialize() {},
    async listTools() {
      return tools;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      if (!name.toLowerCase().includes("search")) return [];
      const query = typeof args.query === "string" ? args.query : "";
      return searchDataByQuery[query] ?? [];
    }
  };
}

async function seedPowerShellCorpus(dbPath: string): Promise<void> {
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();
  try {
    const parsed = parseCanonicalDocument({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://github.com/MicrosoftDocs/office-docs-powershell/blob/main/teams/teams-ps/MicrosoftTeams/Test-Cmdlet.md",
      rawMarkdown: "# Test-Cmdlet\n\n## SYNOPSIS\n\nUsed in tests.",
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "seed",
        blobSha: "seed-blob",
        path: "teams/teams-ps/MicrosoftTeams/Test-Cmdlet.md"
      }
    });
    assert.ok(parsed.document);
    const saved = store.saveKnowledgeDocument(parsed.document, { parserVersion: "cg01e1-seed" });
    store.saveChunkPlaceholder({
      chunkId: "seed-chunk",
      documentId: saved.documentId,
      sectionId: "sec-1",
      headingPath: ["Test-Cmdlet"],
      chunkKind: "powershell_cmdlet",
      text: "Test-Cmdlet config text",
      sourceOrder: 1,
      contentHash: "seed-hash",
      provenance: {},
      metadata: {}
    });
    store.saveChunkEmbedding({
      chunkId: "seed-chunk",
      providerId: "fake",
      model: "seed",
      dimensions: 4,
      embeddingSchemaVersion: "v1",
      inputContentHash: "seed-hash",
      vectorBlob: new Uint8Array(encodeFloat32Vector([1, 2, 3, 4])),
      usage: { requestCount: 1, batchSize: 1, inputTokens: 10 }
    });
  } finally {
    store.close();
  }
}

test("query manifest loads with unique IDs and deterministic taxonomy mapping", () => {
  assert.equal(TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION, "cg01e1-query-manifest-v1");
  assert.ok(TEAMS_ADMIN_DISCOVERY_QUERIES.length >= 12);
  const ids = new Set(TEAMS_ADMIN_DISCOVERY_QUERIES.map((q) => q.queryId));
  assert.equal(ids.size, TEAMS_ADMIN_DISCOVERY_QUERIES.length);
  const taxonomyIds = new Set(TEAMS_ADMIN_TAXONOMY.domains.map((d) => d.domainId));
  for (const query of TEAMS_ADMIN_DISCOVERY_QUERIES) {
    assert.equal(taxonomyIds.has(query.domainId), true);
    assert.equal(query.sourceId, "ms-teams-admin");
  }
});

test("URL normalization handles locale/query/fragment/trailing slash/casing", () => {
  const normalized = normalizeLearnUrl(
    "https://learn.microsoft.com/EN-US/microsoftteams/Direct-Routing-Landing-Page/?view=o365-worldwide#intro"
  );
  assert.ok(normalized);
  assert.equal(
    normalized?.canonicalUrl,
    "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page"
  );
  assert.equal(normalized?.locale, "en-us");
  assert.equal(normalized?.articlePath, "/microsoftteams/direct-routing-landing-page");
});

test("execute mode deduplicates, preserves ancestry, and classifies status reasons", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  await seedPowerShellCorpus(dbPath);

  const queryMap: Record<string, unknown> = {};
  for (const query of TEAMS_ADMIN_DISCOVERY_QUERIES) queryMap[query.queryText] = [];
  queryMap["Microsoft Teams Direct Routing administration voice routing policy"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
      title: "Plan Direct Routing in Microsoft Teams",
      description: "Administrator guidance for Direct Routing and SBC."
    }
  ];
  queryMap["Microsoft Teams Direct Routing SBC media bypass emergency calling"] = [
    {
      url: "https://learn.microsoft.com/microsoftteams/direct-routing-landing-page",
      title: "Plan Direct Routing in Microsoft Teams",
      description: "Administrator guidance for Direct Routing and SBC."
    }
  ];
  queryMap["Microsoft Teams meeting policies settings configuration admin"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview",
      title: "Manage meeting policies in Microsoft Teams",
      description: "Administrator settings and policy management."
    },
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs",
      title: "Build tabs for Teams apps",
      description: "Developer SDK guidance."
    }
  ];
  queryMap["Microsoft Teams external access federation administrator"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/manage-external-access",
      title: "Manage external access in Microsoft Teams",
      description: "IT admin configuration guide."
    },
    {
      url: "https://learn.microsoft.com/en-us/azure/active-directory/external-identities/overview",
      title: "External identities overview",
      description: "Cross-product identity topic."
    }
  ];
  queryMap["Microsoft Teams guest access shared channels cross-tenant"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/guest-access",
      title: "Set up guest access in Microsoft Teams",
      description: "Admin center policy and settings for guest users."
    },
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/end-user-chat-help",
      title: "Chat in Teams",
      description: "For users who want to chat with contacts."
    }
  ];
  queryMap["Microsoft Teams call queues auto attendants administration"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-call-queue",
      title: "Create a call queue in Microsoft Teams",
      description: "Administrator configuration and management."
    },
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-auto-attendant",
      title: "Create an auto attendant in Microsoft Teams",
      description: "Administrator configuration and management."
    }
  ];
  queryMap["Microsoft Teams Operator Connect Calling Plans dial plans number management"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
      title: "Plan Direct Routing in Microsoft Teams",
      description: "Operator connect and direct routing administration."
    }
  ];
  queryMap["Microsoft Teams Rooms devices administration configuration"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-deploy",
      title: "Deploy Microsoft Teams Rooms",
      description: "Configure device settings and administration."
    }
  ];
  queryMap["Microsoft Teams administrator security compliance retention conditional access"] = [
    {
      url: "https://learn.microsoft.com/en-us/microsoftteams/teams-conditional-access-policies",
      title: "Configure Conditional Access for Microsoft Teams",
      description: "Teams admin settings with Entra policy dependencies."
    }
  ];

  const job = new TeamsAdminDiscoveryJob({
    clientFactory: () => buildMockClient(queryMap)
  });
  const result = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    maxConcurrency: 1,
    maxResultsPerQuery: 10
  });

  assert.equal(result.summary.totalQueries, TEAMS_ADMIN_DISCOVERY_QUERIES.length);
  assert.equal(result.summary.successfulQueries, TEAMS_ADMIN_DISCOVERY_QUERIES.length);
  assert.equal(result.summary.failedQueries, 0);
  assert.ok(result.summary.rawSearchHits > result.summary.uniqueCanonicalArticles);
  assert.ok(result.summary.duplicateHits > 0);
  assert.ok(result.summary.overlapCount > 0);
  assert.equal(result.directRoutingValidation.discovered, true);

  const directRouting = result.entries.find((entry) =>
    entry.canonicalUrl.endsWith("/microsoftteams/direct-routing-landing-page")
  );
  assert.ok(directRouting);
  assert.ok((directRouting?.discoveryQueryIds.length ?? 0) >= 2);
  assert.ok(directRouting?.taxonomyDomains.includes("voice_direct_routing"));

  const multiDomain = result.entries.find(
    (entry) => entry.canonicalUrl.endsWith("/microsoftteams/direct-routing-landing-page")
  );
  assert.ok(multiDomain);
  assert.ok((multiDomain?.taxonomyDomains.length ?? 0) >= 2);

  const developer = result.entries.find((entry) =>
    entry.canonicalUrl.includes("/microsoftteams/platform/tabs/what-are-tabs")
  );
  assert.equal(developer?.status, "excluded");
  assert.ok(developer?.reasonCodes.includes("excluded_developer_material"));

  const endUser = result.entries.find((entry) =>
    entry.canonicalUrl.includes("/microsoftteams/end-user-chat-help")
  );
  assert.equal(endUser?.status, "excluded");
  assert.ok(endUser?.reasonCodes.includes("excluded_end_user_help"));

  const unrelated = result.entries.find((entry) => entry.canonicalUrl.includes("/azure/"));
  assert.equal(unrelated?.status, "excluded");
  assert.ok(unrelated?.reasonCodes.includes("excluded_unrelated_namespace"));

  const needsReview = result.entries.find((entry) =>
    entry.canonicalUrl.includes("/microsoftteams/teams-conditional-access-policies")
  );
  assert.equal(needsReview?.status, "needs_review");
  assert.ok(needsReview?.reasonCodes.includes("needs_review_cross_product_authority"));

  const zeroDomains = result.coverage.filter((domain) => domain.warnings.includes("zero_results"));
  assert.ok(zeroDomains.length > 0);
  const highDup = result.coverage.some((domain) => domain.warnings.includes("high_duplication"));
  assert.equal(highDup, true);

  const result2 = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    maxConcurrency: 1,
    maxResultsPerQuery: 10
  });
  const shape1 = result.entries.map((entry) => ({
    canonicalUrl: entry.canonicalUrl,
    status: entry.status,
    domains: [...entry.taxonomyDomains].sort(),
    queryIds: [...entry.discoveryQueryIds].sort()
  }));
  const shape2 = result2.entries.map((entry) => ({
    canonicalUrl: entry.canonicalUrl,
    status: entry.status,
    domains: [...entry.taxonomyDomains].sort(),
    queryIds: [...entry.discoveryQueryIds].sort()
  }));
  assert.deepEqual(shape1, shape2);

  assert.equal(result.powerShellSafety.unchanged, true);
  assert.equal(result.powerShellSafety.before.documents, result.powerShellSafety.after.documents);
  assert.equal(result.powerShellSafety.before.activeChunks, result.powerShellSafety.after.activeChunks);
  assert.equal(result.powerShellSafety.before.embeddings, result.powerShellSafety.after.embeddings);

  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();
  try {
    const teamsAdminDocs = store.listDocumentsBySource({ sourceId: "ms-teams-admin", trackId: "ga" });
    assert.equal(teamsAdminDocs.length, 0);
  } finally {
    store.close();
  }
});
