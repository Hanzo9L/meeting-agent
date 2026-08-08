import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectAnswerPlanForQuestion } from "../../src/main/services/answerV2";
import type { AnswerabilityStatus } from "../../src/main/services/answerV2";

interface AnswerPlanEvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
  requiredClaimConcepts?: string[];
  prohibitedClaimConcepts?: string[];
  requiredCaveatCodes?: string[];
  unsupportedAspectReasons?: string[];
}

interface AnswerPlanEvalArtifact {
  artifactVersion: "1.0";
  runId: string;
  createdAt: string;
  datasetPath: string;
  summary: {
    total: number;
    answerabilityMatch: number;
    requiredConceptCoverage: number;
    prohibitedConceptPass: number;
    requiredCaveatCoverage: number;
    unsupportedAspectCoverage: number;
    planningLatencyP50: number;
    planningLatencyP95: number;
  };
  cases: Array<{
    questionId: string;
    question: string;
    expectedAnswerability: AnswerabilityStatus;
    actualAnswerability: AnswerabilityStatus;
    pass: boolean;
    checks: Record<string, boolean>;
  }>;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

async function loadDataset(path: string): Promise<AnswerPlanEvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AnswerPlanEvalCase);
}

async function main(): Promise<void> {
  const datasetPath = resolve(process.argv[2] ?? "eval/datasets/answer-plan-wb19.jsonl");
  const outputDir = resolve(process.argv[3] ?? "eval/runs/answer-plan");
  const rows = await loadDataset(datasetPath);
  const latencies: number[] = [];
  const cases: AnswerPlanEvalArtifact["cases"] = [];

  for (const row of rows) {
    const inspected = await inspectAnswerPlanForQuestion({ question: row.question });
    const answerability = String(inspected["answerability"]) as AnswerabilityStatus;
    const plannedClaims = (inspected["plannedClaims"] as Array<{ proposition: string }>) ?? [];
    const caveats = (inspected["requiredCaveats"] as Array<{ code: string }>) ?? [];
    const unsupported = (inspected["unsupportedAspects"] as Array<{ reason: string }>) ?? [];
    const diagnostics = (inspected["diagnostics"] as { latencyMs?: number }) ?? {};
    latencies.push(Number(diagnostics.latencyMs ?? 0));

    const normalizedClaims = plannedClaims.map((claim) => normalize(claim.proposition));
    const checks: Record<string, boolean> = {};
    checks["answerability"] = answerability === row.expectedAnswerability;
    checks["requiredClaims"] = (row.requiredClaimConcepts ?? []).every((concept) =>
      normalizedClaims.some((claim) => claim.includes(normalize(concept)))
    );
    checks["prohibitedClaims"] = (row.prohibitedClaimConcepts ?? []).every(
      (concept) => !normalizedClaims.some((claim) => claim.includes(normalize(concept)))
    );
    checks["requiredCaveats"] = (row.requiredCaveatCodes ?? []).every((code) =>
      caveats.some((caveat) => caveat.code === code)
    );
    checks["unsupportedAspects"] = (row.unsupportedAspectReasons ?? []).every((reason) =>
      unsupported.some((aspect) => aspect.reason === reason)
    );
    const pass = Object.values(checks).every(Boolean);
    cases.push({
      questionId: row.questionId,
      question: row.question,
      expectedAnswerability: row.expectedAnswerability,
      actualAnswerability: answerability,
      pass,
      checks
    });
  }

  const artifact: AnswerPlanEvalArtifact = {
    artifactVersion: "1.0",
    runId: `answer-plan-wb19-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    datasetPath,
    summary: {
      total: rows.length,
      answerabilityMatch: cases.filter((entry) => entry.checks["answerability"]).length,
      requiredConceptCoverage: cases.filter((entry) => entry.checks["requiredClaims"]).length,
      prohibitedConceptPass: cases.filter((entry) => entry.checks["prohibitedClaims"]).length,
      requiredCaveatCoverage: cases.filter((entry) => entry.checks["requiredCaveats"]).length,
      unsupportedAspectCoverage: cases.filter((entry) => entry.checks["unsupportedAspects"]).length,
      planningLatencyP50: Number(percentile(latencies, 50).toFixed(3)),
      planningLatencyP95: Number(percentile(latencies, 95).toFixed(3))
    },
    cases
  };

  await mkdir(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, `${artifact.runId}.json`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ artifactPath, summary: artifact.summary }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "answer_plan_evaluation_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
