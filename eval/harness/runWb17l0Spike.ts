import "./cliEnvironment";
import { resolve } from "node:path";
import { runWb17l0Spike } from "../../src/main/services/eval/wb17l0Spike";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const outputDir = resolve(arg("--output-dir") ?? "eval/runs/spikes");
  const v2DatabasePath = arg("--v2-db") ? resolve(arg("--v2-db") as string) : undefined;
  const { artifact, artifactPath } = await runWb17l0Spike({
    outputDir,
    v2DatabasePath
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        runId: artifact.runId,
        decision: artifact.decision,
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
      { error: error instanceof Error ? error.message : "Unknown WB-17L0 spike runner error" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
