import type { KnowledgeStore } from "../store";
import { decodeFloat32Vector, encodeFloat32Vector } from "../store";
import { hashEmbeddingInput } from "./identity";
import type { EmbeddingProvider } from "./types";

export interface EmbedChunkParams {
  chunkId: string;
  text: string;
  provider: EmbeddingProvider;
  model: string;
  embeddingSchemaVersion: string;
  signal?: AbortSignal;
}

export interface EmbedChunkResult {
  reused: boolean;
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
  inputContentHash: string;
}

export class EmbeddingService {
  constructor(private readonly store: KnowledgeStore) {}

  async embedChunk(params: EmbedChunkParams): Promise<EmbedChunkResult> {
    const inputContentHash = hashEmbeddingInput(params.text.trim());
    const reusable = this.store.getChunkEmbedding({
      chunkId: params.chunkId,
      providerId: params.provider.providerId,
      model: params.model,
      embeddingSchemaVersion: params.embeddingSchemaVersion,
      inputContentHash
    });
    if (reusable) {
      return {
        reused: true,
        providerId: reusable.providerId,
        model: reusable.model,
        dimensions: reusable.dimensions,
        embeddingSchemaVersion: reusable.embeddingSchemaVersion,
        inputContentHash: reusable.inputContentHash
      };
    }

    const [result] = await params.provider.embedDocuments(
      [{ id: params.chunkId, text: params.text }],
      {
        model: params.model,
        embeddingSchemaVersion: params.embeddingSchemaVersion,
        signal: params.signal
      }
    );
    if (!result) {
      throw new Error(`Embedding provider returned no result for ${params.chunkId}.`);
    }

    const blob = encodeFloat32Vector(Array.from(result.vector));
    // Decode immediately to enforce dimensional and finite validation before persistence.
    decodeFloat32Vector(blob, result.dimensions);
    this.store.saveChunkEmbedding({
      chunkId: params.chunkId,
      providerId: result.providerId,
      model: result.model,
      dimensions: result.dimensions,
      embeddingSchemaVersion: params.embeddingSchemaVersion,
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

    return {
      reused: false,
      providerId: result.providerId,
      model: result.model,
      dimensions: result.dimensions,
      embeddingSchemaVersion: params.embeddingSchemaVersion,
      inputContentHash: result.inputContentHash
    };
  }
}
