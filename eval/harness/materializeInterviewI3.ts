import "dotenv/config";
import { resolve } from "node:path";
import { InterviewAuthorityMaterializationJob } from "../../src/main/services/knowledgeV2/corpus/interviewAuthorityMaterializationJob";
import { resolveLocalInterviewPacks } from "./interviewAuthorityPack";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const mode = (arg("--mode") ?? "plan") as "plan" | "execute";
  if (mode !== "plan" && mode !== "execute") {
    throw new Error(`Invalid --mode value: ${mode}`);
  }
  const dbPath = arg("--db") ? resolve(arg("--db") as string) : undefined;
  const packs = resolveLocalInterviewPacks(dbPath);
  const missing = [...packs.values()].flatMap(
    (pack) => pack.missingCanonicalUrls
  );
  const job = new InterviewAuthorityMaterializationJob();
  const result = await job.run({
    mode,
    canonicalUrls: missing,
    dbPath,
    artifactsDir: arg("--artifacts-dir")
      ? resolve(arg("--artifacts-dir") as string)
      : undefined
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
