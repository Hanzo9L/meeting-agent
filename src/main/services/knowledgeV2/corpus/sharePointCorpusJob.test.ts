import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { FakeEmbeddingProvider } from "../embeddings/fakeEmbeddingProvider";
import { createKnowledgeV2SqliteStore } from "../store/sqliteStore";
import { classifySharePointSubdomain, SharePointCorpusJob } from "./sharePointCorpusJob";

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");

const RESTRICTED_CONTENT_DISCOVERY = "https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery";
const CHANGE_EXTERNAL_SHARING = "https://learn.microsoft.com/en-us/sharepoint/change-external-sharing-site";

type FetchFixture = Record<string, string>;

class MockLearnFetchClient {
  initializeCalls = 0;
  fetchCalls = 0;

  constructor(
    private readonly fixtures: FetchFixture,
    private readonly failures: Set<string> = new Set()
  ) {}

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  async listTools(): Promise<Array<{ name: string }>> {
    return [{ name: "microsoft_docs_fetch" }, { name: "microsoft_docs_search" }];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!name.toLowerCase().includes("fetch")) throw new Error("unexpected_tool");
    const url = String(args.url ?? "");
    this.fetchCalls += 1;
    if (this.failures.has(url)) throw new Error("network_error_fixture");
    const markdown = this.fixtures[url];
    if (!markdown) throw new Error("not_found_fixture");
    return { markdown };
  }
}

async function makeTempPaths(): Promise<{ dbPath: string; artifactsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-k2-sharepoint-"));
  return { dbPath: join(root, "knowledge-v2.sqlite"), artifactsDir: join(root, "artifacts") };
}

function markdown(title: string, body: string): string {
  return `---\ntitle: ${title}\nms.topic: concept\n---\n\n# ${title}\n\n${body}\n`;
}

/** Realistic markdown fixtures for every article in the approved K2 set, so
 * plan/execute exercise the full curated corpus rather than a subset. */
function allApprovedFixtures(): FetchFixture {
  return {
    "https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery": markdown(
      "Restricted content discovery",
      "Prevent high-risk SharePoint sites and files from surfacing in Microsoft 365 Copilot experiences."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/manage-access-agents-in-sharepoint": markdown(
      "Manage access for agents in SharePoint",
      "Control which agents and Copilot experiences can access SharePoint content."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/advanced-management": markdown(
      "SharePoint Advanced Management",
      "Data access governance and restricted content discovery capabilities."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/change-external-sharing-site": markdown(
      "Change external sharing site settings",
      "Restrict Anyone links to New and existing guests or Only people in your organization."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/external-sharing-overview": markdown(
      "External sharing overview",
      "Organization-level and site-level sharing settings, and how to stop sharing."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/change-default-sharing-link": markdown(
      "Change the default sharing link",
      "Set a more restrictive default link type than Anyone."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off": markdown(
      "Turn external sharing on or off",
      "Organization-level policy for external sharing."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-reports": markdown(
      "Data access governance reports",
      "Identify overshared or sensitive SharePoint and OneDrive sites."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/site-access-review": markdown(
      "Site access review",
      "Delegate oversharing remediation to site owners."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-site-permissions-report": markdown(
      "Site permissions report",
      "Snapshot of the permission structure across sites."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-sharing-links-report": markdown(
      "Sharing links activity report",
      "Sites where users created the most new sharing links."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-sensitivity-label-report": markdown(
      "Sensitivity label report",
      "Sensitivity label distribution across sites."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/sharepoint-admin-role": markdown(
      "SharePoint admin role",
      "Permissions required to administer SharePoint."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-everyone-except-external-user-report": markdown(
      "EEEU insights",
      "Top items shared with Everyone except external users."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/powershell-for-data-access-governance": markdown(
      "DAG reports and PowerShell",
      "Use Start-SPODataAccessGovernanceInsight to generate reports."
    ),
    "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-site-permissions-users-report": markdown(
      "Site permissions for a user report",
      "List of sites a user can access and how access is granted."
    )
  };
}

