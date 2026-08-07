import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildLearnMcpClient,
  createKnowledgeV2SqliteStore,
  getSourceById,
  resolveKnowledgeV2DatabasePath,
  selectToolName
} from "../index";
import type { LearnMcpClient } from "../acquisition/learnMcpClient";
import { classifyTeamsAdminEntry } from "./classifier";
import {
  TEAMS_ADMIN_DISCOVERY_QUERIES,
  TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION
} from "./queryManifest";
import { extractSearchCandidates } from "./searchResultExtractor";
import { TEAMS_ADMIN_TAXONOMY } from "./taxonomy";
import type {
  TeamsAdminDiscoveryArtifacts,
  TeamsAdminDiscoveryRunRequest,
  TeamsAdminDiscoveryRunResult,
  TeamsAdminManifestEntry,
  TeamsAdminPowerShellSafetyCounts,
  TeamsAdminQueryRunMetric
} from "./types";
import { normalizeLearnUrl } from "./urlNormalization";

const SOURCE_ID = "ms-teams-admin";
const DEFAULT_ARTIFACTS_DIR = "eval/runs/discovery";
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_CONCURRENCY = 2;
const DIRECT_ROUTING_TARGET = "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page";

function makeHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function runIdFromNow(date = new Date()): string {
  return `cg01e1-${date.toISOString().replace(/[:.]/g, "-")}`;
}

function parseCliCount(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

function entryIdFromCanonicalUrl(canonicalUrl: string): string {
  return `ta-${makeHash(canonicalUrl).slice(0, 16)}`;
}

function toArtifacts(baseDir: string, runId: string): TeamsAdminDiscoveryArtifacts {
  return {
    jsonPath: join(baseDir, `${runId}.json`),
    jsonlPath: join(baseDir, `${runId}.jsonl`),
    markdownPath: join(baseDir, `${runId}.md`)
  };
}

function computePowerShellSafetyCounts(dbPath: string): TeamsAdminPowerShellSafetyCounts {
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  store.initializeDatabase();
  try {
    const docs = store.listDocumentsBySource({ sourceId: "ms-teams-powershell", trackId: "ga" });
    const chunkIds = new Set<string>();
    let activeChunks = 0;
    for (const doc of docs) {
      const chunks = store.listChunksForDocument({ documentId: doc.documentId });
      activeChunks += chunks.length;
      for (const chunk of chunks) chunkIds.add(chunk.chunkId);
    }
    const embeddings = store
      .listChunkEmbeddings()
      .filter((row) => chunkIds.has(row.chunkId)).length;
    return { documents: docs.length, activeChunks, embeddings };
  } finally {
    store.close();
  }
}

function getDomainWarnings(domain: {
  rawHits: number;
  uniqueCandidates: number;
  excluded: number;
  duplicateHits: number;
}): string[] {
  const warnings: string[] = [];
  if (domain.rawHits === 0) warnings.push("zero_results");
  if (domain.uniqueCandidates > 0 && domain.excluded / domain.uniqueCandidates > 0.7) {
    warnings.push("high_exclusion_rate");
  }
  if (domain.rawHits > 0 && domain.duplicateHits / domain.rawHits >= 0.5) {
    warnings.push("high_duplication");
  }
  if (domain.uniqueCandidates > 0 && domain.rawHits <= 2) {
    warnings.push("weak_result_volume");
  }
  return warnings;
}

function renderMarkdown(result: TeamsAdminDiscoveryRunResult): string {
  const lines: string[] = [];
  lines.push(`# CG-01E1 Teams Admin Discovery ${result.runId}`);
  lines.push("");
  lines.push(`- Mode: ${result.mode}`);
  lines.push(`- Taxonomy version: ${result.taxonomyVersion}`);
  lines.push(`- Query manifest version: ${TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION}`);
  lines.push(`- Source: ${result.sourceId}`);
  lines.push(`- Discovered tools: ${result.discoveredTools.join(", ")}`);
  lines.push(`- Queries: total=${result.summary.totalQueries} success=${result.summary.successfulQueries} failed=${result.summary.failedQueries}`);
  lines.push(`- Hits: raw=${result.summary.rawSearchHits} unique=${result.summary.uniqueCanonicalArticles} duplicates=${result.summary.duplicateHits}`);
  lines.push(`- Status counts: accepted=${result.summary.acceptedCount} candidate=${result.summary.candidateCount} needs_review=${result.summary.needsReviewCount} excluded=${result.summary.excludedCount}`);
  lines.push("");
  lines.push("## Domain Coverage");
  for (const domain of result.coverage) {
    lines.push(
      `- ${domain.domainId}: queries=${domain.queryCount} ok=${domain.successfulQueries} failed=${domain.failedQueries} raw=${domain.rawHits} unique=${domain.uniqueCandidates} accepted=${domain.accepted} candidate=${domain.candidate} review=${domain.needsReview} excluded=${domain.excluded} dup=${domain.duplicateHits} warnings=${domain.warnings.join("|") || "none"}`
    );
  }
  lines.push("");
  lines.push("## Entries by Domain");
  for (const domain of TEAMS_ADMIN_TAXONOMY.domains) {
    lines.push(`### ${domain.displayName}`);
    const domainEntries = result.entries.filter((entry) => entry.taxonomyDomains.includes(domain.domainId));
    if (domainEntries.length === 0) {
      lines.push("- none");
      continue;
    }
    for (const entry of domainEntries.sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl))) {
      const reason = entry.reasonCodes.join(",");
      lines.push(
        `- [${entry.status}] ${entry.title ?? "(untitled)"} | ${entry.canonicalUrl} | domains=${entry.taxonomyDomains.join(",")} | queries=${entry.discoveryQueryIds.join(",")} | reasons=${reason}`
      );
    }
  }
  lines.push("");
  lines.push("## PowerShell Safety");
  lines.push(
    `- before docs/chunks/embeddings=${result.powerShellSafety.before.documents}/${result.powerShellSafety.before.activeChunks}/${result.powerShellSafety.before.embeddings}`
  );
  lines.push(
    `- after docs/chunks/embeddings=${result.powerShellSafety.after.documents}/${result.powerShellSafety.after.activeChunks}/${result.powerShellSafety.after.embeddings}`
  );
  lines.push(`- unchanged=${result.powerShellSafety.unchanged}`);
  lines.push("");
  lines.push("## Direct Routing Validation");
  lines.push(
    `- target=${result.directRoutingValidation.targetCanonicalUrl} discovered=${result.directRoutingValidation.discovered} queries=${result.directRoutingValidation.discoveredByQueryIds.join(",") || "none"}`
  );
  return `${lines.join("\n")}\n`;
}

