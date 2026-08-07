import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { FakeEmbeddingProvider } from "../embeddings/fakeEmbeddingProvider";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import type {
  SourceFileDescriptor,
  SourceSyncAdapter,
  SyncTrackResult,
  TrackCheckpoint
} from "../sync/types";
import { TeamsPowerShellCorpusJob } from "./teamsPowerShellCorpusJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempPaths(): Promise<{ dbPath: string; artifactsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-cg01d-"));
  return {
    dbPath: join(root, "knowledge-v2.sqlite"),
    artifactsDir: join(root, "artifacts")
  };
}

function descriptor(params: {
  path: string;
  commitSha: string;
  blobSha: string;
  content?: string;
  changeType: "added" | "modified" | "unchanged";
}): SourceFileDescriptor {
  return {
    sourceId: "ms-teams-powershell",
    trackId: "ga",
    repository: "MicrosoftDocs/office-docs-powershell",
    branch: "main",
    path: params.path,
    commitSha: params.commitSha,
    blobSha: params.blobSha,
    githubUrl: `https://github.com/MicrosoftDocs/office-docs-powershell/blob/${params.commitSha}/${params.path}`,
    rawUrl: `https://raw.githubusercontent.com/MicrosoftDocs/office-docs-powershell/${params.commitSha}/${params.path}`,
    changeType: params.changeType,
    contentStatus: params.content ? "available" : "not_requested",
    content: params.content
  };
}

function makeSyncResult(params: {
  commitSha: string;
  added?: ReturnType<typeof descriptor>[];
  modified?: ReturnType<typeof descriptor>[];
  unchanged?: ReturnType<typeof descriptor>[];
  deleted?: Array<{ path: string; blobSha: string }>;
}): SyncTrackResult {
  return {
    source: {
      id: "ms-teams-powershell",
      trackId: "ga",
      repository: "MicrosoftDocs/office-docs-powershell",
      branch: "main"
    },
    startCheckpoint: null,
    endCheckpoint: {
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      commitSha: params.commitSha,
      files: Object.fromEntries(
        [...(params.added ?? []), ...(params.modified ?? []), ...(params.unchanged ?? [])].map((d) => [
          d.path,
          { blobSha: d.blobSha }
        ])
      ),
      lastSyncedAt: new Date().toISOString()
    },
    resolvedCommitSha: params.commitSha,
    added: params.added ?? [],
    modified: params.modified ?? [],
    unchanged: params.unchanged ?? [],
    deleted:
      params.deleted?.map((d) => ({
        ...descriptor({
          path: d.path,
          commitSha: params.commitSha,
          blobSha: d.blobSha,
          changeType: "unchanged"
        }),
        changeType: "deleted" as const,
        contentStatus: "missing" as const
      })) ?? [],
    skipped: [],
    errors: []
  };
}

class StaticSyncAdapter implements SourceSyncAdapter {
  calls = 0;
  constructor(private readonly sequence: SyncTrackResult[]) {}

  createSyncPlan(sourceId: string, trackId: string) {
    return {
      sourceId,
      trackId,
      repository: "MicrosoftDocs/office-docs-powershell",
      branch: "main",
      synchronizationEnabled: true,
      trackStatus: "ga" as const,
      includeGlobs: ["teams/docs-conceptual/**/*.md", "teams/teams-ps/MicrosoftTeams/**/*.md"],
      excludeGlobs: []
    };
  }

  async syncTrack(_: {
    sourceId: string;
    trackId: string;
    previousCheckpoint?: TrackCheckpoint | null;
  }): Promise<SyncTrackResult> {
    const result = this.sequence[Math.min(this.calls, this.sequence.length - 1)];
    this.calls += 1;
    if (!result) throw new Error("missing_mock_sync_result");
    return result;
  }
}

function providerFactory(provider: FakeEmbeddingProvider) {
  return () => ({
    provider,
    dimensions: 8,
    credentialAvailable: true
  });
}

