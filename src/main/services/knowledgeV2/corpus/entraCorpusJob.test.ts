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
  classifyEntraSubdomain,
  EntraCorpusJob,
  mapEntraRepoPathToLearnUrl
} from "./entraCorpusJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

async function makeTempPaths(): Promise<{ dbPath: string; artifactsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-k1-entra-"));
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
    sourceId: "ms-entra-docs",
    trackId: "ga",
    repository: "MicrosoftDocs/entra-docs",
    branch: "main",
    path: params.path,
    commitSha: params.commitSha,
    blobSha: params.blobSha,
    githubUrl: `https://github.com/MicrosoftDocs/entra-docs/blob/${params.commitSha}/${params.path}`,
    rawUrl: `https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/${params.commitSha}/${params.path}`,
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
      id: "ms-entra-docs",
      trackId: "ga",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main"
    },
    startCheckpoint: null,
    endCheckpoint: {
      sourceId: "ms-entra-docs",
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
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      synchronizationEnabled: true,
      trackStatus: "ga" as const,
      includeGlobs: [
        "docs/identity/conditional-access/**/*.md",
        "docs/identity/authentication/**/*.md",
        "docs/identity/role-based-access-control/**/*.md",
        "docs/identity/devices/**/*.md",
        "docs/identity-platform/**/*.md"
      ],
      excludeGlobs: ["**/archive/**", "**/media/**", "**/includes/**"]
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

test("maps Entra repo paths onto the existing /entra/ Learn namespace and does not invent other hosts", () => {
  assert.equal(
    mapEntraRepoPathToLearnUrl("docs/identity/conditional-access/overview.md"),
    "https://learn.microsoft.com/entra/identity/conditional-access/overview"
  );
  assert.equal(
    mapEntraRepoPathToLearnUrl("docs/identity-platform/quickstart-register-app.md"),
    "https://learn.microsoft.com/entra/identity-platform/quickstart-register-app"
  );
  assert.equal(mapEntraRepoPathToLearnUrl("README.md"), null);
  assert.equal(classifyEntraSubdomain("docs/identity/conditional-access/overview.md"), "conditional_access");
  assert.equal(classifyEntraSubdomain("docs/identity/devices/overview.md"), "device_identity");
  assert.equal(
    classifyEntraSubdomain("docs/identity-platform/quickstart-register-app.md"),
    "app_service_principal"
  );
});

test("plan mode consumes entra source path and does not mutate store", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-a",
      added: [
        descriptor({
          path: "docs/identity/conditional-access/overview.md",
          commitSha: "commit-a",
          blobSha: "blob-a",
          changeType: "added",
          content: "# Conditional Access overview\n\nRequire MFA for admin roles."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new EntraCorpusJob({
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
  assert.equal(result.source.sourceId, "ms-entra-docs");
  assert.deepEqual(result.source.authorityRoles, ["entra_identity_primary"]);
  assert.equal(result.source.eligibleFileCount, 1);
  assert.equal(result.execution, null);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    assert.equal(store.inspect().documentCount, 0);
    assert.equal(store.countActiveChunks(), 0);
  } finally {
    store.close();
  }
});

test("execute processes entra docs and persists Learn canonical URL plus github revision identity", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const sync = new StaticSyncAdapter([
    makeSyncResult({
      commitSha: "commit-b",
      added: [
        descriptor({
          path: "docs/identity/authentication/concept-mfa-howitworks.md",
          commitSha: "commit-b",
          blobSha: "blob-mfa",
          changeType: "added",
          content: "# How MFA works\n\nPer-user MFA differs from Conditional Access MFA."
        }),
        descriptor({
          path: "docs/identity/role-based-access-control/permissions-reference.md",
          commitSha: "commit-b",
          blobSha: "blob-rbac",
          changeType: "added",
          content: "# Role permissions\n\nExchange Administrator can manage Exchange without Global Administrator."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new EntraCorpusJob({
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
    assert.ok(store.inspect().documentCount >= 1);
    assert.ok(store.countActiveChunks() >= 1);
    const docs = store.listDocumentsBySource({ sourceId: "ms-entra-docs", trackId: "ga" });
    assert.ok(docs.every((doc) => doc.canonicalUrl.startsWith("https://learn.microsoft.com/entra/")));
    assert.ok(docs.every((doc) => doc.transport === "github"));
    const loaded = store.getKnowledgeDocument(docs[0]!.documentId);
    assert.equal(loaded?.sourceRevision.transport, "github");
    if (loaded?.sourceRevision.transport === "github") {
      assert.ok(loaded.sourceRevision.path.startsWith("docs/identity/"));
      assert.ok(loaded.sourceRevision.commitSha.length > 0);
      assert.ok(loaded.sourceRevision.blobSha.length > 0);
      assert.equal(loaded.sourceRevision.repository, "MicrosoftDocs/entra-docs");
    }
    const lexical = store.lexicalSearchChunks({
      query: "Conditional Access MFA",
      sourceId: "ms-entra-docs",
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
          path: "docs/identity-platform/quickstart-register-app.md",
          commitSha: "commit-c",
          blobSha: "blob-c1",
          changeType: "added",
          content: "# Register an application\n\nCreate an app registration and grant API permissions."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = new EntraCorpusJob({
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
      sourceId: "ms-entra-docs",
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
    path: "docs/identity/devices/overview.md",
    commitSha: "commit-d",
    blobSha: "blob-d",
    changeType: "added",
    content: "# Device identity\n\nRequire a compliant device for access to an app."
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
  const job = new EntraCorpusJob({
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
          path: "docs/identity/conditional-access/one.md",
          commitSha: "commit-e",
          blobSha: "blob-e1",
          changeType: "added",
          content: "# One\n\nConditional Access policy one."
        }),
        descriptor({
          path: "docs/identity/conditional-access/two.md",
          commitSha: "commit-e",
          blobSha: "blob-e2",
          changeType: "added",
          content: "# Two\n\nConditional Access policy two."
        })
      ]
    })
  ]);
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    delayMs: 50
  });
  const job = new EntraCorpusJob({
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
