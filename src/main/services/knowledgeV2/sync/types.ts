import type {
  GitHubTransportConfig,
  KnowledgeSourceDefinition,
  SourceContentTrack
} from "../sourceTypes";

export type GitHubKnowledgeSourceDefinition = KnowledgeSourceDefinition & {
  acquisition: GitHubTransportConfig;
};

export interface SourceTrackRef {
  sourceId: string;
  trackId: string;
}

export interface RepositoryIdentity {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
}

export interface SourceFileIdentity {
  sourceId: string;
  trackId: string;
  repository: string;
  branch: string;
  path: string;
  commitSha: string;
  blobSha: string;
  githubUrl: string;
  rawUrl: string;
}

export interface SourceFileDescriptor extends SourceFileIdentity {
  changeType: "added" | "modified" | "unchanged" | "deleted" | "skipped";
  contentStatus: "available" | "missing" | "not_requested" | "failed";
  content?: string;
  contentSha256?: string;
  skippedReason?: string;
}

export interface SyncError {
  scope: "source" | "track" | "repository" | "file";
  code:
    | "invalid_registry"
    | "source_not_found"
    | "track_not_found"
    | "sync_disabled"
    | "non_github_transport"
    | "branch_resolution_failed"
    | "file_listing_failed"
    | "file_fetch_failed"
    | "rate_limited"
    | "network_error"
    | "aborted"
    | "unknown";
  message: string;
  sourceId?: string;
  trackId?: string;
  path?: string;
  retryable: boolean;
}

export interface TrackCheckpoint {
  sourceId: string;
  trackId: string;
  commitSha: string;
  files: Record<string, { blobSha: string }>;
  lastSyncedAt: string;
}

export interface SyncTrackResult {
  source: {
    id: string;
    trackId: string;
    repository: string;
    branch: string;
  };
  startCheckpoint: TrackCheckpoint | null;
  endCheckpoint: TrackCheckpoint | null;
  resolvedCommitSha: string | null;
  added: SourceFileDescriptor[];
  modified: SourceFileDescriptor[];
  unchanged: SourceFileDescriptor[];
  deleted: SourceFileDescriptor[];
  skipped: SourceFileDescriptor[];
  errors: SyncError[];
}

export interface SyncPlan {
  sourceId: string;
  trackId: string;
  repository: string;
  branch: string;
  synchronizationEnabled: boolean;
  trackStatus: SourceContentTrack["status"];
  includeGlobs: string[];
  excludeGlobs: string[];
}

export interface GitTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

export interface GitHubRepositoryClient {
  resolveBranchHead(params: {
    owner: string;
    repo: string;
    branch: string;
    signal?: AbortSignal;
  }): Promise<string>;
  listTree(params: {
    owner: string;
    repo: string;
    ref: string;
    signal?: AbortSignal;
  }): Promise<GitTreeEntry[]>;
  getBlobContent(params: {
    owner: string;
    repo: string;
    blobSha: string;
    signal?: AbortSignal;
  }): Promise<{ content: string }>;
}

export interface SyncOptions {
  fetchContent: boolean;
  maxFileFetchFailures: number;
  signal?: AbortSignal;
}

export interface SourceSyncAdapter {
  createSyncPlan(sourceId: string, trackId: string): SyncPlan;
  syncTrack(params: {
    sourceId: string;
    trackId: string;
    previousCheckpoint?: TrackCheckpoint | null;
    options?: Partial<SyncOptions>;
  }): Promise<SyncTrackResult>;
}

export interface SourceResolution {
  source: GitHubKnowledgeSourceDefinition;
  track: SourceContentTrack;
}

