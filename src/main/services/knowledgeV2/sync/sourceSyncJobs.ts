import { createHash } from "node:crypto";
import { getDefaultSourceRegistry, validateSourceRegistry } from "../sourceRegistry";
import type { SourceContentTrack, SourceRegistry } from "../sourceTypes";
import { GitHubApiError, GitHubRestRepositoryClient } from "./githubAdapter";
import { isMarkdownPath, isTrackEligiblePath, normalizeRepoPath } from "./pathPolicies";
import type {
  GitHubRepositoryClient,
  SourceFileDescriptor,
  SourceResolution,
  SourceSyncAdapter,
  SyncError,
  SyncOptions,
  SyncPlan,
  SyncTrackResult,
  TrackCheckpoint,
  GitHubKnowledgeSourceDefinition
} from "./types";

const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  fetchContent: true,
  maxFileFetchFailures: 100
};

function toRepositoryKey(source: GitHubKnowledgeSourceDefinition): string {
  return `${source.acquisition.owner}/${source.acquisition.repo}`;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("aborted");
  }
}

function resolveSourceAndTrack(
  registry: SourceRegistry,
  sourceId: string,
  trackId: string
): SourceResolution {
  const source = registry.sources.find((item) => item.id === sourceId);
  if (!source) {
    throw new Error(`source_not_found:${sourceId}`);
  }
  const track = source.contentTracks.find((item) => item.id === trackId);
  if (!track) {
    throw new Error(`track_not_found:${sourceId}:${trackId}`);
  }
  if (source.acquisition.transport !== "github") {
    throw new Error(`non_github_transport:${sourceId}:${source.acquisition.transport}`);
  }
  return { source: source as GitHubKnowledgeSourceDefinition, track };
}

function mapLookupError(error: Error): SyncError {
  if (error.message.startsWith("source_not_found:")) {
    return {
      scope: "source",
      code: "source_not_found",
      message: error.message,
      retryable: false
    };
  }
  if (error.message.startsWith("track_not_found:")) {
    return {
      scope: "track",
      code: "track_not_found",
      message: error.message,
      retryable: false
    };
  }
  if (error.message.startsWith("non_github_transport:")) {
    return {
      scope: "source",
      code: "non_github_transport",
      message: error.message,
      retryable: false
    };
  }
  return {
    scope: "source",
    code: "unknown",
    message: error.message,
    retryable: false
  };
}

function toSourceUrls(
  source: GitHubKnowledgeSourceDefinition,
  branchOrCommitSha: string,
  path: string
): { githubUrl: string; rawUrl: string } {
  const normalized = normalizeRepoPath(path);
  return {
    githubUrl: `https://github.com/${source.acquisition.owner}/${source.acquisition.repo}/blob/${branchOrCommitSha}/${normalized}`,
    rawUrl: `https://raw.githubusercontent.com/${source.acquisition.owner}/${source.acquisition.repo}/${branchOrCommitSha}/${normalized}`
  };
}

function toContentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildEndCheckpoint(
  sourceId: string,
  trackId: string,
  commitSha: string,
  currentFileDescriptors: SourceFileDescriptor[]
): TrackCheckpoint {
  const files: TrackCheckpoint["files"] = {};
  for (const descriptor of currentFileDescriptors) {
    if (descriptor.changeType === "deleted" || descriptor.changeType === "skipped") continue;
    files[descriptor.path] = { blobSha: descriptor.blobSha };
  }
  return {
    sourceId,
    trackId,
    commitSha,
    files,
    lastSyncedAt: new Date().toISOString()
  };
}

function buildBaseResult(params: {
  source: GitHubKnowledgeSourceDefinition;
  track: SourceContentTrack;
  previousCheckpoint?: TrackCheckpoint | null;
}): SyncTrackResult {
  return {
    source: {
      id: params.source.id,
      trackId: params.track.id,
      repository: toRepositoryKey(params.source),
      branch: params.source.acquisition.branch
    },
    startCheckpoint: params.previousCheckpoint ?? null,
    endCheckpoint: null,
    resolvedCommitSha: null,
    added: [],
    modified: [],
    unchanged: [],
    deleted: [],
    skipped: [],
    errors: []
  };
}

