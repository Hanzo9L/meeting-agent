import "./cliEnvironment";
import { resolve } from "node:path";
import { runSideBySideEvaluation } from "../../src/main/services/eval/sideBySideRunner";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    getArg("--dataset") ?? "eval/datasets/teams-admin-powershell.seed.jsonl"
  );
  const outputDir = resolve(getArg("--output-dir") ?? "eval/runs");
  const legacyArtifactPath = getArg("--legacy-artifact");
  const v2DatabasePath = getArg("--v2-db");

  const { artifact, artifactPath, jsonlPath, markdownPath } = await runSideBySideEvaluation({
    datasetPath,
    outputDir,
    legacyArtifactPath: legacyArtifactPath ? resolve(legacyArtifactPath) : undefined,
    v2DatabasePath: v2DatabasePath ? resolve(v2DatabasePath) : undefined
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        runId: artifact.runId,
        corpusMode: artifact.corpus.mode,
        documentCount: artifact.corpus.documentCount,
        chunkCount: artifact.corpus.chunkCount,
        embeddingCount: artifact.corpus.embeddingCount,
        artifactPath,
        jsonlPath,
        markdownPath
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Unknown side-by-side runner error"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
