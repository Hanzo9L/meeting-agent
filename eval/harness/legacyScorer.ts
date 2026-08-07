import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { looksLikeQuestion } from "../../src/main/services/questionDetector";
import { retrieveBestChunks } from "../../src/main/services/knowledgeBase/retriever";
import { OpenAiLlmProvider } from "../../src/main/services/openAiLlmProvider";
import type { KnowledgeChunk } from "../../src/main/services/knowledgeBase/types";
import { loadEvaluationDataset } from "./dataset";
import type {
  BaselineQuestionResult,
  BaselineRunArtifact,
  BaselineRunSummary,
  EvaluationQuestion,
  LegacyAnswerResult,
  LegacyBaselineRunOptions,
  LegacyRetrievalItem
} from "./types";

const LEGACY_NOT_FOUND = "Not found in Teams docs.";
const LEGACY_NO_CONTEXT =
  "I could not find this in the indexed Teams developer docs. This may be in Microsoft Teams admin or Phone System documentation instead.";

type IndexCache = {
  repoUrl?: string;
  branch?: string;
  chunks?: KnowledgeChunk[];
};

function getCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const selected = sorted[index] ?? 0;
  return Math.round(selected * 100) / 100;
}

function deriveLegacySourceDomain(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.includes("powershell") || normalized.includes("teams-ps")) {
    return "teams_powershell";
  }
  if (normalized.includes("graph")) return "graph";
  if (normalized.includes("entra")) return "entra";
  if (normalized.includes("m365") || normalized.includes("microsoft-365")) return "m365";
  return "teams_dev";
}

function toSourceUrl(path: string): string {
  const cleanedPath = path.replace(/^\/+/, "");
  return `https://github.com/MicrosoftDocs/msteams-docs/blob/main/msteams-platform/${cleanedPath}`;
}

function hintMatchesRetrieval(hint: string, item: LegacyRetrievalItem): boolean {
  const hintLower = hint.toLowerCase();
  const itemPath = item.path.toLowerCase();
  const hintBase = basename(hintLower);
  return item.sourceUrl.toLowerCase().includes(hintLower) || (hintBase.length > 3 && itemPath.includes(hintBase));
}

async function runLegacyAnswer(
  question: string,
  retrieval: LegacyRetrievalItem[],
  options: LegacyBaselineRunOptions,
  gating: boolean
): Promise<LegacyAnswerResult> {
  if (!options.includeAnswers) {
    return {
      attempted: false,
      status: "not_attempted",
      text: "",
      citations: retrieval.map((item) => ({ title: item.title, path: item.path, url: item.sourceUrl }))
    };
  }

  if (!gating) {
    return {
      attempted: false,
      status: "skipped_not_question",
      text: "",
      citations: []
    };
  }

  if (!options.openAiApiKey) {
    return {
      attempted: false,
      status: "missing_api_key",
      text: "",
      citations: retrieval.map((item) => ({ title: item.title, path: item.path, url: item.sourceUrl }))
    };
  }

  try {
    const provider = new OpenAiLlmProvider(options.openAiApiKey);
    const context = retrieval.map((item) => ({
      title: item.title,
      path: item.path,
      text: item.textSnippet
    }));

    let text = "";
    for await (const token of provider.streamAnswer({
      topic: options.topic,
      topicPromptTemplate: options.topicPromptTemplate,
      question,
      context
    })) {
      text += token;
    }

    const trimmed = text.trim();
    const status =
      trimmed === LEGACY_NOT_FOUND || trimmed === LEGACY_NO_CONTEXT || trimmed.length === 0
        ? "insufficient_evidence"
        : "answered";

    return {
      attempted: true,
      status,
      text: trimmed,
      citations: retrieval.map((item) => ({ title: item.title, path: item.path, url: item.sourceUrl }))
    };
  } catch (error) {
    return {
      attempted: true,
      status: "error",
      text: "",
      error: error instanceof Error ? error.message : "Unknown answer error",
      citations: retrieval.map((item) => ({ title: item.title, path: item.path, url: item.sourceUrl }))
    };
  }
}

