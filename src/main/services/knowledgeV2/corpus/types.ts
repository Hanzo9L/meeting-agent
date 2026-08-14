import type { AcquiredDocumentInput } from "../parse";
import type { DocumentIndexingJobRequest, IndexingDocumentResult } from "../indexing";
import type { SyncTrackResult } from "../sync";

export type CorpusJobMode = "plan" | "execute";

export interface CorpusDocumentFailure {
  sourcePath: string;
  canonicalUrl: string;
  stage:
    | "acquisition"
    | "canonical_load"
    | "parse"
    | "document_persist"
    | "chunking"
    | "chunk_persist_fts"
    | "embedding"
    | "unknown";
  message: string;
  lexicalReady: boolean;
  semanticReady: boolean;
}

export interface CorpusPlanEstimates {
  documentsToParse: number;
  documentsReusable: number;
  estimatedChunkCount: number;
  estimatedDocumentsByType: {
    cmdlet: number;
    conceptual: number;
    other: number;
  };
  embeddingsReusable: number;
  embeddingsToGenerate: number;
  estimatedEmbeddingInputChars: number;
  estimatedEmbeddingInputTokens: number;
  plannedEmbeddingRequestCount: number;
}

export interface CorpusExecutionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
  indexingLifecycleTotals: {
    parsed: number;
    parseReused: number;
    parseFailed: number;
    chunked: number;
    chunksReused: number;
    chunksFailed: number;
    embeddingGenerated: number;
    embeddingReused: number;
    embeddingPartial: number;
    embeddingSkipped: number;
    embeddingFailed: number;
    embeddingCancelled: number;
  };
}

export interface PowerShellCorpusStats {
  documents: {
    totalCanonical: number;
    conceptualDocs: number;
    cmdletDocs: number;
    parseSuccess: number;
    parseWarning: number;
    parseFailed: number;
  };
  chunks: {
    totalActive: number;
    chunkKindDistribution: Record<string, number>;
    averageChunksPerDocument: number;
    medianChunksPerDocument: number;
    largestChunkProducingDocuments: Array<{
      documentId: string;
      sourcePath: string;
      chunkCount: number;
    }>;
    chunkTextSizeSummary: {
      min: number;
      p50: number;
      p95: number;
      max: number;
    };
  };
  fts: {
    indexedActiveRows: number;
    activeChunkCount: number;
    consistent: boolean;
  };
  embeddings: {
    totalActiveChunks: number;
    currentCompatibleEmbeddings: number;
    missingEmbeddings: number;
    staleOrIncompatibleEmbeddings: number;
    semanticReadyPercentage: number;
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
  };
}

export interface RetrievalSmokeCaseResult {
  question: string;
  route: {
    selectedDomains: string[];
    eligibleSources: Array<{ sourceId: string; trackIds: string[] }>;
  };
  exactCandidateCount: number;
  lexicalCandidateCount: number;
  semanticCandidateCount: number | null;
  hybridCandidateCount: number | null;
  topExactSourceId: string | null;
  topLexicalSourceId: string | null;
  topSemanticSourceId: string | null;
  topHybridSourceId: string | null;
  semanticLatencyMs: number | null;
  hybridLatencyMs: number | null;
  warnings: string[];
}

export interface CorpusRunArtifacts {
  jsonPath: string;
  jsonlPath: string;
  markdownPath: string;
}

export interface TeamsPowerShellCorpusRunResult {
  runId: string;
  mode: CorpusJobMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  corpusClassification: "LIMITED_REAL" | "blocked_empty";
  databasePath: string;
  source: {
    sourceId: "ms-teams-powershell";
    trackId: "ga";
    resolvedCommitSha: string | null;
    eligibleFileCount: number;
    counts: {
      added: number;
      modified: number;
      unchanged: number;
      deleted: number;
      errors: number;
    };
  };
  sync: {
    startCheckpointRevision: string | null;
    endCheckpointRevision: string | null;
    checkpointUpdated: boolean;
  };
  acquisitionResult: SyncTrackResult;
  plan: CorpusPlanEstimates;
  execution: CorpusExecutionSummary | null;
  indexingDocuments: IndexingDocumentResult[];
  failures: CorpusDocumentFailure[];
  smoke: {
    setCsOnlineVoiceRoutingPolicy: RetrievalSmokeCaseResult | null;
    conceptualVoiceRouting: RetrievalSmokeCaseResult | null;
    unrelatedCmdlet: RetrievalSmokeCaseResult | null;
  };
  corpusStats: PowerShellCorpusStats | null;
  embeddingUsage: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
    requests: number;
    generated: number;
    reused: number;
    missing: number;
    failed: number;
    inputTokens: number;
    retries: number | null;
    credentialAvailable: boolean;
  };
  warnings: string[];
  errors: string[];
  cancelled: boolean;
  artifactPaths: CorpusRunArtifacts;
}

