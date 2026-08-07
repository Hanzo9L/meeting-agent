import { createHash } from "node:crypto";
import type { CanonicalBlock, CanonicalSection, KnowledgeDocument, SectionKind } from "../parse";
import type { SourceStatus } from "../sourceTypes";
import { hashEmbeddingInput } from "../embeddings";
import {
  type ChunkDiagnostic,
  type ChunkExactEntity,
  type KnowledgeChunk,
  type KnowledgeChunkKind,
  type SemanticChunkResult,
  type SemanticChunkingOptions,
  SEMANTIC_CHUNKER_VERSION,
  pickChunkInheritedMetadata
} from "./types";

const DEFAULT_MAX_CHUNK_CHARS = 2200;

type SectionSlice = {
  blockIndexes: number[];
  renderedBlocks: string[];
  forcedKind?: KnowledgeChunkKind;
};

type ChunkBuildContext = {
  document: KnowledgeDocument;
  contentStatus: SourceStatus | "unknown";
  inheritedMetadata: ReturnType<typeof pickChunkInheritedMetadata>;
  sourceOrder: number;
  chunkerVersion: string;
  diagnostics: ChunkDiagnostic[];
  chunks: KnowledgeChunk[];
  cmdletIdentity?: string;
  maxChunkChars: number;
};

export function chunkKnowledgeDocument(
  document: KnowledgeDocument,
  options: SemanticChunkingOptions = {}
): SemanticChunkResult {
  const chunkerVersion = options.chunkerVersion ?? SEMANTIC_CHUNKER_VERSION;
  const contentStatus = inferContentStatus(document);
  const context: ChunkBuildContext = {
    document,
    contentStatus,
    inheritedMetadata: pickChunkInheritedMetadata(document, contentStatus),
    sourceOrder: 0,
    chunkerVersion,
    diagnostics: [],
    chunks: [],
    cmdletIdentity: detectPrimaryCmdletIdentity(document),
    maxChunkChars: Math.max(600, options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS)
  };

  const sections = flattenSections(document.sections);
  for (const section of sections) {
    if (section.blocks.length === 0 && section.children.length === 0) {
      context.diagnostics.push({
        code: "structurally_empty_section",
        message: "Section has no canonical blocks.",
        sectionId: section.sectionId,
        headingPath: [...section.headingPath]
      });
      continue;
    }
    chunkSection(section, context);
  }

  return {
    chunks: context.chunks,
    diagnostics: context.diagnostics,
    chunkerVersion
  };
}

function chunkSection(section: CanonicalSection, context: ChunkBuildContext): void {
  if (section.sectionKind === "powershell_examples") {
    chunkPowerShellExamples(section, context);
    return;
  }
  if (section.sectionKind === "powershell_parameters") {
    chunkPowerShellParameters(section, context);
    return;
  }

  const mappedKind = mapSectionKind(section.sectionKind, section);
  const slices = splitSection(section, context, mappedKind);
  for (const slice of slices) {
    const chunkKind = slice.forcedKind ?? mappedKind;
    pushChunk(section, chunkKind, slice, context);
  }
}

function chunkPowerShellExamples(section: CanonicalSection, context: ChunkBuildContext): void {
  if (section.blocks.length === 0) {
    if (section.children.length === 0) {
      context.diagnostics.push({
        code: "unusual_powershell_structure",
        message: "PowerShell examples section has no blocks or example subsections.",
        sectionId: section.sectionId,
        headingPath: [...section.headingPath]
      });
    }
    return;
  }
  const slices = splitSection(section, context, "powershell_example");
  for (const slice of slices) pushChunk(section, "powershell_example", slice, context);
}

function chunkPowerShellParameters(section: CanonicalSection, context: ChunkBuildContext): void {
  if (section.blocks.length === 0) {
    if (section.children.length === 0) {
      context.diagnostics.push({
        code: "unusual_powershell_structure",
        message: "PowerShell parameters section missing parameter subheadings.",
        sectionId: section.sectionId,
        headingPath: [...section.headingPath]
      });
    }
    return;
  }
  if (section.children.length > 0) {
    context.diagnostics.push({
      code: "unusual_powershell_structure",
      message: "PowerShell parameters section included parent-level blocks; preserving parent content.",
      sectionId: section.sectionId,
      headingPath: [...section.headingPath]
    });
  }
  const slices = splitSection(section, context, "powershell_parameter");
  for (const slice of slices) pushChunk(section, "powershell_parameter", slice, context);
}

