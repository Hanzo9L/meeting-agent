import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildLearnMcpClient,
  createKnowledgeV2SqliteStore,
  DocumentIndexingJob,
  getSourceById,
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath,
  selectToolName,
  type AcquiredDocumentInput,
  type EmbeddingProvider,
  type IndexingDocumentResult
} from "../index";
import { extractQueryIntent } from "../../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../retrievalV2/domainPolicies";
import { retrieveExactMatches } from "../../retrievalV2/exactMatchRetriever";
import { retrieveLexicalCandidates } from "../../retrievalV2/lexicalRetriever";
import { retrieveSemanticCandidates } from "../../retrievalV2/semanticRetriever";
import { retrieveHybridCandidates } from "../../retrievalV2/hybridRetriever";
import { normalizeLearnUrl } from "../discovery/urlNormalization";
import type { ParseLifecycleStatus } from "../indexing/types";

const SOURCE_ID = "ms-teams-admin";
const TRACK_ID = "ga";
const DEFAULT_ARTIFACTS_DIR = "eval/runs/indexing";
const DEFAULT_APPROVED_MANIFEST = "eval/runs/discovery/cg01e1h-2026-08-07T19-25-19-681Z.json";

type CorpusJobMode = "plan" | "execute";

type FinalManifestEntry = {
  entryId: string;
  canonicalUrl: string;
  articlePath: string;
  title: string | null;
  taxonomyDomains: string[];
  humanApproval: {
    include: boolean;
    reasons: string[];
    notes: string[];
  };
  classification: {
    baseOriginalStatus: string | null;
    baseSanitizedStatus: string | null;
    targetedStatus: string | null;
    baseOriginalReasonCodes: string[];
    baseSanitizedReasonCodes: string[];
    targetedStatuses: string[];
    targetedReasonCodes: string[];
  };
  discoveryQueryIds: string[];
  discoveryRunIds: string[];
  discoveryTopics: string[];
};

type FinalManifest = {
  runId: string;
  environmentProfileHint?: {
    targetPstnModel?: string;
  };
  entries: FinalManifestEntry[];
};

type FetchFailure = {
  entryId: string;
  canonicalUrl: string;
  stage: "fetch";
  message: string;
  retryCount: number;
  retryable: boolean;
};

type StageFailure = {
  entryId: string;
  canonicalUrl: string;
  stage:
    | "fetch"
    | "parse"
    | "document_persist"
    | "chunking"
    | "chunk_persist_fts"
    | "embedding"
    | "unknown";
  message: string;
  retryCount: number;
  retryable: boolean;
  lexicalReady: boolean;
  semanticReady: boolean;
};

type SmokeQueryResult = {
  question: string;
  intent: ReturnType<typeof extractQueryIntent>["intent"];
  route: ReturnType<typeof routeQueryIntent>["scope"];
  exact: {
    count: number;
    top: Array<{
      sourceId: string;
      canonicalUrl: string;
      title: string;
      method: string;
      reasons: string[];
      exactMatch: string | null;
    }>;
    latencyMs: number;
  };
  lexical: {
    count: number;
    top: Array<{
      sourceId: string;
      canonicalUrl: string;
      title: string;
      method: string;
      lexicalScore: number | null;
    }>;
    latencyMs: number;
  };
  semantic: {
    count: number | null;
    top: Array<{
      sourceId: string;
      canonicalUrl: string;
      title: string;
      method: string;
      semanticScore: number | null;
    }>;
    latencyMs: number | null;
    warnings: string[];
  };
  hybrid: {
    count: number | null;
    top: Array<{
      sourceId: string;
      canonicalUrl: string;
      title: string;
      methods: string[];
      fusionScore: number;
      reasons: string[];
    }>;
    latencyMs: number | null;
    warnings: string[];
  };
};

