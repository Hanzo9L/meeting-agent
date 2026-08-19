/**
 * Read-only chunker isolation audit.
 * parsed document → production chunker. No embeddings, retrieval, R2–R4, or synthesis.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  parseCanonicalDocument,
  type AcquiredDocumentInput,
  type CanonicalBlock,
  type CanonicalSection
} from "../../../src/main/services/knowledgeV2/parse";
import type { SourceRevision } from "../../../src/main/services/knowledgeV2/sourceTypes";
import {
  chunkKnowledgeDocument,
  SEMANTIC_CHUNKER_VERSION,
  type KnowledgeChunk
} from "../../../src/main/services/knowledgeV2/chunking";
import { resolveKnowledgeV2DatabasePath } from "../../../src/main/services/knowledgeV2/store/dbPaths";

const OUT_DIR = resolve("eval/runs/chunker-audit");
const DEFAULT_MAX_CHUNK_CHARS = 2200;

const SELECTED = [
  {
    label: "A",
    role: "Troubleshooting / procedural (media path, SBC, media bypass)",
    url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-media-bypass"
  },
  {
    label: "B",
    role: "Conceptual / multi-concept (voice routing policy → PSTN usage → route → gateway)",
    url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
  }
] as const;

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function bodyOf(chunk: KnowledgeChunk): string {
  const lines = chunk.retrievalText.split("\n");
  const blank = lines.findIndex((line, index) => index >= 2 && line.trim() === "");
  if (blank >= 0) return lines.slice(blank + 1).join("\n").trim();
  return chunk.retrievalText;
}

function renderBlock(block: CanonicalBlock): string {
  switch (block.kind) {
    case "paragraph":
      return block.text.trim();
    case "ordered_list":
      return block.items.map((item, i) => `${i + 1}. ${item.trim()}`).join("\n");
    case "unordered_list":
      return block.items.map((item) => `- ${item.trim()}`).join("\n");
    case "table":
      return `TABLE headers=[${block.headers.join(" | ")}] rows=${block.rows.length}`;
    case "code_block":
      return `CODE(${block.language ?? "plain"}) ${block.text.split("\n").length} lines`;
    case "callout":
      return `${block.level.toUpperCase()}: ${block.text.trim()}`;
    case "blockquote":
      return `> ${block.text.trim()}`;
    case "html":
      return `HTML: ${block.html.trim().slice(0, 80)}`;
    case "thematic_break":
      return "---";
    case "unknown":
      return `UNKNOWN(${block.nodeType}): ${block.raw.trim().slice(0, 80)}`;
    default:
      return "";
  }
}

function dumpSections(sections: CanonicalSection[], depth = 0): string[] {
  const lines: string[] = [];
  for (const section of sections) {
    const indent = "  ".repeat(depth);
    lines.push(
      `${indent}- **H${section.headingLevel}** \`${section.heading}\` — sectionId=\`${section.sectionId}\` kind=\`${section.sectionKind}\` headingPath=\`${section.headingPath.join(" → ")}\``
    );
    if (section.blocks.length === 0) {
      lines.push(`${indent}  - _(no blocks; heading exists for hierarchy only)_`);
    }
    for (const [i, block] of section.blocks.entries()) {
      const rendered = renderBlock(block);
      const preview =
        rendered.length > 280 ? `${rendered.slice(0, 280).trim()}…` : rendered;
      lines.push(
        `${indent}  - block ${i} \`${block.kind}\` (${rendered.length} chars)\n${indent}    ${preview.replace(/\n/g, `\n${indent}    `)}`
      );
    }
    lines.push(...dumpSections(section.children, depth + 1));
  }
  return lines;
}

function fence(text: string): string {
  const ticks = text.includes("````") ? "`````" : "````";
  return `${ticks}text\n${text}\n${ticks}`;
}

function firstChars(text: string, n = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= n ? compact : `${compact.slice(0, n).trim()}…`;
}

function acquiredFromStored(row: {
  source_id: string;
  track_id: string;
  transport: "github" | "learn_mcp";
  canonical_url: string;
  raw_markdown: string;
  source_revision_json: string;
}): AcquiredDocumentInput {
  return {
    sourceId: row.source_id,
    trackId: row.track_id,
    transport: row.transport,
    canonicalUrl: row.canonical_url,
    rawMarkdown: row.raw_markdown,
    revision: JSON.parse(row.source_revision_json) as SourceRevision
  };
}

function overlapNote(): string {
  return "_None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._";
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const databasePath = resolveKnowledgeV2DatabasePath();
  const db = new Database(databasePath, { readonly: true });

  const parts: string[] = [];
  parts.push(`# Chunker Isolation Audit`);
  parts.push("");
  parts.push(`Generated: ${new Date().toISOString()}`);
  parts.push(`Database: \`${databasePath}\``);
  parts.push(`Chunker version constant: \`${SEMANTIC_CHUNKER_VERSION}\``);
  parts.push("");
  parts.push(`Scope: parsed document → production chunker only. No embeddings, retrieval, R2, R3, R4, or synthesis.`);
  parts.push("");

  parts.push(`## 1. Production parser and chunker`);
  parts.push("");
  parts.push(`- **Parser:** \`parseCanonicalDocument\` in \`src/main/services/knowledgeV2/parse/parser.ts\``);
  parts.push(`- **Chunker:** \`chunkKnowledgeDocument\` in \`src/main/services/knowledgeV2/chunking/semanticChunker.ts\``);
  parts.push(`- **Production call site:** \`DocumentIndexingJob\` passes \`chunkerVersion\` (default corpus jobs use \`${SEMANTIC_CHUNKER_VERSION}\`)`);
  parts.push(`- **Configured max chunk size:** \`${DEFAULT_MAX_CHUNK_CHARS}\` characters (\`DEFAULT_MAX_CHUNK_CHARS\`). Options allow override; floor is 600.`);
  parts.push(`- **Target chunk size:** none. The chunker packs whole canonical blocks into a section slice until the next block would exceed max.`);
  parts.push(`- **Overlap:** none. No previous/next window is copied into adjacent chunks.`);
  parts.push(`- **Heading handling:** markdown headings become \`CanonicalSection\` nodes. Chunker flattens the tree (parent then children). Each chunk's \`retrievalText\` prefixes \`Document: {title}\` and \`Heading Path: a -> b -> c\`. Headings are not duplicated as body text.`);
  parts.push(`- **List handling:** an entire ordered/unordered list is **one canonical block**. Lists are not split item-by-item unless the rendered list itself exceeds max, in which case \`splitLargeText\` / \`splitHard\` may break on blank lines then whitespace.`);
  parts.push(`- **Table handling:** tables are flushed as **standalone** chunks (\`chunkKind: table\`).`);
  parts.push(`- **Code handling:** code fences are flushed as **standalone** chunks (\`chunkKind: code\` unless inside PowerShell example/syntax).`);
  parts.push(`- **Callouts:** blockquotes matching note/important/warning/caution/tip become \`callout\` blocks and pack with surrounding prose in the same section.`);
  parts.push(`- **Paragraph boundaries:** splits occur between canonical blocks when adding the next block would exceed max. Oversized single blocks split on \`\\n{2,}\` then hard-split on whitespace.`);
  parts.push(`- **Semantic boundary rules:** section-kind special cases for PowerShell (synopsis/syntax/examples/parameters). Generic docs infer \`chunkKind\` from heading keywords (troubleshoot, configure, procedure, reference) plus presence of ordered lists. There is **no** semantic splitter beyond heading sections + block packing + max-char overflow.`);
  parts.push("");

  const summaries: string[] = [];
  const dumpStart = parts.length;

  for (const selected of SELECTED) {
    const row = db
      .prepare(
        `SELECT d.document_id, d.source_id, d.track_id, d.transport, d.canonical_url,
                d.source_path, d.title, d.chunker_version, c.raw_markdown, c.source_revision_json
         FROM documents d
         JOIN document_contents c ON c.document_id = d.document_id
         WHERE d.canonical_url = ? AND d.tombstoned_at IS NULL`
      )
      .get(selected.url) as
      | {
          document_id: string;
          source_id: string;
          track_id: string;
          transport: "github" | "learn_mcp";
          canonical_url: string;
          source_path: string;
          title: string | null;
          chunker_version: string | null;
          raw_markdown: string;
          source_revision_json: string;
        }
      | undefined;
    if (!row) {
      throw new Error(`Missing local document: ${selected.url}`);
    }
    const parsed = parseCanonicalDocument(acquiredFromStored(row));
    if (!parsed.document) {
      throw new Error(`Parser failed for ${selected.url}: ${JSON.stringify(parsed.fatalErrors)}`);
    }
    const result = chunkKnowledgeDocument(parsed.document);
    const storedChunks = db
      .prepare(
        `SELECT chunk_id FROM knowledge_chunks
         WHERE document_id = ? AND tombstoned_at IS NULL
         ORDER BY source_order ASC, chunk_id ASC`
      )
      .all(row.document_id) as Array<{ chunk_id: string }>;
    const storedIds = storedChunks.map((c) => c.chunk_id);
    const liveIds = result.chunks.map((c) => c.chunkId);
    const idsMatch =
      storedIds.length === liveIds.length &&
      storedIds.every((id, i) => id === liveIds[i]);

    const sizes = result.chunks.map((c) => c.retrievalText.length);
    const bodies = result.chunks.map((c) => bodyOf(c));
    const tiny = result.chunks.filter((_, i) => bodies[i]!.length < 200);

    summaries.push(
      [
        `### Document ${selected.label}`,
        "",
        `- Role: ${selected.role}`,
        `- source ID: \`${row.source_id}\``,
        `- document ID: \`${parsed.document.documentId}\``,
        `- stored document ID: \`${row.document_id}\``,
        `- IDs match re-parse: \`${parsed.document.documentId === row.document_id}\``,
        `- canonical URL: ${row.canonical_url}`,
        `- title: ${row.title}`,
        `- chunkerVersion (live): \`${result.chunkerVersion}\``,
        `- stored chunker_version: \`${row.chunker_version ?? "null"}\``,
        `- live chunks: ${result.chunks.length}`,
        `- stored chunks: ${storedChunks.length}`,
        `- live chunk IDs match stored: \`${idsMatch}\``,
        `- retrievalText chars: min ${Math.min(...sizes)} / median ${[...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]} / max ${Math.max(...sizes)}`,
        `- chunks with body < 200 chars: ${tiny.length}`,
        `- diagnostics: ${result.diagnostics.length}`,
        ""
      ].join("\n")
    );

    parts.push(`## Document ${selected.label} — identity`);
    parts.push("");
    parts.push(`**Role:** ${selected.role}`);
    parts.push("");
    parts.push(`| Field | Value |`);
    parts.push(`|---|---|`);
    parts.push(`| source ID | \`${row.source_id}\` |`);
    parts.push(`| document ID (re-parsed) | \`${parsed.document.documentId}\` |`);
    parts.push(`| document ID (stored) | \`${row.document_id}\` |`);
    parts.push(`| canonical URL | ${row.canonical_url} |`);
    parts.push(`| title | ${row.title} |`);
    parts.push(`| track | \`${row.track_id}\` |`);
    parts.push(`| transport | \`${row.transport}\` |`);
    parts.push(`| source path | \`${row.source_path}\` |`);
    parts.push(`| parser warnings | ${parsed.warnings.length} |`);
    parts.push(`| live chunks | ${result.chunks.length} |`);
    parts.push(`| stored chunks | ${storedChunks.length} |`);
    parts.push(`| chunk IDs match stored index | \`${idsMatch}\` |`);
    parts.push("");

    parts.push(`### ${selected.label}. Parsed structure (before chunking)`);
    parts.push("");
    parts.push(`Title: **${parsed.document.normalizedMetadata.title ?? "(none)"}**`);
    parts.push("");
    parts.push(dumpSections(parsed.document.sections).join("\n"));
    parts.push("");

    parts.push(`### ${selected.label}. Chunker diagnostics`);
    parts.push("");
    if (result.diagnostics.length === 0) {
      parts.push("_No chunker diagnostics._");
    } else {
      for (const diag of result.diagnostics) {
        parts.push(
          `- \`${diag.code}\` @ \`${diag.headingPath.join(" → ")}\` (\`${diag.sectionId}\`): ${diag.message}`
        );
      }
    }
    parts.push("");

    parts.push(`### ${selected.label}. Produced chunks`);
    parts.push("");
    for (const [index, chunk] of result.chunks.entries()) {
      const body = bodyOf(chunk);
      const prev = result.chunks[index - 1];
      const next = result.chunks[index + 1];
      parts.push(`#### ${selected.label}-${String(index).padStart(2, "0")} chunk index ${index}`);
      parts.push("");
      parts.push(`- chunk ID: \`${chunk.chunkId}\``);
      parts.push(`- heading path: \`${chunk.headingPath.join(" → ")}\``);
      parts.push(`- source section: \`${chunk.sectionId}\` kind=\`${chunk.chunkKind}\` sourceOrder=${chunk.sourceOrder}`);
      parts.push(
        `- structural refs: ${chunk.provenance.structuralReferences.map((r) => `${r.blockKind}#${r.blockIndex}`).join(", ") || "(none)"}`
      );
      parts.push(`- character count (retrievalText): ${chunk.retrievalText.length}`);
      parts.push(`- character count (body): ${body.length}`);
      parts.push(`- approximate token count: ${approxTokens(chunk.retrievalText)} (chars/4)`);
      parts.push(`- first ~120 characters: ${firstChars(body)}`);
      parts.push(`- previous overlap: ${overlapNote()}`);
      parts.push(`- next chunk heading: ${next ? `\`${next.headingPath.join(" → ")}\`` : "_end of document_"}`);
      parts.push(`- previous chunk heading: ${prev ? `\`${prev.headingPath.join(" → ")}\`` : "_start of document_"}`);
      parts.push("");
      parts.push(`**Full chunk text**`);
      parts.push("");
      parts.push(fence(chunk.retrievalText));
      parts.push("");
    }
  }

  parts.splice(
    dumpStart,
    0,
    `## 2. Selected local Interview Authority Pack documents`,
    "",
    ...summaries,
    `## 3. Per-document parsed structure and chunks`,
    ""
  );

  const artifactPath = resolve(OUT_DIR, "CHUNKER_ISOLATION_AUDIT.md");
  writeFileSync(artifactPath, parts.join("\n"), "utf8");
  db.close();
  process.stderr.write(`${artifactPath}\n`);
}

main();
