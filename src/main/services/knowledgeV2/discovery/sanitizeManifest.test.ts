import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { classifyTeamsAdminEntry } from "./classifier";
import { sanitizeExistingManifest } from "./sanitizeManifest";
import type { EntryClassificationInput } from "./classifier";
import type { TeamsAdminDiscoveryRunResult } from "./types";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

function baseSourceManifest(entries: TeamsAdminDiscoveryRunResult["entries"]): TeamsAdminDiscoveryRunResult {
  return {
    runId: "cg01e1-test-source",
    mode: "execute",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1,
    sourceId: "ms-teams-admin",
    taxonomyVersion: "cg01e1-taxonomy-v1",
    manifestVersion: "cg01e1-query-manifest-v1",
    queries: [],
    discoveredTools: ["microsoft_docs_search"],
    queryMetrics: [],
    entries,
    coverage: [
      {
        domainId: "voice_direct_routing",
        queryCount: 1,
        successfulQueries: 1,
        failedQueries: 0,
        rawHits: entries.length,
        uniqueCandidates: entries.length,
        accepted: entries.filter((entry) => entry.status === "accepted").length,
        excluded: entries.filter((entry) => entry.status === "excluded").length,
        needsReview: entries.filter((entry) => entry.status === "needs_review").length,
        candidate: entries.filter((entry) => entry.status === "candidate").length,
        duplicateHits: 0,
        warnings: []
      }
    ],
    summary: {
      rawSearchHits: entries.length,
      uniqueCanonicalArticles: entries.length,
      duplicateHits: 0,
      acceptedCount: entries.filter((entry) => entry.status === "accepted").length,
      excludedCount: entries.filter((entry) => entry.status === "excluded").length,
      needsReviewCount: entries.filter((entry) => entry.status === "needs_review").length,
      candidateCount: entries.filter((entry) => entry.status === "candidate").length,
      overlapCount: 0,
      totalQueries: 1,
      successfulQueries: 1,
      failedQueries: 0
    },
    directRoutingValidation: {
      targetCanonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
      discovered: entries.some((entry) =>
        entry.canonicalUrl.includes("/microsoftteams/direct-routing-landing-page")
      ),
      matchingEntryId:
        entries.find((entry) => entry.canonicalUrl.includes("/microsoftteams/direct-routing-landing-page"))
          ?.entryId ?? null,
      discoveredByQueryIds: ["TA-VOICE-001"]
    },
    powerShellSafety: {
      before: { documents: 0, activeChunks: 0, embeddings: 0 },
      after: { documents: 0, activeChunks: 0, embeddings: 0 },
      unchanged: true
    },
    warnings: [],
    errors: [],
    artifacts: {
      jsonPath: "",
      jsonlPath: "",
      markdownPath: ""
    }
  };
}

test("classifier excludes non-article asset URLs deterministically", () => {
  const makeInput = (articlePath: string): EntryClassificationInput => ({
    articlePath,
    canonicalUrl: `https://learn.microsoft.com/en-us${articlePath}`,
    title: null,
    snippet: null,
    taxonomyDomains: ["voice_direct_routing"]
  });
  const png = classifyTeamsAdminEntry(makeInput("/microsoftteams/media/direct-routing.png"));
  const svg = classifyTeamsAdminEntry(makeInput("/microsoftteams/diagram.svg"));
  const jpg = classifyTeamsAdminEntry(makeInput("/microsoftteams/screenshot.jpg"));
  const jpeg = classifyTeamsAdminEntry(makeInput("/microsoftteams/screenshot.jpeg"));
  const gif = classifyTeamsAdminEntry(makeInput("/microsoftteams/screenshot.gif"));
  const webp = classifyTeamsAdminEntry(makeInput("/microsoftteams/screenshot.webp"));
  assert.equal(png.status, "excluded");
  assert.ok(png.reasonCodes.includes("excluded_non_article_asset"));
  assert.equal(svg.status, "excluded");
  assert.ok(svg.reasonCodes.includes("excluded_non_article_asset"));
  assert.equal(jpg.status, "excluded");
  assert.equal(jpeg.status, "excluded");
  assert.equal(gif.status, "excluded");
  assert.equal(webp.status, "excluded");
});

test("classifier still excludes answers and allows real microsoftteams docs", () => {
  const answers = classifyTeamsAdminEntry({
    articlePath: "/answers/questions/123",
    canonicalUrl: "https://learn.microsoft.com/en-us/answers/questions/123",
    title: "Some Q&A",
    snippet: "community answer",
    taxonomyDomains: ["core_admin"]
  });
  assert.equal(answers.status, "excluded");
  assert.ok(answers.reasonCodes.includes("excluded_unrelated_namespace"));

  const article = classifyTeamsAdminEntry({
    articlePath: "/microsoftteams/direct-routing-landing-page",
    canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
    title: "Plan Direct Routing in Microsoft Teams",
    snippet: "Administrator guidance for direct routing and SBC configuration.",
    taxonomyDomains: ["voice_direct_routing"]
  });
  assert.equal(article.status, "accepted");
  assert.ok(article.reasonCodes.includes("accepted_teams_admin_namespace"));
});

