import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultSourceRegistry } from "../sourceRegistry";
import { createSourceSyncAdapter } from "./sourceSyncJobs";
import type { GitHubRepositoryClient, GitTreeEntry, TrackCheckpoint } from "./types";

class MockGitHubRepositoryClient implements GitHubRepositoryClient {
  readonly heads = new Map<string, string>();
  readonly trees = new Map<string, GitTreeEntry[]>();
  readonly blobs = new Map<string, string>();
  readonly failingBlobShas = new Set<string>();

  setHead(owner: string, repo: string, branch: string, sha: string): void {
    this.heads.set(`${owner}/${repo}#${branch}`, sha);
  }

  setTree(owner: string, repo: string, ref: string, tree: GitTreeEntry[]): void {
    this.trees.set(`${owner}/${repo}@${ref}`, tree);
  }

  setBlob(sha: string, content: string): void {
    this.blobs.set(sha, content);
  }

  async resolveBranchHead(params: { owner: string; repo: string; branch: string }): Promise<string> {
    const value = this.heads.get(`${params.owner}/${params.repo}#${params.branch}`);
    if (!value) throw new Error("missing head");
    return value;
  }

  async listTree(params: { owner: string; repo: string; ref: string }): Promise<GitTreeEntry[]> {
    return this.trees.get(`${params.owner}/${params.repo}@${params.ref}`) ?? [];
  }

  async getBlobContent(params: { blobSha: string }): Promise<{ content: string }> {
    if (this.failingBlobShas.has(params.blobSha)) {
      throw new Error(`failed blob ${params.blobSha}`);
    }
    const value = this.blobs.get(params.blobSha);
    if (!value) throw new Error("missing blob");
    return { content: value };
  }
}

function makeTeamsPowerShellClient(ref = "commit-a"): MockGitHubRepositoryClient {
  const client = new MockGitHubRepositoryClient();
  client.setHead("MicrosoftDocs", "office-docs-powershell", "main", ref);
  client.setTree("MicrosoftDocs", "office-docs-powershell", ref, [
    { path: "teams/docs-conceptual/voice-routing.md", sha: "blob-1", type: "blob" },
    { path: "teams/teams-ps/MicrosoftTeams/Grant-CsOnlineVoiceRoutingPolicy.md", sha: "blob-2", type: "blob" },
    { path: "teams/archive/old.md", sha: "blob-3", type: "blob" },
    { path: "README.md", sha: "blob-4", type: "blob" }
  ]);
  client.setBlob("blob-1", "---\ntitle: routing\n---\n# Voice routing");
  client.setBlob("blob-2", "# Grant cmdlet");
  client.setBlob("blob-3", "# Archived");
  client.setBlob("blob-4", "# Root readme");
  return client;
}

test("builds sync plan directly from source registry", () => {
  const adapter = createSourceSyncAdapter({ client: new MockGitHubRepositoryClient() });
  const plan = adapter.createSyncPlan("ms-teams-powershell", "ga");
  assert.equal(plan.repository, "MicrosoftDocs/office-docs-powershell");
  assert.equal(plan.branch, "main");
  assert.ok(plan.includeGlobs.includes("teams/docs-conceptual/**/*.md"));
});

