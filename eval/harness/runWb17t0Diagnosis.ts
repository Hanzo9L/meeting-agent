import "./cliEnvironment";
import { resolve } from "node:path";
import { runWb17t0Diagnosis } from "../../src/main/services/eval/wb17t0Diagnosis";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const outputDir = resolve(arg("--output-dir") ?? "eval/runs/diagnostics");
  const datasetPath = arg("--dataset") ? resolve(arg("--dataset") as string) : undefined;
  const v2DatabasePath = arg("--v2-db") ? resolve(arg("--v2-db") as string) : undefined;
  const result = await runWb17t0Diagnosis({ outputDir, datasetPath, v2DatabasePath });
  process.stdout.write(
    `${JSON.stringify(
      {
        runId: result.artifact.runId,
        corpusMode: result.artifact.corpusMode,
        artifactPath: result.artifactPath,
        markdownPath: result.markdownPath
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
        error: error instanceof Error ? error.message : "Unknown wb17t0 diagnostic error"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
