import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
import type {
  CorpusExecutionSummary,
  CorpusPlanEstimates,
  CorpusRunArtifacts,
  RetrievalSmokeCaseResult
} from "./types";

const SOURCE_ID = "ms-sharepoint-docs";
const TRACK_ID = "ga";
const DEFAULT_ARTIFACTS_DIR = "eval/runs/indexing";

type SharePointSubdomain =
  | "site_permissions"
  | "sharing_links"
  | "sensitivity_governance"
  | "copilot_content_discovery";

/**
 * Hand-curated, empirically-verified (HTTP 200, live on learn.microsoft.com
 * as of this K2 slice) approved article set, scoped exactly to the K2
 * knowledge-pack boundary (site/library permissions, sharing controls,
 * oversharing/data-access-governance reporting, and how SharePoint
 * permissions affect Microsoft 365 Copilot content discovery). This
 * intentionally skips the full automated discovery/classification/
 * human-approval pipeline used for `ms-teams-admin` (see
 * `teamsAdminDiscoveryJob.ts`): the K2 scope is already small and
 * explicitly bounded by the design, so a full discovery subsystem would be
 * disproportionate. Acquisition itself still goes through the same real
 * Learn MCP client used in production (`buildLearnMcpClient`), not a mock.
 */
const APPROVED_ARTICLES: Array<{ canonicalUrl: string; subdomain: SharePointSubdomain }> = [
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery",
    subdomain: "copilot_content_discovery"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/manage-access-agents-in-sharepoint",
    subdomain: "copilot_content_discovery"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/advanced-management",
    subdomain: "sensitivity_governance"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/change-external-sharing-site",
    subdomain: "sharing_links"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/external-sharing-overview",
    subdomain: "sharing_links"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/change-default-sharing-link",
    subdomain: "sharing_links"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off",
    subdomain: "sharing_links"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-reports",
    subdomain: "sensitivity_governance"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/site-access-review",
    subdomain: "site_permissions"
  },
  {
    canonicalUrl:
      "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-site-permissions-report",
    subdomain: "site_permissions"
  },
  {
    canonicalUrl:
      "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-sharing-links-report",
    subdomain: "sharing_links"
  },
  {
    canonicalUrl:
      "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-sensitivity-label-report",
    subdomain: "sensitivity_governance"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/sharepoint-admin-role",
    subdomain: "site_permissions"
  },
  {
    canonicalUrl:
      "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-everyone-except-external-user-report",
    subdomain: "sensitivity_governance"
  },
  {
    canonicalUrl: "https://learn.microsoft.com/en-us/sharepoint/powershell-for-data-access-governance",
    subdomain: "sensitivity_governance"
  },
  {
    canonicalUrl:
      "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-site-permissions-users-report",
    subdomain: "site_permissions"
  }
];

type FetchFailure = {
  canonicalUrl: string;
  stage: "fetch";
  message: string;
  retryCount: number;
  retryable: boolean;
};

type StageFailure = {
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

type FetchClient = {
  initialize: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string }>>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

type SharePointCorpusRunResult = {
  runId: string;
  mode: "plan" | "execute";
  approvedArticleCount: number;
  databasePath: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  corpusClassification: "LIMITED_REAL" | "blocked_empty";
  plan: CorpusPlanEstimates & { approvedCanonicalUrls: string[]; bySubdomain: Record<string, number> };
  fetch: { attempted: number; fetched: number; failed: number };
  execution: CorpusExecutionSummary | null;
  failures: StageFailure[];
  failureManifestPath: string;
  corpusStats: {
    documents: { totalCanonical: number; bySubdomain: Record<string, number> };
    chunks: { totalActive: number; chunkKindDistribution: Record<string, number> };
    fts: { indexedActiveRows: number; consistent: boolean };
    embeddings: {
      totalActiveChunks: number;
      currentCompatibleEmbeddings: number;
      semanticReadyPercentage: number;
      providerId: string;
      model: string;
    };
  } | null;
  smoke: {
    primaryCopilotSecurity: RetrievalSmokeCaseResult | null;
    restrictedContentDiscovery: RetrievalSmokeCaseResult | null;
    entraNegativeControl: RetrievalSmokeCaseResult | null;
  };
  embeddingUsage: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
    requests: number;
    generated: number;
    reused: number;
    inputTokens: number;
    credentialAvailable: boolean;
  };
  warnings: string[];
  cancelled: boolean;
  artifactPaths: CorpusRunArtifacts;
};

type SharePointCorpusJobDeps = {
  fetchClientFactory?: (endpoint: string) => FetchClient;
  createEmbeddingProvider?: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
    providerId: string;
  };
};

export function classifySharePointSubdomain(canonicalUrl: string): SharePointSubdomain | "other" {
  const entry = APPROVED_ARTICLES.find((a) => a.canonicalUrl === canonicalUrl);
  return entry?.subdomain ?? "other";
}

