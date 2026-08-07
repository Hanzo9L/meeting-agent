import { dirname, join, resolve } from "node:path";
import { resolveEmbeddingRuntimeConfig } from "../embeddings";
import { HostedOpenAiEmbeddingProvider } from "../embeddings";
import { resolveKnowledgeV2DatabasePath } from "../store";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { ReembeddingIndexRefreshJob } from "./indexRefreshJob";

function parseArg(name: string): string | null {
  const index = process.argv.findIndex((value) => value === name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function parseNumberArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const mode = parseArg("--mode") ?? "plan";
  const dbArg = parseArg("--db");
  const dbPath = dbArg
    ? resolve(dbArg)
    : resolveKnowledgeV2DatabasePath({
        cwd: process.cwd()
      });
  const migrationsDir = join(dirname(import.meta.filename), "../store/migrations");
  const runtime = resolveEmbeddingRuntimeConfig();
  const provider = new HostedOpenAiEmbeddingProvider({
    apiKey: process.env["OPENAI_API_KEY"],
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion,
    maxBatchSize: runtime.maxBatchSize
  });
  const desiredDimensions = parseNumberArg("--dimensions", 1536);
  const batchSize = parseNumberArg("--batch-size", 25);
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir
  });

  try {
    store.initializeDatabase();
    const job = new ReembeddingIndexRefreshJob({
      store,
      provider,
      desired: {
        providerId: provider.providerId,
        model: runtime.model,
        dimensions: desiredDimensions,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      },
      batchSize
    });

    if (mode === "execute") {
      const run = await job.execute();
      process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
      return;
    }

    const plan = job.createPlan();
    const reasonCounts = plan.reduce<Record<string, number>>((acc, item) => {
      acc[item.decision.reason] = (acc[item.decision.reason] ?? 0) + 1;
      return acc;
    }, {});
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "plan",
          total: plan.length,
          reasonCounts,
          sample: plan.slice(0, 20)
        },
        null,
        2
      )}\n`
    );
  } finally {
    store.close();
  }
}

void main();
