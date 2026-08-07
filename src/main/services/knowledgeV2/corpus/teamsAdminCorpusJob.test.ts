import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { FakeEmbeddingProvider } from "../embeddings/fakeEmbeddingProvider";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { encodeFloat32Vector } from "../store/embeddingCodec";
import { TeamsAdminCorpusJob } from "./teamsAdminCorpusJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

type FetchFixture = Record<string, string>;

class MockLearnFetchClient {
  initializeCalls = 0;
  listToolsCalls = 0;
  fetchCalls = 0;

  constructor(
    private readonly fixtures: FetchFixture,
    private readonly failures: Set<string> = new Set()
  ) {}

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  async listTools(): Promise<Array<{ name: string }>> {
    this.listToolsCalls += 1;
    return [{ name: "microsoft_docs_fetch" }, { name: "microsoft_docs_search" }];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!name.toLowerCase().includes("fetch")) {
      throw new Error("unexpected_tool");
    }
    const url = String(args.url ?? "");
    this.fetchCalls += 1;
    if (this.failures.has(url)) throw new Error("network_error_fixture");
    const markdown = this.fixtures[url];
    if (!markdown) throw new Error("not_found_fixture");
    return { markdown };
  }
}

async function makeTempPaths(): Promise<{
  root: string;
  dbPath: string;
  artifactsDir: string;
  manifestPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-cg01e2-"));
  return {
    root,
    dbPath: join(root, "knowledge-v2.sqlite"),
    artifactsDir: join(root, "artifacts"),
    manifestPath: join(root, "manifest.json")
  };
}

function entry(url: string, include = true): Record<string, unknown> {
  const pathname = new URL(url).pathname.replace(/^\/en-us/, "");
  const leaf = pathname.split("/").filter(Boolean).at(-1) ?? "doc";
  return {
    entryId: `ta-${leaf}`,
    canonicalUrl: url,
    articlePath: pathname.toLowerCase(),
    title: leaf,
    taxonomyDomains: ["voice_calling"],
    discoveryQueryIds: ["Q1"],
    discoveryRunIds: ["R1"],
    discoveryTopics: ["calling_plans_setup"],
    classification: {
      baseOriginalStatus: "accepted",
      baseSanitizedStatus: "accepted",
      targetedStatus: null,
      baseOriginalReasonCodes: ["accepted_teams_admin_namespace"],
      baseSanitizedReasonCodes: ["accepted_teams_admin_namespace"],
      targetedStatuses: [],
      targetedReasonCodes: []
    },
    humanApproval: {
      include,
      reasons: ["sanitized_deterministic_accept"],
      notes: []
    }
  };
}

function markdown(title: string, body: string): string {
  return `---\ntitle: ${title}\nms.topic: concept\n---\n\n# ${title}\n\n${body}\n`;
}

async function writeManifest(path: string, entries: Array<Record<string, unknown>>): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        runId: "cg01e1h-test",
        environmentProfileHint: { targetPstnModel: "microsoft_calling_plans" },
        entries
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function seedPowerShell(storePath: string): Promise<void> {
  const store = createKnowledgeV2SqliteStore({
    databasePath: storePath,
    migrationsDir: MIGRATIONS_DIR
  });
  store.initializeDatabase();
  try {
    const parsed = parseCanonicalDocument({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl: "https://example.com/ps",
      rawMarkdown: "# Set-CsOnlineVoiceRoutingPolicy\n\n## SYNOPSIS\n\nVoice policy cmdlet.",
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "seed",
        blobSha: "seedblob",
        path: "teams/teams-ps/MicrosoftTeams/Set-CsOnlineVoiceRoutingPolicy.md"
      }
    });
    assert.ok(parsed.document);
    const saved = store.saveKnowledgeDocument(parsed.document, { parserVersion: "seed-v1" });
    store.saveChunkPlaceholder({
      chunkId: "ps-seed-chunk",
      documentId: saved.documentId,
      sectionId: "synopsis",
      headingPath: ["Set-CsOnlineVoiceRoutingPolicy"],
      chunkKind: "powershell_conceptual",
      text: "Set-CsOnlineVoiceRoutingPolicy sets routing policy",
      sourceOrder: 1,
      contentHash: "pshash",
      provenance: {},
      metadata: {}
    });
    store.saveChunkEmbedding({
      chunkId: "ps-seed-chunk",
      providerId: "fake",
      model: "fake",
      dimensions: 8,
      embeddingSchemaVersion: "v1",
      inputContentHash: "pshash",
      vectorBlob: new Uint8Array(encodeFloat32Vector([1, 2, 3, 4, 5, 6, 7, 8])),
      usage: { requestCount: 1, batchSize: 1, inputTokens: 10 }
    });
  } finally {
    store.close();
  }
}

function createJob(client: MockLearnFetchClient, provider: FakeEmbeddingProvider): TeamsAdminCorpusJob {
  return new TeamsAdminCorpusJob({
    fetchClientFactory: () => client,
    createEmbeddingProvider: () => ({
      provider,
      dimensions: 8,
      credentialAvailable: true,
      providerId: provider.providerId
    })
  });
}

