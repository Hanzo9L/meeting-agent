import type { AcquiredDocumentInput } from "../parse";

export type IndexingMode = "plan" | "execute";

export type ParseLifecycleStatus =
  | "parse_required_new_document"
  | "parse_required_source_changed"
  | "parse_required_parser_version_changed"
  | "parse_required_previous_failed"
  | "parse_reused"
  | "parse_failed";

export type DocumentLifecycleStatus = "inserted" | "updated" | "reused" | "failed";

export type ChunkLifecycleStatus = "chunked" | "chunks_reused" | "chunks_failed";

export type EmbeddingLifecycleStatus =
  | "embedding_generated"
  | "embedding_reused"
  | "embedding_partial"
  | "embedding_skipped"
  | "embedding_failed"
  | "embedding_cancelled";

export type IndexReadiness = "failed" | "lexically_ready" | "semantic_ready" | "semantic_partial";

export interface IndexingEmbeddingIdentity {
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
}

export interface IndexingDocumentMetrics {
  chunksExamined: number;
  chunksToGenerateEmbeddings: number;
  chunksReusedEmbeddings: number;
  embeddingProviderRequests: number;
  embeddingInputTokens: number;
  estimatedEmbeddingInputChars: number;
  estimatedEmbeddingInputTokens: number;
}

export interface IndexingDocumentResult {
  sourceId: string;
  trackId: string;
  canonicalUrl: string;
  documentId: string | null;
  mode: IndexingMode;
  parse: {
    status: ParseLifecycleStatus;
    warnings: string[];
    errors: string[];
  };
  document: {
    status: DocumentLifecycleStatus;
  };
  chunks: {
    status: ChunkLifecycleStatus;
    oldActiveCount: number;
    newCount: number;
    inserted: number;
    updated: number;
    reused: number;
    tombstoned: number;
    ftsInserted: number;
    ftsUpdated: number;
    ftsRemoved: number;
  };
  embeddings: {
    status: EmbeddingLifecycleStatus;
    examinedCount: number;
    generatedCount: number;
    reusedCount: number;
    failedCount: number;
    cancelledCount: number;
    reasonCounts: Record<string, number>;
    providerRequestCount: number;
    providerInputTokens: number;
  };
  readiness: IndexReadiness;
  stageLatencyMs: {
    identity: number;
    parse: number;
    documentPersist: number;
    chunking: number;
    chunkPersistFts: number;
    embeddingPlan: number;
    embeddingExecute: number;
    total: number;
  };
  warnings: string[];
  errors: string[];
  cancelled: boolean;
  metrics: IndexingDocumentMetrics;
}

export interface IndexingRunSummary {
  mode: IndexingMode;
  documentCount: number;
  processedCount: number;
  failedCount: number;
  cancelledCount: number;
  readinessCounts: Record<IndexReadiness, number>;
  parseStatusCounts: Record<ParseLifecycleStatus, number>;
  chunkStatusCounts: Record<ChunkLifecycleStatus, number>;
  embeddingStatusCounts: Record<EmbeddingLifecycleStatus, number>;
  chunkTotals: {
    inserted: number;
    updated: number;
    reused: number;
    tombstoned: number;
    ftsInserted: number;
    ftsUpdated: number;
    ftsRemoved: number;
  };
  embeddingTotals: {
    examined: number;
    generated: number;
    reused: number;
    failed: number;
    cancelled: number;
    providerRequests: number;
    providerInputTokens: number;
  };
  durationMs: number;
  cancelled: boolean;
}

export interface IndexingRunResult {
  mode: IndexingMode;
  summary: IndexingRunSummary;
  documents: IndexingDocumentResult[];
}

export interface DocumentIndexingJobOptions {
  storeDatabasePath: string;
  migrationsDir: string;
  parserVersion: string;
  chunkerVersion: string;
  embeddingIdentity: IndexingEmbeddingIdentity;
  embeddingBatchSize?: number;
  skipEmbeddingGeneration?: boolean;
}

export interface DocumentIndexingJobRequest {
  mode: IndexingMode;
  acquiredDocuments: AcquiredDocumentInput[];
  signal?: AbortSignal;
}