export interface TeamsPowerShellCorpusJobRequest {
  mode: CorpusJobMode;
  dbPath?: string;
  artifactsDir?: string;
  parserVersion: string;
  chunkerVersion: string;
  signal?: AbortSignal;
  documentLimit?: number;
}

export interface EntraCorpusStats {
  documents: {
    totalCanonical: number;
    parseSuccess: number;
    parseWarning: number;
    parseFailed: number;
    bySubdomain: Record<string, number>;
  };
  chunks: {
    totalActive: number;
    chunkKindDistribution: Record<string, number>;
    averageChunksPerDocument: number;
    medianChunksPerDocument: number;
    largestChunkProducingDocuments: Array<{
      documentId: string;
      sourcePath: string;
      chunkCount: number;
    }>;
    chunkTextSizeSummary: {
      min: number;
      p50: number;
      p95: number;
      max: number;
    };
  };
  fts: {
    indexedActiveRows: number;
    activeChunkCount: number;
    consistent: boolean;
  };
  embeddings: {
    totalActiveChunks: number;
    currentCompatibleEmbeddings: number;
    missingEmbeddings: number;
    staleOrIncompatibleEmbeddings: number;
    semanticReadyPercentage: number;
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
  };
}

export interface EntraCorpusRunResult {
  runId: string;
  mode: CorpusJobMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  corpusClassification: "LIMITED_REAL" | "blocked_empty";
  databasePath: string;
  source: {
    sourceId: "ms-entra-docs";
    trackId: "ga";
    authorityRoles: ["entra_identity_primary"];
    resolvedCommitSha: string | null;
    eligibleFileCount: number;
    includeGlobs: string[];
    counts: {
      added: number;
      modified: number;
      unchanged: number;
      deleted: number;
      errors: number;
    };
  };
  sync: {
    startCheckpointRevision: string | null;
    endCheckpointRevision: string | null;
    checkpointUpdated: boolean;
  };
  acquisitionResult: SyncTrackResult;
  plan: CorpusPlanEstimates;
  execution: CorpusExecutionSummary | null;
  indexingDocuments: IndexingDocumentResult[];
  failures: CorpusDocumentFailure[];
  smoke: {
    conditionalAccessMfa: RetrievalSmokeCaseResult | null;
    appRegistration: RetrievalSmokeCaseResult | null;
    sharePointNegativeControl: RetrievalSmokeCaseResult | null;
  };
  corpusStats: EntraCorpusStats | null;
  embeddingUsage: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
    requests: number;
    generated: number;
    reused: number;
    missing: number;
    failed: number;
    inputTokens: number;
    retries: number | null;
    credentialAvailable: boolean;
  };
  warnings: string[];
  errors: string[];
  cancelled: boolean;
  artifactPaths: CorpusRunArtifacts;
}

export interface EntraCorpusJobRequest {
  mode: CorpusJobMode;
  dbPath?: string;
  artifactsDir?: string;
  parserVersion: string;
  chunkerVersion: string;
  signal?: AbortSignal;
  documentLimit?: number;
}

export type AcquiredDocumentBuilder = (input: {
  syncPath: string;
  syncBlobSha: string;
  syncCommitSha: string;
  syncRepository: string;
  syncBranch: string;
  syncCanonicalUrl: string;
  content: string;
}) => AcquiredDocumentInput;

export type IndexingRequestFactory = (
  docs: AcquiredDocumentInput[]
) => DocumentIndexingJobRequest;
