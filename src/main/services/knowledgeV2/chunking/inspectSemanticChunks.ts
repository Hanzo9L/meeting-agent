import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCanonicalDocument } from "../parse";
import type { AcquiredDocumentInput } from "../parse";
import { chunkKnowledgeDocument } from "./semanticChunker";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function loadFixture(path: string): Promise<AcquiredDocumentInput> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

async function main(): Promise<void> {
  const fixturePath = resolve(
    getArg("--fixture") ?? "src/main/services/knowledgeV2/parse/fixtures/teams-admin-learn-direct-routing.json"
  );
  const chunkIdToShow = getArg("--chunk-id");
  const indexArg = getArg("--chunk-index");
  const chunkIndexToShow = typeof indexArg === "string" ? Number(indexArg) : undefined;

  const input = await loadFixture(fixturePath);
  const parsed = parseCanonicalDocument(input);
  if (!parsed.document) {
    process.stdout.write(
      `${JSON.stringify(
        {
          success: false,
          fixturePath,
          fatalErrors: parsed.fatalErrors
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const result = chunkKnowledgeDocument(parsed.document);
  const chunkKinds = result.chunks.reduce<Record<string, number>>((acc, chunk) => {
    acc[chunk.chunkKind] = (acc[chunk.chunkKind] ?? 0) + 1;
    return acc;
  }, {});
  const chunkList = result.chunks.map((chunk, index) => ({
    index,
    chunkId: chunk.chunkId,
    sourceOrder: chunk.sourceOrder,
    chunkKind: chunk.chunkKind,
    sectionId: chunk.sectionId,
    headingPath: chunk.headingPath,
    contentHash: chunk.contentHash,
    retrievalTextLength: chunk.retrievalText.length,
    exactEntities: chunk.exactEntities
  }));

  const selectedChunk =
    (chunkIdToShow ? result.chunks.find((chunk) => chunk.chunkId === chunkIdToShow) : undefined) ??
    (typeof chunkIndexToShow === "number" && Number.isInteger(chunkIndexToShow)
      ? result.chunks[chunkIndexToShow]
      : undefined);

  process.stdout.write(
    `${JSON.stringify(
      {
        success: true,
        fixturePath,
        document: {
          documentId: parsed.document.documentId,
          sourceId: parsed.document.sourceId,
          trackId: parsed.document.trackId,
          title: parsed.document.normalizedMetadata.title,
          canonicalUrl: parsed.document.canonicalUrl
        },
        chunkerVersion: result.chunkerVersion,
        totalChunks: result.chunks.length,
        chunkKinds,
        chunks: chunkList,
        diagnostics: result.diagnostics,
        selectedChunk: selectedChunk
          ? {
              chunkId: selectedChunk.chunkId,
              chunkKind: selectedChunk.chunkKind,
              headingPath: selectedChunk.headingPath,
              retrievalText: selectedChunk.retrievalText,
              exactEntities: selectedChunk.exactEntities,
              provenance: selectedChunk.provenance
            }
          : null
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Semantic chunk inspection failed."
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