export class SharePointCorpusJob {
  private readonly fetchClientFactory: (endpoint: string) => FetchClient;
  private readonly createEmbeddingProvider: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
    providerId: string;
  };

  constructor(deps: SharePointCorpusJobDeps = {}) {
    this.fetchClientFactory = deps.fetchClientFactory ?? ((endpoint) => buildLearnMcpClient(endpoint));
    this.createEmbeddingProvider = deps.createEmbeddingProvider ?? createHostedEmbeddingProviderOrThrow;
  }

  async run(request: {
    mode: "plan" | "execute";
    dbPath?: string;
    artifactsDir?: string;
    parserVersion: string;
    chunkerVersion: string;
    signal?: AbortSignal;
  }): Promise<SharePointCorpusRunResult> {
    const source = getSourceById(SOURCE_ID);
    if (!source || source.acquisition.transport !== "learn_mcp") {
      throw new Error("ms-sharepoint-docs source must exist with learn_mcp transport.");
    }
    const dbPath = resolve(request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() }));
    const artifactsDir = resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR);
    const startedAt = new Date();
    const runId = `k2-sharepoint-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
    const artifactPaths: CorpusRunArtifacts = {
      jsonPath: join(artifactsDir, `${runId}.json`),
      jsonlPath: join(artifactsDir, `${runId}.jsonl`),
      markdownPath: join(artifactsDir, `${runId}.md`)
    };
    const failureManifestPath = join(artifactsDir, `${runId}.failures.json`);
    await mkdir(dirname(artifactPaths.jsonPath), { recursive: true });
    const started = performance.now();
    const warnings: string[] = [];

    const runtime = resolveEmbeddingRuntimeConfig();
    const embeddingRuntime = this.createEmbeddingProvider();
    if (!embeddingRuntime.credentialAvailable) {
      warnings.push("OPENAI_API_KEY missing; semantic embedding generation skipped.");
    }
    const store = createKnowledgeV2SqliteStore({
      databasePath: dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
    });
    store.initializeDatabase();

    const fetchClient = this.fetchClientFactory(source.acquisition.endpoint);
    await fetchClient.initialize();
    const tools = await fetchClient.listTools();
    const fetchTool = selectToolName(
      tools.map((tool) => ({ name: tool.name })),
      (name) => name.includes("fetch")
    );

    const fetchedByUrl = new Map<string, AcquiredDocumentInput>();
    const fetchFailures: FetchFailure[] = [];
    let cancelled = false;
    for (const article of APPROVED_ARTICLES) {
      if (request.signal?.aborted) {
        cancelled = true;
        break;
      }
      const fetched = await fetchLearnDocument({
        canonicalUrl: article.canonicalUrl,
        fetchClient,
        fetchTool,
        signal: request.signal
      });
      if ("failure" in fetched) {
        fetchFailures.push(fetched.failure);
        continue;
      }
      fetchedByUrl.set(article.canonicalUrl, fetched.document);
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
    const docsToParse = planRun.documents.filter((d) => d.parse.status !== "parse_reused").length;
    const docsReusable = planRun.documents.length - docsToParse;
    const estimatedChunkCount = planRun.documents.reduce((sum, d) => sum + d.chunks.newCount, 0);
    const embeddingsReusable = planRun.documents.reduce(
      (sum, d) => sum + d.metrics.chunksReusedEmbeddings,
      0
    );
    const embeddingsToGenerate = planRun.documents.reduce(
      (sum, d) => sum + d.metrics.chunksToGenerateEmbeddings,
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
    const bySubdomain: Record<string, number> = {};
    for (const article of APPROVED_ARTICLES) {
      bySubdomain[article.subdomain] = (bySubdomain[article.subdomain] ?? 0) + 1;
    }
    const plan = {
      documentsToParse: docsToParse,
      documentsReusable: docsReusable,
      estimatedChunkCount,
      estimatedDocumentsByType: { cmdlet: 0, conceptual: planPreviewDocs.length, other: 0 },
      embeddingsReusable,
      embeddingsToGenerate,
      estimatedEmbeddingInputChars: estimatedChars,
      estimatedEmbeddingInputTokens: estimatedTokens,
      plannedEmbeddingRequestCount:
        runtime.maxBatchSize > 0 ? Math.ceil(embeddingsToGenerate / runtime.maxBatchSize) : 0,
      approvedCanonicalUrls: APPROVED_ARTICLES.map((a) => a.canonicalUrl),
      bySubdomain
    };

    const indexedDocuments: IndexingDocumentResult[] = [];
    const stageFailures: StageFailure[] = fetchFailures.map((failure) => ({
      canonicalUrl: failure.canonicalUrl,
      stage: "fetch",
      message: failure.message,
      retryCount: failure.retryCount,
      retryable: failure.retryable,
      lexicalReady: false,
      semanticReady: false
    }));

    let execution: CorpusExecutionSummary | null = null;
    if (request.mode === "execute" && !cancelled) {
      for (const article of APPROVED_ARTICLES) {
        if (request.signal?.aborted) {
          cancelled = true;
          break;
        }
        const acquired = fetchedByUrl.get(article.canonicalUrl);
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
        process.stdout.write(
          `[K2-SPO] current=${article.canonicalUrl} subdomain=${article.subdomain} chunks=${indexed.chunks.newCount} embGen=${indexed.embeddings.generatedCount} embReuse=${indexed.embeddings.reusedCount}\n`
        );
        if (indexed.readiness === "failed" || indexed.errors.length > 0) {
          stageFailures.push({
            canonicalUrl: article.canonicalUrl,
            stage: classifyFailureStage(indexed),
            message: indexed.errors.join("; ") || "indexing_failed",
            retryCount: 0,
            retryable: false,
            lexicalReady: indexed.readiness !== "failed",
            semanticReady: indexed.readiness === "semantic_ready"
          });
        }
      }
      execution = summarizeExecution(indexedDocuments, stageFailures, cancelled);
    }

    const corpusStats =
      request.mode === "execute"
        ? computeCorpusStats({
            store,
            providerId: embeddingRuntime.provider.providerId,
            model: runtime.model,
            dimensions: embeddingRuntime.dimensions,
            schema: runtime.embeddingSchemaVersion
          })
        : null;

    const smoke =
      request.mode === "execute"
        ? await runRetrievalSmokes({
            dbPath,
            provider: embeddingRuntime.provider,
            embeddingModel: runtime.model,
            embeddingSchemaVersion: runtime.embeddingSchemaVersion,
            semanticEnabled: embeddingRuntime.credentialAvailable
          })
        : {
            primaryCopilotSecurity: null,
            restrictedContentDiscovery: null,
            entraNegativeControl: null
          };

    const generated = indexedDocuments.reduce((sum, doc) => sum + doc.embeddings.generatedCount, 0);
    const reused = indexedDocuments.reduce((sum, doc) => sum + doc.embeddings.reusedCount, 0);
    const requestsCount = indexedDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.providerRequestCount,
      0
    );
    const inputTokens = indexedDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.providerInputTokens,
      0
    );

    const hasRealCorpusData =
      (corpusStats?.documents.totalCanonical ?? 0) > 0 &&
      (corpusStats?.chunks.totalActive ?? 0) > 0 &&
      (corpusStats?.fts.indexedActiveRows ?? 0) > 0;

    store.close();

    const result: SharePointCorpusRunResult = {
      runId,
      mode: request.mode,
      approvedArticleCount: APPROVED_ARTICLES.length,
      databasePath: dbPath,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      corpusClassification: hasRealCorpusData ? "LIMITED_REAL" : "blocked_empty",
      plan,
      fetch: {
        attempted: APPROVED_ARTICLES.length,
        fetched: fetchedByUrl.size,
        failed: fetchFailures.length
      },
      execution,
      failures: stageFailures,
      failureManifestPath,
      corpusStats,
      smoke,
      embeddingUsage: {
        providerId: embeddingRuntime.provider.providerId,
        model: runtime.model,
        dimensions: embeddingRuntime.dimensions,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion,
        requests: requestsCount,
        generated,
        reused,
        inputTokens,
        credentialAvailable: embeddingRuntime.credentialAvailable
      },
      warnings,
      cancelled,
      artifactPaths
    };
    await writeFile(failureManifestPath, `${JSON.stringify(stageFailures, null, 2)}\n`, "utf8");
    await writeArtifacts(result);
    return result;
  }
}

async function fetchLearnDocument(params: {
  canonicalUrl: string;
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
        url: params.canonicalUrl
      });
      const markdown = extractMarkdown(payload);
      const normalized = normalizeLearnUrl(params.canonicalUrl);
      if (!normalized) throw new Error("invalid_approved_canonical_url");
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
            canonicalUrl: params.canonicalUrl,
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
      canonicalUrl: params.canonicalUrl,
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function classifyFailureStage(result: IndexingDocumentResult): StageFailure["stage"] {
  if (result.parse.status === "parse_failed") return "parse";
  if (result.chunks.status === "chunks_failed") return "chunk_persist_fts";
  if (result.embeddings.status === "embedding_failed") return "embedding";
  return "unknown";
}

function summarizeExecution(
  indexed: IndexingDocumentResult[],
  failures: StageFailure[],
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

function computeCorpusStats(params: {
  store: ReturnType<typeof createKnowledgeV2SqliteStore>;
  providerId: string;
  model: string;
  dimensions: number;
  schema: string;
}): SharePointCorpusRunResult["corpusStats"] {
  const docs = params.store.listDocumentsBySource({ sourceId: SOURCE_ID, trackId: TRACK_ID });
  const bySubdomain: Record<string, number> = {};
  const chunkKindDistribution: Record<string, number> = {};
  const activeChunks: Array<{ chunkId: string; contentHash: string }> = [];
  let totalChunks = 0;
  let totalFtsRows = 0;
  for (const doc of docs) {
    const subdomain = classifySharePointSubdomain(doc.canonicalUrl);
    bySubdomain[subdomain] = (bySubdomain[subdomain] ?? 0) + 1;
    const chunks = params.store.listChunksForDocument({ documentId: doc.documentId });
    const lifecycle = params.store.inspectChunkLifecycle({ documentId: doc.documentId });
    totalFtsRows += lifecycle.ftsRowCount;
    totalChunks += chunks.length;
    for (const chunk of chunks) {
      activeChunks.push({ chunkId: chunk.chunkId, contentHash: chunk.contentHash });
      chunkKindDistribution[chunk.chunkKind] = (chunkKindDistribution[chunk.chunkKind] ?? 0) + 1;
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
  for (const chunk of activeChunks) {
    const candidates = byChunk.get(chunk.chunkId) ?? [];
    const hasCompatible = candidates.some(
      (embedding) =>
        embedding.providerId === params.providerId &&
        embedding.model === params.model &&
        embedding.dimensions === params.dimensions &&
        embedding.embeddingSchemaVersion === params.schema &&
        embedding.inputContentHash === chunk.contentHash
    );
    if (hasCompatible) compatible += 1;
  }
  const semanticPct = activeChunks.length > 0 ? (compatible / activeChunks.length) * 100 : 0;
  return {
    documents: { totalCanonical: docs.length, bySubdomain },
    chunks: { totalActive: totalChunks, chunkKindDistribution },
    fts: { indexedActiveRows: totalFtsRows, consistent: totalFtsRows === totalChunks },
    embeddings: {
      totalActiveChunks: activeChunks.length,
      currentCompatibleEmbeddings: compatible,
      semanticReadyPercentage: Number(semanticPct.toFixed(2)),
      providerId: params.providerId,
      model: params.model
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
  primaryCopilotSecurity: RetrievalSmokeCaseResult | null;
  restrictedContentDiscovery: RetrievalSmokeCaseResult | null;
  entraNegativeControl: RetrievalSmokeCaseResult | null;
}> {
  return {
    primaryCopilotSecurity: await runSmokeCase({
      question:
        "How would you secure SharePoint data so it is not accessible by all Copilot users?",
      ...params
    }),
    restrictedContentDiscovery: await runSmokeCase({
      question: "What is Restricted Content Discovery?",
      ...params
    }),
    entraNegativeControl: await runSmokeCase({
      question: "How would I configure a Conditional Access policy to require MFA for all admin roles?",
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

async function writeArtifacts(result: SharePointCorpusRunResult): Promise<void> {
  await writeFile(result.artifactPaths.jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const lines = result.failures.map((failure) =>
    JSON.stringify({
      runId: result.runId,
      canonicalUrl: failure.canonicalUrl,
      stage: failure.stage,
      message: failure.message
    })
  );
  await writeFile(result.artifactPaths.jsonlPath, `${lines.join("\n")}\n`, "utf8");
  const md: string[] = [];
  md.push(`# K2 SharePoint Run ${result.runId}`);
  md.push("");
  md.push(`- Mode: ${result.mode}`);
  md.push(`- Corpus classification: ${result.corpusClassification}`);
  md.push(
    `- Fetch attempted/fetched/failed: ${result.fetch.attempted}/${result.fetch.fetched}/${result.fetch.failed}`
  );
  if (result.execution) {
    md.push(
      `- Execute: attempted=${result.execution.attempted} succeeded=${result.execution.succeeded} failed=${result.execution.failed}`
    );
  }
  if (result.corpusStats) {
    md.push(
      `- Corpus docs/chunks: docs=${result.corpusStats.documents.totalCanonical} chunks=${result.corpusStats.chunks.totalActive} semanticReady=${result.corpusStats.embeddings.semanticReadyPercentage}%`
    );
    md.push(
      `- Subdomains: ${Object.entries(result.corpusStats.documents.bySubdomain)
        .map(([name, count]) => `${name}=${count}`)
        .join(", ")}`
    );
  }
  if (result.failures.length > 0) {
    md.push("");
    md.push("## Failures");
    for (const failure of result.failures.slice(0, 50)) {
      md.push(`- ${failure.stage} :: ${failure.canonicalUrl} :: ${failure.message}`);
    }
  }
  await writeFile(result.artifactPaths.markdownPath, `${md.join("\n")}\n`, "utf8");
}
