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
import type { AcquiredDocumentInput } from "../parse";
import {
  createSourceSyncAdapter,
  type SourceFileDescriptor,
  type SourceSyncAdapter,
  type TrackCheckpoint
} from "../sync";

const SOURCE_ID = "ms-powershell-core";
const TRACK_ID = "ga";
const DEFAULT_ARTIFACTS_DIR = "eval/runs/indexing";

export interface PowerShellCoreCorpusJobRequest {
  mode: "plan" | "execute";
  dbPath?: string;
  artifactsDir?: string;
  parserVersion: string;
  chunkerVersion: string;
  signal?: AbortSignal;
}

export interface PowerShellCoreCorpusRunResult {
  runId: string;
  mode: "plan" | "execute";
  databasePath: string;
  durationMs: number;
  source: {
    sourceId: typeof SOURCE_ID;
    trackId: typeof TRACK_ID;
    authorityRoles: ["powershell_core_primary"];
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
  execution: {
    attempted: number;
    succeeded: number;
    failed: number;
  } | null;
  indexingDocuments: IndexingDocumentResult[];
  failures: Array<{ sourcePath: string; message: string }>;
  corpusStats: {
    documents: number;
    chunks: number;
    ftsRows: number;
    compatibleEmbeddings: number;
    missingEmbeddings: number;
    semanticReadyPercentage: number;
  } | null;
  embeddingUsage: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
    requests: number;
    generated: number;
    reused: number;
    failed: number;
    credentialAvailable: boolean;
  };
  checkpointUpdated: boolean;
  artifactPath: string;
  warnings: string[];
}

interface Dependencies {
  syncAdapter?: SourceSyncAdapter;
  createEmbeddingProvider?: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
  };
}

export function mapPowerShellCorePathToLearnUrl(
  sourcePath: string
): string | null {
  const source = getSourceById(SOURCE_ID);
  const mappings = source?.learnMapping?.githubExactCanonicalUrls;
  if (!mappings) return null;
  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const key = Object.keys(mappings).find(
    (candidate) => candidate.toLowerCase() === normalized.toLowerCase()
  );
  return key ? mappings[key] ?? null : null;
}

export class PowerShellCoreCorpusJob {
  private readonly syncAdapter: SourceSyncAdapter;
  private readonly createEmbeddingProvider: NonNullable<
    Dependencies["createEmbeddingProvider"]
  >;

  constructor(deps: Dependencies = {}) {
    this.syncAdapter = deps.syncAdapter ?? createSourceSyncAdapter();
    this.createEmbeddingProvider =
      deps.createEmbeddingProvider ?? createHostedEmbeddingProvider;
  }

