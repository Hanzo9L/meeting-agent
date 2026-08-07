import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chunkKnowledgeDocument } from "../chunking";
import type { AcquiredDocumentInput } from "../parse";
import { parseCanonicalDocument } from "../parse";
import { createKnowledgeV2SqliteStore } from "./sqliteStore";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function loadFixture(path: string): Promise<AcquiredDocumentInput> {
  return JSON.parse(await readFile(path, "utf8")) as AcquiredDocumentInput;
}

async function main(): Promise<void> {
  const dbPath = arg("--db");
  if (!dbPath) {
    throw new Error("Required argument missing: --db <path> (explicit database path required).");
  }
  const fixturePath = resolve(
    arg("--fixture") ?? "src/main/services/knowledgeV2/parse/fixtures/teams-admin-learn-direct-routing.json"
  );
  const migrationDir = resolve("src/main/services/knowledgeV2/store/migrations");
  const input = await loadFixture(fixturePath);
  const parsed = parseCanonicalDocument(input);
  if (!parsed.document) {
    throw new Error(`Fixture parse failed: ${fixturePath}`);
  }
  const document = parsed.document;

  const store = createKnowledgeV2SqliteStore({
    databasePath: resolve(dbPath),
    migrationsDir: migrationDir
  });
  try {
    store.initializeDatabase();
    const savedDocument = store.saveKnowledgeDocument(document, { parserVersion: "cg01b-inspect-v1" });
    const chunked = chunkKnowledgeDocument(document);
    const persisted = store.replaceDocumentChunks({
      documentId: savedDocument.documentId,
      chunkerVersion: chunked.chunkerVersion,
      chunks: chunked.chunks
    });
    const lifecycle = store.inspectChunkLifecycle({ documentId: savedDocument.documentId });
    const querySamples = [
      "Direct Routing voice routing",
      "Set-CsOnlineVoiceRoutingPolicy",
      "-DisplayName"
    ];
    const search = querySamples.map((query) => ({
      query,
      matches: store.lexicalSearchChunks({
        query,
        sourceId: document.sourceId,
        trackId: document.trackId,
        limit: 5
      }).map((row) => ({
        chunkId: row.chunkId,
        rank: row.rank,
        textPreview: row.chunkText.slice(0, 120)
      }))
    }));

    const chunkKinds = chunked.chunks.reduce<Record<string, number>>((acc, chunk) => {
      acc[chunk.chunkKind] = (acc[chunk.chunkKind] ?? 0) + 1;
      return acc;
    }, {});

    process.stdout.write(
      `${JSON.stringify(
        {
          fixturePath,
          databasePath: resolve(dbPath),
          documentId: document.documentId,
          sourceId: document.sourceId,
          trackId: document.trackId,
          chunkerVersion: chunked.chunkerVersion,
          chunkCount: chunked.chunks.length,
          activeChunkCount: lifecycle.activeChunkCount,
          chunkKinds,
          persistence: persisted,
          ftsRowCount: lifecycle.ftsRowCount,
          diagnostics: chunked.diagnostics,
          sampleQueries: search
        },
        null,
        2
      )}\n`
    );
  } finally {
    store.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "Chunk persistence inspection failed." },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
