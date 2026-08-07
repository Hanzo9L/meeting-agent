import type { SourceRevision, SourceTransport } from "../sourceTypes";

export type ParseDiagnosticSeverity = "warning" | "error";

export interface ParseDiagnostic {
  code:
    | "malformed_front_matter"
    | "duplicate_front_matter_key"
    | "invalid_heading_progression"
    | "unsupported_markdown_node"
    | "missing_title"
    | "malformed_table"
    | "unknown_callout";
  severity: ParseDiagnosticSeverity;
  message: string;
  sectionPath: string[];
  nodeType?: string;
}

export interface CanonicalLinkRef {
  text: string;
  href: string;
  kind: "absolute" | "relative";
}

export interface CanonicalInlineToken {
  kind: "text" | "inline_code" | "link";
  value: string;
  href?: string;
}

export type CanonicalBlock =
  | {
      kind: "paragraph";
      text: string;
      inline: CanonicalInlineToken[];
      links: CanonicalLinkRef[];
      raw: string;
    }
  | {
      kind: "ordered_list" | "unordered_list";
      items: string[];
      raw: string;
    }
  | {
      kind: "table";
      headers: string[];
      rows: string[][];
      raw: string;
    }
  | {
      kind: "code_block";
      language?: string;
      text: string;
      raw: string;
    }
  | {
      kind: "blockquote";
      text: string;
      raw: string;
    }
  | {
      kind: "callout";
      level: "note" | "important" | "warning" | "caution" | "tip";
      text: string;
      raw: string;
    }
  | {
      kind: "html";
      html: string;
      raw: string;
    }
  | {
      kind: "thematic_break";
      raw: string;
    }
  | {
      kind: "unknown";
      nodeType: string;
      raw: string;
    };

export type SectionKind =
  | "generic"
  | "powershell_synopsis"
  | "powershell_syntax"
  | "powershell_description"
  | "powershell_examples"
  | "powershell_parameters"
  | "powershell_inputs"
  | "powershell_outputs"
  | "powershell_notes"
  | "powershell_related_links";

export interface CanonicalSection {
  sectionId: string;
  heading: string;
  headingLevel: number;
  headingPath: string[];
  sectionKind: SectionKind;
  blocks: CanonicalBlock[];
  children: CanonicalSection[];
}

export interface NormalizedMetadata {
  title?: string;
  description?: string;
  product?: string;
  service?: string;
  subservice?: string;
  audience?: string;
  topic?: string;
  documentType?: string;
  author?: string;
  msAuthor?: string;
  applicableProducts?: string[];
  createdDate?: string;
  updatedDate?: string;
  deprecationStatus?: string;
  previewStatus?: string;
}

export interface AcquiredDocumentInput {
  sourceId: string;
  trackId: string;
  transport: SourceTransport;
  canonicalUrl: string;
  rawMarkdown: string;
  revision: SourceRevision;
}

export interface KnowledgeDocument {
  documentId: string;
  sourceId: string;
  trackId: string;
  transport: SourceTransport;
  canonicalUrl: string;
  sourcePath: string;
  sourceRevision: SourceRevision;
  rawMarkdown: string;
  rawFrontMatter: string | null;
  frontMatter: Record<string, unknown>;
  normalizedMetadata: NormalizedMetadata;
  sections: CanonicalSection[];
  diagnostics: ParseDiagnostic[];
}

export interface ParseResult {
  success: boolean;
  fatalErrors: ParseDiagnostic[];
  warnings: ParseDiagnostic[];
  document: KnowledgeDocument | null;
}