export class TeamsAdminDiscoveryJob {
  constructor(
    private readonly deps: {
      clientFactory?: (endpoint: string) => LearnMcpClient;
    } = {}
  ) {}

  async run(request: TeamsAdminDiscoveryRunRequest): Promise<TeamsAdminDiscoveryRunResult> {
    const startedAt = new Date();
    const started = performance.now();
    const runId = runIdFromNow(startedAt);
    const source = getSourceById(SOURCE_ID);
    if (!source || source.acquisition.transport !== "learn_mcp") {
      throw new Error("ms-teams-admin source must exist and use learn_mcp transport.");
    }
    const dbPath = resolve(request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() }));
    const artifactsDir = resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR);
    const artifacts = toArtifacts(artifactsDir, runId);
    await mkdir(dirname(artifacts.jsonPath), { recursive: true });

    const beforeCounts = computePowerShellSafetyCounts(dbPath);
    const warnings: string[] = [];
    const errors: string[] = [];
    const enabledQueries = TEAMS_ADMIN_DISCOVERY_QUERIES.filter((query) => query.enabled);

    const entriesByCanonical = new Map<string, TeamsAdminManifestEntry>();
    const queryMetrics: TeamsAdminQueryRunMetric[] = [];
    let discoveredTools: string[] = [];

    if (request.mode === "execute") {
      const client = (this.deps.clientFactory ?? buildLearnMcpClient)(source.acquisition.endpoint);
      await client.initialize();
      const tools = await client.listTools();
      discoveredTools = tools.map((tool) => tool.name);
      const searchTool = selectToolName(tools, (name) => name.includes("search"));
      const maxResults = Math.max(1, request.maxResultsPerQuery ?? DEFAULT_MAX_RESULTS);
      const maxConcurrency = Math.max(1, request.maxConcurrency ?? DEFAULT_CONCURRENCY);

      await mapWithConcurrency(enabledQueries, maxConcurrency, async (query) => {
        const qStarted = performance.now();
        try {
          const payload = await client.callTool(searchTool, {
            query: query.queryText,
            top: maxResults,
            limit: maxResults,
            maxResults,
            path: "microsoftteams"
          });
          const candidates = extractSearchCandidates(payload);
          const latencyMs = performance.now() - qStarted;
          queryMetrics.push({
            queryId: query.queryId,
            domainId: query.domainId,
            toolName: searchTool,
            attempted: true,
            success: true,
            resultCount: candidates.length,
            latencyMs,
            error: null
          });

          for (const hit of candidates) {
            const normalized = normalizeLearnUrl(hit.url);
            if (!normalized) continue;
            if (normalized.hostname !== "learn.microsoft.com") continue;
            const nowIso = new Date().toISOString();
            const existing = entriesByCanonical.get(normalized.canonicalUrl);
            if (!existing) {
              const title = hit.title ?? null;
              const snippet = hit.snippet ?? null;
              const classified = classifyTeamsAdminEntry({
                articlePath: normalized.articlePath,
                canonicalUrl: normalized.canonicalUrl,
                title,
                snippet,
                taxonomyDomains: [query.domainId]
              });
              entriesByCanonical.set(normalized.canonicalUrl, {
                entryId: entryIdFromCanonicalUrl(normalized.canonicalUrl),
                canonicalUrl: normalized.canonicalUrl,
                locale: normalized.locale,
                articlePath: normalized.articlePath,
                title,
                snippet,
                sourceId: SOURCE_ID,
                discoveryQueryIds: [query.queryId],
                taxonomyDomains: [query.domainId],
                discoveryCount: 1,
                status: classified.status,
                reasonCodes: [...classified.reasonCodes],
                authorityClassification: classified.authorityClassification,
                adjacentDomainHints: [...classified.adjacentDomainHints],
                learnMetadata: { locale: hit.locale ?? null },
                discoveredAt: nowIso,
                manifestVersion: TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION
              });
              continue;
            }
            existing.discoveryCount += 1;
            if (!existing.discoveryQueryIds.includes(query.queryId)) {
              existing.discoveryQueryIds.push(query.queryId);
            }
            if (!existing.taxonomyDomains.includes(query.domainId)) {
              existing.taxonomyDomains.push(query.domainId);
            }
          }
        } catch (error) {
          const latencyMs = performance.now() - qStarted;
          const message = error instanceof Error ? error.message : "search_failed";
          queryMetrics.push({
            queryId: query.queryId,
            domainId: query.domainId,
            toolName: searchTool,
            attempted: true,
            success: false,
            resultCount: 0,
            latencyMs,
            error: message
          });
          errors.push(`query ${query.queryId} failed: ${message}`);
        }
      });
    } else {
      discoveredTools = [];
      for (const query of enabledQueries) {
        queryMetrics.push({
          queryId: query.queryId,
          domainId: query.domainId,
          toolName: "plan_only",
          attempted: false,
          success: false,
          resultCount: 0,
          latencyMs: 0,
          error: null
        });
      }
    }

    const entries = [...entriesByCanonical.values()].sort((a, b) =>
      a.canonicalUrl.localeCompare(b.canonicalUrl)
    );

    const rawHits = queryMetrics.reduce((sum, metric) => sum + metric.resultCount, 0);
    const unique = entries.length;
    const duplicateHits = Math.max(0, rawHits - unique);
    const overlapCount = entries.filter((entry) => entry.discoveryQueryIds.length > 1).length;
    const acceptedCount = entries.filter((entry) => entry.status === "accepted").length;
    const excludedCount = entries.filter((entry) => entry.status === "excluded").length;
    const needsReviewCount = entries.filter((entry) => entry.status === "needs_review").length;
    const candidateCount = entries.filter((entry) => entry.status === "candidate").length;

    const coverage = TEAMS_ADMIN_TAXONOMY.domains.map((domain) => {
      const domainQueries = enabledQueries.filter((query) => query.domainId === domain.domainId);
      const domainMetrics = queryMetrics.filter((metric) => metric.domainId === domain.domainId);
      const domainEntries = entries.filter((entry) => entry.taxonomyDomains.includes(domain.domainId));
      const successfulQueries = domainMetrics.filter((metric) => metric.success).length;
      const failedQueries = domainMetrics.filter((metric) => metric.attempted && !metric.success).length;
      const rawHitsCount = domainMetrics.reduce((sum, metric) => sum + metric.resultCount, 0);
      const duplicateCount = Math.max(0, rawHitsCount - domainEntries.length);
      const accepted = domainEntries.filter((entry) => entry.status === "accepted").length;
      const excluded = domainEntries.filter((entry) => entry.status === "excluded").length;
      const needsReview = domainEntries.filter((entry) => entry.status === "needs_review").length;
      const candidate = domainEntries.filter((entry) => entry.status === "candidate").length;
      return {
        domainId: domain.domainId,
        queryCount: domainQueries.length,
        successfulQueries,
        failedQueries,
        rawHits: rawHitsCount,
        uniqueCandidates: domainEntries.length,
        accepted,
        excluded,
        needsReview,
        candidate,
        duplicateHits: duplicateCount,
        warnings: getDomainWarnings({
          rawHits: rawHitsCount,
          uniqueCandidates: domainEntries.length,
          excluded,
          duplicateHits: duplicateCount
        })
      };
    });

    coverage
      .filter((domain) => domain.warnings.length > 0)
      .forEach((domain) => {
        warnings.push(`${domain.domainId}:${domain.warnings.join(",")}`);
      });

    const directRoutingCanonical = normalizeLearnUrl(DIRECT_ROUTING_TARGET)?.canonicalUrl ?? DIRECT_ROUTING_TARGET;
    const directRoutingEntry = entries.find((entry) => entry.canonicalUrl === directRoutingCanonical);
    if (!directRoutingEntry) {
      warnings.push("direct_routing_validation_missing");
    }

    const afterCounts = computePowerShellSafetyCounts(dbPath);
    const unchanged =
      beforeCounts.documents === afterCounts.documents &&
      beforeCounts.activeChunks === afterCounts.activeChunks &&
      beforeCounts.embeddings === afterCounts.embeddings;

    const result: TeamsAdminDiscoveryRunResult = {
      runId,
      mode: request.mode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      sourceId: SOURCE_ID,
      taxonomyVersion: TEAMS_ADMIN_TAXONOMY.version,
      manifestVersion: TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION,
      queries: enabledQueries,
      discoveredTools,
      queryMetrics,
      entries,
      coverage,
      summary: {
        rawSearchHits: rawHits,
        uniqueCanonicalArticles: unique,
        duplicateHits,
        acceptedCount,
        excludedCount,
        needsReviewCount,
        candidateCount,
        overlapCount,
        totalQueries: enabledQueries.length,
        successfulQueries: queryMetrics.filter((metric) => metric.success).length,
        failedQueries: queryMetrics.filter((metric) => metric.attempted && !metric.success).length
      },
      directRoutingValidation: {
        targetCanonicalUrl: directRoutingCanonical,
        discovered: Boolean(directRoutingEntry),
        matchingEntryId: directRoutingEntry?.entryId ?? null,
        discoveredByQueryIds: directRoutingEntry?.discoveryQueryIds ?? []
      },
      powerShellSafety: {
        before: beforeCounts,
        after: afterCounts,
        unchanged
      },
      warnings,
      errors,
      artifacts
    };

    await writeArtifacts(result);
    return result;
  }
}