type TeamsAdminCorpusRunResult = {
  runId: string;
  mode: CorpusJobMode;
  approvedManifestPath: string;
  approvedManifestRunId: string;
  approvedArticleCount: number;
  databasePath: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  environmentHint: {
    pstnModel: string | null;
  };
  powerShellSafety: {
    before: { documents: number; activeChunks: number; embeddings: number };
    after: { documents: number; activeChunks: number; embeddings: number };
    unchanged: boolean;
  };
  plan: {
    approvedCanonicalUrls: string[];
    fetchAttempted: number;
    fetchableCount: number;
    unavailableCount: number;
    alreadyPresentReusableCount: number;
    documentsRequiringParseCount: number;
    estimatedChunkCount: number;
    embeddingsReusable: number;
    embeddingsToGenerate: number;
    estimatedEmbeddingInputChars: number;
    estimatedEmbeddingInputTokens: number;
    plannedEmbeddingRequestCount: number;
    existingCounts: {
      teamsAdminDocuments: number;
      teamsAdminActiveChunks: number;
      teamsAdminEmbeddings: number;
      powerShellDocuments: number;
      powerShellActiveChunks: number;
      powerShellEmbeddings: number;
    };
    embeddingRuntime: {
      providerId: string;
      model: string;
      dimensions: number;
      embeddingSchemaVersion: string;
      credentialAvailable: boolean;
    };
  };
  fetch: {
    attempted: number;
    fetched: number;
    failed: number;
  };
  parse: {
    success: number;
    warning: number;
    failed: number;
  };
  documents: {
    inserted: number;
    updated: number;
    reused: number;
  };
  chunks: {
    activeTotal: number;
    inserted: number;
    updated: number;
    reused: number;
    tombstoned: number;
    chunkKindDistribution: Record<string, number>;
    averagePerDocument: number;
    medianPerDocument: number;
    largestDocuments: Array<{ sourcePath: string; chunkCount: number }>;
  };
  fts: {
    rowCount: number;
    consistentWithActiveChunks: boolean;
  };
  embeddings: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
    generated: number;
    reused: number;
    missingOrFailed: number;
    requestCount: number;
    inputTokens: number;
    semanticReadyChunks: number;
    semanticReadinessPercent: number;
  };
  lifecycleTotals: {
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
  failures: StageFailure[];
  failureManifestPath: string;
  smoke: {
    queries: SmokeQueryResult[];
  } | null;
  artifactPaths: {
    jsonPath: string;
    jsonlPath: string;
    markdownPath: string;
  };
};

type FetchClient = {
  initialize: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string }>>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

type TeamsAdminCorpusJobDeps = {
  fetchClientFactory?: (endpoint: string) => FetchClient;
  createEmbeddingProvider?: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
    providerId: string;
  };
};

