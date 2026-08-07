import { getSourceById } from "../sourceRegistry";
import { createGitHubAcquisitionAdapter } from "./githubAcquisitionAdapter";
import { createLearnMcpAcquisitionAdapter } from "./learnMcpAcquisitionAdapter";
import type {
  AcquisitionResult,
  SourceAcquisitionAdapter,
  AcquisitionCheckpoint,
  AcquireOptions
} from "./types";

export class SourceAcquisitionCoordinator {
  private readonly githubAdapter: SourceAcquisitionAdapter;
  private readonly learnMcpAdapter: SourceAcquisitionAdapter;

  constructor(params?: {
    githubAdapter?: SourceAcquisitionAdapter;
    learnMcpAdapter?: SourceAcquisitionAdapter;
  }) {
    this.githubAdapter = params?.githubAdapter ?? createGitHubAcquisitionAdapter();
    this.learnMcpAdapter = params?.learnMcpAdapter ?? createLearnMcpAcquisitionAdapter();
  }

  async acquire(params: {
    sourceId: string;
    trackId: string;
    previousCheckpoint?: AcquisitionCheckpoint | null;
    options?: AcquireOptions;
  }): Promise<AcquisitionResult> {
    const source = getSourceById(params.sourceId);
    if (!source) {
      return {
        sourceId: params.sourceId,
        trackId: params.trackId,
        transport: "github",
        startCheckpoint: params.previousCheckpoint ?? null,
        endCheckpoint: null,
        added: [],
        modified: [],
        unchanged: [],
        deleted: [],
        errors: [
          {
            sourceId: params.sourceId,
            trackId: params.trackId,
            transport: "github",
            code: "source_not_found",
            message: `Unknown source ${params.sourceId}.`,
            retryable: false
          }
        ]
      };
    }

    if (source.acquisition.transport === "github") {
      return this.githubAdapter.acquire(params);
    }
    return this.learnMcpAdapter.acquire(params);
  }
}