function computeQuestionMetrics(
  question: EvaluationQuestion,
  retrieval: LegacyRetrievalItem[],
  answer: LegacyAnswerResult
): BaselineQuestionResult["metrics"] {
  const expectedDomainHit = retrieval.some((item) =>
    question.expectedSourceDomains.includes(deriveLegacySourceDomain(item.path) as EvaluationQuestion["expectedDomain"])
  );

  let firstExpectedRank: number | null = null;
  for (const item of retrieval) {
    const matchedHint = question.knownSourceHints.some((hint) => hintMatchesRetrieval(hint, item));
    const expectedDomainMatched = question.expectedSourceDomains.includes(
      deriveLegacySourceDomain(item.path) as EvaluationQuestion["expectedDomain"]
    );
    if (matchedHint || expectedDomainMatched) {
      firstExpectedRank = item.rank;
      break;
    }
  }

  const retrievalPaths = new Set(retrieval.map((item) => item.path));
  let citationValidity: BaselineQuestionResult["metrics"]["citationValidity"] = "not_applicable";
  if (answer.citations.length > 0) {
    citationValidity = answer.citations.every((citation) => retrievalPaths.has(citation.path))
      ? "valid"
      : "invalid";
  }

  const answerability: BaselineQuestionResult["metrics"]["answerability"] =
    answer.status === "answered"
      ? "answered"
      : answer.status === "insufficient_evidence"
        ? "insufficient_evidence"
        : answer.status === "error"
          ? "error"
          : "not_answered";

  const unsupportedClaimsHeuristic: BaselineQuestionResult["metrics"]["unsupportedClaimsHeuristic"] =
    answer.status === "answered" && retrieval.length === 0 ? "possible_issue" : "not_evaluated";

  return {
    expectedSourceRetrievedTopK: expectedDomainHit,
    firstExpectedSourceRank: firstExpectedRank,
    citationValidity,
    answerability,
    unsupportedClaimsHeuristic
  };
}

function computeSummary(results: BaselineQuestionResult[]): BaselineRunSummary {
  return {
    totalQuestions: results.length,
    retrievedAnyCount: results.filter((item) => item.retrieval.count > 0).length,
    expectedSourceHitCount: results.filter((item) => item.metrics.expectedSourceRetrievedTopK).length,
    citationValidCount: results.filter((item) => item.metrics.citationValidity === "valid").length,
    answerProducedCount: results.filter((item) => item.metrics.answerability === "answered").length,
    insufficientEvidenceCount: results.filter((item) => item.metrics.answerability === "insufficient_evidence").length,
    errorCount: results.filter((item) => item.metrics.answerability === "error").length,
    p95RetrievalLatencyMs: percentile95(results.map((item) => item.latenciesMs.retrieval)),
    p95AnswerLatencyMs: percentile95(results.map((item) => item.latenciesMs.answer))
  };
}