function splitSection(
  section: CanonicalSection,
  context: ChunkBuildContext,
  baseKind: KnowledgeChunkKind
): SectionSlice[] {
  const slices: SectionSlice[] = [];
  let current: SectionSlice = { blockIndexes: [], renderedBlocks: [] };
  let currentLength = 0;

  const flushCurrent = (): void => {
    if (current.blockIndexes.length === 0) return;
    slices.push(current);
    current = { blockIndexes: [], renderedBlocks: [] };
    currentLength = 0;
  };

  for (let index = 0; index < section.blocks.length; index += 1) {
    const block = section.blocks[index];
    if (!block) continue;
    const rendered = renderBlock(block);

    if (block.kind === "unknown" || block.kind === "html" || block.kind === "blockquote") {
      context.diagnostics.push({
        code: "unsupported_block_preserved_generically",
        message: `Preserved ${block.kind} block text in generic retrieval form.`,
        sectionId: section.sectionId,
        headingPath: [...section.headingPath]
      });
    }

    if (block.kind === "code_block" || block.kind === "table") {
      flushCurrent();
      const forcedKind =
        baseKind === "powershell_syntax" || baseKind === "powershell_example"
          ? baseKind
          : block.kind === "table"
            ? "table"
            : "code";
      if (block.kind === "table") {
        context.diagnostics.push({
          code: "table_chunked_separately",
          message: "Table rendered as a standalone chunk to preserve row/header semantics.",
          sectionId: section.sectionId,
          headingPath: [...section.headingPath]
        });
      }
      slices.push({
        blockIndexes: [index],
        renderedBlocks: [rendered],
        forcedKind
      });
      continue;
    }

    if (rendered.length > context.maxChunkChars) {
      flushCurrent();
      const pieces = splitLargeText(rendered, context.maxChunkChars);
      if (pieces.length > 1) {
        context.diagnostics.push({
          code: "oversized_section_split",
          message: "Oversized block split deterministically into smaller retrieval segments.",
          sectionId: section.sectionId,
          headingPath: [...section.headingPath]
        });
      }
      for (const piece of pieces) {
        slices.push({
          blockIndexes: [index],
          renderedBlocks: [piece]
        });
      }
      continue;
    }

    const nextLen = currentLength + (current.renderedBlocks.length > 0 ? 2 : 0) + rendered.length;
    if (nextLen > context.maxChunkChars && current.renderedBlocks.length > 0) {
      flushCurrent();
    }

    current.blockIndexes.push(index);
    current.renderedBlocks.push(rendered);
    currentLength += (current.renderedBlocks.length > 1 ? 2 : 0) + rendered.length;
  }

  flushCurrent();
  if (slices.length > 1) {
    context.diagnostics.push({
      code: "oversized_section_split",
      message: "Section exceeded chunk size threshold and was split on safe structural boundaries.",
      sectionId: section.sectionId,
      headingPath: [...section.headingPath]
    });
  }
  return slices;
}

function pushChunk(
  section: CanonicalSection,
  chunkKind: KnowledgeChunkKind,
  slice: SectionSlice,
  context: ChunkBuildContext
): void {
  const retrievalText = renderRetrievalText(context.document, section.headingPath, slice.renderedBlocks);
  const contentHash = hashEmbeddingInput(retrievalText.trim());
  const chunkId = createChunkId({
    documentId: context.document.documentId,
    sectionId: section.sectionId,
    chunkKind,
    sourceOrder: context.sourceOrder,
    contentHash,
    chunkerVersion: context.chunkerVersion
  });

  const exactEntities = collectExactEntities(
    context.document,
    section,
    chunkKind,
    slice.renderedBlocks,
    context.cmdletIdentity
  );

  const chunk: KnowledgeChunk = {
    chunkId,
    documentId: context.document.documentId,
    sourceId: context.document.sourceId,
    trackId: context.document.trackId,
    sectionId: section.sectionId,
    headingPath: [...section.headingPath],
    sourceOrder: context.sourceOrder,
    chunkKind,
    retrievalText,
    contentHash,
    chunkerVersion: context.chunkerVersion,
    canonicalUrl: context.document.canonicalUrl,
    contentStatus: context.contentStatus,
    inheritedMetadata: context.inheritedMetadata,
    exactEntities,
    provenance: {
      sourcePath: context.document.sourcePath,
      sourceRevision: context.document.sourceRevision,
      headingPath: [...section.headingPath],
      structuralReferences: slice.blockIndexes.map((blockIndex) => ({
        blockKind: section.blocks[blockIndex]?.kind ?? "unknown",
        blockIndex
      }))
    }
  };
  context.chunks.push(chunk);
  context.sourceOrder += 1;
}

