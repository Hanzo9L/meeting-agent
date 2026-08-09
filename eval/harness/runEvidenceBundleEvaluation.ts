import "./cliEnvironment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectEvidenceForQuestion } from "../../src/main/services/answerV2";
import type { AnswerabilityStatus } from "../../src/main/services/answerV2";

interface EvidenceEvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
  requiredSourceIds: string[];
  requiredUrlContains?: string[];
  requiredTitleContains?: string[];
  prohibitedUrlContains?: string[];
  expectedExactVerified?: boolean;
}

interface EvidenceEvalArtifact {
  artifactVersion: "1.0";
  runId: string;
  createdAt: string;
  datasetPath: string;
  summary: {
    total: number;
    answerabilityMatch: number;
    requiredSourcesMatch: number;
    requiredUrlsMatch: number;
    requiredTitlesMatch: number;
    prohibitedUrlsPass: number;
    exactVerificationMatch: number;
    totalLatencyMsP50: number;
    totalLatencyMsP95: number;
  };
  cases: Array<{
    questionId: string;
    question: string;
    expectedAnswerability: AnswerabilityStatus;
    actualAnswerability: AnswerabilityStatus;
    pass: boolean;
    checks: Record<string, boolean>;
    selectedEvidence: Array<{ sourceId: string; title: string; canonicalUrl: string }>;
  }>;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function loadDataset(path: string): Promise<EvidenceEvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvidenceEvalCase);
}

async function main(): Promise<void> {
  const datasetPath = resolve(process.argv[2] ?? "eval/datasets/evidence-wb18.jsonl");
  const outputDir = resolve(process.argv[3] ?? "eval/runs/evidence");
  const rows = await loadDataset(datasetPath);
  const results: EvidenceEvalArtifact["cases"] = [];
  const latencies: number[] = [];

  for (const row of rows) {
    const inspected = await inspectEvidenceForQuestion({ question: row.question });
    const actual = inspected["answerability"] as AnswerabilityStatus;
    const selected = (inspected["selectedEvidence"] as Array<Record<string, unknown>>) ?? [];
    const exact = inspected["exactIdentifierValidation"] as { verified?: boolean } | undefined;
    const checks: Record<string, boolean> = {};
    checks["answerability"] = actual === row.expectedAnswerability;

    const sourceIds = selected.map((item) => String(item["sourceId"] ?? ""));
    checks["requiredSources"] = row.requiredSourceIds.every((sourceId) => sourceIds.includes(sourceId));

    const urls = selected.map((item) => String(item["canonicalUrl"] ?? ""));
    const titles = selected.map((item) => String(item["title"] ?? ""));
    checks["requiredUrls"] = (row.requiredUrlContains ?? []).every((fragment) =>
      urls.some((url) => url.toLowerCase().includes(fragment.toLowerCase()))
    );
    checks["requiredTitles"] = (row.requiredTitleContains ?? []).every((fragment) =>
      titles.some((title) => title.toLowerCase().includes(fragment.toLowerCase()))
    );
    checks["prohibitedUrls"] = (row.prohibitedUrlContains ?? []).every(
      (fragment) => !urls.some((url) => url.toLowerCase().includes(fragment.toLowerCase()))
    );
    checks["exactVerification"] =
      row.expectedExactVerified === undefined ? true : Boolean(exact?.verified) === row.expectedExactVerified;

    const latency = Number(
      ((inspected["evidenceDiagnostics"] as { latencyMs?: { total?: number } })?.latencyMs?.total ?? 0).toFixed(3)
    );
    latencies.push(latency);

    const pass = Object.values(checks).every(Boolean);
    results.push({
      questionId: row.questionId,
      question: row.question,
      expectedAnswerability: row.expectedAnswerability,
      actualAnswerability: actual,
      pass,
      checks,
      selectedEvidence: selected.map((item) => ({
        sourceId: String(item["sourceId"] ?? ""),
        title: String(item["title"] ?? ""),
        canonicalUrl: String(item["canonicalUrl"] ?? "")
      }))
    });
  }

  const runId = `evidence-wb18-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const artifact: EvidenceEvalArtifact = {
    artifactVersion: "1.0",
    runId,
    createdAt: new Date().toISOString(),
    datasetPath,
    summary: {
      total: rows.length,
      answerabilityMatch: results.filter((item) => item.checks["answerability"]).length,
      requiredSourcesMatch: results.filter((item) => item.checks["requiredSources"]).length,
      requiredUrlsMatch: results.filter((item) => item.checks["requiredUrls"]).length,
      requiredTitlesMatch: results.filter((item) => item.checks["requiredTitles"]).length,
      prohibitedUrlsPass: results.filter((item) => item.checks["prohibitedUrls"]).length,
      exactVerificationMatch: results.filter((item) => item.checks["exactVerification"]).length,
      totalLatencyMsP50: Number(percentile(latencies, 50).toFixed(3)),
      totalLatencyMsP95: Number(percentile(latencies, 95).toFixed(3))
    },
    cases: results
  };

  await mkdir(outputDir, { recursive: true });
  const artifactPath = resolve(outputDir, `${runId}.json`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify({ runId, artifactPath, summary: artifact.summary }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "run_evidence_bundle_evaluation_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
