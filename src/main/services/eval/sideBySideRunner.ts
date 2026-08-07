import { execSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  FakeEmbeddingProvider,
  HostedOpenAiEmbeddingProvider,
  getDefaultSourceRegistry,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";
import { toSideBySideMarkdown } from "./comparisonReporter";
import type {
  BaselineQuestionResult,
  BaselineRunArtifact,
  EvaluationQuestion
} from "../../../../eval/harness/types";
import { loadEvaluationDataset } from "../../../../eval/harness/dataset";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { retrieveHybridCandidates } from "../retrievalV2/hybridRetriever";
import type { FusedRetrievalCandidate } from "../retrievalV2/hybridRetriever";
import type {
  CandidateReviewRow,
  CorpusMode,
  RetrievalMetricSet,
  SideBySideQuestionResult,
  SideBySideRunArtifact,
  SideBySideRunSummary,
  SupplementalQueryResult,
  V2CorpusStats
} from "./sideBySideTypes";

export interface SideBySideRunOptions {
  datasetPath: string;
  legacyArtifactPath?: string;
  outputDir: string;
  v2DatabasePath?: string;
}

interface CorpusSourceTrackRow {
  source_id: string;
  track_id: string;
  transport: "github" | "learn_mcp";
  doc_count: number;
  chunk_count: number;
  embedding_count: number;
}

interface EmbeddingIdentityRow {
  embedding_provider: string;
  embedding_model: string;
  embedding_schema_version: string;
  embedding_dimensions: number;
  count: number;
}

const DOMAIN_TO_SOURCE_IDS: Record<string, string[]> = {
  teams_admin: ["ms-teams-admin"],
  teams_powershell: ["ms-teams-powershell"],
  teams_dev: ["ms-teams-dev-docs"],
  graph: ["ms-graph-docs"],
  entra: ["ms-entra-docs"],
  m365: ["ms-m365-docs"]
};

const DOMAIN_TO_PRIMARY_ROLE: Record<string, string> = {
  teams_admin: "teams_admin_primary",
  teams_powershell: "teams_powershell_cmdlet_primary",
  teams_dev: "teams_dev_specialized",
  graph: "graph_api_primary",
  entra: "entra_identity_primary",
  m365: "m365_tenant_primary"
};

function getCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

const REVIEW_LABEL_OPTIONS: CandidateReviewRow["reviewLabelOptions"] = [
  "highly_relevant",
  "relevant_supporting",
  "marginal",
  "irrelevant",
  "misleading"
];

const CALLING_PLANS_SUPPLEMENTAL_QUERIES: Array<{ queryId: string; question: string }> = [
  { queryId: "CP-001", question: "How do Microsoft Teams Calling Plans work?" },
  { queryId: "CP-002", question: "How do I set up Microsoft Calling Plans?" },
  { queryId: "CP-003", question: "How do I assign a Calling Plan phone number?" },
  { queryId: "CP-004", question: "How do I port numbers into Teams?" },
  { queryId: "CP-005", question: "How do I view PSTN usage for Calling Plans?" }
];

function safeSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function sourceDomainFromLegacy(item: { sourceUrl: string; path: string }): string {
  const merged = `${item.sourceUrl} ${item.path}`.toLowerCase();
  if (merged.includes("office-docs-powershell") || merged.includes("teams-ps") || merged.includes("csonline")) {
    return "teams_powershell";
  }
  if (merged.includes("graph")) return "graph";
  if (merged.includes("entra")) return "entra";
  if (merged.includes("microsoft-365") || merged.includes("m365")) return "m365";
  if (merged.includes("msteams-docs") || merged.includes("dev/")) return "teams_dev";
  if (merged.includes("microsoftteams")) return "teams_admin";
  return "unknown";
}

function expectedSourceIds(question: EvaluationQuestion): Set<string> {
  const ids = new Set<string>();
  for (const domain of question.expectedSourceDomains) {
    const mapped = DOMAIN_TO_SOURCE_IDS[domain];
    if (!mapped) continue;
    for (const sourceId of mapped) ids.add(sourceId);
  }
  return ids;
}

function expectedDomainSet(question: EvaluationQuestion): Set<string> {
  const domains = new Set<string>(question.expectedSourceDomains);
  if (question.expectedDomain !== "unknown") {
    domains.add(question.expectedDomain);
  }
  return domains;
}

function candidateSourceDomains(sourceId: string): Set<string> {
  const source = getDefaultSourceRegistry().sources.find((item) => item.id === sourceId);
  return new Set((source?.domains ?? []).map((domain) => domain));
}

function firstRankForPredicate<T>(items: T[], predicate: (item: T) => boolean): number | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && predicate(item)) return i + 1;
  }
  return null;
}

