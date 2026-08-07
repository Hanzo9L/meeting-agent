import OpenAI from "openai";
import { hashEmbeddingInput } from "./identity";
import type {
  EmbeddingInput,
  EmbeddingOptions,
  EmbeddingProvider,
  EmbeddingProviderError,
  EmbeddingResult
} from "./types";
import { EmbeddingProviderError as ProviderError } from "./types";

interface OpenAiEmbeddingCreateResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens?: number };
}

interface OpenAiEmbeddingsClient {
  embeddings: {
    create(params: {
      model: string;
      input: string[];
    }): Promise<OpenAiEmbeddingCreateResponse>;
  };
}

export interface HostedEmbeddingProviderOptions {
  apiKey?: string;
  defaultModel?: string;
  embeddingSchemaVersion?: string;
  maxBatchSize?: number;
  maxRetries?: number;
  client?: OpenAiEmbeddingsClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeInput(inputs: EmbeddingInput[]): EmbeddingInput[] {
  if (inputs.length === 0) {
    throw new ProviderError({
      code: "invalid_input",
      message: "At least one embedding input is required.",
      retryable: false
    });
  }
  return inputs.map((input) => {
    const text = input.text.trim();
    if (!input.id || !text) {
      throw new ProviderError({
        code: "invalid_input",
        message: "Embedding input must include non-empty id and text.",
        retryable: false
      });
    }
    return { ...input, text };
  });
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  const message = error.message.toLowerCase();
  return message.includes("timeout") || message.includes("network");
}

function mapProviderError(error: unknown): EmbeddingProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 401 || status === 403) {
      return new ProviderError({
        code: "authentication_failed",
        message: "Embedding provider authentication failed.",
        retryable: false
      });
    }
    if (status === 429) {
      return new ProviderError({
        code: "rate_limited",
        message: "Embedding provider rate limited the request.",
        retryable: true
      });
    }
    if (status === 400 || status === 404) {
      return new ProviderError({
        code: "unsupported_model",
        message: "Embedding request rejected by provider/model configuration.",
        retryable: false
      });
    }
  }
  return new ProviderError({
    code: "request_failed",
    message: error instanceof Error ? error.message : "Embedding request failed.",
    retryable: false
  });
}

function assertFiniteVector(vector: number[]): void {
  if (vector.length === 0) {
    throw new ProviderError({
      code: "unexpected_response",
      message: "Provider returned empty embedding vector.",
      retryable: false
    });
  }
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i];
    if (value === undefined || !Number.isFinite(value)) {
      throw new ProviderError({
        code: "unexpected_response",
        message: `Provider returned non-finite vector value at index ${i}.`,
        retryable: false
      });
    }
  }
}

export class HostedOpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "openai";

  private readonly defaultModel: string;
  private readonly embeddingSchemaVersion: string;
  private readonly maxBatchSize: number;
  private readonly maxRetries: number;
  private readonly client: OpenAiEmbeddingsClient | null;

  constructor(options: HostedEmbeddingProviderOptions = {}) {
    this.defaultModel = options.defaultModel ?? "text-embedding-3-small";
    this.embeddingSchemaVersion = options.embeddingSchemaVersion ?? "v1";
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? 64);
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    if (options.client) {
      this.client = options.client;
      return;
    }

    const apiKey = options.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    if (!apiKey) {
      this.client = null;
      return;
    }
    this.client = new OpenAI({ apiKey }) as unknown as OpenAiEmbeddingsClient;
  }

  async embedDocuments(inputs: EmbeddingInput[], options?: EmbeddingOptions): Promise<EmbeddingResult[]> {
    const normalized = normalizeInput(inputs);
    const signal = options?.signal;
    if (signal?.aborted) {
      throw new ProviderError({
        code: "aborted",
        message: "Embedding request aborted before execution.",
        retryable: false
      });
    }
    const model = options?.model ?? this.defaultModel;
    const schemaVersion = options?.embeddingSchemaVersion ?? this.embeddingSchemaVersion;
    const batchSize = Math.max(1, Math.min(options?.maxBatchSize ?? this.maxBatchSize, this.maxBatchSize));
    const resultById = new Map<string, EmbeddingResult>();

    for (let offset = 0; offset < normalized.length; offset += batchSize) {
      if (signal?.aborted) {
        throw new ProviderError({
          code: "aborted",
          message: "Embedding request aborted during execution.",
          retryable: false
        });
      }
      const batch = normalized.slice(offset, offset + batchSize);
      const response = await this.embedBatchWithRetry(batch, model);
      const usageTokens = response.usage?.prompt_tokens;
      const createdAt = new Date().toISOString();

      for (const item of response.data) {
        const source = batch[item.index];
        if (!source) {
          throw new ProviderError({
            code: "unexpected_response",
            message: "Embedding provider returned an out-of-range index.",
            retryable: false
          });
        }
        assertFiniteVector(item.embedding);
        const vector = Float32Array.from(item.embedding);
        resultById.set(source.id, {
          inputId: source.id,
          providerId: this.providerId,
          model: response.model || model,
          dimensions: vector.length,
          embeddingSchemaVersion: schemaVersion,
          inputContentHash: hashEmbeddingInput(source.text),
          vector,
          createdAt,
          usage: {
            inputTokens: usageTokens,
            requestCount: 1,
            batchSize: batch.length
          }
        });
      }
    }

    return normalized.map((input) => {
      const result = resultById.get(input.id);
      if (!result) {
        throw new ProviderError({
          code: "unexpected_response",
          message: `Provider response missing embedding for input ${input.id}.`,
          retryable: false
        });
      }
      return result;
    });
  }

  async embedQuery(input: EmbeddingInput, options?: EmbeddingOptions): Promise<EmbeddingResult> {
    const [result] = await this.embedDocuments([input], options);
    if (!result) {
      throw new ProviderError({
        code: "unexpected_response",
        message: "Provider response missing query embedding result.",
        retryable: false
      });
    }
    return result;
  }

  private async embedBatchWithRetry(
    batch: EmbeddingInput[],
    model: string
  ): Promise<OpenAiEmbeddingCreateResponse> {
    if (!this.client) {
      throw new ProviderError({
        code: "missing_api_key",
        message: "OPENAI_API_KEY is required for hosted embedding provider.",
        retryable: false
      });
    }

    let attempt = 0;
    while (true) {
      try {
        return await this.client.embeddings.create({
          model,
          input: batch.map((item) => item.text)
        });
      } catch (error) {
        attempt += 1;
        const mapped = mapProviderError(error);
        if (attempt > this.maxRetries || !mapped.retryable || !isRetryableError(error)) {
          throw mapped;
        }
        await sleep(150 * attempt);
      }
    }
  }
}
