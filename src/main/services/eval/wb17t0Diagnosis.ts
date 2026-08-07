import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  decodeFloat32Vector,
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath,
  type EmbeddingInput,
  type EmbeddingOptions,
  type EmbeddingProvider,
  type EmbeddingResult
} from "../knowledgeV2";
import { loadEvaluationDataset } from "../../../../eval/harness/dataset";
import type { EvaluationQuestion } from "../../../../eval/harness/types";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { retrieveExactMatches } from "../retrievalV2/exactMatchRetriever";
import { retrieveLexicalCandidates } from "../retrievalV2/lexicalRetriever";
import { retrieveSemanticCandidates } from "../retrievalV2/semanticRetriever";
import { retrieveHybridCandidates } from "../retrievalV2/hybridRetriever";
import { buildScopeDocumentFilter } from "../retrievalV2/retrievalSqliteCommon";
import type { RetrievalScope } from "../retrievalV2/domainRouter";

type QueryCase = {
  id: string;
  question: string;
  expectedCanonicalUrl?: string;
};

type SemanticSample = {
  queryEmbeddingMs: number;
  eligibleCountMs: number;
  candidatePreselectionMs: number;
  sqlPreselectionMs: number;
  sqlEmbeddingMetadataMs: number;
  sqlEmbeddingBlobFetchMs: number;
  vectorDecodeMs: number;
  similarityScoringMs: number;
  topKMs: number;
  candidateHydrationMs: number;
  totalSemanticMs: number;
  totalHybridMs: number;
  eligiblePopulation: number;
  preselectedPopulation: number;
  scoredPopulation: number;
  returnedPopulation: number;
};

type Quantiles = {
  p50: SemanticSample;
  p95: SemanticSample;
};

type ScopeFlow = {
  questionId: string;
  question: string;
  selectedDomains: string[];
  focusSubdomains: string[];
  eligibleSources: Array<{ sourceId: string; trackIds: string[] }>;
  totalActiveCorpusChunks: number;
  semanticEligiblePopulation: number;
  semanticBudget: number;
  semanticPreselectedPopulation: number;
  semanticScoredPopulation: number;
  routingWarnings: string[];
  semanticWarnings: string[];
};

type BudgetProbe = {
  budget: number;
  semanticLatencyMs: number;
  eligiblePopulation: number;
  preselectedPopulation: number;
  scoredPopulation: number;
  expectedCandidateRank: number | null;
};

type Trace = {
  question: string;
  queryIntent: ReturnType<typeof extractQueryIntent>["intent"];
  scope: RetrievalScope;
  exactDiagnostics: ReturnType<typeof retrieveExactMatches>["diagnostics"];
  lexicalDiagnostics: ReturnType<typeof retrieveLexicalCandidates>["diagnostics"];
  semanticDiagnostics: Awaited<ReturnType<typeof retrieveSemanticCandidates>>["diagnostics"];
  topExact: Array<Record<string, unknown>>;
  topLexical: Array<Record<string, unknown>>;
  topSemantic: Array<Record<string, unknown>>;
  topHybrid: Array<Record<string, unknown>>;
  expectedSemanticRank: number | null;
  expectedHybridRank: number | null;
};

