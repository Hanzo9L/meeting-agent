export interface EmbeddingRuntimeConfig {
  provider: "openai";
  model: string;
  embeddingSchemaVersion: string;
  maxBatchSize: number;
}

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_SCHEMA_VERSION = "v1";

export function resolveEmbeddingRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingRuntimeConfig {
  return {
    provider: "openai",
    model: env["KNOWLEDGE_V2_EMBEDDING_MODEL"]?.trim() || DEFAULT_EMBEDDING_MODEL,
    embeddingSchemaVersion:
      env["KNOWLEDGE_V2_EMBEDDING_SCHEMA_VERSION"]?.trim() || DEFAULT_EMBEDDING_SCHEMA_VERSION,
    maxBatchSize: Number(env["KNOWLEDGE_V2_EMBEDDING_BATCH_SIZE"] || "64")
  };
}
