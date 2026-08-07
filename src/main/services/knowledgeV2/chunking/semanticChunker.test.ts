import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chunkKnowledgeDocument } from "./semanticChunker";
import { SEMANTIC_CHUNKER_VERSION } from "./types";
import { parseCanonicalDocument } from "../parse";
import type { AcquiredDocumentInput, KnowledgeDocument } from "../parse";

async function loadFixture(name: string): Promise<AcquiredDocumentInput> {
  const path = resolve(`src/main/services/knowledgeV2/parse/fixtures/${name}`);
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

function parseFixture(input: AcquiredDocumentInput): KnowledgeDocument {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

function makeInput(rawMarkdown: string): AcquiredDocumentInput {
  return {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/doc",
    rawMarkdown,
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "doc.md"
    }
  };
}

test("chunks Direct Routing fixture and retains deterministic structure + context", async () => {
  const doc = parseFixture(await loadFixture("teams-admin-learn-direct-routing.json"));
  const first = chunkKnowledgeDocument(doc);
  const second = chunkKnowledgeDocument(doc);

  assert.ok(first.chunks.length > 20);
  assert.equal(first.chunkerVersion, SEMANTIC_CHUNKER_VERSION);
  assert.deepEqual(
    first.chunks.map((chunk) => chunk.chunkId),
    second.chunks.map((chunk) => chunk.chunkId)
  );
  assert.deepEqual(
    first.chunks.map((chunk) => chunk.contentHash),
    second.chunks.map((chunk) => chunk.contentHash)
  );
  assert.ok(first.chunks.every((chunk) => chunk.headingPath.length >= 1));
  assert.ok(first.chunks.some((chunk) => chunk.retrievalText.toLowerCase().includes("direct routing")));
  assert.ok(first.chunks.some((chunk) => chunk.retrievalText.toLowerCase().includes("routing")));
  assert.ok(first.chunks.some((chunk) => chunk.retrievalText.toLowerCase().includes("sbc")));
  assert.ok(first.chunks.some((chunk) => chunk.chunkKind === "table"));
  assert.ok(first.chunks.every((chunk) => chunk.chunkerVersion === SEMANTIC_CHUNKER_VERSION));
  assert.ok(first.chunks.every((chunk) => chunk.inheritedMetadata.sourceId === doc.sourceId));
  assert.ok(first.chunks.every((chunk) => chunk.provenance.sourcePath.length > 0));
  assert.ok(first.chunks.every((chunk) => chunk.provenance.structuralReferences.length > 0));
});

test("chunks PowerShell conceptual fixture and preserves ordering + metadata inheritance", async () => {
  const doc = parseFixture(await loadFixture("teams-powershell-conceptual.json"));
  const result = chunkKnowledgeDocument(doc);

  assert.ok(result.chunks.length > 0);
  assert.ok(result.chunks.every((chunk) => chunk.sourceId === "ms-teams-powershell"));
  assert.ok(result.chunks.every((chunk) => chunk.trackId === "ga"));
  assert.ok(result.chunks.every((chunk) => chunk.contentStatus === "ga"));
  assert.ok(result.chunks.every((chunk) => chunk.inheritedMetadata.product === doc.normalizedMetadata.product));
  assert.ok(result.chunks.every((chunk) => chunk.inheritedMetadata.sourceId === doc.sourceId));
  const sourceOrders = result.chunks.map((chunk) => chunk.sourceOrder);
  assert.deepEqual(sourceOrders, [...sourceOrders].sort((a, b) => a - b));
});

test("chunks PowerShell cmdlet fixture with synopsis/syntax/examples/parameters behavior", async () => {
  const doc = parseFixture(await loadFixture("teams-powershell-cmdlet.json"));
  const result = chunkKnowledgeDocument(doc);

  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "powershell_synopsis"));
  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "powershell_syntax"));
  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "powershell_example"));
  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "powershell_parameter"));
  const cmdletIdentity = doc.normalizedMetadata.title ?? "Add-TeamChannelUser";
  assert.ok(
    result.chunks.every((chunk) =>
      chunk.exactEntities.some((entity) => entity.type === "cmdlet" && entity.value === cmdletIdentity)
    )
  );

  const parameterChunk = result.chunks.find((chunk) => chunk.chunkKind === "powershell_parameter");
  assert.ok(parameterChunk);
  assert.ok(parameterChunk?.exactEntities.some((entity) => entity.type === "parameter"));
  assert.ok(parameterChunk?.retrievalText.includes("Document: Add-TeamChannelUser"));

  const exampleChunk = result.chunks.find((chunk) =>
    chunk.headingPath.join(" ").toLowerCase().includes("example 1")
  );
  assert.ok(exampleChunk);
  assert.ok(exampleChunk?.chunkKind === "powershell_example");
  assert.ok(exampleChunk?.retrievalText.includes("```"));

  const syntaxChunks = result.chunks.filter((chunk) => chunk.chunkKind === "powershell_syntax");
  assert.ok(syntaxChunks.every((chunk) => chunk.retrievalText.includes("```")));
});

