import { dirname, join, resolve } from "node:path";
import { decodeFloat32Vector, encodeFloat32Vector, resolveKnowledgeV2DatabasePath } from "../store";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { parseCanonicalDocument } from "../parse";
import { resolveEmbeddingRuntimeConfig } from "./config";
import { HostedOpenAiEmbeddingProvider } from "./hostedEmbeddingProvider";

function parseArg(name: string): string | null {
  const index = process.argv.findIndex((value) => value === name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const dbArg = parseArg("--db");
  const text = parseArg("--text") ?? "Teams Direct Routing voice routing policy example";
  const dbPath = dbArg
    ? resolve(dbArg)
    : resolveKnowledgeV2DatabasePath({
        cwd: process.cwd()
      });
  const migrationsDir = join(dirname(import.meta.filename), "../store/migrations");
  const config = resolveEmbeddingRuntimeConfig();
  const provider = new HostedOpenAiEmbeddingProvider({
    apiKey: process.env["OPENAI_API_KEY"],
    defaultModel: config.model,
    embeddingSchemaVersion: config.embeddingSchemaVersion,
    maxBatchSize: config.maxBatchSize
  });

  if (!process.env["OPENAI_API_KEY"]) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "not_run",
          reason: "OPENAI_API_KEY missing"
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const started = Date.now();
  const result = await provider.embedQuery({ id: "smoke-query", text }, { model: config.model });
  const latencyMs = Date.now() - started;

  const blob = encodeFloat32Vector(Array.from(result.vector));
  const decoded = decodeFloat32Vector(blob, result.dimensions);
  let maxDiff = 0;
  for (let i = 0; i < decoded.length; i += 1) {
    const diff = Math.abs((decoded[i] ?? 0) - (result.vector[i] ?? 0));
    if (diff > maxDiff) maxDiff = diff;
  }

  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir
  });
  try {
    store.initializeDatabase();
    const parsed = parseCanonicalDocument({
      sourceId: "wb09-smoke",
      trackId: "ga",
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
      rawMarkdown: `# WB09 Smoke\n\n${text}`,
      revision: {
        transport: "learn_mcp",
        canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page",
        locale: "en-us",
        retrievedAt: new Date().toISOString(),
        contentHash: result.inputContentHash
      }
    });
    if (!parsed.document) {
      throw new Error("Could not create smoke document for embedding persistence.");
    }
    const savedDoc = store.saveKnowledgeDocument(parsed.document, { parserVersion: "wb09-smoke" });
    store.saveChunkPlaceholder({
      chunkId: "wb09-smoke-chunk",
      documentId: savedDoc.documentId,
      sectionId: "wb09-smoke-section",
      headingPath: ["Smoke"],
      chunkKind: "generic",
      text,
      sourceOrder: 0,
      contentHash: result.inputContentHash,
      provenance: { smoke: true },
      metadata: { smoke: true }
    });
    store.saveChunkEmbedding({
      chunkId: "wb09-smoke-chunk",
      providerId: result.providerId,
      model: result.model,
      dimensions: result.dimensions,
      embeddingSchemaVersion: result.embeddingSchemaVersion,
      inputContentHash: result.inputContentHash,
      vectorBlob: new Uint8Array(blob),
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens,
            requestCount: result.usage.requestCount,
            batchSize: result.usage.batchSize
          }
        : undefined
    });
    const loaded = store.getChunkEmbedding({
      chunkId: "wb09-smoke-chunk",
      providerId: result.providerId,
      model: result.model,
      dimensions: result.dimensions,
      embeddingSchemaVersion: result.embeddingSchemaVersion,
      inputContentHash: result.inputContentHash
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          provider: result.providerId,
          model: result.model,
          dimensions: result.dimensions,
          embeddingSchemaVersion: result.embeddingSchemaVersion,
          latencyMs,
          usage: result.usage ?? null,
          persisted: Boolean(loaded),
          roundTripMaxDiff: maxDiff
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