function toSyncError(
  error: unknown,
  fallback: Omit<SyncError, "message" | "retryable"> & { retryable?: boolean }
): SyncError {
  if (error instanceof GitHubApiError) {
    const code: SyncError["code"] =
      error.status === 429 || error.status === 403
        ? "rate_limited"
        : error.status === 0
          ? "network_error"
          : fallback.code;
    return {
      ...fallback,
      code,
      message: error.message,
      retryable: error.retryable
    };
  }
  if (error instanceof Error && error.message === "aborted") {
    return {
      ...fallback,
      code: "aborted",
      message: "Synchronization aborted.",
      retryable: false
    };
  }
  return {
    ...fallback,
    message: error instanceof Error ? error.message : "Unknown synchronization error",
    retryable: fallback.retryable ?? false
  };
}

export function createSourceSyncAdapter(params?: {
  registry?: SourceRegistry;
  client?: GitHubRepositoryClient;
}): SourceSyncAdapter {
  const registry = params?.registry ?? getDefaultSourceRegistry();
  validateSourceRegistry(registry);
  const client = params?.client ?? new GitHubRestRepositoryClient();

  return {
    createSyncPlan(sourceId: string, trackId: string): SyncPlan {
      const { source, track } = resolveSourceAndTrack(registry, sourceId, trackId);
      return {
        sourceId: source.id,
        trackId: track.id,
        repository: toRepositoryKey(source),
        branch: source.acquisition.branch,
        synchronizationEnabled: source.synchronizationEnabled && track.synchronizationEnabled,
        trackStatus: track.status,
        includeGlobs: [...track.includeGlobs],
        excludeGlobs: [...track.excludeGlobs]
      };
    },

    async syncTrack(params): Promise<SyncTrackResult> {
      const options: SyncOptions = {
        ...DEFAULT_SYNC_OPTIONS,
        ...params.options
      };

      let source: GitHubKnowledgeSourceDefinition;
      let track: SourceContentTrack;
      try {
        const resolved = resolveSourceAndTrack(registry, params.sourceId, params.trackId);
        source = resolved.source;
        track = resolved.track;
      } catch (error) {
        const mapped = mapLookupError(error as Error);
        return {
          source: {
            id: params.sourceId,
            trackId: params.trackId,
            repository: "unknown",
            branch: "unknown"
          },
          startCheckpoint: params.previousCheckpoint ?? null,
          endCheckpoint: null,
          resolvedCommitSha: null,
          added: [],
          modified: [],
          unchanged: [],
          deleted: [],
          skipped: [],
          errors: [mapped]
        };
      }

      const result = buildBaseResult({ source, track, previousCheckpoint: params.previousCheckpoint });

      if (!source.synchronizationEnabled || !track.synchronizationEnabled) {
        result.skipped.push({
          sourceId: source.id,
          trackId: track.id,
          repository: toRepositoryKey(source),
          branch: source.acquisition.branch,
          path: "",
          commitSha: "",
          blobSha: "",
          githubUrl: source.acquisition.webBaseUrl,
          rawUrl: source.acquisition.rawBaseUrl,
          changeType: "skipped",
          contentStatus: "not_requested",
          skippedReason: "synchronization_disabled"
        });
        result.errors.push({
          scope: "track",
          code: "sync_disabled",
          sourceId: source.id,
          trackId: track.id,
          message: "Synchronization disabled by source registry configuration.",
          retryable: false
        });
        return result;
      }

      let commitSha: string;
      try {
        ensureNotAborted(options.signal);
        commitSha = await client.resolveBranchHead({
          owner: source.acquisition.owner,
          repo: source.acquisition.repo,
          branch: source.acquisition.branch,
          signal: options.signal
        });
      } catch (error) {
        result.errors.push(
          toSyncError(error, {
            scope: "repository",
            code: "branch_resolution_failed",
            sourceId: source.id,
            trackId: track.id,
            retryable: true
          })
        );
        return result;
      }
      result.resolvedCommitSha = commitSha;

      try {
        ensureNotAborted(options.signal);
        const entries = await client.listTree({
          owner: source.acquisition.owner,
          repo: source.acquisition.repo,
          ref: commitSha,
          signal: options.signal
        });

        const previousFiles = params.previousCheckpoint?.files ?? {};
        const current = new Map<string, { blobSha: string }>();
        const matchedPaths: string[] = [];
        for (const entry of entries) {
          if (entry.type !== "blob") continue;
          const normalizedPath = normalizeRepoPath(entry.path);
          const eligible = isTrackEligiblePath(
            normalizedPath,
            track.includeGlobs,
            track.excludeGlobs
          );
          if (!eligible) {
            if (isMarkdownPath(normalizedPath)) {
              const urls = toSourceUrls(source, commitSha, normalizedPath);
              result.skipped.push({
                sourceId: source.id,
                trackId: track.id,
                repository: toRepositoryKey(source),
                branch: source.acquisition.branch,
                path: normalizedPath,
                commitSha,
                blobSha: entry.sha,
                githubUrl: urls.githubUrl,
                rawUrl: urls.rawUrl,
                changeType: "skipped",
                contentStatus: "not_requested",
                skippedReason: "filtered_by_track_globs"
              });
            }
            continue;
          }
          current.set(normalizedPath, { blobSha: entry.sha });
          matchedPaths.push(normalizedPath);
        }

        const currentDescriptors: SourceFileDescriptor[] = [];
        let fileFailureCount = 0;

        for (const path of matchedPaths) {
          ensureNotAborted(options.signal);
          const currentFile = current.get(path);
          if (!currentFile) continue;
          const previous = previousFiles[path];
          const changeType: SourceFileDescriptor["changeType"] =
            !previous ? "added" : previous.blobSha === currentFile.blobSha ? "unchanged" : "modified";
          const { githubUrl, rawUrl } = toSourceUrls(source, commitSha, path);
          const descriptor: SourceFileDescriptor = {
            sourceId: source.id,
            trackId: track.id,
            repository: toRepositoryKey(source),
            branch: source.acquisition.branch,
            path,
            commitSha,
            blobSha: currentFile.blobSha,
            githubUrl,
            rawUrl,
            changeType,
            contentStatus: "not_requested"
          };

          if (options.fetchContent && (changeType === "added" || changeType === "modified")) {
            try {
              const blob = await client.getBlobContent({
                owner: source.acquisition.owner,
                repo: source.acquisition.repo,
                blobSha: currentFile.blobSha,
                signal: options.signal
              });
              descriptor.content = blob.content;
              descriptor.contentSha256 = toContentHash(blob.content);
              descriptor.contentStatus = "available";
            } catch (error) {
              fileFailureCount += 1;
              descriptor.contentStatus = "failed";
              result.errors.push(
                toSyncError(error, {
                  scope: "file",
                  code: "file_fetch_failed",
                  sourceId: source.id,
                  trackId: track.id,
                  path,
                  retryable: true
                })
              );
              if (fileFailureCount >= options.maxFileFetchFailures) {
                result.errors.push({
                  scope: "track",
                  code: "file_fetch_failed",
                  sourceId: source.id,
                  trackId: track.id,
                  message: `Aborted file fetching after ${fileFailureCount} failures.`,
                  retryable: true
                });
                break;
              }
            }
          }

          currentDescriptors.push(descriptor);
          if (changeType === "added") result.added.push(descriptor);
          if (changeType === "modified") result.modified.push(descriptor);
          if (changeType === "unchanged") result.unchanged.push(descriptor);
        }

        const currentPathSet = new Set(matchedPaths);
        for (const [previousPath, previous] of Object.entries(previousFiles)) {
          if (currentPathSet.has(previousPath)) continue;
          const { githubUrl, rawUrl } = toSourceUrls(
            source,
            params.previousCheckpoint?.commitSha ?? commitSha,
            previousPath
          );
          result.deleted.push({
            sourceId: source.id,
            trackId: track.id,
            repository: toRepositoryKey(source),
            branch: source.acquisition.branch,
            path: previousPath,
            commitSha: params.previousCheckpoint?.commitSha ?? commitSha,
            blobSha: previous.blobSha,
            githubUrl,
            rawUrl,
            changeType: "deleted",
            contentStatus: "missing"
          });
        }

        result.endCheckpoint = buildEndCheckpoint(source.id, track.id, commitSha, [
          ...currentDescriptors,
          ...result.deleted
        ]);
        return result;
      } catch (error) {
        result.errors.push(
          toSyncError(error, {
            scope: "repository",
            code: "file_listing_failed",
            sourceId: source.id,
            trackId: track.id,
            retryable: true
          })
        );
        return result;
      }
    }
  };
}

