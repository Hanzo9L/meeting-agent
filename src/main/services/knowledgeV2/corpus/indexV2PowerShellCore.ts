import { resolve } from "node:path";
import "dotenv/config";
import { PowerShellCoreCorpusJob } from "./powerShellCoreCorpusJob";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const mode = (arg("--mode") ?? "plan") as "plan" | "execute";
  if (mode !== "plan" && mode !== "execute") {
    throw new Error(`Invalid --mode value: ${mode}`);
  }
  const result = await new PowerShellCoreCorpusJob().run({
    mode,
    dbPath: arg("--db") ? resolve(arg("--db") as string) : undefined,
    artifactsDir: arg("--artifacts-dir")
      ? resolve(arg("--artifacts-dir") as string)
      : undefined,
    parserVersion: arg("--parser-version") ?? "cg01c-parser-v1",
    chunkerVersion: arg("--chunker-version") ?? "cg01a-v1"
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      error:
        error instanceof Error
          ? error.message
          : "powershell_core_corpus_failed"
    })}\n`
  );
  process.exitCode = 1;
});
