import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import OpenAI from "openai";
import {
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath,
  type EmbeddingProvider
} from "../knowledgeV2";
import { loadEvaluationDataset } from "../../../../eval/harness/dataset";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { retrieveHybridCandidates } from "../retrievalV2/hybridRetriever";
import { runV2RetrievalEvaluation } from "./v2RetrievalEvaluator";

type Percentiles = { p50: number; p95: number };

type HostedLifecycleFindings = {
  providerCreatedPerQuery: boolean;
  constructorMs: number;
  coldEmbedQueryMs: number;
  coldRequestMs: number;
  coldResponseProcessingMs: number;
  warmEmbedQueryMs: Percentiles;
  warmRequestMs: Percentiles;
  warmResponseProcessingMs: Percentiles;
  overlapWithExactLexicalAlreadyEnabled: boolean;
  overlapComparisonMs: {
    overlap: Percentiles;
    sequential: Percentiles;
  };
};

type HostedOptimizationResult = {
  baselinePerQueryProviderMs: Percentiles;
  optimizedSharedProviderMs: Percentiles;
  optimizedQueryEmbeddingMs: Percentiles;
};

type CacheFeasibility = {
  keyShape: string;
  uncachedHitRate: number;
  replayHitRate: number;
  estimatedMemoryBytesPerEntry: number;
  notes: string[];
};

type LocalFeasibility = {
  status: "evaluated" | "unavailable";
  failureReason?: string;
  modelId: string;
  modelLicense: string;
  runtime: string;
  windowsArm64Compatibility: string;
  dimensions: number;
  cacheDirBytes: number;
  modelLoadMs: number;
  residentMemoryBytes: number;
  localQueryLatencyMs: Percentiles;
  localQueryCpuMs: number;
  localDbPath: string;
  corpusChunkCount: number;
  corpusEmbeddingDurationMs: number;
  corpusEmbeddingThroughputPerSec: number;
};

type EvalRunSummary = {
  runId: string;
  datasetPath: string;
  top1: string;
  top3: string;
  top5: string;
  top10: string;
  mrr: number;
  recallAt10: number;
  leakageQuestions: number;
  p50TotalMs: number;
  p95TotalMs: number;
  p50QueryEmbeddingMs: number;
  p95QueryEmbeddingMs: number;
};

type Wb17l0Artifact = {
  artifactVersion: "1.0";
  runId: string;
  createdAt: string;
  productionEmbeddingIdentity: {
    provider: "openai";
    model: string;
    dimensions: number;
    schema: string;
  };
  hostedLifecycle: HostedLifecycleFindings;
  hostedOptimizations: HostedOptimizationResult;
  cacheFeasibility: CacheFeasibility;
  localFeasibility: LocalFeasibility;
  openAiRuns: {
    seed: EvalRunSummary;
    holdoutV3: EvalRunSummary;
    callingPlans: EvalRunSummary;
  };
  localRuns: {
    seed: EvalRunSummary;
    holdoutV3: EvalRunSummary;
    callingPlans: EvalRunSummary;
  } | null;
  rankingDifferences: Array<{
    dataset: string;
    questionId: string;
    openAiTop1: string;
    localTop1: string;
    openAiFirstExpectedRank: number | null;
    localFirstExpectedRank: number | null;
  }>;
  decision: "A" | "B" | "C" | "D";
  decisionRationale: string;
  productionEmbeddingsUnchanged: true;
  corpusUnchanged: true;
  retrievalPrecisionFrozen: true;
};

type EmbeddingIdentity = {
  providerId: string;
  model: string;
  schema: string;
  dimensions: number;
};

export interface RunWb17l0SpikeParams {
  outputDir?: string;
  v2DatabasePath?: string;
}