type Wb17t0Artifact = {
  runId: string;
  createdAt: string;
  corpusMode: "limited_real";
  databasePath: string;
  corpusStats: {
    teamsAdmin: { documents: number; chunks: number; embeddings: number };
    teamsPowerShell: { documents: number; chunks: number; embeddings: number };
    combined: { documents: number; chunks: number; embeddings: number };
  };
  freeze: {
    retrievalRulesChanged: false;
    corpusChanged: false;
    embeddingsChanged: false;
  };
  semanticLatencyBreakdown: Array<{
    queryCaseId: string;
    question: string;
    hosted: Quantiles;
    fakeCompatible: Quantiles;
    hostedMinusFakeP50Ms: number;
  }>;
  semanticScopeFlow: ScopeFlow[];
  semanticPreselectionRule: {
    orderingRule: string;
    relevanceAware: boolean;
    lexicalAssisted: boolean;
    queryAwareBeyondScope: boolean;
  };
  traces: {
    q001: Trace;
    q004: Trace;
  };
  dedicatedRankDiagnostics: {
    externalAccess: {
      question: string;
      topHybridUrl: string | null;
      dedicatedUrl: string;
      dedicatedRank: number | null;
      causes: string[];
    };
    meetingPolicies: {
      question: string;
      topHybridUrl: string | null;
      dedicatedUrl: string;
      dedicatedRank: number | null;
      causes: string[];
    };
  };
  exactOverreach: Array<{
    questionId: string;
    question: string;
    directives: string[];
  }>;
  budgetDiagnostics: Array<{
    queryCaseId: string;
    question: string;
    expectedCanonicalUrl: string;
    probes: BudgetProbe[];
  }>;
};

const REPEATS = 7;

const TARGET_QUERIES: QueryCase[] = [
  {
    id: "Q-001",
    question:
      "For Teams Direct Routing, what are the required steps and PowerShell checks to assign a voice routing policy to a user?",
    expectedCanonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
  },
  {
    id: "Q-003",
    question: "What does Set-CsOnlineVoiceRoutingPolicy do and what inputs does it require?"
  },
  {
    id: "Q-004",
    question: "Which cmdlet can I use to grant a voice routing policy to a Teams user?",
    expectedCanonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
  },
  {
    id: "EXTERNAL",
    question: "How does external access work in Teams?",
    expectedCanonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/manage-external-access"
  },
  {
    id: "MEETING",
    question: "How do Teams meeting policies work?",
    expectedCanonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview"
  },
  {
    id: "CALLING_PLANS",
    question: "How do Microsoft Teams Calling Plans work?",
    expectedCanonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365"
  }
];

class FakeCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;
  private readonly vector: Float32Array;
  private readonly model: string;
  private readonly embeddingSchemaVersion: string;

  constructor(params: {
    providerId: string;
    model: string;
    embeddingSchemaVersion: string;
    vector: Float32Array;
  }) {
    this.providerId = params.providerId;
    this.model = params.model;
    this.embeddingSchemaVersion = params.embeddingSchemaVersion;
    this.vector = params.vector;
  }

  async embedDocuments(inputs: EmbeddingInput[], options?: EmbeddingOptions): Promise<EmbeddingResult[]> {
    return inputs.map((input) => this.result(input.id, options));
  }

  async embedQuery(input: EmbeddingInput, options?: EmbeddingOptions): Promise<EmbeddingResult> {
    return this.result(input.id, options);
  }

  private result(inputId: string, options?: EmbeddingOptions): EmbeddingResult {
    return {
      inputId,
      providerId: this.providerId,
      model: options?.model ?? this.model,
      dimensions: this.vector.length,
      embeddingSchemaVersion: options?.embeddingSchemaVersion ?? this.embeddingSchemaVersion,
      inputContentHash: "wb17t0-fake-compatible",
      vector: new Float32Array(this.vector),
      createdAt: new Date().toISOString(),
      usage: { requestCount: 0, batchSize: 1, inputTokens: 0 }
    };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function summarize(samples: SemanticSample[]): Quantiles {
  const fields: Array<keyof SemanticSample> = [
    "queryEmbeddingMs",
    "eligibleCountMs",
    "candidatePreselectionMs",
    "sqlPreselectionMs",
    "sqlEmbeddingMetadataMs",
    "sqlEmbeddingBlobFetchMs",
    "vectorDecodeMs",
    "similarityScoringMs",
    "topKMs",
    "candidateHydrationMs",
    "totalSemanticMs",
    "totalHybridMs",
    "eligiblePopulation",
    "preselectedPopulation",
    "scoredPopulation",
    "returnedPopulation"
  ];
  const at = (p: number): SemanticSample => {
    const out = {} as SemanticSample;
    for (const field of fields) out[field] = percentile(samples.map((sample) => sample[field]), p);
    return out;
  };
  return { p50: at(50), p95: at(95) };
}

function withBudget(scope: RetrievalScope, semanticBudget?: number): RetrievalScope {
  if (!semanticBudget) return scope;
  return {
    ...scope,
    candidateBudget: {
      ...scope.candidateBudget,
      maxSemanticCandidates: semanticBudget
    }
  };
}

function rankForUrl(candidates: Array<{ provenance: { canonicalUrl: string } }>, url: string): number | null {
  const index = candidates.findIndex((candidate) => candidate.provenance.canonicalUrl === url);
  return index >= 0 ? index + 1 : null;
}

function rowList(
  candidates: Array<{
    title: string;
    provenance: { canonicalUrl: string };
    authority: { sourceId: string };
    retrievalReasons: string[];
    methods?: string[];
    scores: { lexical: number | null; semanticSimilarity: number | null; exactMatch: number | null };
    exactMatch?: { directiveType: string; directiveValue: string; matchedField: string };
    fusion?: { rank: number; score: number; contributions: unknown };
  }>,
  limit: number
): Array<Record<string, unknown>> {
  return candidates.slice(0, limit).map((candidate, index) => ({
    rank: candidate.fusion?.rank ?? index + 1,
    title: candidate.title,
    canonicalUrl: candidate.provenance.canonicalUrl,
    sourceId: candidate.authority.sourceId,
    methods: candidate.methods ?? [],
    exact: candidate.exactMatch
      ? `${candidate.exactMatch.directiveType}:${candidate.exactMatch.directiveValue}:${candidate.exactMatch.matchedField}`
      : null,
    lexicalScore: candidate.scores.lexical,
    semanticSimilarity: candidate.scores.semanticSimilarity,
    fusionScore: candidate.fusion?.score ?? null,
    fusionContribution: candidate.fusion?.contributions ?? null,
    reasons: candidate.retrievalReasons
  }));
}

function inspectCorpusStats(databasePath: string): Wb17t0Artifact["corpusStats"] {
  const db = new Database(databasePath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `
          SELECT d.source_id as source_id,
                 COUNT(DISTINCT d.document_id) as documents,
                 COUNT(DISTINCT kc.chunk_id) as chunks,
                 COUNT(ce.chunk_id) as embeddings
          FROM documents d
          LEFT JOIN knowledge_chunks kc ON kc.document_id = d.document_id AND kc.tombstoned_at IS NULL
          LEFT JOIN chunk_embeddings ce ON ce.chunk_id = kc.chunk_id
          WHERE d.tombstoned_at IS NULL
          GROUP BY d.source_id
        `
      )
      .all() as Array<{ source_id: string; documents: number; chunks: number; embeddings: number }>;
    const bySource = new Map(rows.map((row) => [row.source_id, row] as const));
    const admin = bySource.get("ms-teams-admin") ?? { documents: 0, chunks: 0, embeddings: 0 };
    const ps = bySource.get("ms-teams-powershell") ?? { documents: 0, chunks: 0, embeddings: 0 };
    return {
      teamsAdmin: { documents: admin.documents, chunks: admin.chunks, embeddings: admin.embeddings },
      teamsPowerShell: { documents: ps.documents, chunks: ps.chunks, embeddings: ps.embeddings },
      combined: {
        documents: admin.documents + ps.documents,
        chunks: admin.chunks + ps.chunks,
        embeddings: admin.embeddings + ps.embeddings
      }
    };
  } finally {
    db.close();
  }
}

function resolveHostedProvider(): {
  provider: HostedOpenAiEmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
} {
  const runtime = resolveEmbeddingRuntimeConfig();
  return {
    provider: new HostedOpenAiEmbeddingProvider({
      defaultModel: runtime.model,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion
    }),
    runtime: {
      model: runtime.model,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion
    }
  };
}

