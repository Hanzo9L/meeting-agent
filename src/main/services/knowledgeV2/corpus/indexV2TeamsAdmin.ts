import { resolve } from "node:path";
import { TeamsAdminCorpusJob } from "./teamsAdminCorpusJob";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const mode = (arg("--mode") ?? "plan") as "plan" | "execute";
  if (mode !== "plan" && mode !== "execute") {
    throw new Error(`Invalid --mode value: ${mode}`);
  }
  const parserVersion = arg("--parser-version") ?? "cg01c-parser-v1";
  const chunkerVersion = arg("--chunker-version") ?? "cg01a-v1";
  const dbPath = arg("--db") ? resolve(arg("--db") as string) : undefined;
  const artifactsDir = arg("--artifacts-dir") ? resolve(arg("--artifacts-dir") as string) : undefined;
  const approvedManifestPath = arg("--manifest")
    ? resolve(arg("--manifest") as string)
    : undefined;
  const job = new TeamsAdminCorpusJob();
  const result = await job.run({
    mode,
    dbPath,
    artifactsDir,
    approvedManifestPath,
    parserVersion,
    chunkerVersion
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : "cg01e2_failed" }, null, 2)}\n`
  );
  process.exitCode = 1;
});