test("retains tables/code/callouts/procedures and never splits code blocks", () => {
  const doc = parseFixture(
    makeInput([
      "# Routing playbook",
      "",
      "## Procedure",
      "",
      "1. Step one",
      "2. Step two",
      "",
      "> NOTE: Keep this callout",
      "",
      "## Data",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| A | B |",
      "",
      "## Script",
      "",
      "```powershell",
      "Get-Thing",
      "Set-Thing",
      "```"
    ].join("\n"))
  );

  const result = chunkKnowledgeDocument(doc);
  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "procedure"));
  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "table"));
  assert.ok(result.chunks.some((chunk) => chunk.chunkKind === "code"));
  assert.ok(result.chunks.some((chunk) => chunk.retrievalText.includes("NOTE: Keep this callout")));
  const code = result.chunks.find((chunk) => chunk.chunkKind === "code");
  assert.ok(code?.retrievalText.includes("```powershell"));
  assert.ok(code?.retrievalText.includes("Set-Thing"));
});

test("oversized sections split deterministically and keep heading provenance", () => {
  const longParagraph = "Direct Routing guidance ".repeat(500);
  const doc = parseFixture(
    makeInput(
      `# Very long\n\n## Configuration\n\n${longParagraph}\n\n${longParagraph}\n\n${longParagraph}`
    )
  );

  const first = chunkKnowledgeDocument(doc, { maxChunkChars: 1000 });
  const second = chunkKnowledgeDocument(doc, { maxChunkChars: 1000 });
  assert.ok(first.chunks.length > 2);
  assert.deepEqual(
    first.chunks.map((chunk) => chunk.chunkId),
    second.chunks.map((chunk) => chunk.chunkId)
  );
  assert.ok(
    first.diagnostics.some((diag) => diag.code === "oversized_section_split")
  );
  assert.ok(
    first.chunks.every((chunk) => chunk.headingPath.join(" -> ").includes("Configuration"))
  );
});

test("retrieval text hashes depend on retrieval text and not raw markdown body", async () => {
  const input = await loadFixture("teams-powershell-conceptual.json");
  const doc = parseFixture(input);
  const result = chunkKnowledgeDocument(doc);

  const alteredDoc: KnowledgeDocument = {
    ...doc,
    rawMarkdown: `${doc.rawMarkdown}\n\n<!-- unrelated -->`,
    rawFrontMatter: doc.rawFrontMatter ? `${doc.rawFrontMatter}\nextra: value` : "extra: value"
  };
  const alteredResult = chunkKnowledgeDocument(alteredDoc);
  assert.deepEqual(
    result.chunks.map((chunk) => chunk.contentHash),
    alteredResult.chunks.map((chunk) => chunk.contentHash)
  );
  assert.deepEqual(
    result.chunks.map((chunk) => chunk.retrievalText),
    alteredResult.chunks.map((chunk) => chunk.retrievalText)
  );
});

test("no markdown reparsing/network/embedding/llm is required for chunking", async () => {
  const doc = parseFixture(await loadFixture("teams-admin-learn-direct-routing.json"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_not_allowed");
  }) as typeof fetch;
  try {
    const result = chunkKnowledgeDocument(doc);
    assert.ok(result.chunks.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
