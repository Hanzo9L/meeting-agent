import { createHash } from "node:crypto";
import { createSourceSyncAdapter } from "../sync/sourceSyncJobs";
import type { AcquisitionCheckpoint, AcquisitionResult, SourceAcquisitionAdapter } from "./types";

function fingerprintFromCommitAndPath(commitSha: string, path: string): string {
  return createHash("sha256").update(`${commitSha}:${path}`).digest("hex");
}

function toCheckpoint(sourceId: string, trackId: string, commitSha: string): AcquisitionCheckpoint {
  return {
    sourceId,
    trackId,
    transport: "github",
    lastRevisionFingerprint: commitSha,
    lastAcquiredAt: new Date().toISOString()
  };
}

export function createGitHubAcquisitionAdapter(): SourceAcquisitionAdapter {
  const syncAdapter = createSourceSyncAdapter();
  return {
    async acquire(params): Promise<AcquisitionResult> {
      const result = await syncAdapter.syncTrack({
        sourceId: params.sourceId,
        trackId: params.trackId,
        previousCheckpoint: params.previousCheckpoint
          ? {
              sourceId: params.previousCheckpoint.sourceId,
              trackId: params.previousCheckpoint.trackId,
              commitSha: params.previousCheckpoint.lastRevisionFingerprint,
              files: {},
              lastSyncedAt: params.previousCheckpoint.lastAcquiredAt
            }
          : null,
        options: {
          signal: params.options?.signal,
          fetchContent: true,
          maxFileFetchFailures: 50
        }
      });

      const mapDocument = (item: (typeof result.added)[number]) => ({
        sourceId: item.sourceId,
        trackId: item.trackId,
        transport: "github" as const,
        canonicalUrl: item.githubUrl,
        rawMarkdown: item.content ?? "",
        revision: {
          transport: "github" as const,
          repository: item.repository,
          branch: item.branch,
          commitSha: item.commitSha,
          blobSha: item.blobSha,
          path: item.path
        },
        metadata: {
          retrievedAt: new Date().toISOString(),
          sourcePath: item.path
        }
      });

      return {
        sourceId: params.sourceId,
        trackId: params.trackId,
        transport: "github",
        startCheckpoint: params.previousCheckpoint ?? null,
        endCheckpoint: result.resolvedCommitSha
          ? toCheckpoint(params.sourceId, params.trackId, result.resolvedCommitSha)
          : null,
        added: result.added.map(mapDocument),
        modified: result.modified.map(mapDocument),
        unchanged: result.unchanged.map(mapDocument),
        deleted: result.deleted.map((item) => ({
          sourcePath: item.path,
          revisionFingerprint: fingerprintFromCommitAndPath(item.commitSha, item.path)
        })),
        errors: result.errors.map((error) => ({
          sourceId: params.sourceId,
          trackId: params.trackId,
          transport: "github" as const,
          code:
            error.code === "source_not_found" ||
            error.code === "track_not_found" ||
            error.code === "network_error" ||
            error.code === "aborted"
              ? error.code
              : error.code === "non_github_transport"
                ? "unsupported_transport"
                : "acquisition_failed",
          message: error.message,
          retryable: error.retryable
        }))
      };
    }
  };
}

