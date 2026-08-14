import type {
  AnswerPlan,
  ClaimSourceSpan,
  EvidenceItem,
  ExtractiveRenderedClaim,
  GroundingDecisionSnapshotBinding
} from "./types";
import type { SourceAuthorityRole } from "../knowledgeV2";

export type CitationPolicyVersion =
  "source-bound-citation-mapper/wb21";

export type CitationValidationFailureReason =
  | "snapshot_mismatch"
  | "r4_range_missing"
  | "claim_missing"
  | "evidence_missing"
  | "span_missing"
  | "span_hash_mismatch"
  | "provenance_mismatch"
  | "canonical_url_missing"
  | "canonical_url_untrusted"
  | "authority_role_mismatch"
  | "rejected_evidence"
  | "contextual_evidence"
  | "source_status_mismatch";

export interface CitationValidationState {
  state: "valid" | "invalid" | "unavailable";
  failureReasons: CitationValidationFailureReason[];
}

export interface SourceCitation {
  citationId: string;
  citationPolicyVersion: CitationPolicyVersion;
  snapshotBinding: GroundingDecisionSnapshotBinding;
  answerTextHash: string;
  factualRangeId: string;
  answerRange: {
    startOffset: number;
    endOffset: number;
  };
  claimId: string;
  evidenceId: string;
  spanId: string;
  supportingSpanIds: string[];
  documentId: string;
  sourceId: string;
  authorityRole: SourceAuthorityRole;
  sourceTitle: string;
  headingPath: string[];
  sectionId: string;
  canonicalUrl: string | null;
  canonicalUrlSource:
    | "persisted_revision"
    | "powershell_document_identity"
    | "source_registry_learn_mapping"
    | null;
  sourceStatus: EvidenceItem["source"]["sourceStatus"];
  sourceRevision: Record<string, unknown>;
  freshnessState: AnswerPlan["freshnessInstructions"];
  validation: CitationValidationState;
}

export interface FactualRangeCitationMapping {
  factualRangeId: string;
  answerRange: ExtractiveRenderedClaim["answerTextRange"];
  claimId: string;
  citationIds: string[];
  invalidCitationIds: string[];
  coverage: "zero" | "one" | "multiple";
  complete: boolean;
}

export interface CitationMappingResult {
  citationPolicyVersion: CitationPolicyVersion;
  snapshotBinding: GroundingDecisionSnapshotBinding;
  answerText: string;
  answerTextHash: string;
  citations: SourceCitation[];
  factualRanges: FactualRangeCitationMapping[];
  validation: {
    valid: boolean;
    failureReasons: CitationValidationFailureReason[];
  };
  previewState: AnswerPlan["previewInstructions"];
  freshnessState: AnswerPlan["freshnessInstructions"];
  diagnostics: {
    latencyMs: number;
    factualRangeCount: number;
    validCitationCount: number;
    invalidCitationCount: number;
    rangesWithoutCitation: number;
    providerRequestCount: 0;
  };
}

export interface CanonicalCitationUrlResolution {
  canonicalUrl: string | null;
  source:
    | "persisted_revision"
    | "powershell_document_identity"
    | "source_registry_learn_mapping"
    | null;
  failureReason:
    | "canonical_url_missing"
    | "canonical_url_untrusted"
    | null;
}

export interface CitationSpanCandidate {
  renderedClaim: ExtractiveRenderedClaim;
  claimId: string;
  span: ClaimSourceSpan;
}
