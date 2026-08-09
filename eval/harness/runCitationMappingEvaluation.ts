import "./cliEnvironment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assembleDeterministicAnswer,
  buildAnswerPlan,
  mapAnswerCitations,
  runQuestionToEvidenceBundle,
  type AnswerabilityStatus
} from "../../src/main/services/answerV2";

interface CitationEvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * sorted.length) - 1
  );
  return sorted[index] ?? 0;
}

async function loadDataset(path: string): Promise<CitationEvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CitationEvalCase);
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.argv[2] ?? "eval/datasets/evidence-wb18.jsonl"
  );
  const outputDir = resolve(
    process.argv[3] ?? "eval/runs/citations-wb21"
  );
  const rows = await loadDataset(datasetPath);
  const cases: Array<Record<string, unknown>> = [];
  const mappingLatencies: number[] = [];

  for (const row of rows) {
    const evidenceRun = await runQuestionToEvidenceBundle({
      question: row.question
    });
    const plan = buildAnswerPlan(evidenceRun.bundle);
    const assembled = assembleDeterministicAnswer({
      bundle: evidenceRun.bundle,
      plan
    });
    if (!assembled.ok) {
      cases.push({
        questionId: row.questionId,
        question: row.question,
        expectedAnswerability: row.expectedAnswerability,
        actualAnswerability: plan.answerability,
        answerabilityMatch:
          plan.answerability === row.expectedAnswerability,
        ok: false,
        r4Failure: assembled.failure
      });
      continue;
    }

    const mapped = mapAnswerCitations({
      bundle: evidenceRun.bundle,
      plan,
      answer: assembled.answer
    });
    mappingLatencies.push(mapped.diagnostics.latencyMs);
    const citationById = new Map(
      mapped.citations.map((citation) => [
        citation.citationId,
        citation
      ])
    );
    cases.push({
      questionId: row.questionId,
      question: row.question,
      expectedAnswerability: row.expectedAnswerability,
      actualAnswerability: assembled.answer.answerability,
      answerabilityMatch:
        assembled.answer.answerability === row.expectedAnswerability,
      ok: true,
      snapshotIdentity: mapped.snapshotBinding,
      renderedR4Answer: assembled.answer.answerText,
      answerTextUnchanged:
        mapped.answerText === assembled.answer.answerText,
      factualRanges: mapped.factualRanges.map((range) => ({
        ...range,
        renderedText: assembled.answer.answerText.slice(
          range.answerRange.startOffset,
          range.answerRange.endOffset
        ),
        citations: [
          ...range.citationIds,
          ...range.invalidCitationIds
        ]
          .map((citationId) => citationById.get(citationId))
          .filter(Boolean)
          .map((citation) => ({
            citationId: citation?.citationId,
            claimId: citation?.claimId,
            evidenceId: citation?.evidenceId,
            spanId: citation?.spanId,
            supportingSpanIds: citation?.supportingSpanIds,
            documentId: citation?.documentId,
            sourceId: citation?.sourceId,
            title: citation?.sourceTitle,
            headingPath: citation?.headingPath,
            canonicalUrl: citation?.canonicalUrl,
            canonicalUrlSource: citation?.canonicalUrlSource,
            authorityRole: citation?.authorityRole,
            sourceStatus: citation?.sourceStatus,
            sourceRevision: citation?.sourceRevision,
            previewState: mapped.previewState,
            freshnessState: citation?.freshnessState,
            validation: citation?.validation
          }))
      })),
      citationValidation: mapped.validation,
      factualRangeCoverage: {
        zero: mapped.factualRanges.filter(
          (range) => range.coverage === "zero"
        ).length,
        one: mapped.factualRanges.filter(
          (range) => range.coverage === "one"
        ).length,
        multiple: mapped.factualRanges.filter(
          (range) => range.coverage === "multiple"
        ).length,
        complete: mapped.factualRanges.filter(
          (range) => range.complete
        ).length
      },
      mappingLatencyMs: mapped.diagnostics.latencyMs,
      providerRequestCount:
        assembled.answer.diagnostics.requestCount +
        mapped.diagnostics.providerRequestCount
    });
  }

  const artifact = {
    artifactVersion: "wb21.0",
    runId: `citations-wb21-${new Date()
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
      citationValidationPass: cases.filter(
        (entry) =>
          (
            entry["citationValidation"] as
              | { valid?: boolean }
              | undefined
          )?.valid === true
      ).length,
      answerTextUnchanged: cases.filter(
        (entry) => entry["answerTextUnchanged"] === true
      ).length,
      factualRanges: cases.reduce((sum, entry) => {
        const coverage = entry["factualRangeCoverage"] as
          | { zero?: number; one?: number; multiple?: number }
          | undefined;
        return (
          sum +
          Number(coverage?.zero ?? 0) +
          Number(coverage?.one ?? 0) +
          Number(coverage?.multiple ?? 0)
        );
      }, 0),
      zeroCitationRanges: cases.reduce(
        (sum, entry) =>
          sum +
          Number(
            (
              entry["factualRangeCoverage"] as
                | { zero?: number }
                | undefined
            )?.zero ?? 0
          ),
        0
      ),
      oneCitationRanges: cases.reduce(
        (sum, entry) =>
          sum +
          Number(
            (
              entry["factualRangeCoverage"] as
                | { one?: number }
                | undefined
            )?.one ?? 0
          ),
        0
      ),
      multipleCitationRanges: cases.reduce(
        (sum, entry) =>
          sum +
          Number(
            (
              entry["factualRangeCoverage"] as
                | { multiple?: number }
                | undefined
            )?.multiple ?? 0
          ),
        0
      ),
      providerRequestCount: cases.reduce(
        (sum, entry) =>
          sum + Number(entry["providerRequestCount"] ?? 0),
        0
      ),
      mappingLatencyP50Ms: Number(
        percentile(mappingLatencies, 50).toFixed(3)
      ),
      mappingLatencyP95Ms: Number(
        percentile(mappingLatencies, 95).toFixed(3)
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
            : "wb21_citation_evaluation_failed"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