function recallAtK(
  topKSources: string[],
  expectedDomains: Set<string>,
  sourceDomainLookup: (sourceId: string) => string[]
): number | null {
  if (expectedDomains.size === 0) return null;
  const found = new Set<string>();
  for (const sourceId of topKSources) {
    const domains = sourceDomainLookup(sourceId);
    for (const domain of domains) {
      if (expectedDomains.has(domain)) found.add(domain);
    }
  }
  return found.size / expectedDomains.size;
}

function computeLegacyMetrics(question: EvaluationQuestion, result: BaselineQuestionResult): RetrievalMetricSet {
  const expectedIds = expectedSourceIds(question);
  const expectedDomains = expectedDomainSet(question);
  const ordered = result.retrieval.ordered;

  const sourceAt = (k: number) =>
    ordered
      .slice(0, k)
      .map((item) => sourceDomainFromLegacy({ sourceUrl: item.sourceUrl, path: item.path }));
  const hitTop = (k: number) =>
    ordered
      .slice(0, k)
      .some((item) => {
        const domain = sourceDomainFromLegacy({ sourceUrl: item.sourceUrl, path: item.path });
        return expectedDomains.has(domain) || expectedIds.has(domain);
      });

  const firstExpectedSourceRank = firstRankForPredicate(
    ordered,
    (item) => expectedDomains.has(sourceDomainFromLegacy({ sourceUrl: item.sourceUrl, path: item.path }))
  );
  const reciprocalRank = firstExpectedSourceRank ? 1 / firstExpectedSourceRank : 0;

  const cmdletExpected = question.expectedIntent === "reference" && /set-cs|grant-cs/i.test(question.question);
  const exactCmdletMatchSuccess = cmdletExpected
    ? ordered.some((item) => /set-csonline|grant-csonline/i.test(item.title))
    : null;

  const leakage = ordered
    .slice(0, 10)
    .filter((item) => !expectedDomains.has(sourceDomainFromLegacy({ sourceUrl: item.sourceUrl, path: item.path })))
    .length;

  const top1Domain = sourceDomainFromLegacy({
    sourceUrl: ordered[0]?.sourceUrl ?? "",
    path: ordered[0]?.path ?? ""
  });
  const authorityCorrectTop1 = expectedDomains.has(top1Domain);
  const betaPolicyCorrect = true;

  const domainRoutingCorrect = expectedDomains.has(question.expectedDomain);

  return {
    expectedSourceHitTop1: hitTop(1),
    expectedSourceHitTop3: hitTop(3),
    expectedSourceHitTop5: hitTop(5),
    expectedSourceHitTop10: hitTop(10),
    firstExpectedSourceRank,
    reciprocalRank,
    recallAt1: recallAtK(sourceAt(1), expectedDomains, (sourceId) => [sourceId]),
    recallAt3: recallAtK(sourceAt(3), expectedDomains, (sourceId) => [sourceId]),
    recallAt5: recallAtK(sourceAt(5), expectedDomains, (sourceId) => [sourceId]),
    recallAt10: recallAtK(sourceAt(10), expectedDomains, (sourceId) => [sourceId]),
    exactCmdletMatchSuccess,
    domainRoutingCorrect,
    authorityCorrectTop1,
    betaPolicyCorrect,
    inappropriateSourceLeakageCount: leakage
  };
}

