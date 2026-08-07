import type { CanonicalBlock, KnowledgeDocument, NormalizedMetadata } from "../parse";
import type { SourceRevision, SourceStatus } from "../sourceTypes";

export const SEMANTIC_CHUNKER_VERSION = "cg01a-v1";

export type KnowledgeChunkKind =
  | "conceptual"
  | "procedure"
  | "configuration"
  | "troubleshooting"
  | "reference"
  | "table"
  | "code"
  | "powershell_synopsis"
  | "powershell_description"
  | "powershell_syntax"
  | "powershell_example"
  | "powershell_parameter"
  | "powershell_inputs"
  | "powershell_outputs"
  | "powershell_notes"
  | "powershell_related_links"
  | "generic";

export interface ChunkExactEntity {
  type: "cmdlet" | "parameter" | "policy" | "feature" | "identifier";
  value: string;
}

export interface ChunkStructuralReference {
  blockKind: CanonicalBlock["kind"];
  blockIndex: number;
}

export interface ChunkInheritedMetadata {
  sourceId: string;
  trackId: string;
  contentStatus: SourceStatus | "unknown";
  title?: string;
  product?: string;
  service?: string;
  subservice?: string;
  topic?: string;
  audience?: string;
  documentType?: string;
  applicableProducts?: string[];
  updatedDate?: string;
  previewStatus?: string;
}

export interface KnowledgeChunk {
  chunkId: string;
  documentId: string;
  sourceId: string;
  trackId: string;
  sectionId: string;
  headingPath: string[];
  sourceOrder: number;
  chunkKind: KnowledgeChunkKind;
  retrievalText: string;
  contentHash: string;
  chunkerVersion: string;
  canonicalUrl: string;
  contentStatus: SourceStatus | "unknown";
  inheritedMetadata: ChunkInheritedMetadata;
  exactEntities: ChunkExactEntity[];
  provenance: {
    sourcePath: string;
    sourceRevision: SourceRevision;
    headingPath: string[];
    structuralReferences: ChunkStructuralReference[];
  };
}

export type ChunkDiagnosticCode =
  | "oversized_section_split"
  | "structurally_empty_section"
  | "unsupported_block_preserved_generically"
  | "table_chunked_separately"
  | "unusual_powershell_structure";

export interface ChunkDiagnostic {
  code: ChunkDiagnosticCode;
  message: string;
  sectionId: string;
  headingPath: string[];
}

export interface SemanticChunkResult {
  chunks: KnowledgeChunk[];
  diagnostics: ChunkDiagnostic[];
  chunkerVersion: string;
}

export interface SemanticChunkingOptions {
  chunkerVersion?: string;
  maxChunkChars?: number;
}

export interface SemanticChunkDocumentSummary {
  documentId: string;
  sourceId: string;
  trackId: string;
  title?: string;
  sectionCount: number;
  chunkCount: number;
  chunkKinds: Record<string, number>;
  diagnostics: ChunkDiagnostic[];
}

export function pickChunkInheritedMetadata(
  document: KnowledgeDocument,
  contentStatus: SourceStatus | "unknown"
): ChunkInheritedMetadata {
  const metadata: ChunkInheritedMetadata = {
    sourceId: document.sourceId,
    trackId: document.trackId,
    contentStatus
  };
  copyWhenDefined(metadata, document.normalizedMetadata, "title");
  copyWhenDefined(metadata, document.normalizedMetadata, "product");
  copyWhenDefined(metadata, document.normalizedMetadata, "service");
  copyWhenDefined(metadata, document.normalizedMetadata, "subservice");
  copyWhenDefined(metadata, document.normalizedMetadata, "topic");
  copyWhenDefined(metadata, document.normalizedMetadata, "audience");
  copyWhenDefined(metadata, document.normalizedMetadata, "documentType");
  copyWhenDefined(metadata, document.normalizedMetadata, "updatedDate");
  copyWhenDefined(metadata, document.normalizedMetadata, "previewStatus");
  if (Array.isArray(document.normalizedMetadata.applicableProducts)) {
    metadata.applicableProducts = [...document.normalizedMetadata.applicableProducts];
  }
  return metadata;
}

function copyWhenDefined<K extends keyof ChunkInheritedMetadata, T extends keyof NormalizedMetadata>(
  target: ChunkInheritedMetadata,
  source: NormalizedMetadata,
  key: K,
  sourceKey?: T
): void {
  const value = source[sourceKey ?? (key as unknown as T)];
  if (typeof value === "string" && value.trim()) {
    target[key] = value.trim() as ChunkInheritedMetadata[K];
  }
}
