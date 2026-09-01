import "./cliEnvironment";

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import {
  OpenAiInterviewAnswerSynthesisPort,
  type InterviewSynthesisClient
} from "../../src/main/services/evidence/openAiInterviewAnswerSynthesisPort";
import type { InterviewAnswerSynthesisInput } from "../../src/main/services/evidence/interviewAnswerSynthesisPort";
import { resolveV2OpenAiModel } from "../../src/main/services/v2OpenAiRuntime";

type ReasoningEffort = "low" | "medium";

interface RawSynthesisResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface BenchmarkRun {
  run: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  schemaValid: boolean;
  bindingValid: boolean;
  errorCode: string | null;
  actualModel: string | null;
  answer: unknown;
}

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HARNESS_DIRECTORY, "../..");
const FIXTURE_PATH = resolve(
  PROJECT_ROOT,
  "eval/fixtures/synthesis-bench/frozen-input.json"
);
const FIXTURE_HASH_PATH = resolve(
  PROJECT_ROOT,
  "eval/fixtures/synthesis-bench/frozen-input.sha256"
);
const RESULTS_DIRECTORY = resolve(
  PROJECT_ROOT,
  "eval/runs/synthesis-bench"
);

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function parseEffort(): ReasoningEffort {
  const value = flag("effort") ?? "medium";
  if (value !== "low" && value !== "medium") {
    throw new Error("--effort must be low or medium");
  }
  return value;
}

function parseRuns(): number {
  const value = Number(flag("runs") ?? "6");
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isStringArray(
  value: unknown,
  allowed: Set<string>,
  requireItem: boolean
): boolean {
  return (
    Array.isArray(value) &&
    (!requireItem || value.length > 0) &&
    value.every(
      (item) => typeof item === "string" && allowed.has(item)
    )
  );
}

function matchesResponseSchema(
  value: unknown,
  input: InterviewAnswerSynthesisInput
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "directAnswer",
      "bullets",
      "unsupportedFacets",
      "confidence"
    ])
  ) {
    return false;
  }
  const evidenceIds = new Set(
    input.evidence.map((item) => item.evidenceId)
  );
  const facetIds = new Set(input.facets.map((item) => item.id));
  const directAnswer = value["directAnswer"];
  if (directAnswer !== null) {
    if (
      !isRecord(directAnswer) ||
      !hasOnlyKeys(directAnswer, ["text", "evidenceIds"]) ||
      typeof directAnswer["text"] !== "string" ||
      !isStringArray(
        directAnswer["evidenceIds"],
        evidenceIds,
        true
      )
    ) {
      return false;
    }
  }
  const bullets = value["bullets"];
  if (
    !Array.isArray(bullets) ||
    bullets.length > 4 ||
    !bullets.every(
      (item) =>
        isRecord(item) &&
        hasOnlyKeys(item, ["text", "facetId", "evidenceIds"]) &&
        typeof item["text"] === "string" &&
        typeof item["facetId"] === "string" &&
        facetIds.has(item["facetId"]) &&
        isStringArray(item["evidenceIds"], evidenceIds, true)
    )
  ) {
    return false;
  }
  const unsupported = value["unsupportedFacets"];
  if (
    !Array.isArray(unsupported) ||
    unsupported.length > facetIds.size ||
    !unsupported.every(
      (item) =>
        isRecord(item) &&
        hasOnlyKeys(item, ["facetId", "reason"]) &&
        typeof item["facetId"] === "string" &&
        facetIds.has(item["facetId"]) &&
        typeof item["reason"] === "string"
    )
  ) {
    return false;
  }
  return (
    value["confidence"] === "high" ||
    value["confidence"] === "medium" ||
    value["confidence"] === "low"
  );
}

function percentile95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * 0.95;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower]!;
  const upperValue = sorted[upper]!;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function main(): Promise<void> {
  const fixtureBytes = readFileSync(FIXTURE_PATH);
  const actualFixtureHash = createHash("sha256")
    .update(fixtureBytes)
    .digest("hex");
  const expectedFixtureHash = readFileSync(
    FIXTURE_HASH_PATH,
    "utf8"
  ).trim();
  if (actualFixtureHash !== expectedFixtureHash) {
    console.error(`Expected fixture SHA-256: ${expectedFixtureHash}`);
    console.error(`Actual fixture SHA-256:   ${actualFixtureHash}`);
    process.exitCode = 1;
    return;
  }

  const input = JSON.parse(
    fixtureBytes.toString("utf8")
  ) as InterviewAnswerSynthesisInput;
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");
  const model = flag("model") ?? resolveV2OpenAiModel();
  const effort = parseEffort();
  const runCount = parseRuns();
  const openAi = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 15_000
  });
  const runs: BenchmarkRun[] = [];

  for (let run = 1; run <= runCount; run += 1) {
    const state: {
      rawResponse: RawSynthesisResponse | null;
    } = { rawResponse: null };
    let rawAnswer: unknown = null;
    const client: InterviewSynthesisClient = {
      chat: {
        completions: {
          async create(request) {
            state.rawResponse =
              await openAi.chat.completions.create({
                ...request,
                model,
                reasoning_effort: effort
              } as unknown as ChatCompletionCreateParamsNonStreaming);
            const content =
              state.rawResponse.choices?.[0]?.message?.content ?? null;
            if (content) {
              try {
                rawAnswer = JSON.parse(content);
              } catch {
                rawAnswer = null;
              }
            }
            return state.rawResponse;
          }
        }
      }
    };
    const port = new OpenAiInterviewAnswerSynthesisPort({
      apiKey,
      model,
      timeoutMs: 15_000,
      client
    });
    const started = performance.now();
    try {
      const answer = await port.synthesize(input);
      runs.push({
        run,
        latencyMs: performance.now() - started,
        inputTokens: state.rawResponse?.usage?.prompt_tokens ?? null,
        outputTokens: state.rawResponse?.usage?.completion_tokens ?? null,
        schemaValid: matchesResponseSchema(rawAnswer, input),
        bindingValid: true,
        errorCode: null,
        actualModel: state.rawResponse?.model ?? null,
        answer
      });
    } catch (error) {
      runs.push({
        run,
        latencyMs: performance.now() - started,
        inputTokens: state.rawResponse?.usage?.prompt_tokens ?? null,
        outputTokens: state.rawResponse?.usage?.completion_tokens ?? null,
        schemaValid: matchesResponseSchema(rawAnswer, input),
        bindingValid: false,
        errorCode:
          error instanceof Error ? error.message : "unknown_error",
        actualModel: state.rawResponse?.model ?? null,
        answer: rawAnswer
      });
    }
  }

  const latencies = runs.map((run) => run.latencyMs);
  const errors = runs.reduce<Record<string, number>>((tally, run) => {
    if (run.errorCode) {
      tally[run.errorCode] = (tally[run.errorCode] ?? 0) + 1;
    }
    return tally;
  }, {});
  const summary = {
    medianMs: median(latencies),
    p95Ms: percentile95(latencies),
    minMs: Math.min(...latencies),
    maxMs: Math.max(...latencies),
    schemaValid: runs.filter((run) => run.schemaValid).length,
    bindingValid: runs.filter((run) => run.bindingValid).length,
    errors
  };
  const timestamp = new Date().toISOString();
  const report = {
    timestamp,
    fixtureSha256: actualFixtureHash,
    model,
    effort,
    runs: runCount,
    summary,
    results: runs
  };
  mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  const outputPath = resolve(
    RESULTS_DIRECTORY,
    `${timestamp.replace(/[:.]/g, "-")}.json`
  );
  writeFileSync(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Results: ${outputPath}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