function computeV2Metrics(
  question: EvaluationQuestion,
  routeDomains: string[],
  candidates: FusedRetrievalCandidate[]
): RetrievalMetricSet {
  const expectedIds = expectedSourceIds(question);
  const expectedDomains = expectedDomainSet(question);
  const topK = (k: number) => candidates.slice(0, k);
  const hitTop = (k: number) =>
    topK(k).some((candidate) => {
      if (expectedIds.has(candidate.authority.sourceId)) return true;
      const domains = candidateSourceDomains(candidate.authority.sourceId);
      for (const domain of domains) {
        if (expectedDomains.has(domain)) return true;
      }
      return false;
    });
  const firstExpectedSourceRank = firstRankForPredicate(candidates, (candidate) => {
    if (expectedIds.has(candidate.authority.sourceId)) return true;
    const domains = candidateSourceDomains(candidate.authority.sourceId);
    for (const domain of domains) if (expectedDomains.has(domain)) return true;
    return false;
  });
  const reciprocalRank = firstExpectedSourceRank ? 1 / firstExpectedSourceRank : 0;
  const recallFn = (k: number) =>
    recallAtK(
      topK(k).map((candidate) => candidate.authority.sourceId),
      expectedDomains,
      (sourceId) => [...candidateSourceDomains(sourceId)]
    );

  const hasCmdletDirective = /set-cs|grant-cs/i.test(question.question);
  const exactCmdletMatchSuccess = hasCmdletDirective
    ? candidates.some(
        (candidate) =>
          candidate.methods.includes("exact") &&
          candidate.exactMatch?.directiveType === "cmdlet" &&
          /set-cs|grant-cs/i.test(candidate.exactMatch.directiveValue)
      )
    : null;

  const domainRoutingCorrect =
    question.expectedDomain === "unknown" || routeDomains.includes(question.expectedDomain);
  const primaryRole = DOMAIN_TO_PRIMARY_ROLE[question.expectedDomain];
  const authorityCorrectTop1 = primaryRole
    ? Boolean(candidates[0]?.authority.authorityRoles.some((role) => role === primaryRole))
    : true;

  const betaAllowed = /beta|preview/i.test(question.question);
  const betaPresent = candidates.some(
    (candidate) =>
      candidate.authority.sourceStatus === "beta" || candidate.authority.sourceStatus === "preview"
  );
  const betaPolicyCorrect = betaAllowed ? betaPresent || candidates.length === 0 : !betaPresent;

  const leakage = topK(10).filter((candidate) => {
    const domains = candidateSourceDomains(candidate.authority.sourceId);
    for (const domain of domains) {
      if (expectedDomains.has(domain)) return false;
    }
    return true;
  }).length;

  return {
    expectedSourceHitTop1: hitTop(1),
    expectedSourceHitTop3: hitTop(3),
    expectedSourceHitTop5: hitTop(5),
    expectedSourceHitTop10: hitTop(10),
    firstExpectedSourceRank,
    reciprocalRank,
    recallAt1: recallFn(1),
    recallAt3: recallFn(3),
    recallAt5: recallFn(5),
    recallAt10: recallFn(10),
    exactCmdletMatchSuccess,
    domainRoutingCorrect,
    authorityCorrectTop1,
    betaPolicyCorrect,
    inappropriateSourceLeakageCount: leakage
  };
}

function toReviewRows(params: {
  candidates: FusedRetrievalCandidate[];
  exactRanks: Map<string, number>;
  lexicalRanks: Map<string, number>;
  semanticRanks: Map<string, number>;
}): CandidateReviewRow[] {
  const { candidates, exactRanks, lexicalRanks, semanticRanks } = params;
  return candidates.map((candidate) => ({
    rank: candidate.fusion.rank,
    chunkId: candidate.chunkId,
    documentId: candidate.documentId,
    title: candidate.title,
    sectionId: candidate.sectionId,
    headingPath: [...candidate.headingPath],
    sourceId: candidate.authority.sourceId,
    trackId: candidate.authority.trackId,
    authorityRoles: [...candidate.authority.authorityRoles],
    methods: [...candidate.methods],
    snippet: safeSnippet(candidate.text),
    canonicalUrl: candidate.provenance.canonicalUrl,
    sourceStatus: candidate.authority.sourceStatus,
    exactMatchState: candidate.exactMatch
      ? `${candidate.exactMatch.directiveType}:${candidate.exactMatch.directiveValue}:${candidate.exactMatch.matchedField}`
      : null,
    exactRank: exactRanks.get(candidate.chunkId) ?? null,
    lexicalRank: lexicalRanks.get(candidate.chunkId) ?? null,
    lexicalScore: candidate.scores.lexical,
    semanticRank: semanticRanks.get(candidate.chunkId) ?? null,
    semanticSimilarity: candidate.scores.semanticSimilarity,
    exactScore: candidate.scores.exactMatch,
    fusionContribution: {
      exactScore: candidate.fusion.contributions.exactScore,
      lexicalRank: candidate.fusion.contributions.lexicalRank,
      semanticRank: candidate.fusion.contributions.semanticRank,
      methodAgreement: candidate.fusion.contributions.methodAgreement,
      routePriority: candidate.fusion.contributions.routePriority,
      authorityRole: candidate.fusion.contributions.authorityRole,
      betaPolicy: candidate.fusion.contributions.betaPolicy,
      total: candidate.fusion.contributions.total
    },
    fusionScore: candidate.fusion.score,
    reviewLabel: null,
    reviewLabelOptions: [...REVIEW_LABEL_OPTIONS]
  }));
}

function asCounter(rows: Array<{ key: string; count: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.key] = row.count;
  return out;
}

