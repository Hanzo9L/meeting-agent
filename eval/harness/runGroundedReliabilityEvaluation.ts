import "./cliEnvironment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  OpenAiGroundedAnswerGenerator,
  buildAnswerPlan,
  generateGroundedAnswer,
  runQuestionToEvidenceBundle
} from "../../src/main/services/answerV2";
import type { AnswerabilityStatus, GroundingValidationIssue } from "../../src/main/services/answerV2";

interface LiveEvalCase {
  questionId: string;
  question: string;
  expectedAnswerability: AnswerabilityStatus;
}

interface ReliabilityCaseResult {
  questionId: string;
  question: string;
  answerability: AnswerabilityStatus;
  mandatoryClaims: number;
  realizedClaims: number;
  missingMandatoryClaims: string[];
  unknownClaimIds: string[];
  requiredCaveats: string[];
  missingCaveats: string[];
  unsupportedAspectViolations: string[];
  schemaValid: boolean;
  firstAttemptValid: boolean;
  firstAttemptIssues: GroundingValidationIssue[];
  retryUsed: boolean;
  retryValid: boolean | null;
  finalValid: boolean;
  latencyMs: {
    firstGeneration: number;
    validator: number;
    retryGeneration: number | null;
    total: number;
  };
  tokenUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    requestCount: number;
    retries: number;
  };
}

interface ReliabilityArtifact {
  artifactVersion: "1.0";
  runId: string;
  createdAt: string;
  mode: "baseline" | "post_hardening";
  model: string;
  datasetPath: string;
  summary: {
    total: number;
    validFirstAttempt: number;
    invalidFirstAttempt: number;
    finalValid: number;
    firstAttemptGenerationP50: number;
    firstAttemptGenerationP95: number;
    totalLatencyP50: number;
    totalLatencyP95: number;
    failureCategories: Record<string, number>;
    requests: number;
    retries: number;
    inputTokens: number;
    outputTokens: number;
  };
  cases: ReliabilityCaseResult[];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function loadDataset(path: string): Promise<LiveEvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LiveEvalCase);
}

