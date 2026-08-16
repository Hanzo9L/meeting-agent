import type { SourceAuthorityRole } from "../knowledgeV2";
import type { EvidenceSupportType } from "./types";

export type ExplanationContextType =
  | "definition"
  | "prerequisite"
  | "procedure"
  | "command"
  | "cmdlet_reference"
  | "parameter_reference"
  | "verification"
  | "example"
  | "conceptual_explanation"
  | "supporting_context";

export type ExplanationContextRelevance =
  | "supports_claim"
  | "same_document_adjacent"
  | "aspect_linked";

export interface ExplanationContextBlock {
  contextBlockId: string;
  groundingSnapshotId: string;
  groundingSnapshotHash: string;
  evidenceId: string;
  documentId: string;
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  headingPath: string[];
  sectionId: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  contentHash: string;
  canonicalUrl: string;
  contextType: ExplanationContextType;
  relevance: ExplanationContextRelevance;
  relatedClaimIds: string[];
  relatedAspectIds: string[];
  authorityRole: SourceAuthorityRole | "unknown";
  supportTypes: EvidenceSupportType[];
  ordering: {
    sequence: number;
    sourceOrder: number;
  };
}

export interface ExplanationContextBuildResult {
  blocks: ExplanationContextBlock[];
  diagnostics: {
    latencyMs: number;
    selectedEvidenceCount: number;
    rejectedEvidenceExcluded: number;
    contextualOnlyExcluded: number;
    sameDocumentAdjacentCount: number;
    providerRequestCount: 0;
  };
}

export interface ContextReference {
  contextBlockId: string;
  evidenceId: string;
  documentId: string;
  chunkId: string;
  sourceTitle: string;
  canonicalUrl: string;
  sourceId: string;
  authorityRole: string;
  headingPath: string[];
  sectionId: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceContentHash: string;
  contextType: ExplanationContextType;
  preview: boolean;
}
