import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createKnowledgeV2SqliteStore,
  getSourceById,
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath,
  type EmbeddingProvider
} from "../index";
import { DocumentIndexingJob } from "../indexing/documentIndexingJob";
import type { IndexingDocumentResult } from "../indexing/types";
import { routeQueryIntent } from "../../retrievalV2/domainPolicies";
import { retrieveExactMatches } from "../../retrievalV2/exactMatchRetriever";
import { retrieveHybridCandidates } from "../../retrievalV2/hybridRetriever";
import { retrieveLexicalCandidates } from "../../retrievalV2/lexicalRetriever";
import { extractQueryIntent } from "../../retrievalV2/queryIntentRules";
import { retrieveSemanticCandidates } from "../../retrievalV2/semanticRetriever";
import { createSourceSyncAdapter, type SourceFileDescriptor, type SourceSyncAdapter } from "../sync";
import type { TrackCheckpoint } from "../sync";
import type { AcquiredDocumentInput } from "../parse";
import type {
  CorpusDocumentFailure,
  CorpusExecutionSummary,
  CorpusPlanEstimates,
  CorpusRunArtifacts,
  EntraCorpusJobRequest,
  EntraCorpusRunResult,
  EntraCorpusStats,
  RetrievalSmokeCaseResult
} from "./types";

const SOURCE_ID = "ms-entra-docs";
const TRACK_ID = "ga";
const DEFAULT_ARTIFACTS_DIR = "eval/runs/indexing";
const ENTRA_LEARN_BASE = "https://learn.microsoft.com/entra";

interface CorpusJobDependencies {
  syncAdapter?: SourceSyncAdapter;
  createEmbeddingProvider?: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
  };
}

export function mapEntraRepoPathToLearnUrl(sourcePath: string): string | null {
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.toLowerCase().startsWith("docs/") || !normalized.toLowerCase().endsWith(".md")) {
    return null;
  }
  const rest = normalized.slice("docs/".length).replace(/\.md$/i, "");
  if (!rest || rest.includes("..")) return null;
  return `${ENTRA_LEARN_BASE}/${rest}`;
}

export function classifyEntraSubdomain(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/identity/conditional-access/")) return "conditional_access";
  if (normalized.includes("/identity/authentication/")) return "authentication";
  if (normalized.includes("/identity/role-based-access-control/")) return "authorization";
  if (normalized.includes("/identity/devices/")) return "device_identity";
  if (normalized.includes("/identity-platform/")) return "app_service_principal";
  if (normalized.includes("/external-id/") || normalized.includes("/guest")) return "guest_identity";
  return "other";
}

