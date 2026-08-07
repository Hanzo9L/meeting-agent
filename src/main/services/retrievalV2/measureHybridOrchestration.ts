import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createKnowledgeV2SqliteStore,
  encodeFloat32Vector,
  FakeEmbeddingProvider,
  hashEmbeddingInput,
  parseCanonicalDocument,
  type AcquiredDocumentInput
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { retrieveHybridCandidates } from "./hybridRetriever";
import { extractQueryIntent } from "./queryIntentRules";

const MODEL = "hybrid-bench-model";
const SCHEMA = "hybrid-bench-v1";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = ((p / 100) * (sorted.length - 1));
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low] ?? 0;
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? 0;
  return lowValue + (highValue - lowValue) * (idx - low);
}

function markdown(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", "", `# ${title}`, "", body].join("\n");
}

function fixtureDoc(input: AcquiredDocumentInput) {
  const parsed = parseCanonicalDocument(input);
  if (!parsed.document) throw new Error("fixture parse failed");
  return parsed.document;
}

async function seedDb(): Promise<{
  dbPath: string;
  provider: FakeEmbeddingProvider;
}> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-hybrid-bench-"));
  const dbPath = join(root, "knowledge-v2.sqlite");
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  store.initializeDatabase();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: MODEL,
    embeddingSchemaVersion: SCHEMA
  });

  const docs = [
    fixtureDoc({
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      rawMarkdown: markdown("Direct Routing planning", "Direct Routing concept."),
      revision: {
        transport: "learn_mcp",
        canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
        locale: "en-us",
        retrievedAt: new Date().toISOString(),
        contentHash: "hybrid-bench-admin-1"
      }
    }),
    fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl:
        "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
      rawMarkdown: markdown("Set-CsOnlineVoiceRoutingPolicy", "Cmdlet semantics."),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: "hybrid-bench-ps-1",
        blobSha: "hybrid-bench-ps-blob-1",
        path: "teams/teams-ps/MicrosoftTeams/set-csonlinevoiceroutingpolicy.md"
      }
    })
  ];
  for (const doc of docs) {
    store.saveKnowledgeDocument(doc, { parserVersion: "hybrid-bench-v1" });
  }

  const adminDoc = docs[0];
  const psDoc = docs[1];
  if (!adminDoc || !psDoc) throw new Error("missing fixture docs");
  const chunks = [
    {
      chunkId: "chunk-dr-admin",
      documentId: adminDoc.documentId,
      sectionId: "direct-routing",
      text: "Direct Routing voice routing behavior with SBC policy.",
      sourceOrder: 1
    },
    {
      chunkId: "chunk-dr-ps",
      documentId: psDoc.documentId,
      sectionId: "direct-routing-ps",
      text: "PowerShell routing checks for Direct Routing.",
      sourceOrder: 2
    },
    {
      chunkId: "chunk-cmdlet",
      documentId: psDoc.documentId,
      sectionId: "set-cs",
      text: "Set-CsOnlineVoiceRoutingPolicy assigns a policy.",
      sourceOrder: 3
    }
  ];
  for (const chunk of chunks) {
    store.saveChunkPlaceholder({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      sectionId: chunk.sectionId,
      headingPath: [chunk.sectionId],
      chunkKind: "configuration",
      text: chunk.text,
      sourceOrder: chunk.sourceOrder,
      contentHash: hashEmbeddingInput(chunk.text.trim()),
      provenance: {},
      metadata: {}
    });
  }

  const query = await provider.embedQuery(
    { id: "q", text: "How does Teams Direct Routing voice routing work?" },
    { model: MODEL, embeddingSchemaVersion: SCHEMA }
  );
  for (const chunk of chunks) {
    store.saveChunkEmbedding({
      chunkId: chunk.chunkId,
      providerId: provider.providerId,
      model: MODEL,
      dimensions: query.dimensions,
      embeddingSchemaVersion: SCHEMA,
      inputContentHash: hashEmbeddingInput(chunk.text.trim()),
      vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(query.vector))),
      usage: { requestCount: 1, batchSize: 1 }
    });
  }

  store.close();
  return { dbPath, provider };
}

async function run(): Promise<void> {
  const fixture = await seedDb();
  const scope = routeQueryIntent(
    extractQueryIntent("How does Teams Direct Routing voice routing work?").intent
  ).scope;
  const overlapRuns: number[] = [];
  const sequentialRuns: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const overlap = await retrieveHybridCandidates({
      databasePath: fixture.dbPath,
      scope,
      embeddingProvider: fixture.provider,
      embeddingRuntimeConfig: { model: MODEL, embeddingSchemaVersion: SCHEMA },
      orchestrationMode: "overlap_semantic_with_exact_lexical"
    });
    const sequential = await retrieveHybridCandidates({
      databasePath: fixture.dbPath,
      scope,
      embeddingProvider: fixture.provider,
      embeddingRuntimeConfig: { model: MODEL, embeddingSchemaVersion: SCHEMA },
      orchestrationMode: "sequential"
    });
    if (i > 0) {
      overlapRuns.push(overlap.diagnostics.totalLatencyMs);
      sequentialRuns.push(sequential.diagnostics.totalLatencyMs);
    }
  }

  const overlapSorted = [...overlapRuns].sort((a, b) => a - b);
  const sequentialSorted = [...sequentialRuns].sort((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify(
      {
        overlap: {
          p50Ms: Number(percentile(overlapSorted, 50).toFixed(3)),
          p95Ms: Number(percentile(overlapSorted, 95).toFixed(3))
        },
        sequential: {
          p50Ms: Number(percentile(sequentialSorted, 50).toFixed(3)),
          p95Ms: Number(percentile(sequentialSorted, 95).toFixed(3))
        }
      },
      null,
      2
    )}\n`
  );
}

run();