function classifyCorpus(stats: {
  documentCount: number;
  chunkCount: number;
  embeddingCount: number;
  sourceCount: number;
  documentsBySource: Record<string, number>;
}): { mode: CorpusMode; reasons: string[] } {
  const reasons: string[] = [];
  const hasTeamsAdmin = (stats.documentsBySource["ms-teams-admin"] ?? 0) > 0;
  const hasTeamsPowerShell = (stats.documentsBySource["ms-teams-powershell"] ?? 0) > 0;
  const hasAdjacent =
    (stats.documentsBySource["ms-graph-docs"] ?? 0) > 0 ||
    (stats.documentsBySource["ms-entra-docs"] ?? 0) > 0 ||
    (stats.documentsBySource["ms-m365-docs"] ?? 0) > 0;

  if (hasTeamsAdmin && hasTeamsPowerShell && !hasAdjacent) {
    reasons.push("real Teams Admin corpus indexed");
    reasons.push("real Teams PowerShell corpus indexed");
    reasons.push("adjacent corpora (Entra/Graph/M365) not yet indexed");
    reasons.push("Teams Admin set is bounded and human-approved, not exhaustive");
    return { mode: "limited_real", reasons };
  }

  if (stats.documentCount === 0 || stats.chunkCount === 0 || stats.embeddingCount === 0) {
    reasons.push("empty_or_partial_index");
    return { mode: "fixture", reasons };
  }
  if (stats.documentCount < 40 || stats.chunkCount < 400 || stats.sourceCount < 3) {
    reasons.push("small_or_narrow_corpus");
    return { mode: "fixture", reasons };
  }
  if (stats.documentCount < 400 || stats.chunkCount < 4000 || stats.sourceCount < 5) {
    reasons.push("partially_populated_corpus");
    return { mode: "limited_real", reasons };
  }
  reasons.push("multi_source_high_volume_index");
  return { mode: "real", reasons };
}

function inspectCorpus(databasePath: string): V2CorpusStats {
  const db = new Database(databasePath, { readonly: true });
  try {
    const documentCount = Number((db.prepare("SELECT COUNT(*) AS count FROM documents").get() as { count: number }).count);
    const chunkCount = Number(
      (
        db.prepare("SELECT COUNT(*) AS count FROM knowledge_chunks WHERE tombstoned_at IS NULL").get() as {
          count: number;
        }
      ).count
    );
    const embeddingCount = Number((db.prepare("SELECT COUNT(*) AS count FROM chunk_embeddings").get() as { count: number }).count);

    const bySourceRows = db
      .prepare(
        `
          SELECT
            d.source_id,
            d.track_id,
            d.transport,
            COUNT(DISTINCT d.document_id) AS doc_count,
            COUNT(DISTINCT kc.chunk_id) AS chunk_count,
            COUNT(ce.chunk_id) AS embedding_count
          FROM documents d
          LEFT JOIN knowledge_chunks kc
            ON kc.document_id = d.document_id
            AND kc.tombstoned_at IS NULL
          LEFT JOIN chunk_embeddings ce
            ON ce.chunk_id = kc.chunk_id
          WHERE d.tombstoned_at IS NULL
          GROUP BY d.source_id, d.track_id, d.transport
        `
      )
      .all() as CorpusSourceTrackRow[];

    const documentsBySource = asCounter(
      bySourceRows.map((row) => ({ key: row.source_id, count: row.doc_count }))
    );
    const chunksBySource = asCounter(
      bySourceRows.map((row) => ({ key: row.source_id, count: row.chunk_count }))
    );
    const embeddingsBySource = asCounter(
      bySourceRows.map((row) => ({ key: row.source_id, count: row.embedding_count }))
    );
    const documentsByTrack = asCounter(
      bySourceRows.map((row) => ({ key: `${row.source_id}:${row.track_id}`, count: row.doc_count }))
    );
    const chunksByTrack = asCounter(
      bySourceRows.map((row) => ({ key: `${row.source_id}:${row.track_id}`, count: row.chunk_count }))
    );
    const embeddingsByTrack = asCounter(
      bySourceRows.map((row) => ({ key: `${row.source_id}:${row.track_id}`, count: row.embedding_count }))
    );
    const documentsByTransport = asCounter(
      bySourceRows.map((row) => ({ key: row.transport, count: row.doc_count }))
    );

    const { mode, reasons } = classifyCorpus({
      documentCount,
      chunkCount,
      embeddingCount,
      sourceCount: Object.keys(documentsBySource).length,
      documentsBySource
    });
    return {
      mode,
      classificationReasons: reasons,
      documentCount,
      chunkCount,
      embeddingCount,
      documentsBySource,
      chunksBySource,
      embeddingsBySource,
      documentsByTrack,
      chunksByTrack,
      embeddingsByTrack,
      documentsByTransport
    };
  } finally {
    db.close();
  }
}

