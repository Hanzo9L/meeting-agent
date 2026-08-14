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
import {
  mapSharePointPowerShellPathToLearnUrl,
  SharePointPowerShellCorpusJob
} from "./sharePointPowerShellCorpusJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");
const REPO = "MicrosoftDocs/OfficeDocs-SharePoint-PowerShell";
const REPO_PATH = "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell";

async function makeTempPaths(): Promise<{ dbPath: string; artifactsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-k2-spo-ps-"));
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
    sourceId: "ms-sharepoint-powershell",
    trackId: "ga",
    repository: REPO,
    branch: "main",
    path: params.path,
    commitSha: params.commitSha,
    blobSha: params.blobSha,
    githubUrl: `https://github.com/${REPO}/blob/${params.commitSha}/${params.path}`,
    rawUrl: `https://raw.githubusercontent.com/${REPO}/${params.commitSha}/${params.path}`,
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
}): SyncTrackResult {
  return {
    source: { id: "ms-sharepoint-powershell", trackId: "ga", repository: REPO, branch: "main" },
    startCheckpoint: null,
    endCheckpoint: {
      sourceId: "ms-sharepoint-powershell",
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
    deleted: [],
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
      repository: REPO,
      branch: "main",
      synchronizationEnabled: true,
      trackStatus: "ga" as const,
      includeGlobs: [`${REPO_PATH}/**/*.md`],
      excludeGlobs: ["**/archive/**", "**/media/**"]
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
  return () => ({ provider, dimensions: 8, credentialAvailable: true });
}

test("maps a genuine SPO* cmdlet path to the deterministic Learn PowerShell-module URL", () => {
  assert.equal(
    mapSharePointPowerShellPathToLearnUrl(`${REPO_PATH}/Set-SPOSite.md`),
    "https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/set-sposite"
  );
  assert.equal(
    mapSharePointPowerShellPathToLearnUrl(`${REPO_PATH}/Get-SPOTenant.md`),
    "https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/get-spotenant"
  );
});

test("rejects paths outside the module directory, non-cmdlet files, and traversal attempts", () => {
  assert.equal(mapSharePointPowerShellPathToLearnUrl("README.md"), null);
  assert.equal(
    mapSharePointPowerShellPathToLearnUrl(`${REPO_PATH}/subfolder/Set-SPOSite.md`),
    null
  );
  assert.equal(mapSharePointPowerShellPathToLearnUrl(`${REPO_PATH}/overview.md`), null);
  assert.equal(mapSharePointPowerShellPathToLearnUrl(`${REPO_PATH}/../../etc/passwd.md`), null);
  // Teams cmdlet shape must not resolve through the SharePoint module mapping.
  assert.equal(mapSharePointPowerShellPathToLearnUrl(`${REPO_PATH}/Set-CsOnlineVoiceRoutingPolicy.md`), null);
});

test("plan mode consumes SharePoint PowerShell source path and does not mutate store", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-a",
      added: [
        descriptor({
          path: `${REPO_PATH}/Set-SPOSite.md`,
          commitSha: "commit-a",
          blobSha: "blob-a",
          changeType: "added",
          content: "# Set-SPOSite\n\nSets properties on a site, including sharing capability."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new SharePointPowerShellCorpusJob({
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
  assert.equal(result.source.sourceId, "ms-sharepoint-powershell");
  assert.deepEqual(result.source.authorityRoles, ["sharepoint_powershell_cmdlet_primary"]);
  assert.equal(result.execution, null);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    assert.equal(store.inspect().documentCount, 0);
  } finally {
    store.close();
  }
});

test("execute processes SPO cmdlet docs and persists the deterministic Learn PowerShell-module canonical URL", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-b",
      added: [
        descriptor({
          path: `${REPO_PATH}/Set-SPOSite.md`,
          commitSha: "commit-b",
          blobSha: "blob-b1",
          changeType: "added",
          content: "# Set-SPOSite\n\nSets properties on a site, including external sharing capability."
        }),
        descriptor({
          path: `${REPO_PATH}/Start-SPODataAccessGovernanceInsight.md`,
          commitSha: "commit-b",
          blobSha: "blob-b2",
          changeType: "added",
          content:
            "# Start-SPODataAccessGovernanceInsight\n\nGenerates data access governance reports for oversharing."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new SharePointPowerShellCorpusJob({
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
  assert.equal(result.corpusClassification, "LIMITED_REAL");
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const docs = store.listDocumentsBySource({ sourceId: "ms-sharepoint-powershell", trackId: "ga" });
    assert.ok(docs.length >= 1);
    assert.ok(
      docs.every((doc) =>
        doc.canonicalUrl.startsWith(
          "https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/"
        )
      )
    );
    assert.ok(docs.every((doc) => doc.transport === "github"));
  } finally {
    store.close();
  }
});

test("rerun idempotency reuses embeddings and avoids regeneration for unchanged SPO docs", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const firstDescriptor = descriptor({
    path: `${REPO_PATH}/Get-SPOSite.md`,
    commitSha: "commit-c",
    blobSha: "blob-c",
    changeType: "added",
    content: "# Get-SPOSite\n\nReturns information about sites."
  });
  const secondDescriptor = {
    ...firstDescriptor,
    changeType: "unchanged" as const,
    contentStatus: "not_requested" as const,
    content: undefined
  };
  const sync = new StaticSyncAdapter([
    makeSyncResult({ commitSha: "commit-c", added: [firstDescriptor] }),
    makeSyncResult({ commitSha: "commit-c", unchanged: [secondDescriptor] })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new SharePointPowerShellCorpusJob({
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
