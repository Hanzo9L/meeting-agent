import "./cliEnvironment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildAnswerPlan,
  runQuestionToEvidenceBundle,
  validateAnswerPlanIntegrity,
  validateGroundingDecisionBoundary,
  type AnswerabilityStatus
} from "../../src/main/services/answerV2";

interface R3EvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
}

async function loadDataset(path: string): Promise<R3EvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as R3EvalCase);
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.argv[2] ?? "eval/datasets/evidence-wb18.jsonl"
  );
  const outputDir = resolve(
    process.argv[3] ?? "eval/runs/answer-plan-r3"
  );
  const rows = await loadDataset(datasetPath);
  const cases: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const run = await runQuestionToEvidenceBundle({
      question: row.question
    });
    const plan = buildAnswerPlan(run.bundle);
    const boundary = validateGroundingDecisionBoundary({
      bundle: run.bundle,
      plan
    });
    const integrity = validateAnswerPlanIntegrity({
      bundle: run.bundle,
      plan
    });
    const evidenceById = new Map(
      run.bundle.evidence.map((evidence) => [
        evidence.evidenceId,
        evidence
      ])
    );
    cases.push({
      questionId: row.questionId,
      question: row.question,
      expectedAnswerability: row.expectedAnswerability,
      actualAnswerability: run.bundle.answerability,
      answerabilityMatch:
        run.bundle.answerability === row.expectedAnswerability,
      boundaryValid: boundary.valid,
      boundaryIssues: boundary.issues,
      planIntegrityValid: integrity.valid,
      planIntegrityIssues: integrity.issues,
      mandatoryAspects: run.bundle.aspectCoverage.aspects
        .filter((aspect) => aspect.requirement === "mandatory")
        .map((aspect) => ({
          aspectId: aspect.aspectId,
          subject: aspect.subject,
          answerObject: aspect.answerObject,
          requiredFacets: aspect.requiredFacets,
          supported:
            run.bundle.aspectCoverage.supportedMandatoryAspectIds.includes(
              aspect.aspectId
            )
        })),
      selectedEvidenceCount: run.bundle.evidence.length,
      selectedEvidence: run.bundle.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        title: evidence.source.title,
        sourceId: evidence.source.sourceId
      })),
      plannedClaimCount: plan.plannedClaims.length,
      plannedClaims: plan.plannedClaims.map((claim) => ({
        claimId: claim.claimId,
        requiredAspectId: claim.requiredAspectId,
        coveredFacets: claim.coveredFacets,
        claimType: claim.claimType,
        proposition: claim.proposition,
        status: claim.status,
        mandatory: claim.mandatory,
        authorityRoles: claim.authorityContext.authorityRoles,
        evidenceIds: claim.evidenceIds,
        sourceSpans: claim.sourceSpans.map((span) => ({
          spanId: span.spanId,
          evidenceId: span.evidenceId,
          evidenceTitle:
            evidenceById.get(span.evidenceId)?.source.title ?? "",
          sourceField: span.sourceField,
          fieldIndex: span.fieldIndex,
          sentenceIndex: span.sentenceIndex,
          startOffset: span.startOffset,
          endOffset: span.endOffset,
          contentHash: span.contentHash,
          text: span.text,
          authorityRole: span.authorityRole
        })),
        ordering: claim.ordering
      })),
      unsupportedAspects: plan.unsupportedAspects,
      evidenceWithoutIndependentClaims:
        plan.diagnostics.evidenceWithoutIndependentClaims,
      facetCoverage: plan.diagnostics.facetCoverage
    });
  }

  const artifact = {
    artifactVersion: "r3.0",
    runId: `answer-plan-r3-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    datasetPath,
    summary: {
      total: cases.length,
      answerabilityMatch: cases.filter(
        (entry) => entry["answerabilityMatch"] === true
      ).length,
      boundaryValid: cases.filter(
        (entry) => entry["boundaryValid"] === true
      ).length,
      planIntegrityValid: cases.filter(
        (entry) => entry["planIntegrityValid"] === true
      ).length,
      selectedEvidenceCount: cases.reduce(
        (sum, entry) =>
          sum + Number(entry["selectedEvidenceCount"] ?? 0),
        0
      ),
      plannedClaimCount: cases.reduce(
        (sum, entry) => sum + Number(entry["plannedClaimCount"] ?? 0),
        0
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
            : "r3_planning_evaluation_failed"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
