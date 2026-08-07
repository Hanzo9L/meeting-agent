import { decodeFloat32Vector } from "../store";
import type {
  PersistedChunkEmbeddingRecord,
  PersistedChunkInputRecord
} from "../store";
import { hashEmbeddingInput } from "../embeddings";

export type ReembedReason =
  | "compatible_embedding_exists"
  | "missing"
  | "model_changed"
  | "schema_changed"
  | "dimensions_changed"
  | "content_changed"
  | "provider_changed"
  | "corrupt";

export type ReembedDecision =
  | {
      status: "reused";
      reason: "compatible_embedding_exists";
      desiredInputHash: string;
      desiredDimensions: number;
    }
  | {
      status: "generate";
      reason: Exclude<ReembedReason, "compatible_embedding_exists">;
      desiredInputHash: string;
      desiredDimensions: number;
    };

export interface DesiredEmbeddingIdentity {
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
}

export interface ChunkEmbeddingStateInput {
  chunk: PersistedChunkInputRecord;
  existingEmbeddings: PersistedChunkEmbeddingRecord[];
  desired: DesiredEmbeddingIdentity;
}

function hasCorruptBlob(record: PersistedChunkEmbeddingRecord): boolean {
  try {
    decodeFloat32Vector(record.vectorBlob, record.dimensions);
    return false;
  } catch {
    return true;
  }
}

export function assessChunkEmbeddingState(input: ChunkEmbeddingStateInput): ReembedDecision {
  const desiredInputHash = hashEmbeddingInput(input.chunk.text.trim());
  const relevant = input.existingEmbeddings.filter((item) => item.chunkId === input.chunk.chunkId);
  const providerMatches = relevant.filter((item) => item.providerId === input.desired.providerId);
  const modelMatches = providerMatches.filter((item) => item.model === input.desired.model);
  const schemaMatches = modelMatches.filter(
    (item) => item.embeddingSchemaVersion === input.desired.embeddingSchemaVersion
  );
  const hashMatches = schemaMatches.filter((item) => item.inputContentHash === desiredInputHash);
  const exactMatches = hashMatches.filter((item) => item.dimensions === input.desired.dimensions);

  const exactCurrent = exactMatches.find((item) => !hasCorruptBlob(item));
  if (exactCurrent) {
    return {
      status: "reused",
      reason: "compatible_embedding_exists",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  if (exactMatches.length > 0) {
    return {
      status: "generate",
      reason: "corrupt",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  if (hashMatches.length > 0) {
    return {
      status: "generate",
      reason: "dimensions_changed",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  if (schemaMatches.length > 0) {
    return {
      status: "generate",
      reason: "content_changed",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  if (modelMatches.length > 0) {
    return {
      status: "generate",
      reason: "schema_changed",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  if (providerMatches.length > 0) {
    return {
      status: "generate",
      reason: "model_changed",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  if (relevant.length > 0) {
    return {
      status: "generate",
      reason: "provider_changed",
      desiredInputHash,
      desiredDimensions: input.desired.dimensions
    };
  }

  return {
    status: "generate",
    reason: "missing",
    desiredInputHash,
    desiredDimensions: input.desired.dimensions
  };
}