async function writeArtifacts(result: TeamsAdminDiscoveryRunResult): Promise<void> {
  await writeFile(result.artifacts.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const jsonl = result.entries.map((entry) =>
    JSON.stringify({
      runId: result.runId,
      entryId: entry.entryId,
      canonicalUrl: entry.canonicalUrl,
      title: entry.title,
      status: entry.status,
      domains: entry.taxonomyDomains,
      queryIds: entry.discoveryQueryIds,
      reasons: entry.reasonCodes
    })
  );
  await writeFile(result.artifacts.jsonlPath, `${jsonl.join("\n")}\n`, "utf8");
  await writeFile(result.artifacts.markdownPath, renderMarkdown(result), "utf8");
}

export function parseTeamsAdminDiscoveryCliArgs(argv: string[]): TeamsAdminDiscoveryRunRequest {
  const readFlag = (flag: string): string | undefined => {
    const index = argv.findIndex((arg) => arg === flag);
    if (index < 0) return undefined;
    return argv[index + 1];
  };
  const modeRaw = readFlag("--mode");
  const mode = modeRaw === "execute" ? "execute" : "plan";
  return {
    mode,
    dbPath: readFlag("--db"),
    artifactsDir: readFlag("--artifacts-dir"),
    maxResultsPerQuery: parseCliCount(readFlag("--max-results"), DEFAULT_MAX_RESULTS),
    maxConcurrency: parseCliCount(readFlag("--max-concurrency"), DEFAULT_CONCURRENCY)
  };
}