async function resolveLegacyArtifactPath(explicitPath?: string): Promise<string> {
  if (explicitPath) return resolve(explicitPath);
  const entries = await readdir(resolve("eval/runs"));
  const jsonFiles = entries.filter((name) => name.endsWith(".json"));
  const parsed: Array<{ path: string; createdAt: string }> = [];
  for (const file of jsonFiles) {
    const path = resolve("eval/runs", file);
    try {
      const content = JSON.parse(await readFile(path, "utf8")) as Partial<BaselineRunArtifact>;
      if (content.pipelineVersion === "legacy-v1" && content.usesKnowledgeEngineV2 === false) {
        parsed.push({ path, createdAt: content.createdAt ?? "" });
      }
    } catch {
      continue;
    }
  }
  parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = parsed[0];
  if (!latest) {
    throw new Error("No frozen legacy baseline artifact found in eval/runs.");
  }
  return latest.path;
}

function chooseEmbeddingProvider(databasePath: string): {
  provider: FakeEmbeddingProvider | HostedOpenAiEmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
  warning?: string;
} {
  const db = new Database(databasePath, { readonly: true });
  try {
    const identityRows = db
      .prepare(
        `
          SELECT
            embedding_provider,
            embedding_model,
            embedding_schema_version,
            embedding_dimensions,
            COUNT(*) AS count
          FROM chunk_embeddings
          GROUP BY
            embedding_provider,
            embedding_model,
            embedding_schema_version,
            embedding_dimensions
          ORDER BY count DESC
          LIMIT 1
        `
      )
      .all() as EmbeddingIdentityRow[];

    const top = identityRows[0];
    if (!top) {
      const provider = new FakeEmbeddingProvider({
        providerId: "fake",
        dimensions: 8,
        defaultModel: "text-embedding-3-small",
        embeddingSchemaVersion: "v1"
      });
      return {
        provider,
        runtime: { model: "text-embedding-3-small", embeddingSchemaVersion: "v1" },
        warning: "no_chunk_embeddings_found_semantic_will_return_zero"
      };
    }

    if (top.embedding_provider === "openai" && process.env["OPENAI_API_KEY"]) {
      const provider = new HostedOpenAiEmbeddingProvider({
        defaultModel: top.embedding_model,
        embeddingSchemaVersion: top.embedding_schema_version
      });
      return {
        provider,
        runtime: {
          model: top.embedding_model,
          embeddingSchemaVersion: top.embedding_schema_version
        }
      };
    }

    const provider = new FakeEmbeddingProvider({
      providerId: top.embedding_provider,
      dimensions: top.embedding_dimensions,
      defaultModel: top.embedding_model,
      embeddingSchemaVersion: top.embedding_schema_version
    });
    return {
      provider,
      runtime: {
        model: top.embedding_model,
        embeddingSchemaVersion: top.embedding_schema_version
      },
      warning:
        top.embedding_provider === "openai"
          ? "openai_embeddings_present_without_api_key_using_fake_provider_for_deterministic_eval"
          : undefined
    };
  } finally {
    db.close();
  }
}

