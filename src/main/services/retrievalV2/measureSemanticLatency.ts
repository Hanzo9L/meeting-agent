import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createKnowledgeV2SqliteStore,
  encodeFloat32Vector,
  hashEmbeddingInput,
  parseCanonicalDocument,
  FakeEmbeddingProvider
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { extractQueryIntent } from "./queryIntentRules";
import { retrieveSemanticCandidates } from "./semanticRetriever";
import {
  decodeNormalizedVectorBlob,
  encodeNormalizedVectorBlob,
  normalizeVector,
  scoreCandidates,
  selectTopK
} from "../../../../eval/spikes/semanticLatencyKernel";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");
const QUESTION = "How does Teams Direct Routing voice routing work?";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[rank] ?? 0;
}

function deterministicVector(seed: number, dimensions: number): Float32Array {
  let state = seed >>> 0;
  const out = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

async function makeFixtureDb(params: {
  candidateCount: number;
  dimensions: number;
  provider: FakeEmbeddingProvider;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-wb15-lat-"));
  const dbPath = join(root, "knowledge-v2.sqlite");
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();

  const doc = parseCanonicalDocument({
    sourceId: "ms-teams-admin",
    trackId: "ga",
    transport: "learn_mcp",
    canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
    rawMarkdown: "---\ntitle: Direct Routing\n---\n\n# Direct Routing\n\nLatency fixture",
    revision: {
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      locale: "en-us",
      retrievedAt: new Date().toISOString(),
      contentHash: "latency"
    }
  }).document;
  if (!doc) throw new Error("Failed to parse fixture doc.");
  store.saveKnowledgeDocument(doc, { parserVersion: "wb15-latency" });

  for (let i = 0; i < params.candidateCount; i += 1) {
    const text = `Direct routing fixture chunk ${i}`;
    const chunkId = `chunk-${i.toString().padStart(5, "0")}`;
    const hash = hashEmbeddingInput(text);
    store.saveChunkPlaceholder({
      chunkId,
      documentId: doc.documentId,
      sectionId: `s-${i}`,
      headingPath: ["Direct Routing"],
      chunkKind: "configuration",
      text,
      sourceOrder: i,
      contentHash: hash,
      provenance: {},
      metadata: {}
    });
    const vector = deterministicVector(i + 1, params.dimensions);
    store.saveChunkEmbedding({
      chunkId,
      providerId: params.provider.providerId,
      model: "latency-model",
      dimensions: params.dimensions,
      embeddingSchemaVersion: "latency-v1",
      inputContentHash: hash,
      vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(vector))),
      usage: { requestCount: 1, batchSize: 1 }
    });
  }
  store.close();
  return dbPath;
}

function parseCandidateSizes(): number[] {
  const raw = process.env["WB15_MEASURE_SIZES"];
  if (!raw) return [100, 500, 1000, 2500, 5000];
  const parsed = raw
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return parsed.length > 0 ? parsed : [100, 500, 1000, 2500, 5000];
}

function parseIterations(): number {
  const raw = Number(process.env["WB15_MEASURE_ITERATIONS"] ?? "6");
  if (!Number.isFinite(raw)) return 6;
  return Math.max(3, Math.floor(raw));
}

function shouldSkipKernel(): boolean {
  return process.env["WB15_MEASURE_SKIP_KERNEL"] === "1";
}

function stageSummary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50Ms: Number(percentile(sorted, 50).toFixed(3)),
    p95Ms: Number(percentile(sorted, 95).toFixed(3))
  };
}

function runKernelComparison(params: {
  candidateCount: number;
  dimensions: number;
  iterations: number;
  topK: number;
}) {
  const query = normalizeVector(deterministicVector(999, params.dimensions));
  const blobs: Uint8Array[] = [];
  for (let index = 0; index < params.candidateCount; index += 1) {
    const vector = normalizeVector(deterministicVector(index + 1, params.dimensions));
    blobs.push(encodeNormalizedVectorBlob(vector));
  }

  const decodeSamples: number[] = [];
  const scoreSamples: number[] = [];
  const topKSamples: number[] = [];
  const totalSamples: number[] = [];

  for (let run = 0; run < params.iterations; run += 1) {
    const started = performance.now();
    const decodeStarted = performance.now();
    const decoded = blobs.map((blob) => decodeNormalizedVectorBlob(blob, params.dimensions));
    const decodeMs = performance.now() - decodeStarted;

    const scoreStarted = performance.now();
    const scored = scoreCandidates(
      query,
      decoded.map((vector, idx) => ({ id: `chunk-${idx}`, vector }))
    );
    const scoreMs = performance.now() - scoreStarted;

    const topKStarted = performance.now();
    selectTopK(scored, params.topK);
    const topKMs = performance.now() - topKStarted;
    const totalMs = performance.now() - started;

    if (run > 0) {
      decodeSamples.push(decodeMs);
      scoreSamples.push(scoreMs);
      topKSamples.push(topKMs);
      totalSamples.push(totalMs);
    }
  }

  return {
    decode: stageSummary(decodeSamples),
    score: stageSummary(scoreSamples),
    topK: stageSummary(topKSamples),
    total: stageSummary(totalSamples)
  };
}