test("plan uses approved manifest only and does not mutate corpus", async () => {
  const { dbPath, artifactsDir, manifestPath } = await makeTempPaths();
  await seedPowerShell(dbPath);
  const approved = "https://learn.microsoft.com/en-us/microsoftteams/set-up-calling-plans";
  const notApproved = "https://learn.microsoft.com/en-us/microsoftteams/unapproved-doc";
  await writeManifest(manifestPath, [entry(approved, true), entry(notApproved, false)]);
  const client = new MockLearnFetchClient({
    [approved]: markdown("Set up Microsoft Calling Plans", "Admin setup and phone numbers.")
  });
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = createJob(client, provider);
  const result = await job.run({
    mode: "plan",
    approvedManifestPath: manifestPath,
    dbPath,
    artifactsDir,
    parserVersion: "cg01c-parser-v1",
    chunkerVersion: "cg01a-v1"
  });
  assert.equal(result.approvedArticleCount, 1);
  assert.equal(result.fetch.attempted, 1);
  assert.equal(result.documents.inserted, 0);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const docs = store.listDocumentsBySource({ sourceId: "ms-teams-admin", trackId: "ga" });
    assert.equal(docs.length, 0);
  } finally {
    store.close();
  }
});

test("execute deduplicates manifest and indexes only approved entries", async () => {
  const { dbPath, artifactsDir, manifestPath } = await makeTempPaths();
  await seedPowerShell(dbPath);
  const urlA = "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365";
  const urlADupe = "https://learn.microsoft.com/microsoftteams/calling-plans-for-office-365";
  const urlB = "https://learn.microsoft.com/en-us/microsoftteams/phone-number-calling-plans/transfer-phone-numbers-to-teams";
  await writeManifest(manifestPath, [entry(urlA, true), entry(urlADupe, true), entry(urlB, true)]);
  const client = new MockLearnFetchClient({
    "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365": markdown(
      "Microsoft Teams Calling Plans",
      "Calling Plans overview and PSTN carrier model."
    ),
    "https://learn.microsoft.com/en-us/microsoftteams/phone-number-calling-plans/transfer-phone-numbers-to-teams":
      markdown("Submitting a port request", "Transfer numbers, port order, assign users.")
  });
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = createJob(client, provider);
  const result = await job.run({
    mode: "execute",
    approvedManifestPath: manifestPath,
    dbPath,
    artifactsDir,
    parserVersion: "cg01c-parser-v1",
    chunkerVersion: "cg01a-v1"
  });
  assert.equal(result.approvedArticleCount, 2);
  assert.equal(result.fetch.attempted, 2);
  assert.equal(result.fetch.failed, 0);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const docs = store.listDocumentsBySource({ sourceId: "ms-teams-admin", trackId: "ga" });
    assert.equal(docs.length, 2);
  } finally {
    store.close();
  }
  assert.equal(result.powerShellSafety.unchanged, true);
});

test("per-article fetch failure is isolated and unchanged second run is incremental", async () => {
  const { dbPath, artifactsDir, manifestPath } = await makeTempPaths();
  await seedPowerShell(dbPath);
  const okUrl = "https://learn.microsoft.com/en-us/microsoftteams/pstn-connectivity";
  const failUrl = "https://learn.microsoft.com/en-us/microsoftteams/set-up-calling-plans";
  await writeManifest(manifestPath, [entry(okUrl, true), entry(failUrl, true)]);
  const client = new MockLearnFetchClient(
    {
      [okUrl]: markdown("PSTN connectivity options", "Calling Plans, Direct Routing, Operator Connect.")
    },
    new Set([failUrl])
  );
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = createJob(client, provider);
  const first = await job.run({
    mode: "execute",
    approvedManifestPath: manifestPath,
    dbPath,
    artifactsDir,
    parserVersion: "cg01c-parser-v1",
    chunkerVersion: "cg01a-v1"
  });
  assert.equal(first.fetch.failed, 1);
  assert.ok(first.failures.some((failure) => failure.canonicalUrl === failUrl && failure.stage === "fetch"));
  const embeddingCallsAfterFirst = provider.getDocumentCallCount();

  const secondClient = new MockLearnFetchClient({
    [okUrl]: markdown("PSTN connectivity options", "Calling Plans, Direct Routing, Operator Connect."),
    [failUrl]: markdown("Set up Microsoft Calling Plans", "Step-by-step setup.")
  });
  const secondJob = createJob(secondClient, provider);
  const second = await secondJob.run({
    mode: "execute",
    approvedManifestPath: manifestPath,
    dbPath,
    artifactsDir,
    parserVersion: "cg01c-parser-v1",
    chunkerVersion: "cg01a-v1"
  });
  assert.equal(second.fetch.failed, 0);
  assert.ok(second.lifecycleTotals.parseReused >= 1);
  assert.ok(second.embeddings.reused >= 1);
  assert.equal(provider.getDocumentCallCount(), embeddingCallsAfterFirst + 1);
  assert.equal(second.powerShellSafety.unchanged, true);
});