function aggregateMetrics(results: SideBySideQuestionResult[]): SideBySideRunSummary {
  const legacyLatencies = results.map((result) => result.legacy.result.latenciesMs.retrieval);
  const v2Latencies = results.map((result) => result.v2.retrievalDiagnostics.totalLatencyMs);
  const v2FusionLatencies = results.map((result) => result.v2.retrievalDiagnostics.fusionLatencyMs);
  const v2SemanticLatencies = results.map((result) => result.v2.retrievalDiagnostics.semanticLatencyMs);

  const countHits = (
    side: "legacyMetrics" | "v2Metrics",
    key:
      | "expectedSourceHitTop1"
      | "expectedSourceHitTop3"
      | "expectedSourceHitTop5"
      | "expectedSourceHitTop10"
      | "domainRoutingCorrect"
      | "authorityCorrectTop1"
      | "betaPolicyCorrect"
  ) => results.filter((result) => result.comparison[side][key]).length;
  const average = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

  const legacyRR = results.map((result) => result.comparison.legacyMetrics.reciprocalRank ?? 0);
  const v2RR = results.map((result) => result.comparison.v2Metrics.reciprocalRank ?? 0);
  const legacyRecall5 = results
    .map((result) => result.comparison.legacyMetrics.recallAt5)
    .filter((value): value is number => value !== null);
  const legacyRecall10 = results
    .map((result) => result.comparison.legacyMetrics.recallAt10)
    .filter((value): value is number => value !== null);
  const v2Recall5 = results
    .map((result) => result.comparison.v2Metrics.recallAt5)
    .filter((value): value is number => value !== null);
  const v2Recall10 = results
    .map((result) => result.comparison.v2Metrics.recallAt10)
    .filter((value): value is number => value !== null);

  const methodContribution: Record<string, number> = {};
  for (const result of results) {
    const expectedIds = expectedSourceIds(result.question);
    const expectedDomains = expectedDomainSet(result.question);
    const firstExpected = result.v2.fusedCandidates.find((candidate) => {
      if (expectedIds.has(candidate.sourceId)) return true;
      const domains = candidateSourceDomains(candidate.sourceId);
      for (const domain of domains) {
        if (expectedDomains.has(domain)) return true;
      }
      return false;
    });
    if (!firstExpected) continue;
    const key = firstExpected.methods.join("+");
    methodContribution[key] = (methodContribution[key] ?? 0) + 1;
  }

  const cmdletQuestions = results.filter(
    (result) => result.comparison.v2Metrics.exactCmdletMatchSuccess !== null
  );
  return {
    totalQuestions: results.length,
    methodContribution,
    legacy: {
      expectedSourceHitTop1: countHits("legacyMetrics", "expectedSourceHitTop1"),
      expectedSourceHitTop3: countHits("legacyMetrics", "expectedSourceHitTop3"),
      expectedSourceHitTop5: countHits("legacyMetrics", "expectedSourceHitTop5"),
      expectedSourceHitTop10: countHits("legacyMetrics", "expectedSourceHitTop10"),
      mrr: average(legacyRR),
      meanRecallAt5: average(legacyRecall5),
      meanRecallAt10: average(legacyRecall10),
      exactCmdletSuccess: {
        success: cmdletQuestions.filter((result) => result.comparison.legacyMetrics.exactCmdletMatchSuccess === true).length,
        total: cmdletQuestions.length
      },
      domainRoutingCorrect: countHits("legacyMetrics", "domainRoutingCorrect"),
      authorityCorrectTop1: countHits("legacyMetrics", "authorityCorrectTop1"),
      betaPolicyCorrect: countHits("legacyMetrics", "betaPolicyCorrect"),
      leakageQuestions: results.filter((result) => result.comparison.legacyMetrics.inappropriateSourceLeakageCount > 0).length,
      p95RetrievalLatencyMs: percentile(legacyLatencies, 95)
    },
    v2: {
      expectedSourceHitTop1: countHits("v2Metrics", "expectedSourceHitTop1"),
      expectedSourceHitTop3: countHits("v2Metrics", "expectedSourceHitTop3"),
      expectedSourceHitTop5: countHits("v2Metrics", "expectedSourceHitTop5"),
      expectedSourceHitTop10: countHits("v2Metrics", "expectedSourceHitTop10"),
      mrr: average(v2RR),
      meanRecallAt5: average(v2Recall5),
      meanRecallAt10: average(v2Recall10),
      exactCmdletSuccess: {
        success: cmdletQuestions.filter((result) => result.comparison.v2Metrics.exactCmdletMatchSuccess === true).length,
        total: cmdletQuestions.length
      },
      domainRoutingCorrect: countHits("v2Metrics", "domainRoutingCorrect"),
      authorityCorrectTop1: countHits("v2Metrics", "authorityCorrectTop1"),
      betaPolicyCorrect: countHits("v2Metrics", "betaPolicyCorrect"),
      leakageQuestions: results.filter((result) => result.comparison.v2Metrics.inappropriateSourceLeakageCount > 0).length,
      p50TotalLatencyMs: percentile(v2Latencies, 50),
      p95TotalLatencyMs: percentile(v2Latencies, 95),
      p50HybridFusionLatencyMs: percentile(v2FusionLatencies, 50),
      p95HybridFusionLatencyMs: percentile(v2FusionLatencies, 95),
      p50SemanticLatencyMs: percentile(v2SemanticLatencies, 50),
      p95SemanticLatencyMs: percentile(v2SemanticLatencies, 95)
    }
  };
}

function legacySources(result: BaselineQuestionResult): Array<{
  rank: number;
  sourceDomain: string;
  sourceUrl: string;
  title: string;
}> {
  return result.retrieval.ordered.map((item) => ({
    rank: item.rank,
    sourceDomain: sourceDomainFromLegacy({ sourceUrl: item.sourceUrl, path: item.path }),
    sourceUrl: item.sourceUrl,
    title: item.title
  }));
}

function toRankMap(candidates: Array<{ chunkId: string }>): Map<string, number> {
  const out = new Map<string, number>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    if (!out.has(candidate.chunkId)) out.set(candidate.chunkId, index + 1);
  }
  return out;
}

