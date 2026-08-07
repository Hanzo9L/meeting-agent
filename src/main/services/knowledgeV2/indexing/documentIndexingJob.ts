import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { chunkKnowledgeDocument } from "../chunking";
import type { EmbeddingProvider } from "../embeddings";
import { ReembeddingIndexRefreshJob } from "../index/indexRefreshJob";
import { parseCanonicalDocument, type AcquiredDocumentInput, type KnowledgeDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "../store";
import type { StoredDocumentRecord } from "../store";
import type {
  DocumentIndexingJobOptions,
  DocumentIndexingJobRequest,
  IndexingDocumentMetrics,
  IndexingDocumentResult,
  IndexingRunResult,
  IndexingRunSummary,
  IndexReadiness,
  ParseLifecycleStatus
} from "./types";

type ExistingDocumentState = {
  document: KnowledgeDocument | null;
  record: StoredDocumentRecord | null;
  sourceContentHash: string;
};

export class DocumentIndexingJob {
  private readonly options: DocumentIndexingJobOptions;
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(options: DocumentIndexingJobOptions & { embeddingProvider: EmbeddingProvider }) {
    this.options = options;
    this.embeddingProvider = options.embeddingProvider;
  }

  async run(request: DocumentIndexingJobRequest): Promise<IndexingRunResult> {
    const started = performance.now();
    const store = createKnowledgeV2SqliteStore({
      databasePath: this.options.storeDatabasePath,
      migrationsDir: this.options.migrationsDir
    });
    store.initializeDatabase();

    const documents: IndexingDocumentResult[] = [];
    let cancelled = false;
    try {
      for (const acquired of request.acquiredDocuments) {
        if (request.signal?.aborted) {
          cancelled = true;
          break;
        }
        const result = await this.indexSingleDocument({
          acquired,
          mode: request.mode,
          signal: request.signal,
          store
        });
        documents.push(result);
        if (result.cancelled) {
          cancelled = true;
          break;
        }
      }
    } finally {
      store.close();
    }

    const summary = summarizeRun({
      mode: request.mode,
      durationMs: performance.now() - started,
      requestedDocuments: request.acquiredDocuments.length,
      documents,
      cancelled
    });
    return {
      mode: request.mode,
      summary,
      documents
    };
  }

  private async indexSingleDocument(params: {
    acquired: AcquiredDocumentInput;
    mode: "plan" | "execute";
    signal?: AbortSignal;
    store: ReturnType<typeof createKnowledgeV2SqliteStore>;
  }): Promise<IndexingDocumentResult> {
    const started = performance.now();
    const { acquired, mode, signal, store } = params;
    const result = createEmptyDocumentResult({
      sourceId: acquired.sourceId,
      trackId: acquired.trackId,
      canonicalUrl: acquired.canonicalUrl,
      mode
    });

    try {
      throwIfAborted(signal);
      const identityStarted = performance.now();
      const existing = this.resolveExistingDocumentState(store, acquired);
      result.stageLatencyMs.identity = performance.now() - identityStarted;
      result.documentId = existing.document?.documentId ?? null;

      const parseStarted = performance.now();
      const parseDecision = this.decideParseLifecycle(existing);
      result.parse.status = parseDecision;
      let workingDocument = existing.document;
      let parseWarnings: string[] = [];
      if (parseDecision !== "parse_reused") {
        const parsed = parseCanonicalDocument(acquired);
        parseWarnings = parsed.warnings.map((warning) => warning.code);
        if (!parsed.success || !parsed.document) {
          result.parse.status = "parse_failed";
          result.parse.errors.push(...parsed.fatalErrors.map((error) => error.code));
          result.parse.warnings.push(...parseWarnings);
          result.document.status = "failed";
          result.chunks.status = "chunks_failed";
          result.embeddings.status = "embedding_skipped";
          result.readiness = "failed";
          if (mode === "execute" && parsed.document) {
            const persisted = store.saveKnowledgeDocument(parsed.document, {
              parserVersion: this.options.parserVersion
            });
            result.documentId = persisted.documentId;
          }
          result.stageLatencyMs.parse = performance.now() - parseStarted;
          result.stageLatencyMs.total = performance.now() - started;
          return result;
        }
        workingDocument = parsed.document;
        result.parse.warnings.push(...parseWarnings);
      }
      result.stageLatencyMs.parse = performance.now() - parseStarted;
      if (!workingDocument) {
        throw new Error("No canonical document available after parse lifecycle decision.");
      }

      const documentPersistStarted = performance.now();
      if (mode === "execute") {
        if (parseDecision === "parse_reused") {
          result.document.status = "reused";
          result.documentId = workingDocument.documentId;
        } else {
          const persisted = store.saveKnowledgeDocument(workingDocument, {
            parserVersion: this.options.parserVersion
          });
          result.document.status = persisted.created ? "inserted" : "updated";
          result.documentId = persisted.documentId;
          if (persisted.documentId !== workingDocument.documentId) {
            workingDocument = {
              ...workingDocument,
              documentId: persisted.documentId
            };
          }
        }
      } else {
        result.document.status = parseDecision === "parse_reused" ? "reused" : existing.document ? "updated" : "inserted";
      }
      result.stageLatencyMs.documentPersist = performance.now() - documentPersistStarted;

      const activeChunksBefore =
        result.documentId
          ? store.countActiveChunks({ documentId: result.documentId })
          : 0;
      result.chunks.oldActiveCount = activeChunksBefore;
      const chunkingStarted = performance.now();
      const shouldRechunk = this.shouldRechunk({
        parseStatus: result.parse.status,
        existingRecord: existing.record,
        activeChunkCount: activeChunksBefore
      });

      let generatedChunks = store.listChunksForDocument({
        documentId: workingDocument.documentId
      });
      if (shouldRechunk) {
        const chunked = chunkKnowledgeDocument(workingDocument, {
          chunkerVersion: this.options.chunkerVersion
        });
        result.warnings.push(...chunked.diagnostics.map((diag) => diag.code));
        generatedChunks = chunked.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          sectionId: chunk.sectionId,
          headingPath: chunk.headingPath,
          sourceOrder: chunk.sourceOrder,
          chunkKind: chunk.chunkKind,
          retrievalText: chunk.retrievalText,
          contentHash: chunk.contentHash,
          chunkerVersion: chunk.chunkerVersion,
          provenance: chunk.provenance,
          metadata: {
            sourceId: chunk.sourceId,
            trackId: chunk.trackId,
            canonicalUrl: chunk.canonicalUrl,
            contentStatus: chunk.contentStatus,
            inheritedMetadata: chunk.inheritedMetadata,
            exactEntities: chunk.exactEntities
          },
          createdAt: "",
          updatedAt: "",
          tombstonedAt: null
        }));
      }
      result.stageLatencyMs.chunking = performance.now() - chunkingStarted;

      const chunkPersistStarted = performance.now();
      if (shouldRechunk) {
        result.chunks.newCount = generatedChunks.length;
        if (mode === "execute") {
          const chunkedReal = chunkKnowledgeDocument(workingDocument, {
            chunkerVersion: this.options.chunkerVersion
          });
          const replacement = store.replaceDocumentChunks({
            documentId: workingDocument.documentId,
            chunkerVersion: this.options.chunkerVersion,
            chunks: chunkedReal.chunks
          });
          result.chunks.status = "chunked";
          result.chunks.inserted = replacement.inserted;
          result.chunks.updated = replacement.updated;
          result.chunks.reused = replacement.reused;
          result.chunks.tombstoned = replacement.tombstoned;
          result.chunks.ftsInserted = replacement.ftsInserted;
          result.chunks.ftsUpdated = replacement.ftsUpdated;
          result.chunks.ftsRemoved = replacement.ftsRemoved;
          generatedChunks = store.listChunksForDocument({
            documentId: workingDocument.documentId
          });
          result.chunks.newCount = generatedChunks.length;
        } else {
          result.chunks.status = "chunked";
        }
      } else {
        result.chunks.status = "chunks_reused";
        result.chunks.newCount = generatedChunks.length;
      }
      result.stageLatencyMs.chunkPersistFts = performance.now() - chunkPersistStarted;

      const activeChunkIds = generatedChunks.map((chunk) => chunk.chunkId);
      const embeddingPlanStarted = performance.now();
      const reembedJob = new ReembeddingIndexRefreshJob({
        store,
        provider: this.embeddingProvider,
        desired: {
          providerId: this.options.embeddingIdentity.providerId,
          model: this.options.embeddingIdentity.model,
          dimensions: this.options.embeddingIdentity.dimensions,
          embeddingSchemaVersion: this.options.embeddingIdentity.embeddingSchemaVersion
        },
        batchSize: this.options.embeddingBatchSize
      });
      let embeddingGenerateCount = 0;
      let embeddingReuseCount = 0;
      let embeddingPlanLength = 0;
      if (mode === "plan" && shouldRechunk) {
        embeddingPlanLength = activeChunkIds.length;
        embeddingGenerateCount = activeChunkIds.length;
      } else {
        const embeddingPlan = reembedJob.createPlan({ chunkIds: activeChunkIds });
        embeddingPlanLength = embeddingPlan.length;
        embeddingGenerateCount = embeddingPlan.filter((item) => item.decision.status === "generate").length;
        embeddingReuseCount = embeddingPlan.filter((item) => item.decision.status === "reused").length;
      }
      result.metrics = buildMetrics({
        chunks: generatedChunks,
        embeddingGenerateCount,
        embeddingReuseCount
      });
      result.embeddings.examinedCount = embeddingPlanLength;
      result.stageLatencyMs.embeddingPlan = performance.now() - embeddingPlanStarted;

      if (mode === "execute" && !this.options.skipEmbeddingGeneration) {
        const embeddingExecuteStarted = performance.now();
        const embeddingRun = await reembedJob.execute({
          chunkIds: activeChunkIds,
          signal
        });
        result.stageLatencyMs.embeddingExecute = performance.now() - embeddingExecuteStarted;
        result.embeddings.generatedCount = embeddingRun.summary.generatedCount;
        result.embeddings.reusedCount = embeddingRun.summary.reusedCount;
        result.embeddings.failedCount = embeddingRun.summary.failedCount;
        result.embeddings.cancelledCount = embeddingRun.summary.cancelledCount;
        result.embeddings.reasonCounts = embeddingRun.summary.reasonCounts;
        result.embeddings.providerRequestCount = embeddingRun.summary.providerRequestCount;
        result.embeddings.providerInputTokens = embeddingRun.summary.providerInputTokens;
        result.metrics.embeddingProviderRequests = embeddingRun.summary.providerRequestCount;
        result.metrics.embeddingInputTokens = embeddingRun.summary.providerInputTokens;
        if (embeddingRun.summary.cancelled) {
          result.cancelled = true;
          result.embeddings.status = "embedding_cancelled";
        } else if (embeddingRun.summary.failedCount > 0) {
          result.embeddings.status =
            embeddingRun.summary.generatedCount + embeddingRun.summary.reusedCount > 0
              ? "embedding_partial"
              : "embedding_failed";
        } else if (embeddingRun.summary.generatedCount > 0) {
          result.embeddings.status = "embedding_generated";
        } else {
          result.embeddings.status = "embedding_reused";
        }
      } else if (mode === "execute" && this.options.skipEmbeddingGeneration) {
        result.embeddings.status = "embedding_skipped";
        result.warnings.push("embedding_generation_skipped");
      } else {
        result.embeddings.generatedCount = embeddingGenerateCount;
        result.embeddings.reusedCount = embeddingReuseCount;
        result.embeddings.status =
          embeddingGenerateCount > 0 ? "embedding_generated" : "embedding_reused";
      }

      result.readiness = deriveReadiness(result);
      result.stageLatencyMs.total = performance.now() - started;
      return result;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "indexing_failed");
      result.readiness = "failed";
      result.document.status = "failed";
      result.chunks.status = "chunks_failed";
      result.embeddings.status = "embedding_failed";
      if (signal?.aborted) {
        result.cancelled = true;
        result.embeddings.status = "embedding_cancelled";
      }
      result.stageLatencyMs.total = performance.now() - started;
      return result;
    }
  }

  private resolveExistingDocumentState(
    store: ReturnType<typeof createKnowledgeV2SqliteStore>,
    acquired: AcquiredDocumentInput
  ): ExistingDocumentState {
    const query = {
      sourceId: acquired.sourceId,
      trackId: acquired.trackId,
      transport: acquired.transport,
      canonicalUrl: acquired.canonicalUrl,
      sourcePath: deriveSourcePath(acquired),
      locale: acquired.revision.transport === "learn_mcp" ? acquired.revision.locale : undefined
    };
    const existingDocument = store.findDocumentBySourceIdentity(query);
    const records = store.listDocumentsBySource({
      sourceId: acquired.sourceId,
      trackId: acquired.trackId
    });
    const existingRecord =
      records.find((record) => record.documentId === existingDocument?.documentId) ?? null;
    return {
      document: existingDocument,
      record: existingRecord,
      sourceContentHash: sha256(normalizeAcquiredRawMarkdown(acquired))
    };
  }

  private decideParseLifecycle(existing: ExistingDocumentState): ParseLifecycleStatus {
    if (!existing.document || !existing.record) {
      return "parse_required_new_document";
    }
    if (existing.record.contentHash !== existing.sourceContentHash) {
      return "parse_required_source_changed";
    }
    if (existing.record.parserVersion !== this.options.parserVersion) {
      return "parse_required_parser_version_changed";
    }
    if (existing.record.parseStatus === "failed") {
      return "parse_required_previous_failed";
    }
    return "parse_reused";
  }

  private shouldRechunk(params: {
    parseStatus: ParseLifecycleStatus;
    existingRecord: StoredDocumentRecord | null;
    activeChunkCount: number;
  }): boolean {
    if (params.parseStatus !== "parse_reused") return true;
    if (!params.existingRecord) return true;
    if (params.activeChunkCount === 0) return true;
    return params.existingRecord.chunkerVersion !== this.options.chunkerVersion;
  }
}