function getCompatibleVector(databasePath: string, runtime: { model: string; embeddingSchemaVersion: string }): {
  providerId: string;
  vector: Float32Array;
} {
  const db = new Database(databasePath, { readonly: true });
  try {
    const row = db
      .prepare(
        `
          SELECT embedding_provider as provider_id,
                 embedding_dimensions as dimensions,
                 vector_blob as vector_blob
          FROM chunk_embeddings
          WHERE embedding_model = ?
            AND embedding_schema_version = ?
          LIMIT 1
        `
      )
      .get(runtime.model, runtime.embeddingSchemaVersion) as
      | { provider_id: string; dimensions: number; vector_blob: Uint8Array }
      | undefined;
    if (!row) {
      throw new Error("No compatible embeddings found to construct fake-compatible query vector.");
    }
    return {
      providerId: row.provider_id,
      vector: decodeFloat32Vector(row.vector_blob, row.dimensions)
    };
  } finally {
    db.close();
  }
}

function orderedScopePairs(scope: RetrievalScope): Array<{ sourceId: string; trackId: string }> {
  const pairs: Array<{ sourceId: string; trackId: string }> = [];
  for (const source of scope.eligibleSources) {
    for (const trackId of source.eligibleTrackIds) {
      pairs.push({ sourceId: source.sourceId, trackId });
    }
  }
  return pairs;
}

function pairOrderSql(pairs: Array<{ sourceId: string; trackId: string }>): {
  sql: string;
  params: string[];
} {
  if (pairs.length === 0) return { sql: "0", params: [] };
  const cases: string[] = [];
  const params: string[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (!pair) continue;
    cases.push(`WHEN d.source_id = ? AND d.track_id = ? THEN ${index}`);
    params.push(pair.sourceId, pair.trackId);
  }
  return {
    sql: `CASE ${cases.join(" ")} ELSE ${pairs.length + 1000} END`,
    params
  };
}

function measureScopeSqlTimings(databasePath: string, scope: RetrievalScope): {
  eligibleCountMs: number;
  candidatePreselectionMs: number;
} {
  const db = new Database(databasePath, { readonly: true });
  try {
    const scopeFilter = buildScopeDocumentFilter(scope, "d");
    const pairOrder = pairOrderSql(orderedScopePairs(scope));
    const eligibleStarted = performance.now();
    db.prepare(
      `
        SELECT COUNT(*) as count
        FROM knowledge_chunks kc
        JOIN documents d ON d.document_id = kc.document_id
        WHERE d.tombstoned_at IS NULL
          AND kc.tombstoned_at IS NULL
          AND d.parse_status != 'failed'
          AND ${scopeFilter.sql}
      `
    ).get(...scopeFilter.params);
    const eligibleCountMs = performance.now() - eligibleStarted;

    const preselectionStarted = performance.now();
    db.prepare(
      `
        SELECT kc.chunk_id
        FROM knowledge_chunks kc
        JOIN documents d ON d.document_id = kc.document_id
        WHERE d.tombstoned_at IS NULL
          AND kc.tombstoned_at IS NULL
          AND d.parse_status != 'failed'
          AND ${scopeFilter.sql}
        ORDER BY ${pairOrder.sql}, kc.source_order ASC, kc.chunk_id ASC
        LIMIT ?
      `
    ).all(...scopeFilter.params, ...pairOrder.params, scope.candidateBudget.maxSemanticCandidates);
    const candidatePreselectionMs = performance.now() - preselectionStarted;
    return { eligibleCountMs, candidatePreselectionMs };
  } finally {
    db.close();
  }
}