async function runV2Retrieval(params: {
  question: string;
  databasePath: string;
  provider: FakeEmbeddingProvider | HostedOpenAiEmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
}): Promise<{
  stageLatencyMs: {
    queryIntent: number;
    domainRouter: number;
    exact: number;
    lexical: number;
    semantic: number;
    fusion: number;
    totalHybridRetrieval: number;
  };
  queryIntent: ReturnType<typeof extractQueryIntent>["intent"];
  retrievalScope: ReturnType<typeof routeQueryIntent>["scope"];
  hybrid: Awaited<ReturnType<typeof retrieveHybridCandidates>>;
}> {
  const intentStarted = performance.now();
  const intent = extractQueryIntent(params.question).intent;
  const queryIntentLatency = performance.now() - intentStarted;
  const routeStarted = performance.now();
  const scope = routeQueryIntent(intent).scope;
  const routeLatency = performance.now() - routeStarted;
  const hybrid = await retrieveHybridCandidates({
    databasePath: params.databasePath,
    scope,
    embeddingProvider: params.provider,
    embeddingRuntimeConfig: params.runtime
  });
  return {
    stageLatencyMs: {
      queryIntent: queryIntentLatency,
      domainRouter: routeLatency,
      exact: hybrid.diagnostics.exactLatencyMs,
      lexical: hybrid.diagnostics.lexicalLatencyMs,
      semantic: hybrid.diagnostics.semanticLatencyMs,
      fusion: hybrid.diagnostics.fusionLatencyMs,
      totalHybridRetrieval: hybrid.diagnostics.totalLatencyMs
    },
    queryIntent: intent,
    retrievalScope: scope,
    hybrid
  };
}