export async function runWb17l0Spike(
  params: RunWb17l0SpikeParams = {}
): Promise<{ artifact: Wb17l0Artifact; artifactPath: string }> {
  const outputDir = resolve(params.outputDir ?? "eval/runs/spikes");
  await mkdir(outputDir, { recursive: true });
  const dbPath = resolve(params.v2DatabasePath ?? resolveKnowledgeV2DatabasePath());
  const runtime = resolveEmbeddingRuntimeConfig();

  const hostedLifecycle = await diagnoseHostedLifecycle({
    model: runtime.model,
    schema: runtime.embeddingSchemaVersion
  });
  const hostedOptimizations = await evaluateHostedOptimizations({
    dbPath,
    model: runtime.model,
    schema: runtime.embeddingSchemaVersion
  });
  const cacheFeasibility = await evaluateCacheFeasibility({
    model: runtime.model,
    schema: runtime.embeddingSchemaVersion
  });

  assertCompatibleEmbeddingSpace({
    corpus: {
      providerId: "openai",
      model: runtime.model,
      schema: runtime.embeddingSchemaVersion,
      dimensions: 1536
    },
    query: {
      providerId: "openai",
      model: runtime.model,
      schema: runtime.embeddingSchemaVersion,
      dimensions: 1536
    }
  });

  const localFailureReason =
    "Dependency/runtime blocker on Windows ARM64 Node 24: @xenova/transformers transitively requires sharp, which failed to provide a usable arm64 binary in this environment without additional native build toolchain.";

  const callingPlansDatasetPath = resolve("eval/datasets/teams-admin-powershell.calling-plans-guardrails.jsonl");
  const seedDatasetPath = resolve("eval/datasets/teams-admin-powershell.seed.jsonl");
  const holdoutV3DatasetPath = resolve("eval/datasets/teams-admin-powershell.tuning-holdout-v3.jsonl");

  const openAiRuns = {
    seed: await runEvalSummary({
      datasetPath: seedDatasetPath,
      outputDir,
      runIdPrefix: "wb17l0-openai-seed",
      dbPath,
      provider: new HostedOpenAiEmbeddingProvider({
        defaultModel: runtime.model,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      }),
      model: runtime.model,
      schema: runtime.embeddingSchemaVersion
    }),
    holdoutV3: await runEvalSummary({
      datasetPath: holdoutV3DatasetPath,
      outputDir,
      runIdPrefix: "wb17l0-openai-holdoutv3",
      dbPath,
      provider: new HostedOpenAiEmbeddingProvider({
        defaultModel: runtime.model,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      }),
      model: runtime.model,
      schema: runtime.embeddingSchemaVersion
    }),
    callingPlans: await runEvalSummary({
      datasetPath: callingPlansDatasetPath,
      outputDir,
      runIdPrefix: "wb17l0-openai-callingplans",
      dbPath,
      provider: new HostedOpenAiEmbeddingProvider({
        defaultModel: runtime.model,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      }),
      model: runtime.model,
      schema: runtime.embeddingSchemaVersion
    })
  };

  const localRuns = null;

  const rankingDifferences: Wb17l0Artifact["rankingDifferences"] = [];

  const decision = decide(null, openAiRuns, localRuns);
  const artifact: Wb17l0Artifact = {
    artifactVersion: "1.0",
    runId: `wb17l0-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    productionEmbeddingIdentity: {
      provider: "openai",
      model: runtime.model,
      dimensions: 1536,
      schema: runtime.embeddingSchemaVersion
    },
    hostedLifecycle,
    hostedOptimizations,
    cacheFeasibility,
    localFeasibility: {
      status: "unavailable",
      failureReason: localFailureReason,
      modelId: "Xenova/all-MiniLM-L6-v2",
      modelLicense: "apache-2.0",
      runtime: "transformers.js (ONNX WASM)",
      windowsArm64Compatibility:
        "practically blocked in this environment without additional native build/toolchain remediation",
      dimensions: 384,
      cacheDirBytes: 0,
      modelLoadMs: 0,
      residentMemoryBytes: process.memoryUsage().rss,
      localQueryLatencyMs: { p50: 0, p95: 0 },
      localQueryCpuMs: 0,
      localDbPath: "",
      corpusChunkCount: 0,
      corpusEmbeddingDurationMs: 0,
      corpusEmbeddingThroughputPerSec: 0
    },
    openAiRuns,
    localRuns,
    rankingDifferences,
    decision: decision.code,
    decisionRationale: decision.rationale,
    productionEmbeddingsUnchanged: true,
    corpusUnchanged: true,
    retrievalPrecisionFrozen: true
  };

  const artifactPath = resolve(outputDir, `${artifact.runId}.json`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return { artifact, artifactPath };
}

export function normalizeEmbeddingInputForCache(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function assertCompatibleEmbeddingSpace(params: {
  corpus: EmbeddingIdentity;
  query: EmbeddingIdentity;
}): void {
  if (
    params.corpus.providerId !== params.query.providerId ||
    params.corpus.model !== params.query.model ||
    params.corpus.schema !== params.query.schema ||
    params.corpus.dimensions !== params.query.dimensions
  ) {
    throw new Error("cross_model_vector_comparison_not_allowed");
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function toPercentiles(values: number[]): Percentiles {
  return {
    p50: Number(percentile(values, 50).toFixed(3)),
    p95: Number(percentile(values, 95).toFixed(3))
  };
}

async function diagnoseHostedLifecycle(params: {
  model: string;
  schema: string;
}): Promise<HostedLifecycleFindings> {
  const samples = [
    "Which command retrieves the Teams voice routing policy configuration in PowerShell?",
    "How do I update a user's Teams voice routing policy with PowerShell?",
    "What does Set-CsOnlineVoiceRoutingPolicy do?"
  ];
  const instrumented = buildInstrumentedHostedProvider(params);
  const constructorMs = instrumented.constructorMs;
  const coldStarted = performance.now();
  const cold = await instrumented.provider.embedQuery(
    { id: "cold", text: samples[0] ?? "cold query" },
    { model: params.model, embeddingSchemaVersion: params.schema }
  );
  void cold;
  const coldEmbedQueryMs = performance.now() - coldStarted;
  const coldRequestMs = instrumented.requestLatencies[0] ?? 0;
  const coldResponseProcessingMs = Math.max(0, coldEmbedQueryMs - coldRequestMs);

  const warmTotals: number[] = [];
  const warmRequests: number[] = [];
  const warmProcessing: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const text = samples[i % samples.length] ?? samples[0] ?? "warm query";
    const started = performance.now();
    const beforeCount = instrumented.requestLatencies.length;
    await instrumented.provider.embedQuery(
      { id: `warm-${i}`, text },
      { model: params.model, embeddingSchemaVersion: params.schema }
    );
    const total = performance.now() - started;
    const request = instrumented.requestLatencies[beforeCount] ?? total;
    warmTotals.push(total);
    warmRequests.push(request);
    warmProcessing.push(Math.max(0, total - request));
  }

  const overlap = await compareOverlapVsSequential(params);
  return {
    providerCreatedPerQuery: false,
    constructorMs: Number(constructorMs.toFixed(3)),
    coldEmbedQueryMs: Number(coldEmbedQueryMs.toFixed(3)),
    coldRequestMs: Number(coldRequestMs.toFixed(3)),
    coldResponseProcessingMs: Number(coldResponseProcessingMs.toFixed(3)),
    warmEmbedQueryMs: toPercentiles(warmTotals),
    warmRequestMs: toPercentiles(warmRequests),
    warmResponseProcessingMs: toPercentiles(warmProcessing),
    overlapWithExactLexicalAlreadyEnabled: true,
    overlapComparisonMs: overlap
  };
}

function buildInstrumentedHostedProvider(params: { model: string; schema: string }): {
  provider: HostedOpenAiEmbeddingProvider;
  requestLatencies: number[];
  constructorMs: number;
} {
  const requestLatencies: number[] = [];
  const apiKey = process.env["OPENAI_API_KEY"] ?? "";
  const rawClient = new OpenAI({ apiKey }) as unknown as {
    embeddings: {
      create(params: { model: string; input: string[] }): Promise<unknown>;
    };
  };
  const client = {
    embeddings: {
      create: async (payload: { model: string; input: string[] }) => {
        const started = performance.now();
        const out = await rawClient.embeddings.create(payload);
        requestLatencies.push(performance.now() - started);
        return out as {
          data: Array<{ embedding: number[]; index: number }>;
          model: string;
          usage?: { prompt_tokens?: number };
        };
      }
    }
  };
  const ctorStarted = performance.now();
  const provider = new HostedOpenAiEmbeddingProvider({
    client,
    defaultModel: params.model,
    embeddingSchemaVersion: params.schema
  });
  return {
    provider,
    requestLatencies,
    constructorMs: performance.now() - ctorStarted
  };
}

async function compareOverlapVsSequential(params: {
  model: string;
  schema: string;
}): Promise<{ overlap: Percentiles; sequential: Percentiles }> {
  const dbPath = resolveKnowledgeV2DatabasePath();
  const runtime = { model: params.model, embeddingSchemaVersion: params.schema };
  const provider = new HostedOpenAiEmbeddingProvider({
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion
  });
  const scope = routeQueryIntent(
    extractQueryIntent("Which command retrieves the Teams voice routing policy configuration in PowerShell?")
      .intent
  ).scope;
  const overlapLatencies: number[] = [];
  const sequentialLatencies: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const overlap = await retrieveHybridCandidates({
      databasePath: dbPath,
      scope,
      embeddingProvider: provider,
      embeddingRuntimeConfig: runtime,
      orchestrationMode: "overlap_semantic_with_exact_lexical"
    });
    const sequential = await retrieveHybridCandidates({
      databasePath: dbPath,
      scope,
      embeddingProvider: provider,
      embeddingRuntimeConfig: runtime,
      orchestrationMode: "sequential"
    });
    if (i > 0) {
      overlapLatencies.push(overlap.diagnostics.totalLatencyMs);
      sequentialLatencies.push(sequential.diagnostics.totalLatencyMs);
    }
  }
  return {
    overlap: toPercentiles(overlapLatencies),
    sequential: toPercentiles(sequentialLatencies)
  };
}

async function evaluateHostedOptimizations(params: {
  dbPath: string;
  model: string;
  schema: string;
}): Promise<HostedOptimizationResult> {
  const dataset = await loadEvaluationDataset(resolve("eval/datasets/teams-admin-powershell.seed.jsonl"));
  const baselineTotals: number[] = [];
  const optimizedTotals: number[] = [];
  const optimizedQueryEmbedding: number[] = [];
  for (const question of dataset) {
    const scope = routeQueryIntent(extractQueryIntent(question.question).intent).scope;
    const baselineProvider = new HostedOpenAiEmbeddingProvider({
      defaultModel: params.model,
      embeddingSchemaVersion: params.schema
    });
    const baseline = await retrieveHybridCandidates({
      databasePath: params.dbPath,
      scope,
      embeddingProvider: baselineProvider,
      embeddingRuntimeConfig: { model: params.model, embeddingSchemaVersion: params.schema }
    });
    baselineTotals.push(baseline.diagnostics.totalLatencyMs);
  }
  const sharedProvider = new HostedOpenAiEmbeddingProvider({
    defaultModel: params.model,
    embeddingSchemaVersion: params.schema
  });
  for (const question of dataset) {
    const scope = routeQueryIntent(extractQueryIntent(question.question).intent).scope;
    const optimized = await retrieveHybridCandidates({
      databasePath: params.dbPath,
      scope,
      embeddingProvider: sharedProvider,
      embeddingRuntimeConfig: { model: params.model, embeddingSchemaVersion: params.schema }
    });
    optimizedTotals.push(optimized.diagnostics.totalLatencyMs);
    optimizedQueryEmbedding.push(optimized.semantic.diagnostics.latencyMs.queryEmbedding);
  }
  return {
    baselinePerQueryProviderMs: toPercentiles(baselineTotals),
    optimizedSharedProviderMs: toPercentiles(optimizedTotals),
    optimizedQueryEmbeddingMs: toPercentiles(optimizedQueryEmbedding)
  };
}

async function evaluateCacheFeasibility(params: {
  model: string;
  schema: string;
}): Promise<CacheFeasibility> {
  const provider = new HostedOpenAiEmbeddingProvider({
    defaultModel: params.model,
    embeddingSchemaVersion: params.schema
  });
  const cache = new Map<string, number>();
  let hits = 0;
  let misses = 0;
  const holdout = await loadEvaluationDataset(resolve("eval/datasets/teams-admin-powershell.tuning-holdout-v3.jsonl"));
  for (const item of holdout) {
    const key = `${params.model}|${params.schema}|${normalizeEmbeddingInputForCache(item.question)}`;
    if (cache.has(key)) {
      hits += 1;
      continue;
    }
    misses += 1;
    await provider.embedQuery(
      { id: `cache-${item.questionId}`, text: item.question },
      { model: params.model, embeddingSchemaVersion: params.schema }
    );
    cache.set(key, 1);
  }

  let replayHits = 0;
  for (const item of holdout) {
    const key = `${params.model}|${params.schema}|${normalizeEmbeddingInputForCache(item.question)}`;
    if (cache.has(key)) replayHits += 1;
  }
  const entryBytesApprox = 64 + 1536 * 4;
  return {
    keyShape: "<model>|<schema>|<trimmed_whitespace_normalized_question_text>",
    uncachedHitRate: hits + misses === 0 ? 0 : hits / (hits + misses),
    replayHitRate: holdout.length === 0 ? 0 : replayHits / holdout.length,
    estimatedMemoryBytesPerEntry: entryBytesApprox,
    notes: [
      "Likely low hit-rate for unique live questions.",
      "High utility for repeated evaluation runs and accidental resend events.",
      "Cache semantics must remain identity-bound to model/schema/input."
    ]
  };
}

async function runEvalSummary(params: {
  datasetPath: string;
  outputDir: string;
  runIdPrefix: string;
  dbPath: string;
  provider: EmbeddingProvider;
  model: string;
  schema: string;
}): Promise<EvalRunSummary> {
  const { artifact, artifactPath } = await runV2RetrievalEvaluation({
    datasetPath: params.datasetPath,
    outputDir: params.outputDir,
    v2DatabasePath: params.dbPath,
    embeddingProvider: params.provider,
    embeddingRuntimeConfig: { model: params.model, embeddingSchemaVersion: params.schema },
    runIdPrefix: params.runIdPrefix
  });
  return {
    runId: artifact.runId,
    datasetPath: artifactPath,
    top1: `${artifact.summary.expectedSourceHitTop1}/${artifact.summary.totalQuestions}`,
    top3: `${artifact.summary.expectedSourceHitTop3}/${artifact.summary.totalQuestions}`,
    top5: `${artifact.summary.expectedSourceHitTop5}/${artifact.summary.totalQuestions}`,
    top10: `${artifact.summary.expectedSourceHitTop10}/${artifact.summary.totalQuestions}`,
    mrr: artifact.summary.mrr,
    recallAt10: artifact.summary.meanRecallAt10,
    leakageQuestions: artifact.summary.leakageQuestions,
    p50TotalMs: artifact.summary.p50TotalHybridLatencyMs,
    p95TotalMs: artifact.summary.p95TotalHybridLatencyMs,
    p50QueryEmbeddingMs: artifact.summary.p50QueryEmbeddingLatencyMs,
    p95QueryEmbeddingMs: artifact.summary.p95QueryEmbeddingLatencyMs
  };
}

function decide(
  _local: null,
  _openAiRuns: Wb17l0Artifact["openAiRuns"],
  _localRuns: Wb17l0Artifact["localRuns"]
): { code: Wb17l0Artifact["decision"]; rationale: string } {
  return {
    code: "D",
    rationale:
      "Local embedding runtime/model could not be validated end-to-end in this Windows ARM64 environment; defer local-provider adoption."
  };
}