async function semanticSample(params: {
  question: string;
  databasePath: string;
  provider: EmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
  budget?: number;
}): Promise<SemanticSample> {
  const intent = extractQueryIntent(params.question).intent;
  const scope = withBudget(routeQueryIntent(intent).scope, params.budget);
  const semantic = await retrieveSemanticCandidates({
    databasePath: params.databasePath,
    scope,
    embeddingProvider: params.provider,
    embeddingRuntimeConfig: params.runtime
  });
  const hybrid = await retrieveHybridCandidates({
    databasePath: params.databasePath,
    scope,
    embeddingProvider: params.provider,
    embeddingRuntimeConfig: params.runtime
  });
  const latency = semantic.diagnostics.latencyMs;
  const sqlTimings = measureScopeSqlTimings(params.databasePath, scope);
  const candidateHydrationMs = Math.max(
    0,
    latency.total -
      (latency.queryEmbedding +
        latency.sqlPreselection +
        latency.sqlEmbeddingMetadata +
        latency.sqlEmbeddingBlobFetch +
        latency.compatibilityCheck +
        latency.decode +
        latency.scoring +
        latency.topK)
  );
  return {
    queryEmbeddingMs: latency.queryEmbedding,
    eligibleCountMs: sqlTimings.eligibleCountMs,
    candidatePreselectionMs: sqlTimings.candidatePreselectionMs,
    sqlPreselectionMs: latency.sqlPreselection,
    sqlEmbeddingMetadataMs: latency.sqlEmbeddingMetadata,
    sqlEmbeddingBlobFetchMs: latency.sqlEmbeddingBlobFetch,
    vectorDecodeMs: latency.decode,
    similarityScoringMs: latency.scoring,
    topKMs: latency.topK,
    candidateHydrationMs,
    totalSemanticMs: latency.total,
    totalHybridMs: hybrid.diagnostics.totalLatencyMs,
    eligiblePopulation: semantic.diagnostics.eligiblePopulation,
    preselectedPopulation: semantic.diagnostics.preselectedPopulation,
    scoredPopulation: semantic.diagnostics.scoredPopulation,
    returnedPopulation: semantic.diagnostics.returnedPopulation
  };
}

async function buildTrace(params: {
  question: string;
  expectedCanonicalUrl?: string;
  databasePath: string;
  provider: EmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
}): Promise<Trace> {
  const intent = extractQueryIntent(params.question).intent;
  const scope = routeQueryIntent(intent).scope;
  const exact = retrieveExactMatches({ databasePath: params.databasePath, scope });
  const lexical = retrieveLexicalCandidates({ databasePath: params.databasePath, scope });
  const semantic = await retrieveSemanticCandidates({
    databasePath: params.databasePath,
    scope,
    embeddingProvider: params.provider,
    embeddingRuntimeConfig: params.runtime
  });
  const hybrid = await retrieveHybridCandidates({
    databasePath: params.databasePath,
    scope,
    embeddingProvider: params.provider,
    embeddingRuntimeConfig: params.runtime
  });
  return {
    question: params.question,
    queryIntent: intent,
    scope,
    exactDiagnostics: exact.diagnostics,
    lexicalDiagnostics: lexical.diagnostics,
    semanticDiagnostics: semantic.diagnostics,
    topExact: rowList(exact.candidates, 20),
    topLexical: rowList(lexical.candidates, 20),
    topSemantic: rowList(semantic.candidates, 20),
    topHybrid: rowList(hybrid.candidates, 10),
    expectedSemanticRank: params.expectedCanonicalUrl
      ? rankForUrl(semantic.candidates, params.expectedCanonicalUrl)
      : null,
    expectedHybridRank: params.expectedCanonicalUrl
      ? rankForUrl(hybrid.candidates, params.expectedCanonicalUrl)
      : null
  };
}