async function main(): Promise<void> {
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 1536,
    defaultModel: "latency-model",
    embeddingSchemaVersion: "latency-v1"
  });
  const baseScope = routeQueryIntent(extractQueryIntent(QUESTION).intent).scope;
  const sizes = parseCandidateSizes();
  const iterations = parseIterations();
  const skipKernel = shouldSkipKernel();
  const report: Array<{
    candidateCount: number;
    retriever: {
      total: { p50Ms: number; p95Ms: number };
      queryEmbedding: { p50Ms: number; p95Ms: number };
      sqlPreselection: { p50Ms: number; p95Ms: number };
      sqlEmbeddingMetadata: { p50Ms: number; p95Ms: number };
      sqlEmbeddingBlobFetch: { p50Ms: number; p95Ms: number };
      compatibilityCheck: { p50Ms: number; p95Ms: number };
      sqliteFetch: { p50Ms: number; p95Ms: number };
      decode: { p50Ms: number; p95Ms: number };
      scoring: { p50Ms: number; p95Ms: number };
      topK: { p50Ms: number; p95Ms: number };
    };
    kernel: {
      total: { p50Ms: number; p95Ms: number };
      decode: { p50Ms: number; p95Ms: number };
      score: { p50Ms: number; p95Ms: number };
      topK: { p50Ms: number; p95Ms: number };
    } | null;
  }> = [];

  for (const size of sizes) {
    const dbPath = await makeFixtureDb({
      candidateCount: size,
      dimensions: 1536,
      provider
    });
    const scope = {
      ...baseScope,
      candidateBudget: {
        ...baseScope.candidateBudget,
        maxSemanticCandidates: size
      }
    };
    const totalRuns: number[] = [];
    const queryEmbeddingRuns: number[] = [];
    const sqlPreselectionRuns: number[] = [];
    const sqlMetadataRuns: number[] = [];
    const sqlBlobRuns: number[] = [];
    const compatibilityRuns: number[] = [];
    const sqlTotalRuns: number[] = [];
    const decodeRuns: number[] = [];
    const scoringRuns: number[] = [];
    const topKRuns: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const result = await retrieveSemanticCandidates({
        databasePath: dbPath,
        scope,
        embeddingProvider: provider,
        embeddingRuntimeConfig: {
          model: "latency-model",
          embeddingSchemaVersion: "latency-v1"
        }
      });
      if (i > 0) {
        totalRuns.push(result.diagnostics.latencyMs.total);
        queryEmbeddingRuns.push(result.diagnostics.latencyMs.queryEmbedding);
        sqlPreselectionRuns.push(result.diagnostics.latencyMs.sqlPreselection);
        sqlMetadataRuns.push(result.diagnostics.latencyMs.sqlEmbeddingMetadata);
        sqlBlobRuns.push(result.diagnostics.latencyMs.sqlEmbeddingBlobFetch);
        compatibilityRuns.push(result.diagnostics.latencyMs.compatibilityCheck);
        sqlTotalRuns.push(result.diagnostics.latencyMs.sqliteFetch);
        decodeRuns.push(result.diagnostics.latencyMs.decode);
        scoringRuns.push(result.diagnostics.latencyMs.scoring);
        topKRuns.push(result.diagnostics.latencyMs.topK);
      }
    }
    const kernel = skipKernel
      ? null
      : runKernelComparison({
          candidateCount: size,
          dimensions: 1536,
          iterations,
          topK: Math.min(20, size)
        });
    report.push({
      candidateCount: size,
      retriever: {
        total: stageSummary(totalRuns),
        queryEmbedding: stageSummary(queryEmbeddingRuns),
        sqlPreselection: stageSummary(sqlPreselectionRuns),
        sqlEmbeddingMetadata: stageSummary(sqlMetadataRuns),
        sqlEmbeddingBlobFetch: stageSummary(sqlBlobRuns),
        compatibilityCheck: stageSummary(compatibilityRuns),
        sqliteFetch: stageSummary(sqlTotalRuns),
        decode: stageSummary(decodeRuns),
        scoring: stageSummary(scoringRuns),
        topK: stageSummary(topKRuns)
      },
      kernel
    });
  }

  process.stdout.write(`${JSON.stringify({ question: QUESTION, report }, null, 2)}\n`);
}

main();

