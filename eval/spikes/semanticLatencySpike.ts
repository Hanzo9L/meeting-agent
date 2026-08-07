import { cpus, freemem, totalmem } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  decodeNormalizedVectorBlob,
  encodeNormalizedVectorBlob,
  generateDeterministicVector,
  scoreCandidates,
  selectTopK
} from "./semanticLatencyKernel";

type RuntimeContext = {
  os: string;
  arch: string;
  cpuModel: string;
  logicalCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  nodeVersion: string;
  electronVersion: string | null;
  betterSqlite3Version: string;
};

type IterationTiming = {
  sqliteFetchMs: number;
  vectorDecodeMs: number;
  scoringMs: number;
  topKMs: Record<number, number>;
  totalMs: number;
  resultSample: Array<{ id: string; score: number }>;
};

type ScenarioSummary = {
  scenarioId: string;
  scenarioKind: "bounded" | "whole_corpus";
  candidateCount: number;
  corpusCount: number;
  dimensions: number;
  topKSet: number[];
  iterations: number;
  warmupIterations: number;
  sqliteFetch: MetricSummary;
  vectorDecode: MetricSummary;
  scoring: MetricSummary;
  topKByValue: Record<number, MetricSummary>;
  total: MetricSummary;
  approxMemory: {
    heapUsedBeforeBytes: number;
    heapUsedAfterBytes: number;
    heapDeltaBytes: number;
    candidateVectorBytes: number;
  };
};