function renderMarkdown(artifact: ReliabilityArtifact): string {
  const lines: string[] = [];
  lines.push(`# Grounded Generation Reliability (${artifact.mode})`);
  lines.push("");
  lines.push(`- Model: \`${artifact.model}\``);
  lines.push(`- Total cases: ${artifact.summary.total}`);
  lines.push(`- First-attempt valid: ${artifact.summary.validFirstAttempt}`);
  lines.push(`- First-attempt invalid: ${artifact.summary.invalidFirstAttempt}`);
  lines.push(`- Final valid after retry policy: ${artifact.summary.finalValid}`);
  lines.push(`- First generation latency p50/p95 (ms): ${artifact.summary.firstAttemptGenerationP50}/${artifact.summary.firstAttemptGenerationP95}`);
  lines.push(`- Total stage latency p50/p95 (ms): ${artifact.summary.totalLatencyP50}/${artifact.summary.totalLatencyP95}`);
  lines.push(`- Requests: ${artifact.summary.requests}; retries: ${artifact.summary.retries}`);
  lines.push(`- Tokens (input/output): ${artifact.summary.inputTokens}/${artifact.summary.outputTokens}`);
  lines.push("");
  lines.push("## Failure categories");
  lines.push("");
  if (Object.keys(artifact.summary.failureCategories).length === 0) {
    lines.push("- None");
  } else {
    for (const [code, count] of Object.entries(artifact.summary.failureCategories).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${code}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Per case");
  lines.push("");
  lines.push("| Case | First valid | Retry used | Final valid | Missing mandatory | Missing caveats |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const row of artifact.cases) {
    lines.push(
      `| ${row.questionId} | ${row.firstAttemptValid ? "yes" : "no"} | ${row.retryUsed ? "yes" : "no"} | ${row.finalValid ? "yes" : "no"} | ${row.missingMandatoryClaims.length} | ${row.missingCaveats.length} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const datasetPath = resolve(process.argv[2] ?? "eval/datasets/grounded-answer-wb20.jsonl");
  const outputDir = resolve(process.argv[3] ?? "eval/runs/grounded-answer-reliability");
  const modeArg = (process.argv[4] ?? "post_hardening").toLowerCase() as "baseline" | "post_hardening";
  const model = process.argv[5] ?? "gpt-4o-mini";
  const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for live reliability evaluation");
  }

  const generator = new OpenAiGroundedAnswerGenerator({ apiKey, model });
  const rows = await loadDataset(datasetPath);
  const firstGenLatencies: number[] = [];
  const totalLatencies: number[] = [];
  const failureCategories = new Map<string, number>();
  const cases: ReliabilityCaseResult[] = [];
  let requestCount = 0;
  let retries = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const row of rows) {
    const run = await runQuestionToEvidenceBundle({ question: row.question });
    const plan = buildAnswerPlan(run.bundle);
    const grounded = await generateGroundedAnswer({
      plan,
      bundle: run.bundle,
      generator,
      options: {
        promptProfile: modeArg === "baseline" ? "baseline" : "hardened",
        claimRetryLimit: modeArg === "baseline" ? 0 : 1,
        claimConcurrency: 3
      }
    });
    const answer = grounded.ok ? grounded.answer : undefined;
    const diagnostics = grounded.ok ? grounded.answer.diagnostics : grounded.failure.diagnostics;
    const firstIssues = grounded.ok
      ? grounded.answer.diagnostics.firstAttemptIssues
      : grounded.failure.groundingIssues;
    for (const issue of firstIssues) {
      failureCategories.set(issue.code, (failureCategories.get(issue.code) ?? 0) + 1);
    }
    const missingMandatoryClaims = firstIssues
      .filter((issue) => issue.code === "missing_mandatory_claim")
      .map((issue) => issue.claimId ?? "unknown");
    const unknownClaimIds = firstIssues
      .filter((issue) => issue.code === "unknown_claim_id")
      .map((issue) => issue.claimId ?? "unknown");
    const missingCaveats = firstIssues
      .filter((issue) =>
        issue.code === "missing_required_caveat" ||
        issue.code === "preview_caveat_missing" ||
        issue.code === "freshness_caveat_missing"
      )
      .map((issue) => issue.message);
    const unsupportedViolations = firstIssues
      .filter((issue) => issue.code === "missing_unsupported_aspect")
      .map((issue) => issue.message);

    firstGenLatencies.push(diagnostics?.attempts[0]?.latencyMs ?? diagnostics?.generationLatencyMs ?? 0);
    totalLatencies.push(diagnostics?.totalLatencyMs ?? 0);
    requestCount += diagnostics?.requestCount ?? 0;
    retries += diagnostics?.retryCount ?? 0;
    inputTokens += diagnostics?.tokenUsage.inputTokens ?? 0;
    outputTokens += diagnostics?.tokenUsage.outputTokens ?? 0;

    cases.push({
      questionId: row.questionId,
      question: row.question,
      answerability: plan.answerability,
      mandatoryClaims: plan.plannedClaims.filter((claim) => claim.mandatory).length,
      realizedClaims: answer?.realizedClaims.length ?? 0,
      missingMandatoryClaims,
      unknownClaimIds,
      requiredCaveats: plan.requiredCaveats.map((caveat) => caveat.code),
      missingCaveats,
      unsupportedAspectViolations: unsupportedViolations,
      schemaValid: !firstIssues.some((issue) => issue.code === "schema_invalid"),
      firstAttemptValid: diagnostics?.firstAttemptValid ?? false,
      firstAttemptIssues: firstIssues,
      retryUsed: (diagnostics?.retryCount ?? 0) > 0,
      retryValid: (diagnostics?.retryCount ?? 0) > 0 ? Boolean(answer?.validation.valid) : null,
      finalValid: Boolean(answer?.validation.valid),
      latencyMs: {
        firstGeneration: diagnostics?.attempts[0]?.latencyMs ?? diagnostics?.generationLatencyMs ?? 0,
        validator: diagnostics?.validationLatencyMs ?? 0,
        retryGeneration:
          diagnostics?.attempts.find((attempt) => attempt.mode === "corrective")?.latencyMs ?? null,
        total: diagnostics?.totalLatencyMs ?? 0
      },
      tokenUsage: {
        inputTokens: diagnostics?.tokenUsage.inputTokens ?? null,
        outputTokens: diagnostics?.tokenUsage.outputTokens ?? null,
        requestCount: diagnostics?.requestCount ?? 0,
        retries: diagnostics?.retryCount ?? 0
      }
    });
  }

  const artifact: ReliabilityArtifact = {
    artifactVersion: "1.0",
    runId: `grounded-reliability-${modeArg}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    createdAt: new Date().toISOString(),
    mode: modeArg,
    model,
    datasetPath,
    summary: {
      total: rows.length,
      validFirstAttempt: cases.filter((entry) => entry.firstAttemptValid).length,
      invalidFirstAttempt: cases.filter((entry) => !entry.firstAttemptValid).length,
      finalValid: cases.filter((entry) => entry.finalValid).length,
      firstAttemptGenerationP50: Number(percentile(firstGenLatencies, 50).toFixed(3)),
      firstAttemptGenerationP95: Number(percentile(firstGenLatencies, 95).toFixed(3)),
      totalLatencyP50: Number(percentile(totalLatencies, 50).toFixed(3)),
      totalLatencyP95: Number(percentile(totalLatencies, 95).toFixed(3)),
      failureCategories: Object.fromEntries(failureCategories.entries()),
      requests: requestCount,
      retries,
      inputTokens,
      outputTokens
    },
    cases
  };

  await mkdir(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, `${artifact.runId}.json`);
  const mdPath = resolve(outputDir, `${artifact.runId}.md`);
  await writeFile(jsonPath, JSON.stringify(artifact, null, 2), "utf8");
  await writeFile(mdPath, renderMarkdown(artifact), "utf8");
  process.stdout.write(`${JSON.stringify({ jsonPath, mdPath, summary: artifact.summary }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "grounded_reliability_evaluation_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