  async run(
    request: PowerShellCoreCorpusJobRequest
  ): Promise<PowerShellCoreCorpusRunResult> {
    const startedAt = new Date();
    const started = performance.now();
    const runId = `g2-2-powershell-core-${startedAt
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    const dbPath = resolve(
      request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() })
    );
    const artifactPath = join(
      resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR),
      `${runId}.json`
    );
    await mkdir(dirname(artifactPath), { recursive: true });

    const source = getSourceById(SOURCE_ID);
    if (!source || source.acquisition.transport !== "github") {
      throw new Error("invalid_powershell_core_source_registry");
    }

    const store = createKnowledgeV2SqliteStore({
      databasePath: dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
    });
    store.initializeDatabase();
    const checkpoint = store.getSyncCheckpoint({
      sourceId: SOURCE_ID,
      trackId: TRACK_ID
    });
    const previousCheckpoint = toTrackCheckpoint(
      checkpoint?.checkpointPayload ?? null
    );
    const sync = await this.syncAdapter.syncTrack({
      sourceId: SOURCE_ID,
      trackId: TRACK_ID,
      previousCheckpoint,
      options: {
        fetchContent: true,
        maxFileFetchFailures: 10,
        signal: request.signal
      }
    });

    const descriptors = [
      ...sync.added,
      ...sync.modified,
      ...sync.unchanged
    ];
    const failures: Array<{ sourcePath: string; message: string }> = [];
    const docs: AcquiredDocumentInput[] = [];
    for (const descriptor of descriptors) {
      const doc = acquiredDocument(descriptor, store);
      if (typeof doc === "string") {
        failures.push({ sourcePath: descriptor.path, message: doc });
      } else {
        docs.push(doc);
      }
    }

    const runtime = resolveEmbeddingRuntimeConfig();
    const { provider, dimensions, credentialAvailable } =
      this.createEmbeddingProvider();
    const warnings: string[] = [];
    if (!credentialAvailable) {
      warnings.push(
        "OPENAI_API_KEY missing; semantic embedding generation skipped."
      );
    }

    const indexingDocuments: IndexingDocumentResult[] = [];
    if (request.mode === "execute") {
      for (const doc of docs) {
        const job = new DocumentIndexingJob({
          storeDatabasePath: dbPath,
          migrationsDir: resolve(
            "src/main/services/knowledgeV2/store/migrations"
          ),
          parserVersion: request.parserVersion,
          chunkerVersion: request.chunkerVersion,
          embeddingIdentity: {
            providerId: provider.providerId,
            model: runtime.model,
            dimensions,
            embeddingSchemaVersion: runtime.embeddingSchemaVersion
          },
          embeddingBatchSize: runtime.maxBatchSize,
          skipEmbeddingGeneration: !credentialAvailable,
          embeddingProvider: provider
        });
        const result = await job.run({
          mode: "execute",
          acquiredDocuments: [doc],
          signal: request.signal
        });
        const indexed = result.documents[0];
        if (indexed) {
          indexingDocuments.push(indexed);
          if (indexed.readiness === "failed") {
            failures.push({
              sourcePath:
                doc.revision.transport === "github"
                  ? doc.revision.path
                  : doc.canonicalUrl,
              message:
                indexed.parse.errors.join("; ") ||
                indexed.errors.join("; ") ||
                "indexing_failed"
            });
          }
        }
      }
    }

    const checkpointUpdated =
      request.mode === "execute" &&
      failures.length === 0 &&
      Boolean(sync.endCheckpoint);
    if (checkpointUpdated && sync.endCheckpoint) {
      store.saveSyncCheckpoint({
        sourceId: SOURCE_ID,
        trackId: TRACK_ID,
        transport: "github",
        status: "ok",
        lastRevisionFingerprint: sync.endCheckpoint.commitSha,
        lastSyncedAt: sync.endCheckpoint.lastSyncedAt,
        lastError: null,
        checkpointPayload: sync.endCheckpoint as unknown as Record<
          string,
          unknown
        >
      });
    }

    const generated = indexingDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.generatedCount,
      0
    );
    const reused = indexingDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.reusedCount,
      0
    );
    const failed = indexingDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.failedCount,
      0
    );
    const requests = indexingDocuments.reduce(
      (sum, doc) => sum + doc.embeddings.providerRequestCount,
      0
    );
    const corpusStats =
      request.mode === "execute"
        ? computeStats(store, {
            providerId: provider.providerId,
            model: runtime.model,
            dimensions,
            schema: runtime.embeddingSchemaVersion
          })
        : null;
    const result: PowerShellCoreCorpusRunResult = {
      runId,
      mode: request.mode,
      databasePath: dbPath,
      durationMs: performance.now() - started,
      source: {
        sourceId: SOURCE_ID,
        trackId: TRACK_ID,
        authorityRoles: ["powershell_core_primary"],
        resolvedCommitSha: sync.resolvedCommitSha,
        eligibleFileCount: descriptors.length,
        includeGlobs:
          source.contentTracks.find((track) => track.id === TRACK_ID)
            ?.includeGlobs ?? [],
        counts: {
          added: sync.added.length,
          modified: sync.modified.length,
          unchanged: sync.unchanged.length,
          deleted: sync.deleted.length,
          errors: sync.errors.length
        }
      },
      execution:
        request.mode === "execute"
          ? {
              attempted: indexingDocuments.length,
              succeeded: indexingDocuments.filter(
                (doc) => doc.readiness !== "failed"
              ).length,
              failed: failures.length
            }
          : null,
      indexingDocuments,
      failures,
      corpusStats,
      embeddingUsage: {
        providerId: provider.providerId,
        model: runtime.model,
        dimensions,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion,
        requests,
        generated,
        reused,
        failed,
        credentialAvailable
      },
      checkpointUpdated,
      artifactPath,
      warnings
    };
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
    store.close();
    return result;
  }
}

function acquiredDocument(
  descriptor: SourceFileDescriptor,
  store: ReturnType<typeof createKnowledgeV2SqliteStore>
): AcquiredDocumentInput | string {
  const canonicalUrl = mapPowerShellCorePathToLearnUrl(descriptor.path);
  if (!canonicalUrl) return "unverified_canonical_path";
  let rawMarkdown: string;
  if (
    descriptor.changeType === "added" ||
    descriptor.changeType === "modified"
  ) {
    if (
      descriptor.contentStatus !== "available" ||
      typeof descriptor.content !== "string"
    ) {
      return "content_not_available";
    }
    rawMarkdown = normalizePowerShellHelpFrontMatter(descriptor.content);
  } else {
    const existing = store.findDocumentBySourceIdentity({
      sourceId: SOURCE_ID,
      trackId: TRACK_ID,
      transport: "github",
      canonicalUrl,
      sourcePath: descriptor.path
    });
    if (!existing) return "unchanged_document_missing_from_store";
    rawMarkdown = normalizePowerShellHelpFrontMatter(existing.rawMarkdown);
  }
  return {
    sourceId: SOURCE_ID,
    trackId: TRACK_ID,
    transport: "github",
    canonicalUrl,
    rawMarkdown,
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

function normalizePowerShellHelpFrontMatter(markdown: string): string {
  // The official ForEach-Object help file represents the `%` alias as an
  // unquoted YAML scalar. `%` is a YAML directive indicator, so quote that
  // exact metadata value before passing the otherwise unchanged document to
  // Relay's strict Markdown parser.
  return markdown.replace(/^(\s*-\s*)%(\s*)$/m, '$1"%"$2');
}

function computeStats(
  store: ReturnType<typeof createKnowledgeV2SqliteStore>,
  identity: {
    providerId: string;
    model: string;
    dimensions: number;
    schema: string;
  }
): NonNullable<PowerShellCoreCorpusRunResult["corpusStats"]> {
  const docs = store.listDocumentsBySource({
    sourceId: SOURCE_ID,
    trackId: TRACK_ID
  });
  const chunks = docs.flatMap((doc) =>
    store.listChunksForDocument({ documentId: doc.documentId })
  );
  const embeddings = store.listChunkEmbeddings();
  let compatible = 0;
  for (const chunk of chunks) {
    if (
      embeddings.some(
        (embedding) =>
          embedding.chunkId === chunk.chunkId &&
          embedding.providerId === identity.providerId &&
          embedding.model === identity.model &&
          embedding.dimensions === identity.dimensions &&
          embedding.embeddingSchemaVersion === identity.schema &&
          embedding.inputContentHash === chunk.contentHash
      )
    ) {
      compatible += 1;
    }
  }
  const ftsRows = docs.reduce(
    (sum, doc) =>
      sum +
      store.inspectChunkLifecycle({ documentId: doc.documentId }).ftsRowCount,
    0
  );
  return {
    documents: docs.length,
    chunks: chunks.length,
    ftsRows,
    compatibleEmbeddings: compatible,
    missingEmbeddings: chunks.length - compatible,
    semanticReadyPercentage:
      chunks.length === 0
        ? 0
        : Number(((compatible / chunks.length) * 100).toFixed(2))
  };
}

function createHostedEmbeddingProvider(): {
  provider: EmbeddingProvider;
  dimensions: number;
  credentialAvailable: boolean;
} {
  const runtime = resolveEmbeddingRuntimeConfig();
  const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
  return {
    provider: new HostedOpenAiEmbeddingProvider({
      apiKey,
      defaultModel: runtime.model,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion,
      maxBatchSize: runtime.maxBatchSize
    }),
    dimensions:
      runtime.model === "text-embedding-3-large"
        ? 3072
        : Number(
            process.env["KNOWLEDGE_V2_EMBEDDING_DIMENSIONS"] || "1536"
          ),
    credentialAvailable: apiKey.length > 0
  };
}

function toTrackCheckpoint(
  payload: Record<string, unknown> | null
): TrackCheckpoint | null {
  if (
    !payload ||
    typeof payload["commitSha"] !== "string" ||
    typeof payload["sourceId"] !== "string" ||
    typeof payload["trackId"] !== "string" ||
    typeof payload["lastSyncedAt"] !== "string" ||
    typeof payload["files"] !== "object" ||
    payload["files"] === null
  ) {
    return null;
  }
  return {
    sourceId: payload["sourceId"] as string,
    trackId: payload["trackId"] as string,
    commitSha: payload["commitSha"] as string,
    files: payload["files"] as Record<string, { blobSha: string }>,
    lastSyncedAt: payload["lastSyncedAt"] as string
  };
}