export async function runSideBySideEvaluation(
  options: SideBySideRunOptions
): Promise<{ artifact: SideBySideRunArtifact; artifactPath: string; jsonlPath: string; markdownPath: string }> {
  const datasetPath = resolve(options.datasetPath);
  const legacyArtifactPath = await resolveLegacyArtifactPath(options.legacyArtifactPath);
  const legacyArtifact = JSON.parse(await readFile(legacyArtifactPath, "utf8")) as BaselineRunArtifact;
  const dataset = await loadEvaluationDataset(datasetPath);
  const legacyByQuestion = new Map(legacyArtifact.results.map((result) => [result.questionId, result]));
  const v2DatabasePath = resolve(options.v2DatabasePath ?? resolveKnowledgeV2DatabasePath());
  const corpus = inspectCorpus(v2DatabasePath);
  const providerInfo = chooseEmbeddingProvider(v2DatabasePath);

  const warnings: string[] = [];
  if (providerInfo.warning) warnings.push(providerInfo.warning);
  if (corpus.mode === "fixture") {
    warnings.push(
      "Fixture corpus — validates retrieval plumbing only. Results must not be interpreted as production retrieval quality."
    );
  }

  const questions: SideBySideQuestionResult[] = [];
  for (const question of dataset) {
    const legacy = legacyByQuestion.get(question.questionId);
    if (!legacy) {
      throw new Error(`Legacy baseline is missing question ${question.questionId}.`);
    }

    const v2Run = await runV2Retrieval({
      question: question.question,
      databasePath: v2DatabasePath,
      provider: providerInfo.provider,
      runtime: providerInfo.runtime
    });
    const exactRanks = toRankMap(v2Run.hybrid.exact.candidates);
    const lexicalRanks = toRankMap(v2Run.hybrid.lexical.candidates);
    const semanticRanks = toRankMap(v2Run.hybrid.semantic.candidates);
    const fused = toReviewRows({
      candidates: v2Run.hybrid.candidates,
      exactRanks,
      lexicalRanks,
      semanticRanks
    });
    questions.push({
      question,
      legacy: {
        runId: legacyArtifact.runId,
        result: legacy,
        retrievedSources: legacySources(legacy)
      },
      v2: {
        stageLatencyMs: v2Run.stageLatencyMs,
        queryIntent: v2Run.queryIntent,
        retrievalScope: v2Run.retrievalScope,
        exactDiagnostics: v2Run.hybrid.exact.diagnostics,
        lexicalDiagnostics: v2Run.hybrid.lexical.diagnostics,
        semanticDiagnostics: v2Run.hybrid.semantic.diagnostics,
        fusionDiagnostics: v2Run.hybrid.fusionDiagnostics,
        retrievalDiagnostics: v2Run.hybrid.diagnostics,
        fusedCandidates: fused
      },
      comparison: {
        legacyMetrics: computeLegacyMetrics(question, legacy),
        v2Metrics: computeV2Metrics(question, v2Run.retrievalScope.selectedDomains, v2Run.hybrid.candidates)
      }
    });
  }

  const supplementalCallingPlans: SupplementalQueryResult[] = [];
  for (const supplemental of CALLING_PLANS_SUPPLEMENTAL_QUERIES) {
    const v2Run = await runV2Retrieval({
      question: supplemental.question,
      databasePath: v2DatabasePath,
      provider: providerInfo.provider,
      runtime: providerInfo.runtime
    });
    const exactRanks = toRankMap(v2Run.hybrid.exact.candidates);
    const lexicalRanks = toRankMap(v2Run.hybrid.lexical.candidates);
    const semanticRanks = toRankMap(v2Run.hybrid.semantic.candidates);
    supplementalCallingPlans.push({
      queryId: supplemental.queryId,
      question: supplemental.question,
      stageLatencyMs: v2Run.stageLatencyMs,
      queryIntent: v2Run.queryIntent,
      retrievalScope: v2Run.retrievalScope,
      exactDiagnostics: v2Run.hybrid.exact.diagnostics,
      lexicalDiagnostics: v2Run.hybrid.lexical.diagnostics,
      semanticDiagnostics: v2Run.hybrid.semantic.diagnostics,
      fusionDiagnostics: v2Run.hybrid.fusionDiagnostics,
      retrievalDiagnostics: v2Run.hybrid.diagnostics,
      topCandidates: toReviewRows({
        candidates: v2Run.hybrid.candidates.slice(0, 5),
        exactRanks,
        lexicalRanks,
        semanticRanks
      })
    });
  }

  const summary = aggregateMetrics(questions);
  const commitSha = getCommitSha();
  const runId = `wb17-${new Date().toISOString().replace(/[:.]/g, "-")}-${commitSha.slice(0, 7)}`;
  const artifact: SideBySideRunArtifact = {
    artifactVersion: "1.0",
    pipelineVersion: "side-by-side-wb17",
    runId,
    createdAt: new Date().toISOString(),
    commitSha,
    datasetPath,
    legacyArtifactPath,
    corpus,
    freeze: {
      routingRulesUnchanged: true,
      fusionPolicyUnchanged: true,
      budgetsUnchanged: true
    },
    summary,
    questions,
    supplementalCallingPlans: {
      enabled: true,
      note: "Supplemental Calling Plans diagnostics are separate from legacy-vs-v2 aggregate scoring.",
      queries: supplementalCallingPlans
    },
    warnings,
    legacyBaseline: {
      runId: legacyArtifact.runId,
      pipelineVersion: legacyArtifact.pipelineVersion,
      usesKnowledgeEngineV2: legacyArtifact.usesKnowledgeEngineV2,
      summary: legacyArtifact.summary
    }
  };

  await mkdir(options.outputDir, { recursive: true });
  const artifactPath = resolve(options.outputDir, `${runId}.json`);
  const jsonlPath = resolve(options.outputDir, `${runId}.jsonl`);
  const markdownPath = resolve(options.outputDir, `${runId}.md`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  await writeFile(
    jsonlPath,
    artifact.questions
      .map((questionResult) =>
        JSON.stringify({
          runId,
          questionId: questionResult.question.questionId,
          question: questionResult.question.question,
          legacy: {
            gating: questionResult.legacy.result.gating,
            retrieval: questionResult.legacy.result.retrieval,
            metrics: questionResult.comparison.legacyMetrics,
            latencyMs: questionResult.legacy.result.latenciesMs.retrieval
          },
          v2: {
            stageLatencyMs: questionResult.v2.stageLatencyMs,
            queryIntent: questionResult.v2.queryIntent,
            retrievalScope: questionResult.v2.retrievalScope,
            exactDiagnostics: questionResult.v2.exactDiagnostics,
            lexicalDiagnostics: questionResult.v2.lexicalDiagnostics,
            semanticDiagnostics: questionResult.v2.semanticDiagnostics,
            fusionDiagnostics: questionResult.v2.fusionDiagnostics,
            metrics: questionResult.comparison.v2Metrics,
            latencyMs: questionResult.v2.retrievalDiagnostics
          }
        })
      )
      .concat(
        artifact.supplementalCallingPlans.queries.map((supplemental) =>
          JSON.stringify({
            runId,
            supplemental: true,
            queryId: supplemental.queryId,
            question: supplemental.question,
            stageLatencyMs: supplemental.stageLatencyMs,
            queryIntent: supplemental.queryIntent,
            retrievalScope: supplemental.retrievalScope,
            exactDiagnostics: supplemental.exactDiagnostics,
            lexicalDiagnostics: supplemental.lexicalDiagnostics,
            semanticDiagnostics: supplemental.semanticDiagnostics,
            fusionDiagnostics: supplemental.fusionDiagnostics,
            retrievalDiagnostics: supplemental.retrievalDiagnostics,
            topCandidates: supplemental.topCandidates
          })
        )
      )
      .join("\n") + "\n",
    "utf8"
  );
  await writeFile(markdownPath, toSideBySideMarkdown(artifact), "utf8");
  return { artifact, artifactPath, jsonlPath, markdownPath };
}
