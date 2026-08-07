export interface EmbeddingInput {
  id: string;
  text: string;
}

export interface EmbeddingOptions {
  model?: string;
  embeddingSchemaVersion?: string;
  maxBatchSize?: number;
  signal?: AbortSignal;
}

export interface EmbeddingUsage {
  inputTokens?: number;
  requestCount: number;
  batchSize: number;
}

export interface EmbeddingResult {
  inputId: string;
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
  inputContentHash: string;
  vector: Float32Array;
  createdAt: string;
  usage?: EmbeddingUsage;
}

export interface EmbeddingProvider {
  readonly providerId: string;
  embedDocuments(inputs: EmbeddingInput[], options?: EmbeddingOptions): Promise<EmbeddingResult[]>;
  embedQuery(input: EmbeddingInput, options?: EmbeddingOptions): Promise<EmbeddingResult>;
}

export class EmbeddingProviderError extends Error {
  readonly code:
    | "missing_api_key"
    | "invalid_input"
    | "request_failed"
    | "authentication_failed"
    | "rate_limited"
    | "unsupported_model"
    | "aborted"
    | "unexpected_response";

  readonly retryable: boolean;

  constructor(params: {
    code:
      | "missing_api_key"
      | "invalid_input"
      | "request_failed"
      | "authentication_failed"
      | "rate_limited"
      | "unsupported_model"
      | "aborted"
      | "unexpected_response";
    message: string;
    retryable: boolean;
  }) {
    super(params.message);
    this.name = "EmbeddingProviderError";
    this.code = params.code;
    this.retryable = params.retryable;
  }
}
