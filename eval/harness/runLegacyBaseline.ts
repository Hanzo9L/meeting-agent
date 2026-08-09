import "./cliEnvironment";
import { resolve } from "node:path";
import { DEFAULT_TOPIC, DEFAULT_TOPIC_PROMPT } from "../../src/shared/constants";
import { runLegacyBaseline } from "./legacyScorer";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    getArg("--dataset") ?? "eval/datasets/teams-admin-powershell.seed.jsonl"
  );
  const indexCachePath = getArg("--index-cache");
  if (!indexCachePath) {
    throw new Error("Missing required --index-cache argument.");
  }

  const outputDir = resolve(getArg("--output-dir") ?? "eval/runs");
  const topK = Number(getArg("--top-k") ?? "4");
  const includeAnswers = hasFlag("--with-answers");
  const openAiApiKey = process.env.OPENAI_API_KEY;

  const { artifactPath, summaryPath, artifact } = await runLegacyBaseline({
    datasetPath,
    indexCachePath: resolve(indexCachePath),
    outputDir,
    topK: Number.isFinite(topK) && topK > 0 ? topK : 4,
    includeAnswers,
    openAiApiKey,
    topic: process.env.BASELINE_TOPIC ?? DEFAULT_TOPIC,
    topicPromptTemplate: process.env.BASELINE_TOPIC_PROMPT ?? DEFAULT_TOPIC_PROMPT
  });

  console.log(
    JSON.stringify(
      {
        runId: artifact.runId,
        artifactPath,
        summaryPath,
        totalQuestions: artifact.summary.totalQuestions,
        retrievedAnyCount: artifact.summary.retrievedAnyCount,
        answerProducedCount: artifact.summary.answerProducedCount,
        insufficientEvidenceCount: artifact.summary.insufficientEvidenceCount,
        usesKnowledgeEngineV2: artifact.usesKnowledgeEngineV2
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Unknown baseline runner error"
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