function deriveReadiness(result: IndexingDocumentResult): IndexReadiness {
  if (result.parse.status === "parse_failed") return "failed";
  if (result.chunks.newCount === 0 && result.chunks.oldActiveCount === 0) return "failed";
  if (
    result.embeddings.status === "embedding_failed" ||
    result.embeddings.status === "embedding_cancelled" ||
    result.embeddings.status === "embedding_skipped"
  ) {
    return "lexically_ready";
  }
  if (result.embeddings.status === "embedding_partial") return "semantic_partial";
  return "semantic_ready";
}

function createEmptyDocumentResult(params: {
  sourceId: string;
  trackId: string;
  canonicalUrl: string;
  mode: "plan" | "execute";
}): IndexingDocumentResult {
  const metrics: IndexingDocumentMetrics = {
    chunksExamined: 0,
    chunksToGenerateEmbeddings: 0,
    chunksReusedEmbeddings: 0,
    embeddingProviderRequests: 0,
    embeddingInputTokens: 0,
    estimatedEmbeddingInputChars: 0,
    estimatedEmbeddingInputTokens: 0
  };
  return {
    sourceId: params.sourceId,
    trackId: params.trackId,
    canonicalUrl: params.canonicalUrl,
    documentId: null,
    mode: params.mode,
    parse: {
      status: "parse_required_new_document",
      warnings: [],
      errors: []
    },
    document: {
      status: "reused"
    },
    chunks: {
      status: "chunks_reused",
      oldActiveCount: 0,
      newCount: 0,
      inserted: 0,
      updated: 0,
      reused: 0,
      tombstoned: 0,
      ftsInserted: 0,
      ftsUpdated: 0,
      ftsRemoved: 0
    },
    embeddings: {
      status: "embedding_skipped",
      examinedCount: 0,
      generatedCount: 0,
      reusedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      reasonCounts: {},
      providerRequestCount: 0,
      providerInputTokens: 0
    },
    readiness: "failed",
    stageLatencyMs: {
      identity: 0,
      parse: 0,
      documentPersist: 0,
      chunking: 0,
      chunkPersistFts: 0,
      embeddingPlan: 0,
      embeddingExecute: 0,
      total: 0
    },
    warnings: [],
    errors: [],
    cancelled: false,
    metrics
  };
}