function toMarkdownSummary(artifact: BaselineRunArtifact): string {
  const lines: string[] = [];
  lines.push(`# Legacy Baseline Summary (${artifact.runId})`);
  lines.push("");
  lines.push(`- Pipeline: \`${artifact.pipelineVersion}\``);
  lines.push(`- Commit: \`${artifact.commitSha}\``);
  lines.push(`- Dataset: \`${artifact.datasetPath}\``);
  lines.push(`- Index cache: \`${artifact.indexCachePath}\``);
  lines.push(`- Questions: ${artifact.summary.totalQuestions}`);
  lines.push(`- Retrieved any context: ${artifact.summary.retrievedAnyCount}`);
  lines.push(`- Expected source hit (Top-K): ${artifact.summary.expectedSourceHitCount}`);
  lines.push(`- Answer produced: ${artifact.summary.answerProducedCount}`);
  lines.push(`- Insufficient evidence: ${artifact.summary.insufficientEvidenceCount}`);
  lines.push(`- Errors: ${artifact.summary.errorCount}`);
  lines.push(`- p95 retrieval latency (ms): ${artifact.summary.p95RetrievalLatencyMs}`);
  lines.push(`- p95 answer latency (ms): ${artifact.summary.p95AnswerLatencyMs}`);
  lines.push("");
  lines.push("## Question outcomes");
  lines.push("");
  for (const result of artifact.results) {
    lines.push(
      `- ${result.questionId}: retrieved=${result.retrieval.count}, answerability=${result.metrics.answerability}, expectedSourceHit=${result.metrics.expectedSourceRetrievedTopK}, firstExpectedRank=${result.metrics.firstExpectedSourceRank ?? "n/a"}`
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Subjective answer quality and nuanced unsupported claims still require human review.");
  lines.push("- This baseline intentionally reflects legacy behavior without V2 retrieval improvements.");
  return lines.join("\n");
}

export async function runLegacyBaseline(options: LegacyBaselineRunOptions): Promise<{
  artifact: BaselineRunArtifact;
  artifactPath: string;
  summaryPath: string;
}> {
  const dataset = await loadEvaluationDataset(options.datasetPath);
  const indexRaw = await readFile(options.indexCachePath, "utf8");
  const indexParsed = JSON.parse(indexRaw) as IndexCache;
  const chunks = indexParsed.chunks ?? [];
  if (!Array.isArray(chunks)) {
    throw new Error("Index cache missing valid chunks array.");
  }

  const results: BaselineQuestionResult[] = [];
  for (const question of dataset) {
    const startTotal = performance.now();
    const startGating = performance.now();
    const gating = looksLikeQuestion(question.question);
    const gatingMs = performance.now() - startGating;

    const startRetrieval = performance.now();
    const context = retrieveBestChunks(question.question, chunks, options.topK);
    const retrievalMs = performance.now() - startRetrieval;

    const retrievalItems: LegacyRetrievalItem[] = context.map((item, index) => ({
      rank: index + 1,
      title: item.title,
      path: item.path,
      textSnippet: item.text,
      sourceUrl: toSourceUrl(item.path)
    }));

    const startAnswer = performance.now();
    const answer = await runLegacyAnswer(question.question, retrievalItems, options, gating);
    const answerMs = performance.now() - startAnswer;

    const errors: string[] = [];
    if (answer.error) errors.push(answer.error);

    const totalMs = performance.now() - startTotal;
    const metrics = computeQuestionMetrics(question, retrievalItems, answer);

    const reviewReasons: string[] = [];
    if (metrics.answerability === "answered") reviewReasons.push("subjective_answer_quality");
    if (!metrics.expectedSourceRetrievedTopK) reviewReasons.push("expected_source_not_retrieved");
    if (metrics.unsupportedClaimsHeuristic === "possible_issue") reviewReasons.push("possible_unsupported_claim");

    results.push({
      questionId: question.questionId,
      question: question.question,
      expectedDomain: question.expectedDomain,
      expectedIntent: question.expectedIntent,
      gating: { looksLikeQuestion: gating },
      retrieval: {
        topK: options.topK,
        count: retrievalItems.length,
        ordered: retrievalItems
      },
      answer,
      metrics,
      latenciesMs: {
        gating: Math.round(gatingMs * 100) / 100,
        retrieval: Math.round(retrievalMs * 100) / 100,
        answer: Math.round(answerMs * 100) / 100,
        total: Math.round(totalMs * 100) / 100
      },
      errors,
      humanReview: {
        required: reviewReasons.length > 0,
        reasons: reviewReasons
      }
    });
  }

  const summary = computeSummary(results);
  const commitSha = getCommitSha();
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${commitSha.slice(0, 7)}`;

  const artifact: BaselineRunArtifact = {
    artifactVersion: "1.0",
    pipelineVersion: "legacy-v1",
    usesKnowledgeEngineV2: false,
    runId,
    commitSha,
    createdAt: new Date().toISOString(),
    datasetPath: resolve(options.datasetPath),
    indexCachePath: resolve(options.indexCachePath),
    options: {
      topK: options.topK,
      includeAnswers: options.includeAnswers
    },
    summary,
    results
  };

  await mkdir(options.outputDir, { recursive: true });
  const artifactPath = resolve(options.outputDir, `${runId}.json`);
  const summaryPath = resolve(options.outputDir, `${runId}.md`);
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  await writeFile(summaryPath, toMarkdownSummary(artifact), "utf8");

  return { artifact, artifactPath, summaryPath };
}