export class TeamsAdminCorpusJob {
  private readonly fetchClientFactory: (endpoint: string) => FetchClient;
  private readonly createEmbeddingProvider: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
    providerId: string;
  };

  constructor(deps: TeamsAdminCorpusJobDeps = {}) {
    this.fetchClientFactory = deps.fetchClientFactory ?? ((endpoint) => buildLearnMcpClient(endpoint));
    this.createEmbeddingProvider = deps.createEmbeddingProvider ?? createHostedEmbeddingProviderOrThrow;
  }

  async run(request: {
    mode: CorpusJobMode;
    approvedManifestPath?: string;
    dbPath?: string;
    artifactsDir?: string;
    parserVersion: string;
    chunkerVersion: string;
    signal?: AbortSignal;
  }): Promise<TeamsAdminCorpusRunResult> {
    const source = getSourceById(SOURCE_ID);
    if (!source || source.acquisition.transport !== "learn_mcp") {
      throw new Error("ms-teams-admin source must exist with learn_mcp transport.");
    }
    const approvedManifestPath = request.approvedManifestPath ?? DEFAULT_APPROVED_MANIFEST;
    const manifest = await loadManifest(approvedManifestPath);
    const approvedEntries = dedupeEntries(
      manifest.entries.filter((entry) => entry.humanApproval?.include === true)
    );
    const dbPath = resolve(request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() }));
    const artifactsDir = resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR);
    const startedAt = new Date();
    const runId = `cg01e2-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
    const artifactPaths = {
      jsonPath: join(artifactsDir, `${runId}.json`),
      jsonlPath: join(artifactsDir, `${runId}.jsonl`),
      markdownPath: join(artifactsDir, `${runId}.md`)
    };
    const failureManifestPath = join(artifactsDir, `${runId}.failures.json`);
    await mkdir(dirname(artifactPaths.jsonPath), { recursive: true });
    const started = performance.now();

    const runtime = resolveEmbeddingRuntimeConfig();
    const embeddingRuntime = this.createEmbeddingProvider();
    const store = createKnowledgeV2SqliteStore({
      databasePath: dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
    });
    store.initializeDatabase();
    const powerShellBefore = computePowerShellSafetyCounts(store);
    const existingTeamsAdminDocs = store.listDocumentsBySource({ sourceId: SOURCE_ID, trackId: TRACK_ID });
    const existingTeamsAdminChunks = countChunksForDocs(store, existingTeamsAdminDocs.map((doc) => doc.documentId));
    const existingTeamsAdminChunkIds = new Set(existingTeamsAdminChunks.map((chunk) => chunk.chunkId));
    const existingTeamsAdminEmbeddings = store
      .listChunkEmbeddings()
      .filter((row) => existingTeamsAdminChunkIds.has(row.chunkId)).length;

    const fetchClient = this.fetchClientFactory(source.acquisition.endpoint);
    await fetchClient.initialize();
    const tools = await fetchClient.listTools();
    const fetchTool = selectToolName(
      tools.map((tool) => ({ name: tool.name })),
      (name) => name.includes("fetch")
    );

    const fetchedByUrl = new Map<string, AcquiredDocumentInput>();
    const fetchFailures: FetchFailure[] = [];
    for (const entry of approvedEntries) {
      if (request.signal?.aborted) break;
      const fetched = await fetchLearnDocument({
        entry,
        fetchClient,
        fetchTool,
        signal: request.signal
      });
      if ("failure" in fetched) {
        fetchFailures.push(fetched.failure);
        continue;
      }
      fetchedByUrl.set(entry.canonicalUrl, fetched.document);
    }

    const planPreviewDocs = [...fetchedByUrl.values()];
    const planJob = new DocumentIndexingJob({
      storeDatabasePath: dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations"),
      parserVersion: request.parserVersion,
      chunkerVersion: request.chunkerVersion,
      embeddingIdentity: {
        providerId: embeddingRuntime.providerId,
        model: runtime.model,
        dimensions: embeddingRuntime.dimensions,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      },
      embeddingBatchSize: runtime.maxBatchSize,
      embeddingProvider: {
        providerId: "plan-only",
        async embedDocuments() {
          throw new Error("plan_mode_no_embedding_calls");
        },
        async embedQuery() {
          throw new Error("plan_mode_no_embedding_calls");
        }
      }
    });
    const planRun = await planJob.run({
      mode: "plan",
      acquiredDocuments: planPreviewDocs,
      signal: request.signal
    });

    const parseReusableStatuses: ParseLifecycleStatus[] = ["parse_reused"];
    const fetchableCount = fetchedByUrl.size;
    const unavailableCount = fetchFailures.length;
    const docsToParse = planRun.documents.filter(
      (doc) => !parseReusableStatuses.includes(doc.parse.status)
    ).length;
    const docsReusable = planRun.documents.length - docsToParse;
    const estimatedChunkCount = planRun.documents.reduce((sum, doc) => sum + doc.chunks.newCount, 0);
    const embeddingsReusable = planRun.documents.reduce(
      (sum, doc) => sum + doc.metrics.chunksReusedEmbeddings,
      0
    );
    const embeddingsToGenerateRaw = planRun.documents.reduce(
      (sum, doc) => sum + doc.metrics.chunksToGenerateEmbeddings,
      0
    );
    const embeddingsToGenerate =
      embeddingsToGenerateRaw > 0 ? embeddingsToGenerateRaw : estimatedChunkCount;
    const estimatedEmbeddingInputCharsRaw = planRun.documents.reduce(
      (sum, doc) => sum + doc.metrics.estimatedEmbeddingInputChars,
      0
    );
    const estimatedEmbeddingInputTokensRaw = planRun.documents.reduce(
      (sum, doc) => sum + doc.metrics.estimatedEmbeddingInputTokens,
      0
    );
    const fallbackEmbeddingChars = planPreviewDocs.reduce(
      (sum, doc) => sum + doc.rawMarkdown.length,
      0
    );
    const estimatedEmbeddingInputChars =
      estimatedEmbeddingInputCharsRaw > 0 ? estimatedEmbeddingInputCharsRaw : fallbackEmbeddingChars;
    const estimatedEmbeddingInputTokens =
      estimatedEmbeddingInputTokensRaw > 0
        ? estimatedEmbeddingInputTokensRaw
        : Math.ceil(estimatedEmbeddingInputChars / 4);
    const plannedEmbeddingRequestCount =
      runtime.maxBatchSize > 0 ? Math.ceil(embeddingsToGenerate / runtime.maxBatchSize) : 0;

    const plan = {
      approvedCanonicalUrls: approvedEntries.map((entry) => entry.canonicalUrl),
      fetchAttempted: approvedEntries.length,
      fetchableCount,
      unavailableCount,
      alreadyPresentReusableCount: docsReusable,
      documentsRequiringParseCount: docsToParse,
      estimatedChunkCount,
      embeddingsReusable,
      embeddingsToGenerate,
      estimatedEmbeddingInputChars,
      estimatedEmbeddingInputTokens,
      plannedEmbeddingRequestCount,
      existingCounts: {
        teamsAdminDocuments: existingTeamsAdminDocs.length,
        teamsAdminActiveChunks: existingTeamsAdminChunks.length,
        teamsAdminEmbeddings: existingTeamsAdminEmbeddings,
        powerShellDocuments: powerShellBefore.documents,
        powerShellActiveChunks: powerShellBefore.activeChunks,
        powerShellEmbeddings: powerShellBefore.embeddings
      },
      embeddingRuntime: {
        providerId: embeddingRuntime.providerId,
        model: runtime.model,
        dimensions: embeddingRuntime.dimensions,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion,
        credentialAvailable: embeddingRuntime.credentialAvailable
      }
    };

    const indexedDocuments: IndexingDocumentResult[] = [];
    const stageFailures: StageFailure[] = fetchFailures.map((failure) => ({
      entryId: failure.entryId,
      canonicalUrl: failure.canonicalUrl,
      stage: "fetch",
      message: failure.message,
      retryCount: failure.retryCount,
      retryable: failure.retryable,
      lexicalReady: false,
      semanticReady: false
    }));
    if (request.mode === "execute") {
      for (const entry of approvedEntries) {
        if (request.signal?.aborted) break;
        const acquired = fetchedByUrl.get(entry.canonicalUrl);
        if (!acquired) continue;
        const docJob = new DocumentIndexingJob({
          storeDatabasePath: dbPath,
          migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations"),
          parserVersion: request.parserVersion,
          chunkerVersion: request.chunkerVersion,
          embeddingIdentity: {
            providerId: embeddingRuntime.provider.providerId,
            model: runtime.model,
            dimensions: embeddingRuntime.dimensions,
            embeddingSchemaVersion: runtime.embeddingSchemaVersion
          },
          embeddingBatchSize: runtime.maxBatchSize,
          skipEmbeddingGeneration: !embeddingRuntime.credentialAvailable,
          embeddingProvider: embeddingRuntime.provider
        });
        const run = await docJob.run({
          mode: "execute",
          acquiredDocuments: [acquired],
          signal: request.signal
        });
        const indexed = run.documents[0];
        if (!indexed) continue;
        indexedDocuments.push(indexed);
        if (indexed.readiness === "failed" || indexed.errors.length > 0) {
          stageFailures.push({
            entryId: entry.entryId,
            canonicalUrl: entry.canonicalUrl,
            stage: classifyFailureStage(indexed),
            message: indexed.errors.join("; ") || "indexing_failed",
            retryCount: 0,
            retryable: false,
            lexicalReady: indexed.readiness !== "failed",
            semanticReady: indexed.readiness === "semantic_ready"
          });
        }
      }
    }

    const teamsAdminDocs = store.listDocumentsBySource({ sourceId: SOURCE_ID, trackId: TRACK_ID });
    const teamsAdminChunks = countChunksForDocs(store, teamsAdminDocs.map((doc) => doc.documentId));
    const chunkDistribution = chunkKindDistribution(teamsAdminChunks);
    const chunkStats = chunkSummary(teamsAdminDocs, teamsAdminChunks);
    const teamsAdminChunkIds = new Set(teamsAdminChunks.map((chunk) => chunk.chunkId));
    const teamsAdminEmbeddings = store
      .listChunkEmbeddings()
      .filter((row) => teamsAdminChunkIds.has(row.chunkId));
    const compatibleEmbeddings = teamsAdminEmbeddings.filter(
      (row) =>
        row.providerId === embeddingRuntime.provider.providerId &&
        row.model === runtime.model &&
        row.dimensions === embeddingRuntime.dimensions &&
        row.embeddingSchemaVersion === runtime.embeddingSchemaVersion
    ).length;
    const semanticReadyPct =
      teamsAdminChunks.length > 0 ? (compatibleEmbeddings / teamsAdminChunks.length) * 100 : 0;

    const parse = {
      success: teamsAdminDocs.filter((doc) => doc.parseStatus === "success").length,
      warning: teamsAdminDocs.filter((doc) => doc.parseStatus === "warning").length,
      failed: teamsAdminDocs.filter((doc) => doc.parseStatus === "failed").length
    };
    const documents = {
      inserted: indexedDocuments.filter((doc) => doc.document.status === "inserted").length,
      updated: indexedDocuments.filter((doc) => doc.document.status === "updated").length,
      reused: indexedDocuments.filter((doc) => doc.document.status === "reused").length
    };
    const chunks = {
      activeTotal: teamsAdminChunks.length,
      inserted: indexedDocuments.reduce((sum, doc) => sum + doc.chunks.inserted, 0),
      updated: indexedDocuments.reduce((sum, doc) => sum + doc.chunks.updated, 0),
      reused: indexedDocuments.reduce((sum, doc) => sum + doc.chunks.reused, 0),
      tombstoned: indexedDocuments.reduce((sum, doc) => sum + doc.chunks.tombstoned, 0),
      chunkKindDistribution: chunkDistribution,
      averagePerDocument: chunkStats.averagePerDocument,
      medianPerDocument: chunkStats.medianPerDocument,
      largestDocuments: chunkStats.largestDocuments
    };
    const ftsRowCount = teamsAdminDocs.reduce((sum, doc) => {
      const lifecycle = store.inspectChunkLifecycle({ documentId: doc.documentId });
      return sum + lifecycle.ftsRowCount;
    }, 0);
    const fts = {
      rowCount: ftsRowCount,
      consistentWithActiveChunks: ftsRowCount === teamsAdminChunks.length
    };

    const generated = indexedDocuments.reduce((sum, doc) => sum + doc.embeddings.generatedCount, 0);
    const reused = indexedDocuments.reduce((sum, doc) => sum + doc.embeddings.reusedCount, 0);
    const failedEmbedding = indexedDocuments.reduce((sum, doc) => sum + doc.embeddings.failedCount, 0);
    const providerRequests = indexedDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.providerRequestCount,
      0
    );
    const providerInputTokens = indexedDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.providerInputTokens,
      0
    );
    const embeddings = {
      providerId: embeddingRuntime.provider.providerId,
      model: runtime.model,
      dimensions: embeddingRuntime.dimensions,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion,
      generated,
      reused,
      missingOrFailed: Math.max(0, teamsAdminChunks.length - compatibleEmbeddings) + failedEmbedding,
      requestCount: providerRequests,
      inputTokens: providerInputTokens,
      semanticReadyChunks: compatibleEmbeddings,
      semanticReadinessPercent: Number(semanticReadyPct.toFixed(2))
    };
    const lifecycleTotals = {
      parsed: indexedDocuments.filter((doc) => doc.parse.status !== "parse_reused").length,
      parseReused: indexedDocuments.filter((doc) => doc.parse.status === "parse_reused").length,
      parseFailed: indexedDocuments.filter((doc) => doc.parse.status === "parse_failed").length,
      chunked: indexedDocuments.filter((doc) => doc.chunks.status === "chunked").length,
      chunksReused: indexedDocuments.filter((doc) => doc.chunks.status === "chunks_reused").length,
      chunksFailed: indexedDocuments.filter((doc) => doc.chunks.status === "chunks_failed").length,
      embeddingGenerated: indexedDocuments.filter((doc) => doc.embeddings.status === "embedding_generated")
        .length,
      embeddingReused: indexedDocuments.filter((doc) => doc.embeddings.status === "embedding_reused").length,
      embeddingPartial: indexedDocuments.filter((doc) => doc.embeddings.status === "embedding_partial")
        .length,
      embeddingSkipped: indexedDocuments.filter((doc) => doc.embeddings.status === "embedding_skipped")
        .length,
      embeddingFailed: indexedDocuments.filter((doc) => doc.embeddings.status === "embedding_failed").length,
      embeddingCancelled: indexedDocuments.filter((doc) => doc.embeddings.status === "embedding_cancelled")
        .length
    };

    const smoke =
      request.mode === "execute"
        ? {
            queries: await runRetrievalSmokes({
              databasePath: dbPath,
              provider: embeddingRuntime.provider,
              model: runtime.model,
              embeddingSchemaVersion: runtime.embeddingSchemaVersion,
              semanticEnabled: embeddingRuntime.credentialAvailable
            })
          }
        : null;

    const powerShellAfter = computePowerShellSafetyCounts(store);
    const powerShellUnchanged =
      powerShellBefore.documents === powerShellAfter.documents &&
      powerShellBefore.activeChunks === powerShellAfter.activeChunks &&
      powerShellBefore.embeddings === powerShellAfter.embeddings;
    store.close();

    const result: TeamsAdminCorpusRunResult = {
      runId,
      mode: request.mode,
      approvedManifestPath,
      approvedManifestRunId: manifest.runId,
      approvedArticleCount: approvedEntries.length,
      databasePath: dbPath,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      environmentHint: {
        pstnModel: manifest.environmentProfileHint?.targetPstnModel ?? null
      },
      powerShellSafety: {
        before: powerShellBefore,
        after: powerShellAfter,
        unchanged: powerShellUnchanged
      },
      plan,
      fetch: {
        attempted: approvedEntries.length,
        fetched: fetchableCount,
        failed: unavailableCount
      },
      parse,
      documents,
      chunks,
      fts,
      embeddings,
      lifecycleTotals,
      failures: stageFailures,
      failureManifestPath,
      smoke,
      artifactPaths
    };
    await writeFile(failureManifestPath, `${JSON.stringify(stageFailures, null, 2)}\n`, "utf8");
    await writeArtifacts(result);
    return result;
  }
}

async function fetchLearnDocument(params: {
  entry: FinalManifestEntry;
  fetchClient: FetchClient;
  fetchTool: string;
  signal?: AbortSignal;
}): Promise<{ document: AcquiredDocumentInput } | { failure: FetchFailure }> {
  const maxAttempts = 2;
  let lastError = "fetch_failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (params.signal?.aborted) break;
    try {
      const payload = await params.fetchClient.callTool(params.fetchTool, {
        url: params.entry.canonicalUrl
      });
      const markdown = extractMarkdown(payload);
      const normalized = normalizeLearnUrl(params.entry.canonicalUrl);
      if (!normalized) throw new Error("invalid_manifest_canonical_url");
      const retrievedAt = new Date().toISOString();
      return {
        document: {
          sourceId: SOURCE_ID,
          trackId: TRACK_ID,
          transport: "learn_mcp",
          canonicalUrl: normalized.canonicalUrl,
          rawMarkdown: markdown,
          revision: {
            transport: "learn_mcp",
            canonicalUrl: normalized.canonicalUrl,
            locale: normalized.locale ?? "en-us",
            retrievedAt,
            contentHash: sha256(markdown),
            sourcePath: normalized.articlePath.replace(/^\/+/, "")
          }
        }
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "fetch_failed";
      const retryable = /network|timeout|temporar|503|429/i.test(lastError);
      if (!retryable || attempt >= maxAttempts) {
        return {
          failure: {
            entryId: params.entry.entryId,
            canonicalUrl: params.entry.canonicalUrl,
            stage: "fetch",
            message: lastError,
            retryCount: attempt - 1,
            retryable
          }
        };
      }
    }
  }
  return {
    failure: {
      entryId: params.entry.entryId,
      canonicalUrl: params.entry.canonicalUrl,
      stage: "fetch",
      message: lastError,
      retryCount: maxAttempts - 1,
      retryable: false
    }
  };
}

function extractMarkdown(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) {
    const textParts = payload
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const asRecord = item as Record<string, unknown>;
          if (typeof asRecord["text"] === "string") return asRecord["text"];
          if (typeof asRecord["markdown"] === "string") return asRecord["markdown"];
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (textParts.length > 0) return textParts.join("\n\n");
  }
  if (typeof payload === "object" && payload !== null) {
    const asRecord = payload as Record<string, unknown>;
    if (typeof asRecord["markdown"] === "string") return asRecord["markdown"];
    if (typeof asRecord["text"] === "string") return asRecord["text"];
    if (Array.isArray(asRecord["content"])) {
      const content = asRecord["content"] as unknown[];
      const textParts = content
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            const rec = item as Record<string, unknown>;
            if (typeof rec["text"] === "string") return rec["text"];
          }
          return null;
        })
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      if (textParts.length > 0) return textParts.join("\n\n");
    }
  }
  return JSON.stringify(payload, null, 2);
}

async function loadManifest(pathLike: string): Promise<FinalManifest> {
  const raw = await readFile(resolve(pathLike), "utf8");
  const parsed = JSON.parse(raw) as FinalManifest;
  if (!parsed.entries || !Array.isArray(parsed.entries)) {
    throw new Error("approved_manifest_missing_entries");
  }
  return parsed;
}

function dedupeEntries(entries: FinalManifestEntry[]): FinalManifestEntry[] {
  const byUrl = new Map<string, FinalManifestEntry>();
  for (const entry of entries) {
    const normalized = normalizeLearnUrl(entry.canonicalUrl);
    if (!normalized) continue;
    const existing = byUrl.get(normalized.canonicalUrl);
    if (!existing) {
      byUrl.set(normalized.canonicalUrl, {
        ...entry,
        canonicalUrl: normalized.canonicalUrl,
        articlePath: normalized.articlePath
      });
      continue;
    }
    existing.taxonomyDomains = [...new Set([...existing.taxonomyDomains, ...entry.taxonomyDomains])];
    existing.discoveryQueryIds = [...new Set([...existing.discoveryQueryIds, ...entry.discoveryQueryIds])];
    existing.discoveryRunIds = [...new Set([...existing.discoveryRunIds, ...entry.discoveryRunIds])];
    existing.discoveryTopics = [...new Set([...existing.discoveryTopics, ...entry.discoveryTopics])];
    existing.humanApproval.reasons = [
      ...new Set([...existing.humanApproval.reasons, ...entry.humanApproval.reasons])
    ];
    existing.humanApproval.notes = [
      ...new Set([...existing.humanApproval.notes, ...entry.humanApproval.notes])
    ];
  }
  return [...byUrl.values()].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function countChunksForDocs(
  store: ReturnType<typeof createKnowledgeV2SqliteStore>,
  documentIds: string[]
): Array<{ documentId: string; chunkId: string; chunkKind: string }> {
  const chunks: Array<{ documentId: string; chunkId: string; chunkKind: string }> = [];
  for (const documentId of documentIds) {
    const rows = store.listChunksForDocument({ documentId });
    for (const row of rows) {
      chunks.push({
        documentId,
        chunkId: row.chunkId,
        chunkKind: row.chunkKind
      });
    }
  }
  return chunks;
}

function chunkKindDistribution(chunks: Array<{ chunkKind: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const chunk of chunks) {
    out[chunk.chunkKind] = (out[chunk.chunkKind] ?? 0) + 1;
  }
  return out;
}

function chunkSummary(
  docs: Array<{ documentId: string; sourcePath: string }>,
  chunks: Array<{ documentId: string }>
): {
  averagePerDocument: number;
  medianPerDocument: number;
  largestDocuments: Array<{ sourcePath: string; chunkCount: number }>;
} {
  const counts = new Map<string, number>();
  for (const chunk of chunks) {
    counts.set(chunk.documentId, (counts.get(chunk.documentId) ?? 0) + 1);
  }
  const perDoc = docs.map((doc) => ({
    documentId: doc.documentId,
    sourcePath: doc.sourcePath,
    count: counts.get(doc.documentId) ?? 0
  }));
  const values = perDoc.map((row) => row.count).sort((a, b) => a - b);
  const average = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const median =
    values.length === 0
      ? 0
      : values.length % 2 === 1
        ? (values[(values.length - 1) / 2] ?? 0)
        : (((values[values.length / 2 - 1] ?? 0) + (values[values.length / 2] ?? 0)) / 2);
  const largestDocuments = [...perDoc]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((row) => ({
      sourcePath: row.sourcePath,
      chunkCount: row.count
    }));
  return {
    averagePerDocument: Number(average.toFixed(2)),
    medianPerDocument: Number(median.toFixed(2)),
    largestDocuments
  };
}

function classifyFailureStage(result: IndexingDocumentResult): StageFailure["stage"] {
  if (result.parse.status === "parse_failed") return "parse";
  if (result.chunks.status === "chunks_failed") return "chunk_persist_fts";
  if (result.embeddings.status === "embedding_failed") return "embedding";
  return "unknown";
}

function computePowerShellSafetyCounts(store: ReturnType<typeof createKnowledgeV2SqliteStore>): {
  documents: number;
  activeChunks: number;
  embeddings: number;
} {
  const docs = store.listDocumentsBySource({ sourceId: "ms-teams-powershell", trackId: "ga" });
  const chunkIds = new Set<string>();
  let activeChunks = 0;
  for (const doc of docs) {
    const chunks = store.listChunksForDocument({ documentId: doc.documentId });
    activeChunks += chunks.length;
    for (const chunk of chunks) chunkIds.add(chunk.chunkId);
  }
  const embeddings = store
    .listChunkEmbeddings()
    .filter((embedding) => chunkIds.has(embedding.chunkId)).length;
  return { documents: docs.length, activeChunks, embeddings };
}

async function runRetrievalSmokes(params: {
  databasePath: string;
  provider: EmbeddingProvider;
  model: string;
  embeddingSchemaVersion: string;
  semanticEnabled: boolean;
}): Promise<SmokeQueryResult[]> {
  const questions = [
    "How do Microsoft Teams Calling Plans work?",
    "How do I set up Microsoft Calling Plans?",
    "How do I assign a Calling Plan phone number to a user?",
    "How do I port phone numbers into Microsoft Teams Calling Plans?",
    "How do I view PSTN usage for Calling Plans?",
    "How does Teams Direct Routing voice routing work?",
    "What does Set-CsOnlineVoiceRoutingPolicy do?",
    "How does external access work in Teams?",
    "How does guest access work in Teams?",
    "How do Teams meeting policies work?",
    "How do Teams call queues work?",
    "How do Teams auto attendants work?",
    "How do I view Teams analytics and usage reports?"
  ];
  const outputs: SmokeQueryResult[] = [];
  for (const question of questions) {
    const intentResult = extractQueryIntent(question);
    const route = routeQueryIntent(intentResult.intent).scope;
    const exact = retrieveExactMatches({
      databasePath: params.databasePath,
      scope: route
    });
    const lexical = retrieveLexicalCandidates({
      databasePath: params.databasePath,
      scope: route
    });
    let semantic:
      | {
          count: number | null;
          top: SmokeQueryResult["semantic"]["top"];
          latencyMs: number | null;
          warnings: string[];
        }
      | null = null;
    let hybrid:
      | {
          count: number | null;
          top: SmokeQueryResult["hybrid"]["top"];
          latencyMs: number | null;
          warnings: string[];
        }
      | null = null;
    if (params.semanticEnabled) {
      try {
        const semanticRun = await retrieveSemanticCandidates({
          databasePath: params.databasePath,
          scope: route,
          embeddingProvider: params.provider,
          embeddingRuntimeConfig: {
            model: params.model,
            embeddingSchemaVersion: params.embeddingSchemaVersion
          }
        });
        semantic = {
          count: semanticRun.candidates.length,
          top: semanticRun.candidates.slice(0, 5).map((candidate) => ({
            sourceId: candidate.authority.sourceId,
            canonicalUrl: candidate.provenance.canonicalUrl,
            title: candidate.title,
            method: candidate.method,
            semanticScore: candidate.scores.semanticSimilarity
          })),
          latencyMs: semanticRun.diagnostics.latencyMs.total,
          warnings: [...semanticRun.diagnostics.warnings]
        };
      } catch (error) {
        semantic = {
          count: null,
          top: [],
          latencyMs: null,
          warnings: [error instanceof Error ? error.message : "semantic_failed"]
        };
      }
      try {
        const hybridRun = await retrieveHybridCandidates({
          databasePath: params.databasePath,
          scope: route,
          embeddingProvider: params.provider,
          embeddingRuntimeConfig: {
            model: params.model,
            embeddingSchemaVersion: params.embeddingSchemaVersion
          }
        });
        hybrid = {
          count: hybridRun.candidates.length,
          top: hybridRun.candidates.slice(0, 5).map((candidate) => ({
            sourceId: candidate.authority.sourceId,
            canonicalUrl: candidate.provenance.canonicalUrl,
            title: candidate.title,
            methods: candidate.methods,
            fusionScore: candidate.fusion.score,
            reasons: candidate.retrievalReasons
          })),
          latencyMs: hybridRun.diagnostics.totalLatencyMs,
          warnings: [...hybridRun.warnings]
        };
      } catch (error) {
        hybrid = {
          count: null,
          top: [],
          latencyMs: null,
          warnings: [error instanceof Error ? error.message : "hybrid_failed"]
        };
      }
    } else {
      semantic = {
        count: null,
        top: [],
        latencyMs: null,
        warnings: ["semantic_smoke_skipped_missing_hosted_embedding_credentials"]
      };
      hybrid = {
        count: null,
        top: [],
        latencyMs: null,
        warnings: ["hybrid_smoke_skipped_missing_hosted_embedding_credentials"]
      };
    }

    outputs.push({
      question,
      intent: intentResult.intent,
      route,
      exact: {
        count: exact.candidates.length,
        top: exact.candidates.slice(0, 5).map((candidate) => ({
          sourceId: candidate.authority.sourceId,
          canonicalUrl: candidate.provenance.canonicalUrl,
          title: candidate.title,
          method: candidate.method,
          reasons: candidate.retrievalReasons,
          exactMatch: candidate.exactMatch
            ? `${candidate.exactMatch.directiveType}:${candidate.exactMatch.directiveValue}:${candidate.exactMatch.matchedField}`
            : null
        })),
        latencyMs: exact.latencyMs
      },
      lexical: {
        count: lexical.candidates.length,
        top: lexical.candidates.slice(0, 5).map((candidate) => ({
          sourceId: candidate.authority.sourceId,
          canonicalUrl: candidate.provenance.canonicalUrl,
          title: candidate.title,
          method: candidate.method,
          lexicalScore: candidate.scores.lexical
        })),
        latencyMs: lexical.latencyMs
      },
      semantic: semantic ?? { count: null, top: [], latencyMs: null, warnings: [] },
      hybrid: hybrid ?? { count: null, top: [], latencyMs: null, warnings: [] }
    });
  }
  return outputs;
}

function createHostedEmbeddingProviderOrThrow(): {
  provider: EmbeddingProvider;
  dimensions: number;
  credentialAvailable: boolean;
  providerId: string;
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
    credentialAvailable: apiKey.length > 0,
    providerId: provider.providerId
  };
}

function inferEmbeddingDimensions(model: string): number {
  if (model === "text-embedding-3-large") return 3072;
  if (model === "text-embedding-3-small") return 1536;
  return Number(process.env["KNOWLEDGE_V2_EMBEDDING_DIMENSIONS"] || "1536");
}

async function writeArtifacts(result: TeamsAdminCorpusRunResult): Promise<void> {
  await writeFile(result.artifactPaths.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const lines = result.failures.map((failure) =>
    JSON.stringify({
      runId: result.runId,
      canonicalUrl: failure.canonicalUrl,
      stage: failure.stage,
      message: failure.message,
      lexicalReady: failure.lexicalReady,
      semanticReady: failure.semanticReady
    })
  );
  await writeFile(result.artifactPaths.jsonlPath, `${lines.join("\n")}\n`, "utf8");
  const md: string[] = [];
  md.push(`# CG-01E2 ${result.runId}`);
  md.push("");
  md.push(`- Mode: ${result.mode}`);
  md.push(`- Approved manifest: \`${result.approvedManifestPath}\``);
  md.push(`- Approved article count: ${result.approvedArticleCount}`);
  md.push(`- Fetch attempted/fetched/failed: ${result.fetch.attempted}/${result.fetch.fetched}/${result.fetch.failed}`);
  md.push(`- Parse success/warning/failed: ${result.parse.success}/${result.parse.warning}/${result.parse.failed}`);
  md.push(`- Chunks active: ${result.chunks.activeTotal}`);
  md.push(`- FTS rows: ${result.fts.rowCount} (consistent=${result.fts.consistentWithActiveChunks})`);
  md.push(
    `- Embeddings generated/reused/missing: ${result.embeddings.generated}/${result.embeddings.reused}/${result.embeddings.missingOrFailed}`
  );
  md.push(
    `- Embedding requests/tokens: ${result.embeddings.requestCount}/${result.embeddings.inputTokens}`
  );
  md.push(`- PowerShell unchanged: ${result.powerShellSafety.unchanged}`);
  if (result.smoke) {
    md.push("");
    md.push("## Retrieval Smoke");
    for (const row of result.smoke.queries) {
      md.push(
        `- ${row.question} | exact=${row.exact.count} lexical=${row.lexical.count} semantic=${row.semantic.count ?? "null"} hybrid=${row.hybrid.count ?? "null"}`
      );
    }
  }
  await writeFile(result.artifactPaths.markdownPath, `${md.join("\n")}\n`, "utf8");
}
