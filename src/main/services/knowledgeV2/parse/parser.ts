import { createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { parseDocument as parseYamlDocument } from "yaml";
import type {
  AcquiredDocumentInput,
  CanonicalBlock,
  CanonicalInlineToken,
  CanonicalLinkRef,
  CanonicalSection,
  KnowledgeDocument,
  NormalizedMetadata,
  ParseDiagnostic,
  ParseResult,
  SectionKind
} from "./types";

type NodeLike = {
  type: string;
  depth?: number;
  lang?: string;
  value?: string;
  ordered?: boolean;
  children?: NodeLike[];
  align?: Array<"left" | "right" | "center" | null>;
  url?: string;
};

function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSourcePath(input: AcquiredDocumentInput): string {
  if (input.revision.transport === "github") return input.revision.path;
  if (input.revision.sourcePath) return input.revision.sourcePath;
  return new URL(input.canonicalUrl).pathname.replace(/^\/+/, "");
}

function unwrapLearnMarkdownEnvelope(input: AcquiredDocumentInput): string {
  const raw = input.rawMarkdown;
  if (input.transport !== "learn_mcp") return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const textParts = parsed
        .map((entry) => (entry as { text?: unknown }).text)
        .filter((value): value is string => typeof value === "string");
      if (textParts.length > 0) return textParts.join("\n\n");
    }
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { content?: unknown[]; markdown?: unknown; text?: unknown };
      if (typeof record.markdown === "string") return record.markdown;
      if (typeof record.text === "string") return record.text;
      if (Array.isArray(record.content)) {
        const textParts = record.content
          .map((entry) => (entry as { text?: unknown }).text)
          .filter((value): value is string => typeof value === "string");
        if (textParts.length > 0) return textParts.join("\n\n");
      }
    }
  } catch {
    // Not a JSON envelope; treat raw as markdown.
  }
  return raw;
}

function extractFrontMatter(rawMarkdown: string): {
  bodyMarkdown: string;
  rawFrontMatter: string | null;
  frontMatter: Record<string, unknown>;
  diagnostics: ParseDiagnostic[];
} {
  const diagnostics: ParseDiagnostic[] = [];
  if (!rawMarkdown.startsWith("---\n")) {
    return {
      bodyMarkdown: rawMarkdown,
      rawFrontMatter: null,
      frontMatter: {},
      diagnostics
    };
  }

  const closing = rawMarkdown.indexOf("\n---\n", 4);
  if (closing < 0) {
    diagnostics.push({
      code: "malformed_front_matter",
      severity: "error",
      message: "YAML front matter opening marker found without closing marker.",
      sectionPath: []
    });
    return {
      bodyMarkdown: rawMarkdown,
      rawFrontMatter: null,
      frontMatter: {},
      diagnostics
    };
  }

  const rawFrontMatter = rawMarkdown.slice(4, closing + 1);
  const bodyMarkdown = rawMarkdown.slice(closing + 5);
  try {
    const parsed = parseYamlDocument(rawFrontMatter, { uniqueKeys: false });
    for (const warning of parsed.warnings) {
      diagnostics.push({
        code: "duplicate_front_matter_key",
        severity: "warning",
        message: String(warning),
        sectionPath: []
      });
    }
    for (const error of parsed.errors) {
      diagnostics.push({
        code: "malformed_front_matter",
        severity: "error",
        message: String(error),
        sectionPath: []
      });
    }
    const data = (parsed.toJSON() ?? {}) as Record<string, unknown>;
    return {
      bodyMarkdown,
      rawFrontMatter,
      frontMatter: data,
      diagnostics
    };
  } catch (error) {
    diagnostics.push({
      code: "malformed_front_matter",
      severity: "error",
      message: error instanceof Error ? error.message : "Front matter parse failed.",
      sectionPath: []
    });
    return {
      bodyMarkdown,
      rawFrontMatter,
      frontMatter: {},
      diagnostics
    };
  }
}

