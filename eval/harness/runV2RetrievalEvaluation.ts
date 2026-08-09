import "./cliEnvironment";
import { resolve } from "node:path";
import { runV2RetrievalEvaluation } from "../../src/main/services/eval/v2RetrievalEvaluator";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const datasetPath = resolve(arg("--dataset") ?? "eval/datasets/teams-admin-powershell.seed.jsonl");
  const outputDir = resolve(arg("--output-dir") ?? "eval/runs/tuning");
  const v2DatabasePath = arg("--v2-db") ? resolve(arg("--v2-db") as string) : undefined;
  const { artifact, artifactPath } = await runV2RetrievalEvaluation({
    datasetPath,
    outputDir,
    v2DatabasePath
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        runId: artifact.runId,
        totalQuestions: artifact.summary.totalQuestions,
        artifactPath
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "Unknown V2 evaluation runner error" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