type MetricSummary = {
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

type SpikeOutput = {
  generatedAt: string;
  seed: number;
  context: RuntimeContext;
  config: {
    candidateSizesBounded: number[];
    wholeCorpusSizes: number[];
    dimensionsPrimary: number[];
    dimensionsSecondary: number[];
    topKSet: number[];
    iterations: number;
    warmupIterations: number;
    boundedCorpusMultiplier: number;
  };
  scenarios: ScenarioSummary[];
  notes: {
    boundedInterpretation: string;
    wholeCorpusInterpretation: string;
  };
};

const DEFAULT_CANDIDATE_SIZES = [100, 500, 1000, 2500, 5000, 10000];
const DEFAULT_WHOLE_CORPUS_SIZES = [25000, 50000];
const DEFAULT_PRIMARY_DIMENSIONS = [1536];
const DEFAULT_SECONDARY_DIMENSIONS = [768, 3072];
const DEFAULT_TOP_K = [5, 10, 20];
const require = createRequire(import.meta.url);

function parseList(value: string | undefined): number[] | null {
  if (!value) return null;
  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  return parsed.length > 0 ? parsed : null;
}

function parseArgValue(name: string): string | null {
  const index = process.argv.findIndex((entry) => entry === name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function parseNumberArg(name: string, fallback: number): number {
  const value = parseArgValue(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

function summarize(values: number[]): MetricSummary {
  return {
    minMs: values.length > 0 ? Math.min(...values) : 0,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: values.length > 0 ? Math.max(...values) : 0
  };
}

function getRuntimeContext(): RuntimeContext {
  const cpuModel = cpus()[0]?.model ?? "unknown";
  let betterSqlite3Version = "unknown";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    betterSqlite3Version = require("better-sqlite3/package.json").version;
  } catch {
    // ignore
  }
  return {
    os: process.platform,
    arch: process.arch,
    cpuModel,
    logicalCores: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? null,
    betterSqlite3Version
  };
}

function hashSeed(value: string, seed: number): number {
  const digest = createHash("sha256").update(`${seed}:${value}`).digest();
  return digest.readUInt32LE(0);
}

function setupBenchmarkTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_vectors (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      vector_blob BLOB NOT NULL,
      dimensions INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_benchmark_domain_source ON benchmark_vectors(domain, source_id);
  `);
}

function populateScenarioCorpus(params: {
  db: Database.Database;
  dimensions: number;
  boundedCount: number;
  totalCount: number;
  seed: number;
}): void {
  const insert = params.db.prepare(`
    INSERT INTO benchmark_vectors (id, source_id, domain, vector_blob, dimensions)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = params.db.transaction(() => {
    for (let i = 0; i < params.totalCount; i += 1) {
      const id = `v-${i}`;
      const isBounded = i < params.boundedCount;
      const sourceId =
        isBounded && i % 2 === 0
          ? "ms-teams-admin"
          : isBounded
            ? "ms-teams-powershell"
            : i % 3 === 0
              ? "ms-entra-docs"
              : "ms-graph-docs";
      const domain = isBounded ? "teams_voice" : "cross_domain";
      const vectorSeed = hashSeed(id, params.seed);
      const vector = generateDeterministicVector(vectorSeed, params.dimensions);
      const blob = encodeNormalizedVectorBlob(vector);
      insert.run(id, sourceId, domain, Buffer.from(blob), params.dimensions);
    }
  });

  insertMany();
}

function fetchCandidates(params: {
  db: Database.Database;
  bounded: boolean;
  expectedCount: number;
}): Array<{ id: string; blob: Uint8Array }> {
  if (params.bounded) {
    const rows = params.db
      .prepare(
        `
      SELECT id, vector_blob
      FROM benchmark_vectors
      WHERE domain = 'teams_voice'
        AND source_id IN ('ms-teams-admin', 'ms-teams-powershell')
      ORDER BY id ASC
      LIMIT ?
    `
      )
      .all(params.expectedCount) as Array<{ id: string; vector_blob: Uint8Array }>;
    return rows.map((row) => ({ id: row.id, blob: row.vector_blob }));
  }

  const rows = params.db
    .prepare(
      `
    SELECT id, vector_blob
    FROM benchmark_vectors
    ORDER BY id ASC
    LIMIT ?
  `
    )
    .all(params.expectedCount) as Array<{ id: string; vector_blob: Uint8Array }>;
  return rows.map((row) => ({ id: row.id, blob: row.vector_blob }));
}

function runIteration(params: {
  db: Database.Database;
  dimensions: number;
  candidateCount: number;
  bounded: boolean;
  topKSet: number[];
  seed: number;
}): IterationTiming {
  const queryVector = encodeNormalizedVectorBlob(
    generateDeterministicVector(hashSeed("query", params.seed), params.dimensions)
  );
  const query = decodeNormalizedVectorBlob(queryVector, params.dimensions);

  const startedTotal = performance.now();
  const startedFetch = performance.now();
  const rawCandidates = fetchCandidates({
    db: params.db,
    bounded: params.bounded,
    expectedCount: params.candidateCount
  });
  const sqliteFetchMs = performance.now() - startedFetch;

  const startedDecode = performance.now();
  const decoded = rawCandidates.map((candidate) => ({
    id: candidate.id,
    vector: decodeNormalizedVectorBlob(candidate.blob, params.dimensions)
  }));
  const vectorDecodeMs = performance.now() - startedDecode;

  const startedScoring = performance.now();
  const scored = scoreCandidates(query, decoded);
  const scoringMs = performance.now() - startedScoring;

  const topKMs: Record<number, number> = {};
  let sample: Array<{ id: string; score: number }> = [];
  for (const topK of params.topKSet) {
    const startedTopK = performance.now();
    const top = selectTopK(scored, topK);
    topKMs[topK] = performance.now() - startedTopK;
    if (sample.length === 0) {
      sample = top.slice(0, Math.min(3, top.length));
    }
  }

  return {
    sqliteFetchMs,
    vectorDecodeMs,
    scoringMs,
    topKMs,
    totalMs: performance.now() - startedTotal,
    resultSample: sample
  };
}

function renderMarkdownReport(output: SpikeOutput): string {
  const lines: string[] = [];
  lines.push("# AD-03 Bounded Semantic Latency Spike");
  lines.push("");
  lines.push(`Generated at: ${output.generatedAt}`);
  lines.push("");
  lines.push("## Runtime");
  lines.push(
    `- OS/Arch: ${output.context.os} / ${output.context.arch}`
  );
  lines.push(
    `- CPU: ${output.context.cpuModel} (${output.context.logicalCores} logical cores)`
  );
  lines.push(
    `- Memory: ${(output.context.totalMemoryBytes / (1024 ** 3)).toFixed(2)} GiB`
  );
  lines.push(`- Node: ${output.context.nodeVersion}`);
  lines.push(`- Electron: ${output.context.electronVersion ?? "not running in electron"}`);
  lines.push(`- better-sqlite3: ${output.context.betterSqlite3Version}`);
  lines.push("");
  lines.push("## Scenario results (p50 / p95 ms)");
  lines.push("");
  for (const scenario of output.scenarios) {
    lines.push(
      `- ${scenario.scenarioId}: total ${scenario.total.p50Ms.toFixed(2)} / ${scenario.total.p95Ms.toFixed(2)} ` +
        `(fetch ${scenario.sqliteFetch.p50Ms.toFixed(2)} / ${scenario.sqliteFetch.p95Ms.toFixed(2)}, ` +
        `decode ${scenario.vectorDecode.p50Ms.toFixed(2)} / ${scenario.vectorDecode.p95Ms.toFixed(2)}, ` +
        `score ${scenario.scoring.p50Ms.toFixed(2)} / ${scenario.scoring.p95Ms.toFixed(2)})`
    );
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push(`- Bounded path: ${output.notes.boundedInterpretation}`);
  lines.push(`- Whole-corpus diagnostic: ${output.notes.wholeCorpusInterpretation}`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const now = new Date();
  const seed = parseNumberArg("--seed", 1729);
  const iterations = parseNumberArg("--iterations", 4);
  const warmupIterations = parseNumberArg("--warmup", 1);
  const boundedCorpusMultiplier = parseNumberArg("--bounded-multiplier", 3);

  const candidateSizes =
    parseList(parseArgValue("--candidates") ?? undefined) ??
    DEFAULT_CANDIDATE_SIZES;
  const wholeCorpusSizes =
    parseList(parseArgValue("--whole-corpus") ?? undefined) ??
    DEFAULT_WHOLE_CORPUS_SIZES;
  const primaryDimensions =
    parseList(parseArgValue("--primary-dimensions") ?? undefined) ??
    DEFAULT_PRIMARY_DIMENSIONS;
  const secondaryDimensions =
    parseList(parseArgValue("--secondary-dimensions") ?? undefined) ??
    DEFAULT_SECONDARY_DIMENSIONS;
  const topKSet =
    parseList(parseArgValue("--top-k") ?? undefined) ?? DEFAULT_TOP_K;

  const runDir = await mkdtemp(join(resolve("eval/runs"), "wb11-"));
  const scenarios: ScenarioSummary[] = [];

  const dimensionPlans = [
    ...primaryDimensions.map((dim) => ({
      dimensions: dim,
      candidateSizes,
      includeWholeCorpus: true
    })),
    ...secondaryDimensions.map((dim) => ({
      dimensions: dim,
      candidateSizes: candidateSizes.filter((size) => size >= 1000 && size <= 5000),
      includeWholeCorpus: false
    }))
  ];

  for (const plan of dimensionPlans) {
    for (const boundedCount of plan.candidateSizes) {
      const run = {
        kind: "bounded" as const,
        candidateCount: boundedCount,
        corpusCount: Math.max(
          boundedCount,
          Math.floor(boundedCount * boundedCorpusMultiplier)
        )
      };
      {
        const dbPath = join(
          runDir,
          `bench-d${plan.dimensions}-c${run.candidateCount}-total${run.corpusCount}-${run.kind}.sqlite`
        );
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        setupBenchmarkTable(db);
        populateScenarioCorpus({
          db,
          dimensions: plan.dimensions,
          boundedCount,
          totalCount: run.corpusCount,
          seed
        });

        const topKTimingSeries = new Map<number, number[]>();
        topKSet.forEach((k) => topKTimingSeries.set(k, []));
        const fetchSeries: number[] = [];
        const decodeSeries: number[] = [];
        const scoreSeries: number[] = [];
        const totalSeries: number[] = [];

        const heapBefore = process.memoryUsage().heapUsed;

        for (let iteration = 0; iteration < warmupIterations + iterations; iteration += 1) {
          const timing = runIteration({
            db,
            dimensions: plan.dimensions,
            candidateCount: run.candidateCount,
            bounded: run.kind === "bounded",
            topKSet,
            seed: seed + iteration
          });
          if (iteration < warmupIterations) continue;
          fetchSeries.push(timing.sqliteFetchMs);
          decodeSeries.push(timing.vectorDecodeMs);
          scoreSeries.push(timing.scoringMs);
          totalSeries.push(timing.totalMs);
          for (const topK of topKSet) {
            const value = timing.topKMs[topK];
            if (value === undefined) continue;
            topKTimingSeries.get(topK)?.push(value);
          }
        }

        const heapAfter = process.memoryUsage().heapUsed;
        const topKByValue: Record<number, MetricSummary> = {};
        for (const topK of topKSet) {
          topKByValue[topK] = summarize(topKTimingSeries.get(topK) ?? []);
        }

        scenarios.push({
          scenarioId: `${run.kind}:dim${plan.dimensions}:cand${run.candidateCount}`,
          scenarioKind: run.kind,
          candidateCount: run.candidateCount,
          corpusCount: run.corpusCount,
          dimensions: plan.dimensions,
          topKSet,
          iterations,
          warmupIterations,
          sqliteFetch: summarize(fetchSeries),
          vectorDecode: summarize(decodeSeries),
          scoring: summarize(scoreSeries),
          topKByValue,
          total: summarize(totalSeries),
          approxMemory: {
            heapUsedBeforeBytes: heapBefore,
            heapUsedAfterBytes: heapAfter,
            heapDeltaBytes: heapAfter - heapBefore,
            candidateVectorBytes: run.candidateCount * plan.dimensions * 4
          }
        });

        db.close();
      }
    }

    if (plan.includeWholeCorpus && wholeCorpusSizes.length > 0) {
      for (const wholeCount of wholeCorpusSizes) {
        const run = {
          kind: "whole_corpus" as const,
          candidateCount: wholeCount,
          corpusCount: wholeCount
        };
        const dbPath = join(
          runDir,
          `bench-d${plan.dimensions}-c${run.candidateCount}-total${run.corpusCount}-${run.kind}.sqlite`
        );
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        setupBenchmarkTable(db);
        populateScenarioCorpus({
          db,
          dimensions: plan.dimensions,
          boundedCount: Math.min(5000, Math.floor(wholeCount / 2)),
          totalCount: run.corpusCount,
          seed
        });

        const topKTimingSeries = new Map<number, number[]>();
        topKSet.forEach((k) => topKTimingSeries.set(k, []));
        const fetchSeries: number[] = [];
        const decodeSeries: number[] = [];
        const scoreSeries: number[] = [];
        const totalSeries: number[] = [];

        const heapBefore = process.memoryUsage().heapUsed;

        for (let iteration = 0; iteration < warmupIterations + iterations; iteration += 1) {
          const timing = runIteration({
            db,
            dimensions: plan.dimensions,
            candidateCount: run.candidateCount,
            bounded: false,
            topKSet,
            seed: seed + iteration
          });
          if (iteration < warmupIterations) continue;
          fetchSeries.push(timing.sqliteFetchMs);
          decodeSeries.push(timing.vectorDecodeMs);
          scoreSeries.push(timing.scoringMs);
          totalSeries.push(timing.totalMs);
          for (const topK of topKSet) {
            const value = timing.topKMs[topK];
            if (value === undefined) continue;
            topKTimingSeries.get(topK)?.push(value);
          }
        }

        const heapAfter = process.memoryUsage().heapUsed;
        const topKByValue: Record<number, MetricSummary> = {};
        for (const topK of topKSet) {
          topKByValue[topK] = summarize(topKTimingSeries.get(topK) ?? []);
        }

        scenarios.push({
          scenarioId: `${run.kind}:dim${plan.dimensions}:cand${run.candidateCount}`,
          scenarioKind: run.kind,
          candidateCount: run.candidateCount,
          corpusCount: run.corpusCount,
          dimensions: plan.dimensions,
          topKSet,
          iterations,
          warmupIterations,
          sqliteFetch: summarize(fetchSeries),
          vectorDecode: summarize(decodeSeries),
          scoring: summarize(scoreSeries),
          topKByValue,
          total: summarize(totalSeries),
          approxMemory: {
            heapUsedBeforeBytes: heapBefore,
            heapUsedAfterBytes: heapAfter,
            heapDeltaBytes: heapAfter - heapBefore,
            candidateVectorBytes: run.candidateCount * plan.dimensions * 4
          }
        });

        db.close();
      }
    }
  }

  const boundedScenarios = scenarios.filter((scenario) => scenario.scenarioKind === "bounded");
  const wholeScenarios = scenarios.filter((scenario) => scenario.scenarioKind === "whole_corpus");

  const output: SpikeOutput = {
    generatedAt: now.toISOString(),
    seed,
    context: getRuntimeContext(),
    config: {
      candidateSizesBounded: candidateSizes,
      wholeCorpusSizes,
      dimensionsPrimary: primaryDimensions,
      dimensionsSecondary: secondaryDimensions,
      topKSet,
      iterations,
      warmupIterations,
      boundedCorpusMultiplier
    },
    scenarios,
    notes: {
      boundedInterpretation:
        boundedScenarios.length > 0
          ? `Bounded scenarios (domain/source constrained) max observed p95 total = ${Math.max(
              ...boundedScenarios.map((scenario) => scenario.total.p95Ms)
            ).toFixed(2)}ms.`
          : "No bounded scenarios executed.",
      wholeCorpusInterpretation:
        wholeScenarios.length > 0
          ? `Whole-corpus diagnostics max observed p95 total = ${Math.max(
              ...wholeScenarios.map((scenario) => scenario.total.p95Ms)
            ).toFixed(2)}ms.`
          : "Whole-corpus diagnostics were not executed."
    }
  };

  const artifactBase = join(
    resolve("eval/runs"),
    `wb11-${output.generatedAt.replace(/[:.]/g, "-")}`
  );
  await mkdir(dirname(artifactBase), { recursive: true });
  await writeFile(`${artifactBase}.json`, JSON.stringify(output, null, 2), "utf8");
  await writeFile(`${artifactBase}.md`, renderMarkdownReport(output), "utf8");
  process.stdout.write(
    `${JSON.stringify(
      {
        artifactJson: `${artifactBase}.json`,
        artifactMarkdown: `${artifactBase}.md`,
        scenarioCount: output.scenarios.length
      },
      null,
      2
    )}\n`
  );

  await rm(runDir, { recursive: true, force: true });
}

void main();