function normalizeMetadata(frontMatter: Record<string, unknown>, fallbackTitle?: string): NormalizedMetadata {
  const pick = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = frontMatter[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };
  const pickArray = (keys: string[]): string[] | undefined => {
    for (const key of keys) {
      const value = frontMatter[key];
      if (Array.isArray(value)) {
        const normalized = value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (normalized.length > 0) return normalized;
      }
      if (typeof value === "string" && value.trim()) return [value.trim()];
    }
    return undefined;
  };

  return {
    title: pick(["title"]) ?? fallbackTitle,
    description: pick(["description", "summary"]),
    product: pick(["product", "ms.product"]),
    service: pick(["service", "ms.service"]),
    subservice: pick(["subservice", "ms.subservice"]),
    audience: pick(["audience"]),
    topic: pick(["topic", "ms.topic"]),
    documentType: pick(["documentType", "page_type"]),
    author: pick(["author"]),
    msAuthor: pick(["ms.author", "ms_author"]),
    applicableProducts: pickArray(["appliesto", "applicableProducts", "ms.applicableproducts"]),
    createdDate: pick(["createdDate", "ms.created", "created_at"]),
    updatedDate: pick(["updatedDate", "ms.date", "updated_at"]),
    deprecationStatus: pick(["deprecationStatus", "deprecated"]),
    previewStatus: pick(["previewStatus", "ms.status"])
  };
}

function collectInlineTokens(node: NodeLike): { inline: CanonicalInlineToken[]; links: CanonicalLinkRef[] } {
  const inline: CanonicalInlineToken[] = [];
  const links: CanonicalLinkRef[] = [];
  visit(node as never, (candidate: unknown) => {
    const current = candidate as NodeLike;
    if (current.type === "inlineCode") {
      inline.push({
        kind: "inline_code",
        value: current.value ?? ""
      });
      return;
    }
    if (current.type === "link") {
      const text = toString(current as never);
      const href = current.url ?? "";
      inline.push({
        kind: "link",
        value: text,
        href
      });
      links.push({
        text,
        href,
        kind: /^https?:\/\//i.test(href) ? "absolute" : "relative"
      });
      return;
    }
    if (current.type === "text") {
      inline.push({
        kind: "text",
        value: current.value ?? ""
      });
    }
  });
  return { inline, links };
}

function detectCallout(text: string): CanonicalBlock | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(note|important|warning|caution|tip)\s*[:\-]?\s*/i);
  if (!match) return null;
  const level = (match[1] ?? "").toLowerCase() as "note" | "important" | "warning" | "caution" | "tip";
  return {
    kind: "callout",
    level,
    text: trimmed.slice(match[0].length),
    raw: trimmed
  };
}

function toSectionKind(heading: string): SectionKind {
  const key = heading.trim().toLowerCase();
  if (key === "synopsis") return "powershell_synopsis";
  if (key === "syntax") return "powershell_syntax";
  if (key === "description") return "powershell_description";
  if (key === "examples" || key.startsWith("example")) return "powershell_examples";
  if (key === "parameters") return "powershell_parameters";
  if (key === "inputs") return "powershell_inputs";
  if (key === "outputs") return "powershell_outputs";
  if (key === "notes") return "powershell_notes";
  if (key === "related links" || key === "relatedlinks") return "powershell_related_links";
  return "generic";
}

function convertNodeToBlock(
  node: NodeLike,
  diagnostics: ParseDiagnostic[],
  sectionPath: string[]
): CanonicalBlock | null {
  const raw = toString(node as never);
  if (node.type === "paragraph") {
    const { inline, links } = collectInlineTokens(node);
    return {
      kind: "paragraph",
      text: raw,
      inline,
      links,
      raw
    };
  }

  if (node.type === "list") {
    const items = (node.children ?? [])
      .filter((child) => child.type === "listItem")
      .map((child) => toString(child as never));
    return {
      kind: node.ordered ? "ordered_list" : "unordered_list",
      items,
      raw
    };
  }

  if (node.type === "table") {
    const rows = node.children ?? [];
    if (rows.length === 0) {
      diagnostics.push({
        code: "malformed_table",
        severity: "warning",
        message: "Table node without rows encountered.",
        sectionPath
      });
      return {
        kind: "table",
        headers: [],
        rows: [],
        raw
      };
    }
    const headers = (rows[0]?.children ?? []).map((cell) => toString(cell as never));
    const bodyRows = rows.slice(1).map((row) => (row.children ?? []).map((cell) => toString(cell as never)));
    return {
      kind: "table",
      headers,
      rows: bodyRows,
      raw
    };
  }

  if (node.type === "code") {
    return {
      kind: "code_block",
      language: node.lang,
      text: node.value ?? "",
      raw
    };
  }

  if (node.type === "blockquote") {
    const callout = detectCallout(raw);
    if (callout) return callout;
    return {
      kind: "blockquote",
      text: raw,
      raw
    };
  }

  if (node.type === "html") {
    return {
      kind: "html",
      html: node.value ?? "",
      raw
    };
  }

  if (node.type === "thematicBreak") {
    return {
      kind: "thematic_break",
      raw
    };
  }

  if (node.type === "definition" || node.type === "footnoteDefinition") {
    diagnostics.push({
      code: "unsupported_markdown_node",
      severity: "warning",
      message: `Unsupported node preserved: ${node.type}`,
      sectionPath,
      nodeType: node.type
    });
    return {
      kind: "unknown",
      nodeType: node.type,
      raw
    };
  }

  diagnostics.push({
    code: "unsupported_markdown_node",
    severity: "warning",
    message: `Unsupported node preserved: ${node.type}`,
    sectionPath,
    nodeType: node.type
  });
  return {
    kind: "unknown",
    nodeType: node.type,
    raw
  };
}

