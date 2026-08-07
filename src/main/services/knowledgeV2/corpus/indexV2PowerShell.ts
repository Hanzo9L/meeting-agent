import { resolve } from "node:path";
import { TeamsPowerShellCorpusJob } from "./teamsPowerShellCorpusJob";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intArg(name: string): number | undefined {
  const value = arg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main(): Promise<void> {
  const mode = (arg("--mode") ?? "plan") as "plan" | "execute";
  if (mode !== "plan" && mode !== "execute") {
    throw new Error(`Invalid --mode value: ${mode}`);
  }
  const parserVersion = arg("--parser-version") ?? "cg01c-parser-v1";
  const chunkerVersion = arg("--chunker-version") ?? "cg01a-v1";
  const dbPath = arg("--db") ? resolve(arg("--db") as string) : undefined;
  const artifactsDir = arg("--artifacts-dir")
    ? resolve(arg("--artifacts-dir") as string)
    : undefined;
  const documentLimit = intArg("--limit");

  const job = new TeamsPowerShellCorpusJob();
  const result = await job.run({
    mode,
    dbPath,
    artifactsDir,
    parserVersion,
    chunkerVersion,
    documentLimit
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : "cg01d_failed" }, null, 2)}\n`
  );
  process.exitCode = 1;
});