function summarizeRun(params: {
  mode: "plan" | "execute";
  durationMs: number;
  requestedDocuments: number;
  documents: IndexingDocumentResult[];
  cancelled: boolean;
}): IndexingRunSummary {
  const readinessCounts: Record<IndexReadiness, number> = {
    failed: 0,
    lexically_ready: 0,
    semantic_ready: 0,
    semantic_partial: 0
  };
  const parseStatusCounts: IndexingRunSummary["parseStatusCounts"] = {
    parse_required_new_document: 0,
    parse_required_source_changed: 0,
    parse_required_parser_version_changed: 0,
    parse_required_previous_failed: 0,
    parse_reused: 0,
    parse_failed: 0
  };
  const chunkStatusCounts: IndexingRunSummary["chunkStatusCounts"] = {
    chunked: 0,
    chunks_reused: 0,
    chunks_failed: 0
  };
  const embeddingStatusCounts: IndexingRunSummary["embeddingStatusCounts"] = {
    embedding_generated: 0,
    embedding_reused: 0,
    embedding_partial: 0,
    embedding_skipped: 0,
    embedding_failed: 0,
    embedding_cancelled: 0
  };

  const summary: IndexingRunSummary = {
    mode: params.mode,
    documentCount: params.requestedDocuments,
    processedCount: params.documents.length,
    failedCount: 0,
    cancelledCount: 0,
    readinessCounts,
    parseStatusCounts,
    chunkStatusCounts,
    embeddingStatusCounts,
    chunkTotals: {
      inserted: 0,
      updated: 0,
      reused: 0,
      tombstoned: 0,
      ftsInserted: 0,
      ftsUpdated: 0,
      ftsRemoved: 0
    },
    embeddingTotals: {
      examined: 0,
      generated: 0,
      reused: 0,
      failed: 0,
      cancelled: 0,
      providerRequests: 0,
      providerInputTokens: 0
    },
    durationMs: params.durationMs,
    cancelled: params.cancelled
  };

  for (const document of params.documents) {
    readinessCounts[document.readiness] += 1;
    parseStatusCounts[document.parse.status] += 1;
    chunkStatusCounts[document.chunks.status] += 1;
    embeddingStatusCounts[document.embeddings.status] += 1;
    summary.chunkTotals.inserted += document.chunks.inserted;
    summary.chunkTotals.updated += document.chunks.updated;
    summary.chunkTotals.reused += document.chunks.reused;
    summary.chunkTotals.tombstoned += document.chunks.tombstoned;
    summary.chunkTotals.ftsInserted += document.chunks.ftsInserted;
    summary.chunkTotals.ftsUpdated += document.chunks.ftsUpdated;
    summary.chunkTotals.ftsRemoved += document.chunks.ftsRemoved;
    summary.embeddingTotals.examined += document.embeddings.examinedCount;
    summary.embeddingTotals.generated += document.embeddings.generatedCount;
    summary.embeddingTotals.reused += document.embeddings.reusedCount;
    summary.embeddingTotals.failed += document.embeddings.failedCount;
    summary.embeddingTotals.cancelled += document.embeddings.cancelledCount;
    summary.embeddingTotals.providerRequests += document.embeddings.providerRequestCount;
    summary.embeddingTotals.providerInputTokens += document.embeddings.providerInputTokens;
    if (document.readiness === "failed") summary.failedCount += 1;
    if (document.cancelled) summary.cancelledCount += 1;
  }
  return summary;
}