function flattenSections(sections: CanonicalSection[]): CanonicalSection[] {
  const out: CanonicalSection[] = [];
  const queue = [...sections];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    out.push(current);
    queue.unshift(...current.children);
  }
  return out;
}

function mapSectionKind(sectionKind: SectionKind, section: CanonicalSection): KnowledgeChunkKind {
  switch (sectionKind) {
    case "powershell_synopsis":
      return "powershell_synopsis";
    case "powershell_syntax":
      return "powershell_syntax";
    case "powershell_description":
      return "powershell_description";
    case "powershell_inputs":
      return "powershell_inputs";
    case "powershell_outputs":
      return "powershell_outputs";
    case "powershell_notes":
      return "powershell_notes";
    case "powershell_related_links":
      return "powershell_related_links";
    default:
      return inferGenericChunkKind(section);
  }
}

function inferGenericChunkKind(section: CanonicalSection): KnowledgeChunkKind {
  const headingText = section.headingPath.join(" ").toLowerCase();
  const lastHeading = section.headingPath.at(-1)?.trim() ?? "";
  if (section.headingPath.some((heading) => heading.trim().toLowerCase() === "parameters")) {
    if (/^-[a-z0-9][a-z0-9-]*$/i.test(lastHeading)) return "powershell_parameter";
  }
  if (section.headingPath.some((heading) => heading.trim().toLowerCase() === "inputs")) {
    return "powershell_inputs";
  }
  if (section.headingPath.some((heading) => heading.trim().toLowerCase() === "outputs")) {
    return "powershell_outputs";
  }
  if (section.headingPath.some((heading) => heading.trim().toLowerCase() === "notes")) {
    return "powershell_notes";
  }
  if (section.headingPath.some((heading) => heading.trim().toLowerCase() === "related links")) {
    return "powershell_related_links";
  }
  const hasOrdered = section.blocks.some((block) => block.kind === "ordered_list");
  if (/\b(troubleshoot|troubleshooting|issue|error|fix|fail|outbound)\b/.test(headingText)) {
    return "troubleshooting";
  }
  if (/\b(configure|configuration|setting|requirements?|policy|routing|sbc|plan)\b/.test(headingText)) {
    return hasOrdered ? "procedure" : "configuration";
  }
  if (hasOrdered && /\b(step|steps|how to|procedure)\b/.test(headingText)) {
    return "procedure";
  }
  if (/\b(reference|overview|definitions?|api)\b/.test(headingText)) {
    return "reference";
  }
  return "conceptual";
}

function inferContentStatus(document: KnowledgeDocument): SourceStatus | "unknown" {
  const track = document.trackId.toLowerCase();
  if (track.includes("beta")) return "beta";
  if (track.includes("preview")) return "preview";
  const previewStatus = document.normalizedMetadata.previewStatus?.toLowerCase();
  if (previewStatus?.includes("beta")) return "beta";
  if (previewStatus?.includes("preview")) return "preview";
  if (track.includes("ga")) return "ga";
  return "unknown";
}

function renderRetrievalText(
  document: KnowledgeDocument,
  headingPath: string[],
  renderedBlocks: string[]
): string {
  const title = document.normalizedMetadata.title ?? headingPath[0] ?? "Untitled Document";
  const lines: string[] = [];
  lines.push(`Document: ${title}`);
  lines.push(`Heading Path: ${headingPath.join(" -> ")}`);
  lines.push("");
  lines.push(renderedBlocks.join("\n\n").trim());
  return lines.join("\n").trim();
}

function renderBlock(block: CanonicalBlock): string {
  switch (block.kind) {
    case "paragraph":
      return block.text.trim();
    case "ordered_list":
      return block.items.map((item, index) => `${index + 1}. ${item.trim()}`).join("\n");
    case "unordered_list":
      return block.items.map((item) => `- ${item.trim()}`).join("\n");
    case "table": {
      const header = block.headers.join(" | ");
      const divider = block.headers.map(() => "---").join(" | ");
      const rows = block.rows.map((row) => row.join(" | "));
      return [`| ${header} |`, `| ${divider} |`, ...rows.map((row) => `| ${row} |`)].join("\n");
    }
    case "code_block": {
      const language = block.language?.trim();
      return [`\`\`\`${language ?? ""}`.trim(), block.text, "```"].join("\n");
    }
    case "callout":
      return `${block.level.toUpperCase()}: ${block.text.trim()}`;
    case "blockquote":
      return block.text.trim();
    case "html":
      return block.html.trim() || block.raw.trim();
    case "thematic_break":
      return "---";
    case "unknown":
      return block.raw.trim();
    default:
      return "";
  }
}

