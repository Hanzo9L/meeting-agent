import type { KnowledgeDocument } from "../parse";
import type { SourceTransport } from "../sourceTypes";
import type { KnowledgeChunk } from "../chunking";

export type DocumentParseStatus = "success" | "warning" | "failed";

export interface SaveDocumentOptions {
  parserVersion: string;
}

export interface StoredDocumentRecord {
  documentId: string;
  sourceId: string;
  trackId: string;
  transport: SourceTransport;
  canonicalUrl: string;
  sourcePath: string;
  contentHash: string;
  parseStatus: DocumentParseStatus;
  warningCount: number;
  errorCount: number;
  parserVersion: string;
  chunkerVersion: string | null;
  embeddingVersion: string | null;
  createdAt: string;
  updatedAt: string;
  tombstonedAt: string | null;
}

export interface SaveDocumentResult {
  documentId: string;
  created: boolean;
  updated: boolean;
}

export interface FindDocumentIdentityQuery {
  sourceId: string;
  trackId: string;
  transport: SourceTransport;
  canonicalUrl: string;
  sourcePath: string;
  locale?: string;
}

export interface SyncCheckpointRecord {
  sourceId: string;
  trackId: string;
  transport: SourceTransport;
  status: "idle" | "ok" | "error";
  lastRevisionFingerprint: string;
  lastSyncedAt: string;
  lastError: string | null;
  checkpointPayload: Record<string, unknown>;
}

export interface SyncCheckpointQuery {
  sourceId: string;
  trackId: string;
}

export interface ChunkSeedRecord {
  chunkId: string;
  documentId: string;
  sectionId: string;
  headingPath: string[];
  chunkKind: string;
  text: string;
  sourceOrder: number;
  contentHash: string;
  provenance: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ReplaceDocumentChunksResult {
  documentId: string;
  chunkerVersion: string;
  oldActiveChunkCount: number;
  newChunkCount: number;
  inserted: number;
  updated: number;
  reused: number;
  tombstoned: number;
  ftsInserted: number;
  ftsUpdated: number;
  ftsRemoved: number;
  durationMs: number;
}

export interface PersistedKnowledgeChunkRecord {
  chunkId: string;
  documentId: string;
  sectionId: string;
  headingPath: string[];
  sourceOrder: number;
  chunkKind: string;
  retrievalText: string;
  contentHash: string;
  chunkerVersion: string | null;
  provenance: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  tombstonedAt: string | null;
}

export interface ChunkLifecycleInspection {
  activeChunkCount: number;
  tombstonedChunkCount: number;
  ftsRowCount: number;
}

export interface ChunkEmbeddingRecord {
  chunkId: string;
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
  inputContentHash: string;
  vectorBlob: Uint8Array;
  usage?: Record<string, unknown>;
}

export interface LoadedChunkEmbedding {
  chunkId: string;
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
  inputContentHash: string;
  vectorBlob: Uint8Array;
  usage?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChunkEmbeddingLookup {
  chunkId: string;
  providerId: string;
  model: string;
  dimensions?: number;
  embeddingSchemaVersion: string;
  inputContentHash: string;
}

export interface PersistedChunkEmbeddingRecord {
  chunkId: string;
  providerId: string;
  model: string;
  dimensions: number;
  embeddingSchemaVersion: string;
  inputContentHash: string;
  vectorBlob: Uint8Array;
  usage?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedChunkInputRecord {
  chunkId: string;
  documentId: string;
  text: string;
  contentHash: string;
}

export interface KnowledgeStoreInspection {
  databasePath: string;
  schemaVersion: number;
  fileSizeBytes: number | null;
  documentCount: number;
  documentsBySource: Array<{ sourceId: string; count: number }>;
  documentsByTransport: Array<{ transport: SourceTransport; count: number }>;
  parseStatusCounts: Array<{ parseStatus: DocumentParseStatus; count: number }>;
  embeddingCount: number;
  embeddingsByModel: Array<{
    providerId: string;
    model: string;
    embeddingSchemaVersion: string;
    dimensions: number;
    count: number;
  }>;
  syncCheckpoints: Array<{
    sourceId: string;
    trackId: string;
    transport: SourceTransport;
    status: "idle" | "ok" | "error";
    lastSyncedAt: string;
    lastRevisionFingerprint: string;
    lastError: string | null;
  }>;
}

export interface KnowledgeStore {
  initializeDatabase(): void;
  close(): void;
  getSchemaVersion(): number;
  saveKnowledgeDocument(document: KnowledgeDocument, options: SaveDocumentOptions): SaveDocumentResult;
  getKnowledgeDocument(documentId: string): KnowledgeDocument | null;
  findDocumentBySourceIdentity(query: FindDocumentIdentityQuery): KnowledgeDocument | null;
  listDocumentsBySource(params: {
    sourceId: string;
    trackId?: string;
    includeTombstoned?: boolean;
  }): StoredDocumentRecord[];
  getDocumentRawSource(documentId: string): {
    rawMarkdown: string;
    rawFrontMatter: string | null;
    frontMatter: Record<string, unknown>;
  } | null;
  tombstoneDocument(query: FindDocumentIdentityQuery, reason: string): boolean;
  saveSyncCheckpoint(checkpoint: SyncCheckpointRecord): void;
  getSyncCheckpoint(query: SyncCheckpointQuery): SyncCheckpointRecord | null;
  saveChunkPlaceholder(chunk: ChunkSeedRecord): void;
  replaceDocumentChunks(params: {
    documentId: string;
    chunkerVersion: string;
    chunks: KnowledgeChunk[];
  }): ReplaceDocumentChunksResult;
  listChunksForDocument(params: {
    documentId: string;
    includeTombstoned?: boolean;
  }): PersistedKnowledgeChunkRecord[];
  getChunk(chunkId: string): PersistedKnowledgeChunkRecord | null;
  countActiveChunks(params?: { documentId?: string }): number;
  lexicalSearchChunks(params: {
    query: string;
    sourceId?: string;
    trackId?: string;
    limit?: number;
  }): Array<{
    chunkId: string;
    documentId: string;
    sourceId: string;
    trackId: string;
    chunkText: string;
    rank: number;
  }>;
  inspectChunkLifecycle(params: { documentId: string }): ChunkLifecycleInspection;
  saveChunkEmbedding(embedding: ChunkEmbeddingRecord): void;
  getChunkEmbedding(params: ChunkEmbeddingLookup): LoadedChunkEmbedding | null;
  listChunkInputs(params?: {
    chunkIds?: string[];
    limit?: number;
    offset?: number;
  }): PersistedChunkInputRecord[];
  listChunkEmbeddings(params?: { chunkId?: string }): PersistedChunkEmbeddingRecord[];
  inspect(): KnowledgeStoreInspection;
}