export class EntraCorpusJob {
  private readonly syncAdapter: SourceSyncAdapter;
  private readonly createEmbeddingProvider: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
  };

  constructor(deps: CorpusJobDependencies = {}) {
    this.syncAdapter = deps.syncAdapter ?? createSourceSyncAdapter();
    this.createEmbeddingProvider =
      deps.createEmbeddingProvider ?? createHostedEmbeddingProviderOrThrow;
  }

  async run(request: EntraCorpusJobRequest): Promise<EntraCorpusRunResult> {
    const startedAt = new Date();
    const started = performance.now();
    const runId = `k1-entra-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
    const dbPath = resolve(request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() }));
    const artifactsDir = resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR);
    const artifacts = buildArtifactPaths(artifactsDir, runId);
    const warnings: string[] = [];
    const errors: string[] = [];
    const indexingDocuments: IndexingDocumentResult[] = [];
    const failures: CorpusDocumentFailure[] = [];
    let cancelled = false;

    await mkdir(dirname(artifacts.jsonPath), { recursive: true });

    const source = getSourceById(SOURCE_ID);
    if (!source || source.acquisition.transport !== "github") {
      throw new Error("Invalid source registry state for ms-entra-docs github source.");
    }

    const store = createKnowledgeV2SqliteStore({
      databasePath: dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
    });
    store.initializeDatabase();
    const checkpointRow = store.getSyncCheckpoint({ sourceId: SOURCE_ID, trackId: TRACK_ID });
    const previousCheckpoint = toTrackCheckpoint(checkpointRow?.checkpointPayload ?? null);

    const syncResult = await this.syncAdapter.syncTrack({
      sourceId: SOURCE_ID,
      trackId: TRACK_ID,
      previousCheckpoint,
      options: {
        fetchContent: true,
        maxFileFetchFailures: 100,
        signal: request.signal
      }
    });

    const descriptorPool = [...syncResult.added, ...syncResult.modified, ...syncResult.unchanged];
    const limitedDescriptors =
      typeof request.documentLimit === "number" && request.documentLimit > 0
        ? descriptorPool.slice(0, request.documentLimit)
        : descriptorPool;

    const acquiredDocs: AcquiredDocumentInput[] = [];
    for (const descriptor of limitedDescriptors) {
      if (request.signal?.aborted) {
        cancelled = true;
        break;
      }
      const built = this.buildAcquiredDocument(descriptor, store);
      if ("failure" in built) {
        failures.push(built.failure);
        continue;
      }
      acquiredDocs.push(built.doc);
    }

    const plan = await this.planIndexing({
      dbPath,
      parserVersion: request.parserVersion,
      chunkerVersion: request.chunkerVersion,
      docs: acquiredDocs,
      signal: request.signal
    });

    let execution: CorpusExecutionSummary | null = null;
    const embeddingConfig = resolveEmbeddingRuntimeConfig();
    const { provider, dimensions, credentialAvailable } = this.createEmbeddingProvider();
    const skipEmbeddings = !credentialAvailable;
    if (!credentialAvailable) {
      warnings.push("OPENAI_API_KEY missing; semantic embedding generation skipped.");
    }

    if (request.mode === "execute" && !cancelled) {
      let done = 0;
      for (const doc of acquiredDocs) {
        if (request.signal?.aborted) {
          cancelled = true;
          break;
        }
        const job = new DocumentIndexingJob({
          storeDatabasePath: dbPath,
          migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations"),
          parserVersion: request.parserVersion,
          chunkerVersion: request.chunkerVersion,
          embeddingIdentity: {
            providerId: provider.providerId,
            model: embeddingConfig.model,
            dimensions,
            embeddingSchemaVersion: embeddingConfig.embeddingSchemaVersion
          },
          embeddingBatchSize: embeddingConfig.maxBatchSize,
          skipEmbeddingGeneration: skipEmbeddings,
          embeddingProvider: provider
        });
        const run = await job.run({
          mode: "execute",
          acquiredDocuments: [doc],
          signal: request.signal
        });
        const indexed = run.documents[0];
        if (!indexed) continue;
        indexingDocuments.push(indexed);
        done += 1;
        const currentPath = doc.revision.transport === "github" ? doc.revision.path : doc.canonicalUrl;
        process.stdout.write(
          `[K1-ENTRA] completed=${done}/${acquiredDocs.length} failed=${failures.length} current=${currentPath} chunks=${indexed.chunks.newCount} embGen=${indexed.embeddings.generatedCount} embReuse=${indexed.embeddings.reusedCount}\n`
        );
        if (indexed.readiness === "failed") {
          failures.push({
            sourcePath: currentPath,
            canonicalUrl: doc.canonicalUrl,
            stage: classifyFailureStage(indexed),
            message: indexed.errors.join("; ") || "indexing_failed",
            lexicalReady: false,
            semanticReady: false
          });
        }
      }

      for (const deleted of syncResult.deleted) {
        if (request.signal?.aborted) {
          cancelled = true;
          break;
        }
        if (
          !store.tombstoneDocument(
            {
              sourceId: SOURCE_ID,
              trackId: TRACK_ID,
              transport: "github",
              canonicalUrl: canonicalUrlForDescriptor(deleted),
              sourcePath: deleted.path
            },
            "deleted_in_source"
          )
        ) {
          warnings.push(`Deleted source path not found for tombstone: ${deleted.path}`);
        }
      }

      execution = summarizeExecution(indexingDocuments, failures, cancelled);
      const canUpdateCheckpoint = failures.length === 0 && !cancelled;
      if (canUpdateCheckpoint && syncResult.endCheckpoint) {
        store.saveSyncCheckpoint({
          sourceId: SOURCE_ID,
          trackId: TRACK_ID,
          transport: "github",
          status: "ok",
          lastRevisionFingerprint: syncResult.endCheckpoint.commitSha,
          lastSyncedAt: syncResult.endCheckpoint.lastSyncedAt,
          lastError: null,
          checkpointPayload: syncResult.endCheckpoint as unknown as Record<string, unknown>
        });
      } else {
        store.saveSyncCheckpoint({
          sourceId: SOURCE_ID,
          trackId: TRACK_ID,
          transport: "github",
          status: failures.length > 0 ? "error" : "idle",
          lastRevisionFingerprint: checkpointRow?.lastRevisionFingerprint ?? "none",
          lastSyncedAt: new Date().toISOString(),
          lastError:
            failures.length > 0
              ? `documents_failed:${failures.length}`
              : cancelled
                ? "cancelled"
                : "not_executed",
          checkpointPayload: {
            previousCheckpoint: checkpointRow?.checkpointPayload ?? null,
            attemptedRevision: syncResult.resolvedCommitSha,
            failedPaths: failures.map((f) => f.sourcePath)
          }
        });
      }
    }

    const corpusStats =
      request.mode === "execute"
        ? computeCorpusStats({
            store,
            providerId: provider.providerId,
            model: embeddingConfig.model,
            dimensions,
            schema: embeddingConfig.embeddingSchemaVersion
          })
        : null;

    const smoke =
      request.mode === "execute"
        ? await runRetrievalSmokes({
            dbPath,
            provider,
            embeddingModel: embeddingConfig.model,
            embeddingSchemaVersion: embeddingConfig.embeddingSchemaVersion,
            semanticEnabled: credentialAvailable
          })
        : {
            conditionalAccessMfa: null,
            appRegistration: null,
            sharePointNegativeControl: null
          };

    const generated = indexingDocuments.reduce((sum, doc) => sum + doc.embeddings.generatedCount, 0);
    const reused = indexingDocuments.reduce((sum, doc) => sum + doc.embeddings.reusedCount, 0);
    const failedEmbeddings = indexingDocuments.reduce((sum, doc) => sum + doc.embeddings.failedCount, 0);
    const requests = indexingDocuments.reduce((sum, doc) => sum + doc.embeddings.providerRequestCount, 0);
    const inputTokens = indexingDocuments.reduce((sum, doc) => sum + doc.embeddings.providerInputTokens, 0);

    const hasRealCorpusData =
      (corpusStats?.documents.totalCanonical ?? 0) > 0 &&
      (corpusStats?.chunks.totalActive ?? 0) > 0 &&
      (corpusStats?.fts.indexedActiveRows ?? 0) > 0;
    const result: EntraCorpusRunResult = {
      runId,
      mode: request.mode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      corpusClassification: hasRealCorpusData ? "LIMITED_REAL" : "blocked_empty",
      databasePath: dbPath,
      source: {
        sourceId: SOURCE_ID,
        trackId: TRACK_ID,
        authorityRoles: ["entra_identity_primary"],
        resolvedCommitSha: syncResult.resolvedCommitSha,
        eligibleFileCount: descriptorPool.length,
        includeGlobs: source.contentTracks.find((track) => track.id === TRACK_ID)?.includeGlobs ?? [],
        counts: {
          added: syncResult.added.length,
          modified: syncResult.modified.length,
          unchanged: syncResult.unchanged.length,
          deleted: syncResult.deleted.length,
          errors: syncResult.errors.length
        }
      },
      sync: {
        startCheckpointRevision: previousCheckpoint?.commitSha ?? null,
        endCheckpointRevision: syncResult.endCheckpoint?.commitSha ?? null,
        checkpointUpdated:
          request.mode === "execute" && failures.length === 0 && !cancelled && Boolean(syncResult.endCheckpoint)
      },
      acquisitionResult: syncResult,
      plan,
      execution,
      indexingDocuments,
      failures,
      smoke,
      corpusStats,
      embeddingUsage: {
        providerId: provider.providerId,
        model: embeddingConfig.model,
        dimensions,
        embeddingSchemaVersion: embeddingConfig.embeddingSchemaVersion,
        requests,
        generated,
        reused,
        missing: Math.max(0, plan.embeddingsToGenerate - generated),
        failed: failedEmbeddings,
        inputTokens,
        retries: null,
        credentialAvailable
      },
      warnings,
      errors,
      cancelled,
      artifactPaths: artifacts
    };

    await writeArtifacts(result);
    store.close();
    return result;
  }

  private buildAcquiredDocument(
    descriptor: SourceFileDescriptor,
    store: ReturnType<typeof createKnowledgeV2SqliteStore>
  ): { doc: AcquiredDocumentInput } | { failure: CorpusDocumentFailure } {
    const canonicalUrl = canonicalUrlForDescriptor(descriptor);
    if (descriptor.changeType === "added" || descriptor.changeType === "modified") {
      if (descriptor.contentStatus !== "available" || typeof descriptor.content !== "string") {
        return {
          failure: {
            sourcePath: descriptor.path,
            canonicalUrl,
            stage: "acquisition",
            message: "content_not_available_for_changed_document",
            lexicalReady: false,
            semanticReady: false
          }
        };
      }
      return {
        doc: toAcquiredDocument(descriptor, descriptor.content)
      };
    }

    const existing = store.findDocumentBySourceIdentity({
      sourceId: SOURCE_ID,
      trackId: TRACK_ID,
      transport: "github",
      canonicalUrl,
      sourcePath: descriptor.path
    });
    if (!existing) {
      return {
        failure: {
          sourcePath: descriptor.path,
          canonicalUrl,
          stage: "canonical_load",
          message: "unchanged_document_missing_from_store",
          lexicalReady: false,
          semanticReady: false
        }
      };
    }
    return {
      doc: {
        sourceId: SOURCE_ID,
        trackId: TRACK_ID,
        transport: "github",
        canonicalUrl,
        rawMarkdown: existing.rawMarkdown,
        revision: {
          transport: "github",
          repository: descriptor.repository,
          branch: descriptor.branch,
          commitSha: descriptor.commitSha,
          blobSha: descriptor.blobSha,
          path: descriptor.path
        }
      }
    };
  }

  private async planIndexing(params: {
    dbPath: string;
    parserVersion: string;
    chunkerVersion: string;
    docs: AcquiredDocumentInput[];
    signal?: AbortSignal;
  }): Promise<CorpusPlanEstimates> {
    const runtime = resolveEmbeddingRuntimeConfig();
    const fakeProvider = {
      providerId: "plan-only",
      async embedDocuments() {
        throw new Error("plan_mode_no_embedding_calls");
      },
      async embedQuery() {
        throw new Error("plan_mode_no_embedding_calls");
      }
    } as EmbeddingProvider;

    const job = new DocumentIndexingJob({
      storeDatabasePath: params.dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations"),
      parserVersion: params.parserVersion,
      chunkerVersion: params.chunkerVersion,
      embeddingIdentity: {
        providerId: "openai",
        model: runtime.model,
        dimensions: inferEmbeddingDimensions(runtime.model),
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      },
      embeddingBatchSize: runtime.maxBatchSize,
      embeddingProvider: fakeProvider
    });
    const planRun = await job.run({
      mode: "plan",
      acquiredDocuments: params.docs,
      signal: params.signal
    });
    const docsToParse = planRun.documents.filter((d) => d.parse.status !== "parse_reused").length;
    const docsReusable = planRun.documents.length - docsToParse;
    const estChunkCount = planRun.documents.reduce((sum, d) => sum + d.chunks.newCount, 0);
    const embeddingsToGenerate = planRun.documents.reduce(
      (sum, d) => sum + d.metrics.chunksToGenerateEmbeddings,
      0
    );
    const embeddingsReusable = planRun.documents.reduce(
      (sum, d) => sum + d.metrics.chunksReusedEmbeddings,
      0
    );
    const estimatedChars = planRun.documents.reduce(
      (sum, d) => sum + d.metrics.estimatedEmbeddingInputChars,
      0
    );
    const estimatedTokens = planRun.documents.reduce(
      (sum, d) => sum + d.metrics.estimatedEmbeddingInputTokens,
      0
    );
    const byType = { cmdlet: 0, conceptual: 0, other: 0 };
    for (const doc of params.docs) {
      const sourcePath = doc.revision.transport === "github" ? doc.revision.path : "";
      const subdomain = classifyEntraSubdomain(sourcePath);
      if (subdomain === "other") byType.other += 1;
      else byType.conceptual += 1;
    }
    return {
      documentsToParse: docsToParse,
      documentsReusable: docsReusable,
      estimatedChunkCount: estChunkCount,
      estimatedDocumentsByType: byType,
      embeddingsReusable: embeddingsReusable,
      embeddingsToGenerate,
      estimatedEmbeddingInputChars: estimatedChars,
      estimatedEmbeddingInputTokens: estimatedTokens,
      plannedEmbeddingRequestCount:
        runtime.maxBatchSize > 0 ? Math.ceil(embeddingsToGenerate / runtime.maxBatchSize) : 0
    };
  }
}

function canonicalUrlForDescriptor(descriptor: SourceFileDescriptor): string {
  return mapEntraRepoPathToLearnUrl(descriptor.path) ?? descriptor.githubUrl;
}

function toAcquiredDocument(descriptor: SourceFileDescriptor, content: string): AcquiredDocumentInput {
  return {
    sourceId: SOURCE_ID,
    trackId: TRACK_ID,
    transport: "github",
    canonicalUrl: canonicalUrlForDescriptor(descriptor),
    rawMarkdown: content,
    revision: {
      transport: "github",
      repository: descriptor.repository,
      branch: descriptor.branch,
      commitSha: descriptor.commitSha,
      blobSha: descriptor.blobSha,
      path: descriptor.path
    }
  };
}

function classifyFailureStage(result: IndexingDocumentResult): CorpusDocumentFailure["stage"] {
  if (result.parse.status === "parse_failed") return "parse";
  if (result.chunks.status === "chunks_failed") return "chunk_persist_fts";
  if (result.embeddings.status === "embedding_failed") return "embedding";
  return "unknown";
}

function summarizeExecution(
  indexed: IndexingDocumentResult[],
  failures: CorpusDocumentFailure[],
  cancelled: boolean
): CorpusExecutionSummary {
  return {
    attempted: indexed.length,
    succeeded: indexed.filter((d) => d.readiness !== "failed").length,
    failed: failures.length,
    cancelled,
    indexingLifecycleTotals: {
      parsed: indexed.filter((d) => d.parse.status !== "parse_reused").length,
      parseReused: indexed.filter((d) => d.parse.status === "parse_reused").length,
      parseFailed: indexed.filter((d) => d.parse.status === "parse_failed").length,
      chunked: indexed.filter((d) => d.chunks.status === "chunked").length,
      chunksReused: indexed.filter((d) => d.chunks.status === "chunks_reused").length,
      chunksFailed: indexed.filter((d) => d.chunks.status === "chunks_failed").length,
      embeddingGenerated: indexed.filter((d) => d.embeddings.status === "embedding_generated").length,
      embeddingReused: indexed.filter((d) => d.embeddings.status === "embedding_reused").length,
      embeddingPartial: indexed.filter((d) => d.embeddings.status === "embedding_partial").length,
      embeddingSkipped: indexed.filter((d) => d.embeddings.status === "embedding_skipped").length,
      embeddingFailed: indexed.filter((d) => d.embeddings.status === "embedding_failed").length,
      embeddingCancelled: indexed.filter((d) => d.embeddings.status === "embedding_cancelled").length
    }
  };
}

function inferEmbeddingDimensions(model: string): number {
  if (model === "text-embedding-3-large") return 3072;
  if (model === "text-embedding-3-small") return 1536;
  return Number(process.env["KNOWLEDGE_V2_EMBEDDING_DIMENSIONS"] || "1536");
}

function createHostedEmbeddingProviderOrThrow(): {
  provider: EmbeddingProvider;
  dimensions: number;
  credentialAvailable: boolean;
} {
  const runtime = resolveEmbeddingRuntimeConfig();
  const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
  const provider = new HostedOpenAiEmbeddingProvider({
    apiKey,
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion,
    maxBatchSize: runtime.maxBatchSize
  });
  return {
    provider,
    dimensions: inferEmbeddingDimensions(runtime.model),
    credentialAvailable: apiKey.length > 0
  };
}

function toTrackCheckpoint(payload: Record<string, unknown> | null): TrackCheckpoint | null {
  if (!payload) return null;
  if (
    typeof payload["commitSha"] === "string" &&
    typeof payload["sourceId"] === "string" &&
    typeof payload["trackId"] === "string" &&
    typeof payload["lastSyncedAt"] === "string" &&
    typeof payload["files"] === "object" &&
    payload["files"] !== null
  ) {
    return {
      sourceId: payload["sourceId"] as string,
      trackId: payload["trackId"] as string,
      commitSha: payload["commitSha"] as string,
      files: payload["files"] as Record<string, { blobSha: string }>,
      lastSyncedAt: payload["lastSyncedAt"] as string
    };
  }
  return null;
}

function buildArtifactPaths(baseDir: string, runId: string): CorpusRunArtifacts {
  return {
    jsonPath: join(baseDir, `${runId}.json`),
    jsonlPath: join(baseDir, `${runId}.jsonl`),
    markdownPath: join(baseDir, `${runId}.md`)
  };
}

async function writeArtifacts(result: EntraCorpusRunResult): Promise<void> {
  const artifact = {
    ...result,
    acquisitionResult: summarizeAcquisition(result.acquisitionResult)
  };
  await writeFile(result.artifactPaths.jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const jsonlLines = result.indexingDocuments.map((doc) =>
    JSON.stringify({
      runId: result.runId,
      sourceId: doc.sourceId,
      canonicalUrl: doc.canonicalUrl,
      parseStatus: doc.parse.status,
      chunkStatus: doc.chunks.status,
      embeddingStatus: doc.embeddings.status,
      readiness: doc.readiness,
      errors: doc.errors
    })
  );
  await writeFile(result.artifactPaths.jsonlPath, `${jsonlLines.join("\n")}\n`, "utf8");
  await writeFile(result.artifactPaths.markdownPath, renderMarkdownSummary(result), "utf8");
}

function summarizeAcquisition(result: EntraCorpusRunResult["acquisitionResult"]): Record<string, unknown> {
  const summarize = (items: SourceFileDescriptor[]) =>
    items.map((item) => ({
      path: item.path,
      changeType: item.changeType,
      blobSha: item.blobSha,
      commitSha: item.commitSha,
      githubUrl: item.githubUrl,
      contentStatus: item.contentStatus,
      contentChars: typeof item.content === "string" ? item.content.length : 0
    }));
  return {
    source: result.source,
    resolvedCommitSha: result.resolvedCommitSha,
    added: summarize(result.added),
    modified: summarize(result.modified),
    unchanged: summarize(result.unchanged).map((item) => ({ path: item.path, blobSha: item.blobSha })),
    deleted: summarize(result.deleted),
    skipped: result.skipped.map((item) => ({ path: item.path, skippedReason: item.skippedReason })),
    errors: result.errors
  };
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function computeCorpusStats(params: {
  store: ReturnType<typeof createKnowledgeV2SqliteStore>;
  providerId: string;
  model: string;
  dimensions: number;
  schema: string;
}): EntraCorpusStats {
  const docs = params.store.listDocumentsBySource({ sourceId: SOURCE_ID, trackId: TRACK_ID });
  const parseSuccess = docs.filter((d) => d.parseStatus === "success").length;
  const parseWarning = docs.filter((d) => d.parseStatus === "warning").length;
  const parseFailed = docs.filter((d) => d.parseStatus === "failed").length;
  const bySubdomain: Record<string, number> = {};
  for (const doc of docs) {
    const subdomain = classifyEntraSubdomain(doc.sourcePath);
    bySubdomain[subdomain] = (bySubdomain[subdomain] ?? 0) + 1;
  }

  const chunkKindDistribution: Record<string, number> = {};
  const chunksPerDoc: Array<{ documentId: string; sourcePath: string; count: number }> = [];
  const chunkSizes: number[] = [];
  const activeChunks: Array<{ chunkId: string; contentHash: string }> = [];
  let totalChunks = 0;
  let totalFtsRows = 0;
  for (const doc of docs) {
    const chunks = params.store.listChunksForDocument({ documentId: doc.documentId });
    const lifecycle = params.store.inspectChunkLifecycle({ documentId: doc.documentId });
    totalFtsRows += lifecycle.ftsRowCount;
    totalChunks += chunks.length;
    chunksPerDoc.push({ documentId: doc.documentId, sourcePath: doc.sourcePath, count: chunks.length });
    for (const chunk of chunks) {
      activeChunks.push({ chunkId: chunk.chunkId, contentHash: chunk.contentHash });
      chunkKindDistribution[chunk.chunkKind] = (chunkKindDistribution[chunk.chunkKind] ?? 0) + 1;
      chunkSizes.push(chunk.retrievalText.length);
    }
  }
  const embeddings = params.store.listChunkEmbeddings();
  const byChunk = new Map<string, typeof embeddings>();
  for (const embedding of embeddings) {
    const current = byChunk.get(embedding.chunkId) ?? [];
    current.push(embedding);
    byChunk.set(embedding.chunkId, current);
  }
  let compatible = 0;
  let missing = 0;
  let stale = 0;
  for (const chunk of activeChunks) {
    const candidates = byChunk.get(chunk.chunkId) ?? [];
    if (candidates.length === 0) {
      missing += 1;
      continue;
    }
    const hasCompatible = candidates.some(
      (embedding) =>
        embedding.providerId === params.providerId &&
        embedding.model === params.model &&
        embedding.dimensions === params.dimensions &&
        embedding.embeddingSchemaVersion === params.schema &&
        embedding.inputContentHash === chunk.contentHash
    );
    if (hasCompatible) compatible += 1;
    else stale += 1;
  }

  const countsOnly = chunksPerDoc.map((d) => d.count);
  const avg = countsOnly.length > 0 ? totalChunks / countsOnly.length : 0;
  const median = percentile(countsOnly, 50);
  const largest = [...chunksPerDoc].sort((a, b) => b.count - a.count).slice(0, 5);
  const semanticPct = activeChunks.length > 0 ? (compatible / activeChunks.length) * 100 : 0;

  return {
    documents: {
      totalCanonical: docs.length,
      parseSuccess,
      parseWarning,
      parseFailed,
      bySubdomain
    },
    chunks: {
      totalActive: totalChunks,
      chunkKindDistribution,
      averageChunksPerDocument: Number(avg.toFixed(2)),
      medianChunksPerDocument: Number(median.toFixed(2)),
      largestChunkProducingDocuments: largest.map((entry) => ({
        documentId: entry.documentId,
        sourcePath: entry.sourcePath,
        chunkCount: entry.count
      })),
      chunkTextSizeSummary: {
        min: chunkSizes.length > 0 ? Math.min(...chunkSizes) : 0,
        p50: percentile(chunkSizes, 50),
        p95: percentile(chunkSizes, 95),
        max: chunkSizes.length > 0 ? Math.max(...chunkSizes) : 0
      }
    },
    fts: {
      indexedActiveRows: totalFtsRows,
      activeChunkCount: totalChunks,
      consistent: totalFtsRows === totalChunks
    },
    embeddings: {
      totalActiveChunks: activeChunks.length,
      currentCompatibleEmbeddings: compatible,
      missingEmbeddings: missing,
      staleOrIncompatibleEmbeddings: stale,
      semanticReadyPercentage: Number(semanticPct.toFixed(2)),
      providerId: params.providerId,
      model: params.model,
      dimensions: params.dimensions,
      embeddingSchemaVersion: params.schema
    }
  };
}

async function runRetrievalSmokes(params: {
  dbPath: string;
  provider: EmbeddingProvider;
  embeddingModel: string;
  embeddingSchemaVersion: string;
  semanticEnabled: boolean;
}): Promise<{
  conditionalAccessMfa: RetrievalSmokeCaseResult | null;
  appRegistration: RetrievalSmokeCaseResult | null;
  sharePointNegativeControl: RetrievalSmokeCaseResult | null;
}> {
  return {
    conditionalAccessMfa: await runSmokeCase({
      question: "How would I configure a Conditional Access policy to require MFA for all admin roles?",
      ...params
    }),
    appRegistration: await runSmokeCase({
      question: "How do I register an application in Entra and grant it API permissions?",
      ...params
    }),
    sharePointNegativeControl: await runSmokeCase({
      question:
        "How would you secure SharePoint data so it is not accessible by all Copilot users?",
      ...params
    })
  };
}

async function runSmokeCase(params: {
  question: string;
  dbPath: string;
  provider: EmbeddingProvider;
  embeddingModel: string;
  embeddingSchemaVersion: string;
  semanticEnabled: boolean;
}): Promise<RetrievalSmokeCaseResult> {
  const intent = extractQueryIntent(params.question).intent;
  const scope = routeQueryIntent(intent).scope;
  const exact = retrieveExactMatches({ databasePath: params.dbPath, scope });
  const lexical = retrieveLexicalCandidates({ databasePath: params.dbPath, scope });

  let semanticCount: number | null = null;
  let hybridCount: number | null = null;
  let semanticTop: string | null = null;
  let hybridTop: string | null = null;
  let semanticLatency: number | null = null;
  let hybridLatency: number | null = null;
  const warnings: string[] = [];
  if (params.semanticEnabled) {
    try {
      const semantic = await retrieveSemanticCandidates({
        databasePath: params.dbPath,
        scope,
        embeddingProvider: params.provider,
        embeddingRuntimeConfig: {
          model: params.embeddingModel,
          embeddingSchemaVersion: params.embeddingSchemaVersion
        }
      });
      semanticCount = semantic.candidates.length;
      semanticTop = semantic.candidates[0]?.authority.sourceId ?? null;
      semanticLatency = semantic.diagnostics.latencyMs.total;

      const hybrid = await retrieveHybridCandidates({
        databasePath: params.dbPath,
        scope,
        embeddingProvider: params.provider,
        embeddingRuntimeConfig: {
          model: params.embeddingModel,
          embeddingSchemaVersion: params.embeddingSchemaVersion
        }
      });
      hybridCount = hybrid.candidates.length;
      hybridTop = hybrid.candidates[0]?.authority.sourceId ?? null;
      hybridLatency = hybrid.diagnostics.totalLatencyMs;
      warnings.push(...hybrid.warnings);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "semantic_or_hybrid_failed");
    }
  } else {
    warnings.push("semantic_smoke_skipped_missing_hosted_embedding_credentials");
  }
  return {
    question: params.question,
    route: {
      selectedDomains: scope.selectedDomains,
      eligibleSources: scope.eligibleSources.map((source) => ({
        sourceId: source.sourceId,
        trackIds: source.eligibleTrackIds
      }))
    },
    exactCandidateCount: exact.candidates.length,
    lexicalCandidateCount: lexical.candidates.length,
    semanticCandidateCount: semanticCount,
    hybridCandidateCount: hybridCount,
    topExactSourceId: exact.candidates[0]?.authority.sourceId ?? null,
    topLexicalSourceId: lexical.candidates[0]?.authority.sourceId ?? null,
    topSemanticSourceId: semanticTop,
    topHybridSourceId: hybridTop,
    semanticLatencyMs: semanticLatency,
    hybridLatencyMs: hybridLatency,
    warnings
  };
}

function renderMarkdownSummary(result: EntraCorpusRunResult): string {
  const lines: string[] = [];
  lines.push(`# K1 Entra Run ${result.runId}`);
  lines.push("");
  lines.push(`- Mode: ${result.mode}`);
  lines.push(`- Corpus classification: ${result.corpusClassification}`);
  lines.push(`- Database: \`${result.databasePath}\``);
  lines.push(`- Source revision: ${result.source.resolvedCommitSha ?? "unknown"}`);
  lines.push(`- Eligible files: ${result.source.eligibleFileCount}`);
  lines.push(`- Include globs: ${result.source.includeGlobs.join(", ")}`);
  lines.push(
    `- Acquisition counts: added=${result.source.counts.added} modified=${result.source.counts.modified} unchanged=${result.source.counts.unchanged} deleted=${result.source.counts.deleted}`
  );
  lines.push(
    `- Plan: parse=${result.plan.documentsToParse} reusable=${result.plan.documentsReusable} estChunks=${result.plan.estimatedChunkCount} estEmbeddingsToGenerate=${result.plan.embeddingsToGenerate}`
  );
  if (result.execution) {
    lines.push(
      `- Execute: attempted=${result.execution.attempted} succeeded=${result.execution.succeeded} failed=${result.execution.failed} cancelled=${result.execution.cancelled}`
    );
  }
  lines.push(
    `- Embedding usage: provider=${result.embeddingUsage.providerId} model=${result.embeddingUsage.model} requests=${result.embeddingUsage.requests} generated=${result.embeddingUsage.generated} reused=${result.embeddingUsage.reused} tokens=${result.embeddingUsage.inputTokens}`
  );
  if (result.corpusStats) {
    lines.push(
      `- Corpus docs/chunks: docs=${result.corpusStats.documents.totalCanonical} chunks=${result.corpusStats.chunks.totalActive} semanticReady=${result.corpusStats.embeddings.semanticReadyPercentage}%`
    );
    lines.push(
      `- Subdomains: ${Object.entries(result.corpusStats.documents.bySubdomain)
        .map(([name, count]) => `${name}=${count}`)
        .join(", ")}`
    );
  }
  if (result.failures.length > 0) {
    lines.push("");
    lines.push("## Failures");
    for (const failure of result.failures.slice(0, 50)) {
      lines.push(`- ${failure.stage} :: ${failure.sourcePath} :: ${failure.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
