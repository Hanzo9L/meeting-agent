import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FakeEmbeddingProvider } from "../embeddings";
import { DocumentIndexingJob } from "./documentIndexingJob";
import type { AcquiredDocumentInput } from "../parse";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadFixture(path: string): Promise<AcquiredDocumentInput> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

async function main(): Promise<void> {
  const db = arg("--db");
  if (!db) {
    throw new Error("Missing required --db <path> argument.");
  }
  const fixture = arg("--fixture");
  if (!fixture) {
    throw new Error("Missing required --fixture <path> argument.");
  }
  const mode = (arg("--mode") ?? "plan") as "plan" | "execute";
  if (mode !== "plan" && mode !== "execute") {
    throw new Error(`Invalid mode: ${mode}`);
  }

  const acquired = await loadFixture(resolve(fixture));
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: Number(arg("--dimensions") ?? "8"),
    defaultModel: arg("--model") ?? "fake-cg01c-v1",
    embeddingSchemaVersion: arg("--embedding-schema") ?? "v1"
  });

  const job = new DocumentIndexingJob({
    storeDatabasePath: resolve(db),
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations"),
    parserVersion: arg("--parser-version") ?? "cg01c-parser-v1",
    chunkerVersion: arg("--chunker-version") ?? "cg01a-v1",
    embeddingIdentity: {
      providerId: provider.providerId,
      model: arg("--model") ?? "fake-cg01c-v1",
      dimensions: Number(arg("--dimensions") ?? "8"),
      embeddingSchemaVersion: arg("--embedding-schema") ?? "v1"
    },
    embeddingBatchSize: Number(arg("--embedding-batch-size") ?? "25"),
    embeddingProvider: provider
  });

  const result = await job.run({
    mode,
    acquiredDocuments: [acquired]
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "index_v2_document_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