export function parseCanonicalDocument(input: AcquiredDocumentInput): ParseResult {
  const diagnostics: ParseDiagnostic[] = [];
  const markdown = unwrapLearnMarkdownEnvelope(input);
  const fm = extractFrontMatter(markdown);
  diagnostics.push(...fm.diagnostics);

  let tree: NodeLike;
  try {
    tree = unified().use(remarkParse).use(remarkGfm).parse(fm.bodyMarkdown) as unknown as NodeLike;
  } catch (error) {
    const fatal: ParseDiagnostic = {
      code: "unsupported_markdown_node",
      severity: "error",
      message: error instanceof Error ? error.message : "Markdown parse failed.",
      sectionPath: []
    };
    return {
      success: false,
      fatalErrors: [fatal],
      warnings: diagnostics.filter((item) => item.severity === "warning"),
      document: null
    };
  }

  const sectionCounter = { value: 0 };
  const rootSection: CanonicalSection = {
    sectionId: `sec-${sectionCounter.value++}`,
    heading: "Document Root",
    headingLevel: 0,
    headingPath: [],
    sectionKind: "generic",
    blocks: [],
    children: []
  };
  const stack: CanonicalSection[] = [rootSection];

  for (const node of tree.children ?? []) {
    if (node.type === "heading") {
      const headingLevel = node.depth ?? 1;
      const headingText = toString(node as never).trim() || `Untitled Heading ${sectionCounter.value}`;
      const currentLevel = stack[stack.length - 1]?.headingLevel ?? 0;
      if (headingLevel > currentLevel + 1) {
        diagnostics.push({
          code: "invalid_heading_progression",
          severity: "warning",
          message: `Heading level jumped from H${currentLevel} to H${headingLevel}.`,
          sectionPath: stack[stack.length - 1]?.headingPath ?? []
        });
      }

      while (stack.length > 0 && (stack[stack.length - 1]?.headingLevel ?? 0) >= headingLevel) {
        stack.pop();
      }
      const parent = stack[stack.length - 1] ?? rootSection;
      const section: CanonicalSection = {
        sectionId: `sec-${sectionCounter.value++}`,
        heading: headingText,
        headingLevel,
        headingPath: [...parent.headingPath, headingText],
        sectionKind: toSectionKind(headingText),
        blocks: [],
        children: []
      };
      parent.children.push(section);
      stack.push(section);
      continue;
    }

    const current = stack[stack.length - 1] ?? rootSection;
    const block = convertNodeToBlock(node, diagnostics, current.headingPath);
    if (block) current.blocks.push(block);
  }

  const firstHeading = rootSection.children[0]?.heading;
  const normalizedMetadata = normalizeMetadata(fm.frontMatter, firstHeading);
  if (!normalizedMetadata.title) {
    diagnostics.push({
      code: "missing_title",
      severity: "warning",
      message: "No title metadata or heading-derived fallback title found.",
      sectionPath: []
    });
  }

  const sourcePath = toSourcePath(input);
  const documentId = hashStable(
    `${input.sourceId}|${input.trackId}|${input.transport}|${input.canonicalUrl}|${sourcePath}`
  );

  const document: KnowledgeDocument = {
    documentId,
    sourceId: input.sourceId,
    trackId: input.trackId,
    transport: input.transport,
    canonicalUrl: input.canonicalUrl,
    sourcePath,
    sourceRevision: input.revision,
    rawMarkdown: markdown,
    rawFrontMatter: fm.rawFrontMatter,
    frontMatter: fm.frontMatter,
    normalizedMetadata,
    sections: rootSection.children,
    diagnostics
  };

  const fatalErrors = diagnostics.filter((item) => item.severity === "error");
  return {
    success: fatalErrors.length === 0,
    fatalErrors,
    warnings: diagnostics.filter((item) => item.severity === "warning"),
    document
  };
}

