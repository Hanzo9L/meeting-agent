import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";
import { loadEvaluationDataset } from "../../../../eval/harness/dataset";
import type { EvaluationQuestion } from "../../../../eval/harness/types";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { retrieveHybridCandidates } from "../retrievalV2/hybridRetriever";

type RetrievalMetricSet = {
  expectedSourceHitTop1: boolean;
  expectedSourceHitTop3: boolean;
  expectedSourceHitTop5: boolean;
  expectedSourceHitTop10: boolean;
  firstExpectedSourceRank: number | null;
  reciprocalRank: number;
  recallAt1: number | null;
  recallAt3: number | null;
  recallAt5: number | null;
  recallAt10: number | null;
  exactCmdletMatchSuccess: boolean | null;
  domainRoutingCorrect: boolean;
  authorityCorrectTop1: boolean;
  inappropriateSourceLeakageCount: number;
};

type EvaluatedQuestion = {
  question: EvaluationQuestion;
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
  scope: ReturnType<typeof routeQueryIntent>["scope"];
  semanticPopulation: {
    eligiblePopulation: number;
    preselectedPopulation: number;
    scoredPopulation: number;
    queryEmbeddingLatencyMs: number;
    reasonCounts: Record<string, number>;
  };
  metrics: RetrievalMetricSet;
  top10: Array<{
    rank: number;
    title: string;
    canonicalUrl: string;
    sourceId: string;
    methods: string[];
    exactMatchState: string | null;
    lexicalScore: number | null;
    semanticSimilarity: number | null;
    fusionScore: number;
    reasons: string[];
  }>;
};

