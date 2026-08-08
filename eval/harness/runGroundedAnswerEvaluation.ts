import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FakeAnswerGenerator,
  OpenAiGroundedAnswerGenerator,
  buildAnswerPlan,
  generateGroundedAnswer,
  runQuestionToEvidenceBundle
} from "../../src/main/services/answerV2";
import type { ClaimRealizationProvider } from "../../src/main/services/answerV2";
import type { AnswerabilityStatus } from "../../src/main/services/answerV2";

interface GroundedEvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
  requiredClaimConcepts?: string[];
  prohibitedPhrases?: string[];
  requiredCaveatCodes?: string[];
  requireValidationPass?: boolean;
  requireNoRealizedClaims?: boolean;
}

interface GroundedEvalArtifact {
  artifactVersion: "1.0";
  runId: string;
  createdAt: string;
  datasetPath: string;
  provider: string;
  summary: {
    total: number;
    answerabilityMatch: number;
    requiredConceptCoverage: number;
    prohibitedPhrasePass: number;
    requiredCaveatCoverage: number;
    validationPass: number;
    generationLatencyP50: number;
    generationLatencyP95: number;
    validationLatencyP50: number;
    validationLatencyP95: number;
    totalLatencyP50: number;
    totalLatencyP95: number;
  };
  cases: Array<{
    questionId: string;
    question: string;
    pass: boolean;
    checks: Record<string, boolean>;
    diagnostics: {
      generationLatencyMs: number;
      validationLatencyMs: number;
      totalLatencyMs: number;
    };
  }>;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function loadDataset(path: string): Promise<GroundedEvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as GroundedEvalCase);
}

function resolveGenerator(mode: string): ClaimRealizationProvider {
  if (mode === "fake") {
    return new FakeAnswerGenerator();
  }
  const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for provider=openai");
  }
  return new OpenAiGroundedAnswerGenerator({ apiKey });
}

async function main(): Promise<void> {
  const datasetPath = resolve(process.argv[2] ?? "eval/datasets/grounded-answer-wb20.jsonl");
  const outputDir = resolve(process.argv[3] ?? "eval/runs/grounded-answer");
  const providerArg = (process.argv[4] ?? "fake").toLowerCase();
  const generator = resolveGenerator(providerArg);
  const rows = await loadDataset(datasetPath);
  const generationLatencies: number[] = [];
  const validationLatencies: number[] = [];
  const totalLatencies: number[] = [];
  const cases: GroundedEvalArtifact["cases"] = [];

  for (const row of rows) {
    const run = await runQuestionToEvidenceBundle({ question: row.question });
    const plan = buildAnswerPlan(run.bundle);
    const grounded = await generateGroundedAnswer({
      plan,
      bundle: run.bundle,
      generator,
      options: {
        claimRetryLimit: 1,
        claimConcurrency: 3
      }
    });

    generationLatencies.push(grounded.diagnostics.generationLatencyMs);
    validationLatencies.push(grounded.diagnostics.validationLatencyMs);
    totalLatencies.push(grounded.diagnostics.totalLatencyMs);

    const normalizedClaims = grounded.realizedClaims.map((claim) => normalize(claim.generatedText));
    const normalizedAnswer = normalize(grounded.answerText);
    const checks: Record<string, boolean> = {};
    checks["answerability"] = grounded.answerability === row.expectedAnswerability;
    checks["requiredClaims"] = (row.requiredClaimConcepts ?? []).every((concept) =>
      normalizedClaims.some((claim) => claim.includes(normalize(concept)))
    );
    checks["prohibitedPhrases"] = (row.prohibitedPhrases ?? []).every(
      (phrase) => !normalizedAnswer.includes(normalize(phrase))
    );
    checks["requiredCaveats"] = (row.requiredCaveatCodes ?? []).every((code) =>
      grounded.caveats.some((caveat) => caveat.code === code)
    );
    checks["validationPass"] = row.requireValidationPass === false ? !grounded.validation.valid : grounded.validation.valid;
    checks["realizedClaimPolicy"] = row.requireNoRealizedClaims
      ? grounded.realizedClaims.length === 0
      : true;

    const pass = Object.values(checks).every(Boolean);
    cases.push({
      questionId: row.questionId,
      question: row.question,
      pass,
      checks,
      diagnostics: {
        generationLatencyMs: grounded.diagnostics.generationLatencyMs,
        validationLatencyMs: grounded.diagnostics.validationLatencyMs,
        totalLatencyMs: grounded.diagnostics.totalLatencyMs
      }
    });
  }

  const artifact: GroundedEvalArtifact = {
    artifactVersion: "1.0",
    runId: `grounded-answer-wb20-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    datasetPath,
    provider: generator.providerId,
    summary: {
      total: rows.length,
      answerabilityMatch: cases.filter((entry) => entry.checks["answerability"]).length,
      requiredConceptCoverage: cases.filter((entry) => entry.checks["requiredClaims"]).length,
      prohibitedPhrasePass: cases.filter((entry) => entry.checks["prohibitedPhrases"]).length,
      requiredCaveatCoverage: cases.filter((entry) => entry.checks["requiredCaveats"]).length,
      validationPass: cases.filter((entry) => entry.checks["validationPass"]).length,
      generationLatencyP50: Number(percentile(generationLatencies, 50).toFixed(3)),
      generationLatencyP95: Number(percentile(generationLatencies, 95).toFixed(3)),
      validationLatencyP50: Number(percentile(validationLatencies, 50).toFixed(3)),
      validationLatencyP95: Number(percentile(validationLatencies, 95).toFixed(3)),
      totalLatencyP50: Number(percentile(totalLatencies, 50).toFixed(3)),
      totalLatencyP95: Number(percentile(totalLatencies, 95).toFixed(3))
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
      { error: error instanceof Error ? error.message : "grounded_answer_evaluation_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