function splitLargeText(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return [normalized];

  const paragraphParts = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const output: string[] = [];
  let current = "";

  const flush = (): void => {
    const value = current.trim();
    if (value) output.push(value);
    current = "";
  };

  for (const part of paragraphParts) {
    if (part.length > maxChars) {
      flush();
      output.push(...splitHard(part, maxChars));
      continue;
    }
    const candidate = current ? `${current}\n\n${part}` : part;
    if (candidate.length > maxChars) {
      flush();
      current = part;
    } else {
      current = candidate;
    }
  }
  flush();
  return output.length > 0 ? output : splitHard(normalized, maxChars);
}

function splitHard(text: string, maxChars: number): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const out: string[] = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (candidate.length > maxChars && current) {
      out.push(current);
      current = token;
      continue;
    }
    if (token.length > maxChars) {
      if (current) out.push(current);
      current = "";
      let start = 0;
      while (start < token.length) {
        out.push(token.slice(start, start + maxChars));
        start += maxChars;
      }
      continue;
    }
    current = candidate;
  }
  if (current) out.push(current);
  return out;
}

function detectPrimaryCmdletIdentity(document: KnowledgeDocument): string | undefined {
  if (document.sourceId !== "ms-teams-powershell") return undefined;
  const title = document.normalizedMetadata.title?.trim();
  if (title && isCmdletName(title)) return title;
  const firstHeading = document.sections[0]?.heading?.trim();
  if (firstHeading && isCmdletName(firstHeading)) return firstHeading;
  return undefined;
}

function collectExactEntities(
  document: KnowledgeDocument,
  section: CanonicalSection,
  chunkKind: KnowledgeChunkKind,
  renderedBlocks: string[],
  cmdletIdentity?: string
): ChunkExactEntity[] {
  const entities: ChunkExactEntity[] = [];
  const seen = new Set<string>();
  const add = (type: ChunkExactEntity["type"], value: string): void => {
    const normalized = value.trim();
    if (!normalized) return;
    const key = `${type}:${normalized.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ type, value: normalized });
  };

  if (cmdletIdentity) add("cmdlet", cmdletIdentity);
  for (const heading of section.headingPath) {
    if (isCmdletName(heading)) add("cmdlet", heading);
  }

  const parameterHeading = section.headingPath.find((heading) => /^-[a-z0-9][a-z0-9-]*$/i.test(heading.trim()));
  if (parameterHeading) add("parameter", parameterHeading.trim());
  if (chunkKind === "powershell_parameter") {
    const named = section.headingPath.at(-1);
    if (named && /^-[a-z0-9][a-z0-9-]*$/i.test(named.trim())) add("parameter", named.trim());
  }

  const joined = renderedBlocks.join("\n");
  for (const cmdlet of joined.match(/\b[A-Za-z]+-[A-Za-z][A-Za-z0-9]+\b/g) ?? []) {
    add("cmdlet", cmdlet);
  }
  for (const policy of joined.match(/\b[A-Za-z0-9]+Policy\b/g) ?? []) {
    add("policy", policy);
  }
  for (const feature of ["Direct Routing", "Operator Connect", "Conditional Access", "SBC", "voice routing"]) {
    if (joined.toLowerCase().includes(feature.toLowerCase())) add("feature", feature);
  }
  if (document.canonicalUrl) add("identifier", document.canonicalUrl);

  return entities;
}

function isCmdletName(value: string): boolean {
  return /^[A-Za-z]+-[A-Za-z][A-Za-z0-9]+$/.test(value.trim());
}

function createChunkId(params: {
  documentId: string;
  sectionId: string;
  chunkKind: KnowledgeChunkKind;
  sourceOrder: number;
  contentHash: string;
  chunkerVersion: string;
}): string {
  const seed = [
    params.documentId,
    params.sectionId,
    params.chunkKind,
    String(params.sourceOrder),
    params.contentHash,
    params.chunkerVersion
  ].join("|");
  return createHash("sha256").update(seed, "utf8").digest("hex");
}
