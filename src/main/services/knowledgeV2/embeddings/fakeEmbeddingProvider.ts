import { createHash } from "node:crypto";
import { hashEmbeddingInput } from "./identity";
import type {
  EmbeddingInput,
  EmbeddingOptions,
  EmbeddingProvider,
  EmbeddingResult
} from "./types";

export interface FakeEmbeddingProviderOptions {
  providerId?: string;
  dimensions?: number;
  defaultModel?: string;
  embeddingSchemaVersion?: string;
  failInputIds?: string[];
  delayMs?: number;
}

function deterministicValue(seed: string, index: number): number {
  const digest = createHash("sha256").update(`${seed}:${index}`).digest();
  const raw = digest.readUInt32LE(0);
  return raw / 0xffffffff;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;
  private readonly dimensions: number;
  private readonly defaultModel: string;
  private readonly defaultEmbeddingSchemaVersion: string;
  private readonly failInputIds: Set<string>;
  private readonly delayMs: number;
  private requestCount = 0;
  private documentCallCount = 0;

  constructor(options: FakeEmbeddingProviderOptions = {}) {
    this.providerId = options.providerId ?? "fake";
    this.dimensions = options.dimensions ?? 8;
    this.defaultModel = options.defaultModel ?? "fake-embedding-v1";
    this.defaultEmbeddingSchemaVersion = options.embeddingSchemaVersion ?? "v1";
    this.failInputIds = new Set(options.failInputIds ?? []);
    this.delayMs = options.delayMs ?? 0;
  }

  async embedDocuments(inputs: EmbeddingInput[], options?: EmbeddingOptions): Promise<EmbeddingResult[]> {
    this.documentCallCount += 1;
    return this.embedMany(inputs, options);
  }

  async embedQuery(input: EmbeddingInput, options?: EmbeddingOptions): Promise<EmbeddingResult> {
    const [result] = await this.embedMany([input], options);
    if (!result) {
      throw new Error("Fake provider failed to produce query embedding result.");
    }
    return result;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  getDocumentCallCount(): number {
    return this.documentCallCount;
  }

  private async embedMany(
    inputs: EmbeddingInput[],
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]> {
    this.requestCount += 1;
    if (options?.signal?.aborted) {
      throw new Error("aborted");
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (options?.signal?.aborted) {
        throw new Error("aborted");
      }
    }
    for (const input of inputs) {
      if (this.failInputIds.has(input.id)) {
        throw new Error(`fake_provider_failure:${input.id}`);
      }
    }
    const model = options?.model ?? this.defaultModel;
    const embeddingSchemaVersion =
      options?.embeddingSchemaVersion ?? this.defaultEmbeddingSchemaVersion;
    const now = new Date().toISOString();
    return inputs.map((input) => {
      const vector = new Float32Array(this.dimensions);
      for (let i = 0; i < this.dimensions; i += 1) {
        vector[i] = deterministicValue(`${model}:${input.text}`, i);
      }
      return {
        inputId: input.id,
        providerId: this.providerId,
        model,
        dimensions: this.dimensions,
        embeddingSchemaVersion,
        inputContentHash: hashEmbeddingInput(input.text),
        vector,
        createdAt: now,
        usage: {
          requestCount: 1,
          batchSize: inputs.length
        }
      };
    });
  }
}