test("initial sync marks eligible files as added and preserves provenance", async () => {
  const client = makeTeamsPowerShellClient();
  const adapter = createSourceSyncAdapter({ client });
  const result = await adapter.syncTrack({
    sourceId: "ms-teams-powershell",
    trackId: "ga"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.added.length, 2);
  assert.equal(result.modified.length, 0);
  assert.equal(result.unchanged.length, 0);
  assert.equal(result.deleted.length, 0);
  assert.ok(result.skipped.length >= 1);
  assert.ok(result.skipped.some((item) => item.path === "teams/archive/old.md"));
  assert.equal(result.resolvedCommitSha, "commit-a");
  assert.equal(result.added[0]?.sourceId, "ms-teams-powershell");
  assert.equal(result.added[0]?.trackId, "ga");
  assert.equal(result.added[0]?.repository, "MicrosoftDocs/office-docs-powershell");
  assert.equal(result.added[0]?.branch, "main");
  assert.ok(result.added[0]?.blobSha);
  assert.ok(result.added[0]?.contentSha256);
  assert.ok(result.added[0]?.githubUrl.includes("/blob/commit-a/teams/"));
});

test("incremental sync identifies unchanged, modified, added, and deleted files", async () => {
  const client = makeTeamsPowerShellClient("commit-b");
  client.setTree("MicrosoftDocs", "office-docs-powershell", "commit-b", [
    { path: "teams/docs-conceptual/voice-routing.md", sha: "blob-1", type: "blob" },
    {
      path: "teams/teams-ps/MicrosoftTeams/Grant-CsOnlineVoiceRoutingPolicy.md",
      sha: "blob-2-new",
      type: "blob"
    },
    { path: "teams/docs-conceptual/new-file.md", sha: "blob-5", type: "blob" }
  ]);
  client.setBlob("blob-2-new", "# Grant cmdlet updated");
  client.setBlob("blob-5", "# New content");

  const previousCheckpoint: TrackCheckpoint = {
    sourceId: "ms-teams-powershell",
    trackId: "ga",
    commitSha: "commit-a",
    files: {
      "teams/docs-conceptual/voice-routing.md": { blobSha: "blob-1" },
      "teams/teams-ps/MicrosoftTeams/Grant-CsOnlineVoiceRoutingPolicy.md": { blobSha: "blob-2" },
      "teams/docs-conceptual/removed.md": { blobSha: "blob-9" }
    },
    lastSyncedAt: "2026-01-01T00:00:00.000Z"
  };

  const adapter = createSourceSyncAdapter({ client });
  const result = await adapter.syncTrack({
    sourceId: "ms-teams-powershell",
    trackId: "ga",
    previousCheckpoint
  });

  assert.equal(result.added.length, 1);
  assert.equal(result.modified.length, 1);
  assert.equal(result.unchanged.length, 1);
  assert.equal(result.deleted.length, 1);
  assert.equal(result.added[0]?.path, "teams/docs-conceptual/new-file.md");
  assert.equal(
    result.modified[0]?.path,
    "teams/teams-ps/MicrosoftTeams/Grant-CsOnlineVoiceRoutingPolicy.md"
  );
  assert.equal(result.unchanged[0]?.path, "teams/docs-conceptual/voice-routing.md");
  assert.equal(result.deleted[0]?.path, "teams/docs-conceptual/removed.md");
});

test("isolates per-file failures without corrupting entire sync", async () => {
  const client = makeTeamsPowerShellClient();
  client.failingBlobShas.add("blob-2");
  const adapter = createSourceSyncAdapter({ client });
  const result = await adapter.syncTrack({
    sourceId: "ms-teams-powershell",
    trackId: "ga"
  });

  assert.equal(result.added.length, 2);
  assert.ok(result.errors.length >= 1);
  const failed = result.added.find((item) => item.blobSha === "blob-2");
  assert.equal(failed?.contentStatus, "failed");
  const success = result.added.find((item) => item.blobSha === "blob-1");
  assert.equal(success?.contentStatus, "available");
});

test("fails clearly for invalid source IDs", async () => {
  const adapter = createSourceSyncAdapter({ client: new MockGitHubRepositoryClient() });
  const result = await adapter.syncTrack({
    sourceId: "not-a-source",
    trackId: "ga"
  });
  assert.equal(result.errors[0]?.code, "source_not_found");
});

test("fails clearly for non-github transport source", async () => {
  const adapter = createSourceSyncAdapter({ client: new MockGitHubRepositoryClient() });
  const result = await adapter.syncTrack({
    sourceId: "ms-teams-admin",
    trackId: "ga"
  });
  assert.equal(result.errors[0]?.code, "non_github_transport");
});

test("skips disabled synchronization tracks", async () => {
  const registry = getDefaultSourceRegistry();
  const graph = registry.sources.find((source) => source.id === "ms-graph-docs");
  if (!graph) throw new Error("missing graph source");
  const client = new MockGitHubRepositoryClient();
  const adapter = createSourceSyncAdapter({ registry, client });
  const result = await adapter.syncTrack({
    sourceId: "ms-graph-docs",
    trackId: "v1-ga"
  });
  assert.equal(result.errors[0]?.code, "sync_disabled");
  assert.equal(result.skipped[0]?.skippedReason, "synchronization_disabled");
});

test("supports Graph GA/beta track separation in plans", () => {
  const adapter = createSourceSyncAdapter({ client: new MockGitHubRepositoryClient() });
  const gaPlan = adapter.createSyncPlan("ms-graph-docs", "v1-ga");
  const betaPlan = adapter.createSyncPlan("ms-graph-docs", "beta-preview");
  assert.equal(gaPlan.trackStatus, "ga");
  assert.equal(betaPlan.trackStatus, "beta");
  assert.equal(gaPlan.includeGlobs[0], "api-reference/v1.0/**/*.md");
  assert.equal(betaPlan.includeGlobs[0], "api-reference/beta/**/*.md");
});

test("supports Teams PowerShell dual include paths from registry", async () => {
  const client = new MockGitHubRepositoryClient();
  client.setHead("MicrosoftDocs", "office-docs-powershell", "main", "commit-ps");
  client.setTree("MicrosoftDocs", "office-docs-powershell", "commit-ps", [
    { path: "teams/docs-conceptual/voice-routing.md", sha: "ps-1", type: "blob" },
    { path: "teams/teams-ps/MicrosoftTeams/Grant-CsOnlineVoiceRoutingPolicy.md", sha: "ps-2", type: "blob" },
    { path: "teams/other/ignore.txt", sha: "ps-3", type: "blob" }
  ]);
  client.setBlob("ps-1", "# conceptual");
  client.setBlob("ps-2", "# cmdlet");
  client.setBlob("ps-3", "ignored");

  const adapter = createSourceSyncAdapter({ client });
  const result = await adapter.syncTrack({
    sourceId: "ms-teams-powershell",
    trackId: "ga"
  });

  assert.equal(result.added.length, 2);
  const paths = result.added.map((item) => item.path).sort();
  assert.deepEqual(paths, [
    "teams/docs-conceptual/voice-routing.md",
    "teams/teams-ps/MicrosoftTeams/Grant-CsOnlineVoiceRoutingPolicy.md"
  ]);
});