function deriveSourcePath(acquired: AcquiredDocumentInput): string {
  if (acquired.revision.transport === "github") return acquired.revision.path;
  if (acquired.revision.sourcePath) return acquired.revision.sourcePath;
  return new URL(acquired.canonicalUrl).pathname.replace(/^\/+/, "");
}

function normalizeAcquiredRawMarkdown(acquired: AcquiredDocumentInput): string {
  if (acquired.transport !== "learn_mcp") return acquired.rawMarkdown;
  const trimmed = acquired.rawMarkdown.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return acquired.rawMarkdown;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const textParts = parsed
        .map((entry) => (entry as { text?: unknown }).text)
        .filter((value): value is string => typeof value === "string");
      if (textParts.length > 0) return textParts.join("\n\n");
    }
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { content?: unknown[]; markdown?: unknown; text?: unknown };
      if (typeof record.markdown === "string") return record.markdown;
      if (typeof record.text === "string") return record.text;
      if (Array.isArray(record.content)) {
        const textParts = record.content
          .map((entry) => (entry as { text?: unknown }).text)
          .filter((value): value is string => typeof value === "string");
        if (textParts.length > 0) return textParts.join("\n\n");
      }
    }
  } catch {
    // Not JSON envelope.
  }
  return acquired.rawMarkdown;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("indexing_aborted");
}

function buildMetrics(params: {
  chunks: Array<{ retrievalText: string }>;
  embeddingGenerateCount: number;
  embeddingReuseCount: number;
}): IndexingDocumentMetrics {
  const estimatedChars = params.chunks.reduce((sum, chunk) => sum + chunk.retrievalText.length, 0);
  return {
    chunksExamined: params.chunks.length,
    chunksToGenerateEmbeddings: params.embeddingGenerateCount,
    chunksReusedEmbeddings: params.embeddingReuseCount,
    embeddingProviderRequests: 0,
    embeddingInputTokens: 0,
    estimatedEmbeddingInputChars: estimatedChars,
    estimatedEmbeddingInputTokens: Math.ceil(estimatedChars / 4)
  };
}
