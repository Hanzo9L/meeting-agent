import "./cliEnvironment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assembleDeterministicAnswer,
  buildAnswerPlan,
  runQuestionToEvidenceBundle,
  type AnswerabilityStatus
} from "../../src/main/services/answerV2";

interface R4EvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[index] ?? 0;
}

async function loadDataset(path: string): Promise<R4EvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as R4EvalCase);
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.argv[2] ?? "eval/datasets/evidence-wb18.jsonl"
  );
  const outputDir = resolve(
    process.argv[3] ?? "eval/runs/extractive-answer-r4"
  );
  const rows = await loadDataset(datasetPath);
  const cases: Array<Record<string, unknown>> = [];
  const assemblyLatencies: number[] = [];

  for (const row of rows) {
    const run = await runQuestionToEvidenceBundle({
      question: row.question
    });
    const plan = buildAnswerPlan(run.bundle);
    const result = assembleDeterministicAnswer({
      bundle: run.bundle,
      plan
    });
    if (!result.ok) {
      cases.push({
        questionId: row.questionId,
        question: row.question,
        expectedAnswerability: row.expectedAnswerability,
        actualAnswerability: plan.answerability,
        answerabilityMatch:
          plan.answerability === row.expectedAnswerability,
        ok: false,
        snapshotIdentity: plan.snapshotBinding,
        planIdentity: plan.planIdentity,
        r3Claims: plan.plannedClaims,
        failure: result.failure
      });
      continue;
    }

    const assembly = result.answer.extractiveAssembly;
    const latency = result.answer.diagnostics.totalLatencyMs;
    assemblyLatencies.push(latency);
    const renderedIds = new Set(
      assembly?.renderedClaims.map((claim) => claim.claimId) ?? []
    );
    cases.push({
      questionId: row.questionId,
      question: row.question,
      expectedAnswerability: row.expectedAnswerability,
      actualAnswerability: result.answer.answerability,
      answerabilityMatch:
        result.answer.answerability === row.expectedAnswerability,
      ok: true,
      snapshotIdentity: result.answer.snapshotBinding,
      planIdentity: plan.planIdentity,
      r3Claims: plan.plannedClaims.map((claim) => ({
        claimId: claim.claimId,
        requiredAspectId: claim.requiredAspectId,
        coveredFacets: claim.coveredFacets,
        proposition: claim.proposition,
        status: claim.status,
        sourceSpans: claim.sourceSpans
      })),
      renderedClaims:
        assembly?.renderedClaims.map((claim) => ({
          claimId: claim.claimId,
          renderedText: claim.renderedText,
          transformation: claim.transformation,
          answerTextRange: claim.answerTextRange,
          evidenceIds: claim.evidenceIds,
          sourceSpans: claim.sourceSpans
        })) ?? [],
      finalAnswerText: result.answer.answerText,
      caveats: result.answer.caveats,
      unsupportedAspects: result.answer.unsupportedAspects,
      omittedClaimIds: plan.plannedClaims
        .map((claim) => claim.claimId)
        .filter((claimId) => !renderedIds.has(claimId)),
      factualTextAudit: assembly?.factualTextAudit,
      validation: {
        grounding: result.answer.validation,
        assembly: assembly?.validation
      },
      assemblyLatencyMs: latency,
      providerRequestCount: result.answer.diagnostics.requestCount
    });
  }

  const artifact = {
    artifactVersion: "r4.0",
    runId: `extractive-answer-r4-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    datasetPath,
    summary: {
      total: cases.length,
      successful: cases.filter((entry) => entry["ok"] === true).length,
      answerabilityMatch: cases.filter(
        (entry) => entry["answerabilityMatch"] === true
      ).length,
      provenanceAuditPass: cases.filter(
        (entry) =>
          (
            entry["factualTextAudit"] as
              | { allFactualUnitsAttributed?: boolean }
              | undefined
          )?.allFactualUnitsAttributed === true
      ).length,
      providerRequestCount: cases.reduce(
        (sum, entry) =>
          sum + Number(entry["providerRequestCount"] ?? 0),
        0
      ),
      assemblyLatencyP50Ms: Number(
        percentile(assemblyLatencies, 50).toFixed(3)
      ),
      assemblyLatencyP95Ms: Number(
        percentile(assemblyLatencies, 95).toFixed(3)
      )
    },
    cases
  };

  await mkdir(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, `${artifact.runId}.json`);
  await writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    `${JSON.stringify(
      { artifactPath, summary: artifact.summary },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error:
          error instanceof Error
            ? error.message
            : "r4_extractive_evaluation_failed"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