test("sanitized reclassification is deterministic and preserves ancestry", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-cg01e11-"));
  const dbPath = join(root, "knowledge-v2.sqlite");
  const artifactsDir = join(root, "artifacts");
  const sourcePath = join(root, "source.json");
  const approvalPath = join(root, "approval.md");

  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();
  store.close();

  const entries: TeamsAdminDiscoveryRunResult["entries"] = [
    {
      entryId: "ta-asset",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/media/direct-routing.png",
      locale: "en-us",
      articlePath: "/microsoftteams/media/direct-routing.png",
      title: null,
      snippet: null,
      sourceId: "ms-teams-admin",
      discoveryQueryIds: ["TA-VOICE-001"],
      taxonomyDomains: ["voice_direct_routing"],
      discoveryCount: 1,
      status: "accepted",
      reasonCodes: ["accepted_teams_admin_namespace", "accepted_admin_terminology"],
      authorityClassification: "teams_admin_primary",
      adjacentDomainHints: [],
      learnMetadata: {},
      discoveredAt: new Date().toISOString(),
      manifestVersion: "cg01e1-query-manifest-v1"
    },
    {
      entryId: "ta-doc",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
      locale: "en-us",
      articlePath: "/microsoftteams/direct-routing-landing-page",
      title: "Plan Direct Routing in Microsoft Teams",
      snippet: "Administrator setup and policy guidance.",
      sourceId: "ms-teams-admin",
      discoveryQueryIds: ["TA-VOICE-001", "TA-VOICE-003"],
      taxonomyDomains: ["voice_direct_routing", "voice_calling"],
      discoveryCount: 2,
      status: "accepted",
      reasonCodes: ["accepted_teams_admin_namespace", "accepted_admin_terminology"],
      authorityClassification: "teams_admin_primary",
      adjacentDomainHints: [],
      learnMetadata: {},
      discoveredAt: new Date().toISOString(),
      manifestVersion: "cg01e1-query-manifest-v1"
    }
  ];
  await writeFile(sourcePath, `${JSON.stringify(baseSourceManifest(entries), null, 2)}\n`, "utf8");

  const first = await sanitizeExistingManifest({
    inputManifestPath: sourcePath,
    outputDir: artifactsDir,
    dbPath,
    approvalPath
  });
  const second = await sanitizeExistingManifest({
    inputManifestPath: sourcePath,
    outputDir: artifactsDir,
    dbPath,
    approvalPath
  });
  const firstStatuses = first.sanitized.entries.map((entry) => ({
    entryId: entry.entryId,
    originalStatus: entry.originalStatus,
    sanitizedStatus: entry.sanitizedStatus,
    queryIds: [...entry.discoveryQueryIds].sort(),
    domains: [...entry.taxonomyDomains].sort()
  }));
  const secondStatuses = second.sanitized.entries.map((entry) => ({
    entryId: entry.entryId,
    originalStatus: entry.originalStatus,
    sanitizedStatus: entry.sanitizedStatus,
    queryIds: [...entry.discoveryQueryIds].sort(),
    domains: [...entry.taxonomyDomains].sort()
  }));
  assert.deepEqual(firstStatuses, secondStatuses);

  const asset = first.sanitized.entries.find((entry) => entry.entryId === "ta-asset");
  assert.equal(asset?.originalStatus, "accepted");
  assert.equal(asset?.sanitizedStatus, "excluded");
  assert.ok(asset?.sanitizedReasonCodes.includes("excluded_non_article_asset"));
  assert.equal(asset?.discoveryQueryIds[0], "TA-VOICE-001");

  const doc = first.sanitized.entries.find((entry) => entry.entryId === "ta-doc");
  assert.equal(doc?.sanitizedStatus, "accepted");
  assert.deepEqual(doc?.discoveryQueryIds.sort(), ["TA-VOICE-001", "TA-VOICE-003"]);

  const written = JSON.parse(await readFile(first.artifactPaths.jsonPath, "utf8")) as {
    summary: { sanitizedCounts: { accepted: number; excluded: number }; movedFromAcceptedToExcluded: number };
  };
  assert.equal(written.summary.sanitizedCounts.accepted, 1);
  assert.equal(written.summary.sanitizedCounts.excluded, 1);
  assert.equal(written.summary.movedFromAcceptedToExcluded, 1);
});
