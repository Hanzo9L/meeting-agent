import type { SourceRevision } from "../sourceTypes";

export interface AcquiredDocument {
  sourceId: string;
  trackId: string;
  transport: "github" | "learn_mcp";
  canonicalUrl: string;
  rawMarkdown: string;
  revision: SourceRevision;
  metadata: {
    title?: string;
    locale?: string;
    retrievedAt: string;
    sourcePath?: string;
    originalContentGitUrl?: string;
    gitCommitId?: string;
  };
}

export interface AcquisitionError {
  sourceId: string;
  trackId: string;
  transport: "github" | "learn_mcp";
  code:
    | "source_not_found"
    | "track_not_found"
    | "unsupported_transport"
    | "acquisition_failed"
    | "network_error"
    | "aborted"
    | "unknown";
  message: string;
  retryable: boolean;
}

export interface AcquisitionCheckpoint {
  sourceId: string;
  trackId: string;
  transport: "github" | "learn_mcp";
  lastRevisionFingerprint: string;
  lastAcquiredAt: string;
}

export interface AcquisitionResult {
  sourceId: string;
  trackId: string;
  transport: "github" | "learn_mcp";
  startCheckpoint: AcquisitionCheckpoint | null;
  endCheckpoint: AcquisitionCheckpoint | null;
  added: AcquiredDocument[];
  modified: AcquiredDocument[];
  unchanged: AcquiredDocument[];
  deleted: Array<{ sourcePath: string; revisionFingerprint: string }>;
  errors: AcquisitionError[];
}

export interface AcquireOptions {
  signal?: AbortSignal;
  maxDocuments?: number;
}

export interface SourceAcquisitionAdapter {
  acquire(params: {
    sourceId: string;
    trackId: string;
    previousCheckpoint?: AcquisitionCheckpoint | null;
    options?: AcquireOptions;
  }): Promise<AcquisitionResult>;
}