function createJob(client: MockLearnFetchClient, provider: FakeEmbeddingProvider): SharePointCorpusJob {
  return new SharePointCorpusJob({
    fetchClientFactory: () => client,
    createEmbeddingProvider: () => ({
      provider,
      dimensions: 8,
      credentialAvailable: true,
      providerId: provider.providerId
    })
  });
}

test("classifies approved SharePoint articles into the K2 subdomain taxonomy", () => {
  assert.equal(classifySharePointSubdomain(RESTRICTED_CONTENT_DISCOVERY), "copilot_content_discovery");
  assert.equal(classifySharePointSubdomain(CHANGE_EXTERNAL_SHARING), "sharing_links");
  assert.equal(classifySharePointSubdomain("https://learn.microsoft.com/en-us/sharepoint/unrelated"), "other");
});

test("plan mode fetches the approved set and does not mutate the store", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const client = new MockLearnFetchClient(allApprovedFixtures());
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = createJob(client, provider);
  const result = await job.run({
    mode: "plan",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(result.fetch.attempted, result.approvedArticleCount);
  assert.equal(result.fetch.failed, 0);
  assert.equal(result.execution, null);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const docs = store.listDocumentsBySource({ sourceId: "ms-sharepoint-docs", trackId: "ga" });
    assert.equal(docs.length, 0);
  } finally {
    store.close();
  }
});

test("execute indexes the full approved SharePoint corpus with real subdomain coverage", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const client = new MockLearnFetchClient(allApprovedFixtures());
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = createJob(client, provider);
  const result = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(result.fetch.failed, 0);
  assert.equal(result.corpusClassification, "LIMITED_REAL");
  assert.ok(result.corpusStats);
  assert.ok(result.corpusStats!.documents.totalCanonical >= result.approvedArticleCount - 1);
  assert.ok(Object.keys(result.corpusStats!.documents.bySubdomain).length >= 3);
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  try {
    store.initializeDatabase();
    const docs = store.listDocumentsBySource({ sourceId: "ms-sharepoint-docs", trackId: "ga" });
    assert.ok(docs.every((doc) => doc.canonicalUrl.startsWith("https://learn.microsoft.com/en-us/sharepoint/")));
    const lexical = store.lexicalSearchChunks({
      query: "Restricted Content Discovery",
      sourceId: "ms-sharepoint-docs",
      trackId: "ga",
      limit: 5
    });
    assert.ok(lexical.length > 0);
  } finally {
    store.close();
  }
});

test("per-article fetch failure is isolated and rerun is incremental (idempotent)", async () => {
  const { dbPath, artifactsDir } = await makeTempPaths();
  const fixtures = allApprovedFixtures();
  delete fixtures[CHANGE_EXTERNAL_SHARING];
  const client = new MockLearnFetchClient(fixtures, new Set([CHANGE_EXTERNAL_SHARING]));
  const provider = new FakeEmbeddingProvider({ providerId: "fake", dimensions: 8 });
  const job = createJob(client, provider);
  const first = await job.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(first.fetch.failed, 1);
  assert.ok(first.failures.some((failure) => failure.canonicalUrl === CHANGE_EXTERNAL_SHARING));
  const embeddingCallsAfterFirst = provider.getDocumentCallCount();

  const secondClient = new MockLearnFetchClient(allApprovedFixtures());
  const secondJob = createJob(secondClient, provider);
  const second = await secondJob.run({
    mode: "execute",
    dbPath,
    artifactsDir,
    parserVersion: "parser-v1",
    chunkerVersion: "chunker-v1"
  });
  assert.equal(second.fetch.failed, 0);
  assert.ok(second.embeddingUsage.reused > 0);
  // Only the previously-failed article plus nothing else should require new embeddings.
  assert.equal(provider.getDocumentCallCount(), embeddingCallsAfterFirst + 1);
});