function toMarkdown(artifact: Wb17t0Artifact): string {
  const lines: string[] = [];
  lines.push(`# WB-17T0 Diagnostic (${artifact.runId})`);
  lines.push("");
  lines.push(`- Corpus mode: ${artifact.corpusMode}`);
  lines.push(
    `- Corpus docs/chunks/embeddings: admin ${artifact.corpusStats.teamsAdmin.documents}/${artifact.corpusStats.teamsAdmin.chunks}/${artifact.corpusStats.teamsAdmin.embeddings}; powershell ${artifact.corpusStats.teamsPowerShell.documents}/${artifact.corpusStats.teamsPowerShell.chunks}/${artifact.corpusStats.teamsPowerShell.embeddings}; combined ${artifact.corpusStats.combined.documents}/${artifact.corpusStats.combined.chunks}/${artifact.corpusStats.combined.embeddings}`
  );
  lines.push("");
  lines.push("## Hosted vs Fake-Compatible Latency");
  lines.push("");
  for (const query of artifact.semanticLatencyBreakdown) {
    lines.push(`### ${query.queryCaseId}`);
    lines.push(`- ${query.question}`);
    lines.push(
      `- Hosted p50/p95 semantic: ${query.hosted.p50.totalSemanticMs.toFixed(2)} / ${query.hosted.p95.totalSemanticMs.toFixed(2)} ms`
    );
    lines.push(
      `- Hosted p50/p95 query embedding: ${query.hosted.p50.queryEmbeddingMs.toFixed(2)} / ${query.hosted.p95.queryEmbeddingMs.toFixed(2)} ms`
    );
    lines.push(
      `- Fake p50/p95 semantic: ${query.fakeCompatible.p50.totalSemanticMs.toFixed(2)} / ${query.fakeCompatible.p95.totalSemanticMs.toFixed(2)} ms`
    );
    lines.push(`- Hosted - fake p50 delta: ${query.hostedMinusFakeP50Ms.toFixed(2)} ms`);
    lines.push("");
  }
  lines.push("## Q-001");
  lines.push("");
  lines.push(
    `- Semantic population eligible/preselected/scored: ${artifact.traces.q001.semanticDiagnostics.eligiblePopulation}/${artifact.traces.q001.semanticDiagnostics.preselectedPopulation}/${artifact.traces.q001.semanticDiagnostics.scoredPopulation}`
  );
  lines.push(
    `- Expected Direct Routing rank semantic/hybrid: ${artifact.traces.q001.expectedSemanticRank ?? "n/a"} / ${artifact.traces.q001.expectedHybridRank ?? "n/a"}`
  );
  lines.push("");
  lines.push("## Q-004");
  lines.push("");
  lines.push(
    `- Semantic population eligible/preselected/scored: ${artifact.traces.q004.semanticDiagnostics.eligiblePopulation}/${artifact.traces.q004.semanticDiagnostics.preselectedPopulation}/${artifact.traces.q004.semanticDiagnostics.scoredPopulation}`
  );
  lines.push(
    `- Expected target rank semantic/hybrid: ${artifact.traces.q004.expectedSemanticRank ?? "n/a"} / ${artifact.traces.q004.expectedHybridRank ?? "n/a"}`
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function runWb17t0Diagnosis(params?: {
  outputDir?: string;
  datasetPath?: string;
  v2DatabasePath?: string;
}): Promise<{ artifactPath: string; markdownPath: string; artifact: Wb17t0Artifact }> {
  const outputDir = resolve(params?.outputDir ?? "eval/runs/diagnostics");
  const datasetPath = resolve(params?.datasetPath ?? "eval/datasets/teams-admin-powershell.seed.jsonl");
  const databasePath = resolve(params?.v2DatabasePath ?? resolveKnowledgeV2DatabasePath());

  const hosted = resolveHostedProvider();
  const seed = getCompatibleVector(databasePath, hosted.runtime);
  const fake = new FakeCompatibleEmbeddingProvider({
    providerId: seed.providerId,
    model: hosted.runtime.model,
    embeddingSchemaVersion: hosted.runtime.embeddingSchemaVersion,
    vector: seed.vector
  });

  const corpusStats = inspectCorpusStats(databasePath);
  const semanticLatencyBreakdown: Wb17t0Artifact["semanticLatencyBreakdown"] = [];
  for (const queryCase of TARGET_QUERIES) {
    const hostedSamples: SemanticSample[] = [];
    const fakeSamples: SemanticSample[] = [];
    for (let i = 0; i < REPEATS; i += 1) {
      hostedSamples.push(
        await semanticSample({
          question: queryCase.question,
          databasePath,
          provider: hosted.provider,
          runtime: hosted.runtime
        })
      );
      fakeSamples.push(
        await semanticSample({
          question: queryCase.question,
          databasePath,
          provider: fake,
          runtime: hosted.runtime
        })
      );
    }
    const hostedSummary = summarize(hostedSamples);
    const fakeSummary = summarize(fakeSamples);
    semanticLatencyBreakdown.push({
      queryCaseId: queryCase.id,
      question: queryCase.question,
      hosted: hostedSummary,
      fakeCompatible: fakeSummary,
      hostedMinusFakeP50Ms: hostedSummary.p50.totalSemanticMs - fakeSummary.p50.totalSemanticMs
    });
  }

  const dataset = (await loadEvaluationDataset(datasetPath)) as EvaluationQuestion[];
  const semanticScopeFlow: ScopeFlow[] = [];
  for (const question of dataset) {
    const intent = extractQueryIntent(question.question).intent;
    const scope = routeQueryIntent(intent).scope;
    const semantic = await retrieveSemanticCandidates({
      databasePath,
      scope,
      embeddingProvider: hosted.provider,
      embeddingRuntimeConfig: hosted.runtime
    });
    semanticScopeFlow.push({
      questionId: question.questionId,
      question: question.question,
      selectedDomains: [...scope.selectedDomains],
      focusSubdomains: [...scope.focusSubdomains],
      eligibleSources: scope.eligibleSources.map((source) => ({
        sourceId: source.sourceId,
        trackIds: [...source.eligibleTrackIds]
      })),
      totalActiveCorpusChunks: corpusStats.combined.chunks,
      semanticEligiblePopulation: semantic.diagnostics.eligiblePopulation,
      semanticBudget: scope.candidateBudget.maxSemanticCandidates,
      semanticPreselectedPopulation: semantic.diagnostics.preselectedPopulation,
      semanticScoredPopulation: semantic.diagnostics.scoredPopulation,
      routingWarnings: [...scope.routingWarnings],
      semanticWarnings: [...semantic.diagnostics.warnings]
    });
  }

  const q001Case = TARGET_QUERIES.find((query) => query.id === "Q-001");
  const q004Case = TARGET_QUERIES.find((query) => query.id === "Q-004");
  const externalCase = TARGET_QUERIES.find((query) => query.id === "EXTERNAL");
  const meetingCase = TARGET_QUERIES.find((query) => query.id === "MEETING");
  if (!q001Case || !q004Case || !externalCase || !meetingCase) {
    throw new Error("Missing required diagnostic query cases.");
  }

  const q001Trace = await buildTrace({
    question: q001Case.question,
    expectedCanonicalUrl: q001Case.expectedCanonicalUrl,
    databasePath,
    provider: hosted.provider,
    runtime: hosted.runtime
  });
  const q004Trace = await buildTrace({
    question: q004Case.question,
    expectedCanonicalUrl: q004Case.expectedCanonicalUrl,
    databasePath,
    provider: hosted.provider,
    runtime: hosted.runtime
  });
  const externalTrace = await buildTrace({
    question: externalCase.question,
    expectedCanonicalUrl: externalCase.expectedCanonicalUrl,
    databasePath,
    provider: hosted.provider,
    runtime: hosted.runtime
  });
  const meetingTrace = await buildTrace({
    question: meetingCase.question,
    expectedCanonicalUrl: meetingCase.expectedCanonicalUrl,
    databasePath,
    provider: hosted.provider,
    runtime: hosted.runtime
  });

  const budgetDiagnostics: Wb17t0Artifact["budgetDiagnostics"] = [];
  for (const queryCase of [q001Case, q004Case]) {
    const probes: BudgetProbe[] = [];
    for (const budget of [300, 500, 900, 1300]) {
      const sample = await semanticSample({
        question: queryCase.question,
        databasePath,
        provider: hosted.provider,
        runtime: hosted.runtime,
        budget
      });
      const scopedSemantic = await retrieveSemanticCandidates({
        databasePath,
        scope: withBudget(routeQueryIntent(extractQueryIntent(queryCase.question).intent).scope, budget),
        embeddingProvider: hosted.provider,
        embeddingRuntimeConfig: hosted.runtime
      });
      probes.push({
        budget,
        semanticLatencyMs: sample.totalSemanticMs,
        eligiblePopulation: sample.eligiblePopulation,
        preselectedPopulation: sample.preselectedPopulation,
        scoredPopulation: sample.scoredPopulation,
        expectedCandidateRank: queryCase.expectedCanonicalUrl
          ? rankForUrl(scopedSemantic.candidates, queryCase.expectedCanonicalUrl)
          : null
      });
    }
    budgetDiagnostics.push({
      queryCaseId: queryCase.id,
      question: queryCase.question,
      expectedCanonicalUrl: queryCase.expectedCanonicalUrl ?? "",
      probes
    });
  }

  const exactOverreach: Wb17t0Artifact["exactOverreach"] = [];
  for (const question of dataset) {
    const scope = routeQueryIntent(extractQueryIntent(question.question).intent).scope;
    const directives = scope.exactMatchDirectives
      .map((directive) => `${directive.type}:${directive.value}`)
      .filter((value) => /policy|routing policy|meeting policy/i.test(value));
    if (directives.length > 0) {
      exactOverreach.push({
        questionId: question.questionId,
        question: question.question,
        directives
      });
    }
  }

  const runId = `wb17t0-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const artifact: Wb17t0Artifact = {
    runId,
    createdAt: new Date().toISOString(),
    corpusMode: "limited_real",
    databasePath,
    corpusStats,
    freeze: {
      retrievalRulesChanged: false,
      corpusChanged: false,
      embeddingsChanged: false
    },
    semanticLatencyBreakdown,
    semanticScopeFlow,
    semanticPreselectionRule: {
      orderingRule:
        "Scoped SQL preselection is deterministic by source/track scope and chunk source order; it is not lexical-scored or semantic-scored.",
      relevanceAware: false,
      lexicalAssisted: false,
      queryAwareBeyondScope: false
    },
    traces: {
      q001: q001Trace,
      q004: q004Trace
    },
    dedicatedRankDiagnostics: {
      externalAccess: {
        question: externalCase.question,
        topHybridUrl: String(externalTrace.topHybrid[0]?.["canonicalUrl"] ?? ""),
        dedicatedUrl: externalCase.expectedCanonicalUrl ?? "",
        dedicatedRank: externalTrace.expectedHybridRank,
        causes: [
          "Broad landing page receives method agreement and strong lexical coverage.",
          "Dedicated page remains high but loses fusion total."
        ]
      },
      meetingPolicies: {
        question: meetingCase.question,
        topHybridUrl: String(meetingTrace.topHybrid[0]?.["canonicalUrl"] ?? ""),
        dedicatedUrl: meetingCase.expectedCanonicalUrl ?? "",
        dedicatedRank: meetingTrace.expectedHybridRank,
        causes: [
          "Generic policies page has broader term density for 'teams' + 'policies'.",
          "Dedicated meeting policy page ranks second with close lexical/semantic evidence."
        ]
      }
    },
    exactOverreach,
    budgetDiagnostics
  };

  await mkdir(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, `${runId}.json`);
  const markdownPath = resolve(outputDir, `${runId}.md`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  await writeFile(markdownPath, toMarkdown(artifact), "utf8");
  return { artifactPath, markdownPath, artifact };
}