test("plan mode consumes powershell source path and does not mutate store", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-a",
      added: [
        descriptor({
          path: "teams/teams-ps/MicrosoftTeams/Set-CsOnlineVoiceRoutingPolicy.md",
          commitSha: "commit-a",
          blobSha: "blob-a",
          changeType: "added",
          content: "# Set-CsOnlineVoiceRoutingPolicy\n\n## SYNOPSIS\n\nSets policy."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new TeamsPowerShellCorpusJob({
    syncAdapter: sync,
    createEmbeddingProvider: providerFactory(provider)
  });
  const result = await job.run({
    mode: "plan",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(sync.calls, 1);
  assert.equal(result.source.sourceId, "ms-teams-powershell");
  assert.equal(result.source.eligibleFileCount, 1);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    assert.equal(store.inspect().documentCount, 0);
    assert.equal(store.countActiveChunks(), 0);
  } finally {
    store.close();
  }
});

test("execute processes multiple docs and failure isolation preserves successful docs", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-b",
      added: [
        descriptor({
          path: "teams/docs-conceptual/voice-routing.md",
          commitSha: "commit-b",
          blobSha: "blob-v",
          changeType: "added",
          content: "# Voice routing\n\nPSTN usage and route policy."
        }),
        descriptor({
          path: "teams/teams-ps/MicrosoftTeams/Broken.md",
          commitSha: "commit-b",
          blobSha: "blob-b",
          changeType: "added",
          content: "---\ntitle: [bad\n# Broken"
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new TeamsPowerShellCorpusJob({
    syncAdapter: sync,
    createEmbeddingProvider: providerFactory(provider)
  });
  const result = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(result.execution?.attempted, 2);
  assert.ok(result.execution && result.execution.succeeded >= 1);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    assert.ok(store.inspect().documentCount >= 1);
    assert.ok(store.countActiveChunks() >= 1);
    const lexical = store.lexicalSearchChunks({
      query: "voice routing",
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      limit: 5
    });
    assert.ok(lexical.length > 0);
  } finally {
    store.close();
  }
});

test("execute updates checkpoint only on fully successful run", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-c",
      added: [
        descriptor({
          path: "teams/teams-ps/MicrosoftTeams/First.md",
          commitSha: "commit-c",
          blobSha: "blob-c1",
          changeType: "added",
          content: "# First\n\n## SYNOPSIS\n\nFirst cmdlet"
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new TeamsPowerShellCorpusJob({
    syncAdapter: sync,
    createEmbeddingProvider: providerFactory(provider)
  });
  const result = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(result.sync.checkpointUpdated, true);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const checkpoint = store.getSyncCheckpoint({
      sourceId: "ms-teams-powershell",
      trackId: "ga"
    });
    assert.equal(checkpoint?.status, "ok");
    assert.equal(checkpoint?.lastRevisionFingerprint, "commit-c");
  } finally {
    store.close();
  }
});

test("rerun idempotency reuses embeddings and avoids generation calls", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const firstDescriptor = descriptor({
    path: "teams/teams-ps/MicrosoftTeams/Set-CsOnlineVoiceRoutingPolicy.md",
    commitSha: "commit-d",
    blobSha: "blob-d",
    changeType: "added",
    content: "# Set-CsOnlineVoiceRoutingPolicy\n\n## SYNOPSIS\n\nSet policy"
  });
  const secondDescriptor = {
    ...firstDescriptor,
    changeType: "unchanged" as const,
    contentStatus: "not_requested" as const,
    content: undefined
  };
  const sync = new StaticSyncAdapter([
    makeSyncResult({ commitSha: "commit-d", added: [firstDescriptor] }),
    makeSyncResult({ commitSha: "commit-d", unchanged: [secondDescriptor] })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new TeamsPowerShellCorpusJob({
    syncAdapter: sync,
    createEmbeddingProvider: providerFactory(provider)
  });
  const first = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  const callsAfterFirst = provider.getDocumentCallCount();
  const second = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.ok(first.embeddingUsage.generated > 0);
  assert.equal(second.embeddingUsage.generated, 0);
  assert.ok(second.embeddingUsage.reused > 0);
  assert.equal(provider.getDocumentCallCount(), callsAfterFirst);
});

test("cancellation preserves committed progress for already indexed docs", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-e",
      added: [
        descriptor({
          path: "teams/docs-conceptual/one.md",
          commitSha: "commit-e",
          blobSha: "blob-e1",
          changeType: "added",
          content: "# One\n\nVoice policy one."
        }),
        descriptor({
          path: "teams/docs-conceptual/two.md",
          commitSha: "commit-e",
          blobSha: "blob-e2",
          changeType: "added",
          content: "# Two\n\nVoice policy two."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    delayMs: 50
  });
  const job = new TeamsPowerShellCorpusJob({
    syncAdapter: sync,
    createEmbeddingProvider: providerFactory(provider)
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 40);
  const result = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1",
    signal: controller.signal
  });
  assert.equal(result.cancelled, true);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    assert.ok(store.inspect().documentCount >= 1);
  } finally {
    store.close();
  }
});