type V2EvalArtifact = {
  artifactVersion: "1.0";
  runId: string;
  createdAt: string;
  datasetPath: string;
  databasePath: string;
  summary: {
    totalQuestions: number;
    expectedSourceHitTop1: number;
    expectedSourceHitTop3: number;
    expectedSourceHitTop5: number;
    expectedSourceHitTop10: number;
    mrr: number;
    meanRecallAt5: number;
    meanRecallAt10: number;
    exactCmdletSuccess: { success: number; total: number };
    domainRoutingCorrect: number;
    authorityCorrectTop1: number;
    leakageQuestions: number;
    p50SemanticLatencyMs: number;
    p95SemanticLatencyMs: number;
    p50TotalHybridLatencyMs: number;
    p95TotalHybridLatencyMs: number;
    p50QueryEmbeddingLatencyMs: number;
    p95QueryEmbeddingLatencyMs: number;
    meanSemanticEligiblePopulation: number;
    meanSemanticPreselectedPopulation: number;
    meanSemanticScoredPopulation: number;
  };
  questions: EvaluatedQuestion[];
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function expectedDomainSet(question: EvaluationQuestion): Set<string> {
  const domains = new Set(question.expectedSourceDomains);
  domains.add(question.expectedDomain);
  domains.delete("unknown");
  return domains;
}

function sourceDomainsForSourceId(sourceId: string): string[] {
  if (sourceId === "ms-teams-admin") return ["teams_admin"];
  if (sourceId === "ms-teams-powershell") return ["teams_powershell"];
  if (sourceId === "ms-teams-dev-docs") return ["teams_dev"];
  if (sourceId === "ms-graph-docs") return ["graph"];
  if (sourceId === "ms-entra-docs") return ["entra"];
  if (sourceId === "ms-m365-docs") return ["m365"];
  return [];
}

function firstRank<T>(items: T[], predicate: (value: T) => boolean): number | null {
  for (let index = 0; index < items.length; index += 1) {
    if (predicate(items[index] as T)) return index + 1;
  }
  return null;
}

function recallAtK(
  topKSources: string[],
  expectedDomains: Set<string>
): number | null {
  if (expectedDomains.size === 0) return null;
  const found = new Set<string>();
  for (const sourceId of topKSources) {
    for (const domain of sourceDomainsForSourceId(sourceId)) {
      if (expectedDomains.has(domain)) found.add(domain);
    }
  }
  return found.size / expectedDomains.size;
}

function computeMetrics(params: {
  question: EvaluationQuestion;
  selectedDomains: string[];
  candidates: Awaited<ReturnType<typeof retrieveHybridCandidates>>["candidates"];
}): RetrievalMetricSet {
  const expectedDomains = expectedDomainSet(params.question);
  const expectedSourceHit = (k: number): boolean =>
    params.candidates.slice(0, k).some((candidate) =>
      sourceDomainsForSourceId(candidate.authority.sourceId).some((domain) =>
        expectedDomains.has(domain)
      )
    );
  const firstExpectedSourceRank = firstRank(params.candidates, (candidate) =>
    sourceDomainsForSourceId(candidate.authority.sourceId).some((domain) =>
      expectedDomains.has(domain)
    )
  );
  const cmdletExpected =
    params.question.expectedIntent === "reference" &&
    /set-cs|grant-cs|get-cs/i.test(params.question.question);
  const exactCmdletMatchSuccess = cmdletExpected
    ? params.candidates.some(
        (candidate) =>
          candidate.methods.includes("exact") &&
          candidate.exactMatch?.directiveType === "cmdlet"
      )
    : null;
  const leakageCount = params.candidates
    .slice(0, 10)
    .filter(
      (candidate) =>
        !sourceDomainsForSourceId(candidate.authority.sourceId).some((domain) =>
          expectedDomains.has(domain)
        )
    ).length;
  return {
    expectedSourceHitTop1: expectedSourceHit(1),
    expectedSourceHitTop3: expectedSourceHit(3),
    expectedSourceHitTop5: expectedSourceHit(5),
    expectedSourceHitTop10: expectedSourceHit(10),
    firstExpectedSourceRank,
    reciprocalRank: firstExpectedSourceRank ? 1 / firstExpectedSourceRank : 0,
    recallAt1: recallAtK(
      params.candidates.slice(0, 1).map((candidate) => candidate.authority.sourceId),
      expectedDomains
    ),
    recallAt3: recallAtK(
      params.candidates.slice(0, 3).map((candidate) => candidate.authority.sourceId),
      expectedDomains
    ),
    recallAt5: recallAtK(
      params.candidates.slice(0, 5).map((candidate) => candidate.authority.sourceId),
      expectedDomains
    ),
    recallAt10: recallAtK(
      params.candidates.slice(0, 10).map((candidate) => candidate.authority.sourceId),
      expectedDomains
    ),
    exactCmdletMatchSuccess,
    domainRoutingCorrect:
      params.question.expectedDomain === "unknown" ||
      params.selectedDomains.includes(params.question.expectedDomain),
    authorityCorrectTop1:
      sourceDomainsForSourceId(params.candidates[0]?.authority.sourceId ?? "").includes(
        params.question.expectedDomain
      ),
    inappropriateSourceLeakageCount: leakageCount
  };
}

function buildSummary(questions: EvaluatedQuestion[]): V2EvalArtifact["summary"] {
  const semanticLatencies = questions.map((question) => question.stageLatencyMs.semantic);
  const totalLatencies = questions.map((question) => question.stageLatencyMs.totalHybridRetrieval);
  const queryEmbeddingLatencies = questions.map(
    (question) => question.semanticPopulation.queryEmbeddingLatencyMs
  );
  const metrics = questions.map((question) => question.metrics);
  const recalls5 = metrics
    .map((metric) => metric.recallAt5)
    .filter((value): value is number => value !== null);
  const recalls10 = metrics
    .map((metric) => metric.recallAt10)
    .filter((value): value is number => value !== null);
  const cmdletMetrics = metrics.filter((metric) => metric.exactCmdletMatchSuccess !== null);
  return {
    totalQuestions: questions.length,
    expectedSourceHitTop1: metrics.filter((metric) => metric.expectedSourceHitTop1).length,
    expectedSourceHitTop3: metrics.filter((metric) => metric.expectedSourceHitTop3).length,
    expectedSourceHitTop5: metrics.filter((metric) => metric.expectedSourceHitTop5).length,
    expectedSourceHitTop10: metrics.filter((metric) => metric.expectedSourceHitTop10).length,
    mrr: average(metrics.map((metric) => metric.reciprocalRank)),
    meanRecallAt5: average(recalls5),
    meanRecallAt10: average(recalls10),
    exactCmdletSuccess: {
      success: cmdletMetrics.filter((metric) => metric.exactCmdletMatchSuccess === true).length,
      total: cmdletMetrics.length
    },
    domainRoutingCorrect: metrics.filter((metric) => metric.domainRoutingCorrect).length,
    authorityCorrectTop1: metrics.filter((metric) => metric.authorityCorrectTop1).length,
    leakageQuestions: metrics.filter((metric) => metric.inappropriateSourceLeakageCount > 0).length,
    p50SemanticLatencyMs: percentile(semanticLatencies, 50),
    p95SemanticLatencyMs: percentile(semanticLatencies, 95),
    p50TotalHybridLatencyMs: percentile(totalLatencies, 50),
    p95TotalHybridLatencyMs: percentile(totalLatencies, 95),
    p50QueryEmbeddingLatencyMs: percentile(queryEmbeddingLatencies, 50),
    p95QueryEmbeddingLatencyMs: percentile(queryEmbeddingLatencies, 95),
    meanSemanticEligiblePopulation: average(
      questions.map((question) => question.semanticPopulation.eligiblePopulation)
    ),
    meanSemanticPreselectedPopulation: average(
      questions.map((question) => question.semanticPopulation.preselectedPopulation)
    ),
    meanSemanticScoredPopulation: average(
      questions.map((question) => question.semanticPopulation.scoredPopulation)
    )
  };
}

export async function runV2RetrievalEvaluation(params: {
  datasetPath: string;
  outputDir: string;
  v2DatabasePath?: string;
}): Promise<{ artifact: V2EvalArtifact; artifactPath: string }> {
  const datasetPath = resolve(params.datasetPath);
  const outputDir = resolve(params.outputDir);
  const databasePath = resolve(params.v2DatabasePath ?? resolveKnowledgeV2DatabasePath());
  const runtime = resolveEmbeddingRuntimeConfig();
  const provider = new HostedOpenAiEmbeddingProvider({
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion
  });
  const dataset = await loadEvaluationDataset(datasetPath);

  const questions: EvaluatedQuestion[] = [];
  for (const question of dataset) {
    const intentStart = performance.now();
    const intent = extractQueryIntent(question.question).intent;
    const intentLatency = performance.now() - intentStart;
    const routeStart = performance.now();
    const route = routeQueryIntent(intent);
    const routeLatency = performance.now() - routeStart;
    const hybrid = await retrieveHybridCandidates({
      databasePath,
      scope: route.scope,
      embeddingProvider: provider,
      embeddingRuntimeConfig: runtime
    });
    const metrics = computeMetrics({
      question,
      selectedDomains: route.scope.selectedDomains,
      candidates: hybrid.candidates
    });
    questions.push({
      question,
      stageLatencyMs: {
        queryIntent: intentLatency,
        domainRouter: routeLatency,
        exact: hybrid.diagnostics.exactLatencyMs,
        lexical: hybrid.diagnostics.lexicalLatencyMs,
        semantic: hybrid.diagnostics.semanticLatencyMs,
        fusion: hybrid.diagnostics.fusionLatencyMs,
        totalHybridRetrieval: hybrid.diagnostics.totalLatencyMs
      },
      queryIntent: intent,
      scope: route.scope,
      semanticPopulation: {
        eligiblePopulation: hybrid.semantic.diagnostics.eligiblePopulation,
        preselectedPopulation: hybrid.semantic.diagnostics.preselectedPopulation,
        scoredPopulation: hybrid.semantic.diagnostics.scoredPopulation,
        queryEmbeddingLatencyMs: hybrid.semantic.diagnostics.latencyMs.queryEmbedding,
        reasonCounts: hybrid.semantic.diagnostics.preselectionReasonCounts as Record<string, number>
      },
      metrics,
      top10: hybrid.candidates.slice(0, 10).map((candidate) => ({
        rank: candidate.fusion.rank,
        title: candidate.title,
        canonicalUrl: candidate.provenance.canonicalUrl,
        sourceId: candidate.authority.sourceId,
        methods: [...candidate.methods],
        exactMatchState: candidate.exactMatch
          ? `${candidate.exactMatch.directiveType}:${candidate.exactMatch.directiveValue}:${candidate.exactMatch.matchedField}`
          : null,
        lexicalScore: candidate.scores.lexical,
        semanticSimilarity: candidate.scores.semanticSimilarity,
        fusionScore: candidate.fusion.score,
        reasons: [...candidate.retrievalReasons]
      }))
    });
  }

  const runId = `v2eval-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const artifact: V2EvalArtifact = {
    artifactVersion: "1.0",
    runId,
    createdAt: new Date().toISOString(),
    datasetPath,
    databasePath,
    summary: buildSummary(questions),
    questions
  };
  await mkdir(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, `${runId}.json`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return { artifact, artifactPath };
}
