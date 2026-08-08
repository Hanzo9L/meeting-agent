import type { SourceAuthorityRole, SourceDomain, SourceStatus } from "../knowledgeV2";
import type { QueryIntent } from "../retrievalV2/queryIntent";
import type { RetrievalScope } from "../retrievalV2/domainRouter";
import type { CandidateExactMatch, FusedRetrievalCandidate, HybridRetrievalResult } from "../retrievalV2";

export type AnswerabilityStatus = "answered" | "partial" | "insufficient_evidence";

export type EvidenceFreshnessState =
  | "current"
  | "possibly_stale"
  | "stale"
  | "unknown"
  | "verification_required";

export type EvidenceSupportType =
  | "concept_definition"
  | "configuration_behavior"
  | "procedure"
  | "prerequisite"
  | "cmdlet_semantics"
  | "parameter_semantics"
  | "troubleshooting_guidance"
  | "licensing_or_status"
  | "comparison_dimension"
  | "contextual";

export type EvidenceRejectionReason =
  | "redundant"
  | "lower_authority"
  | "low_topical_relevance"
  | "unsupported_exact_identifier"
  | "beta_not_allowed"
  | "conflicting"
  | "superseded"
  | "insufficient_direct_support"
  | "candidate_cap"
  | "adjacent_domain_authority_missing";

export interface EvidenceItem {
  evidenceId: string;
  chunkId: string;
  documentId: string;
  source: {
    sourceId: string;
    trackId: string;
    sourceStatus: SourceStatus | "unknown";
    sourceDomain: SourceDomain | "unknown";
    authorityTier: "tier1" | "secondary" | "unknown";
    authorityRoles: SourceAuthorityRole[];
    routePriority: "primary" | "supporting";
    title: string;
    canonicalUrl: string;
    sourcePath: string;
    sourceRevision: Record<string, unknown>;
  };
  location: {
    sectionId: string;
    headingPath: string[];
  };
  text: string;
  supportTypes: EvidenceSupportType[];
  retrieval: {
    methods: Array<"exact" | "lexical" | "semantic">;
    fusionRank: number;
    fusionScore: number;
    methodSignals: FusedRetrievalCandidate["methodSignals"];
    exactMatch: CandidateExactMatch | null;
    retrievalReasons: string[];
  };
  selectionReason: string;
}

export interface RejectedEvidenceCandidate {
  candidateId: string;
  chunkId: string;
  documentId: string;
  title: string;
  sourceId: string;
  fusionRank: number;
  reasons: EvidenceRejectionReason[];
}

export interface EvidenceConflict {
  conflictId: string;
  conflictType: "contradiction" | "ga_vs_beta" | "stale_vs_current" | "scope_mismatch";
  topic: string;
  evidenceIds: string[];
  notes: string;
}

export interface EvidenceBundleDiagnostics {
  latencyMs: {
    total: number;
    selection: number;
    conflictDetection: number;
    answerability: number;
  };
  populations: {
    candidates: number;
    selectedEvidence: number;
    rejectedCandidates: number;
  };
  policySignals: {
    authoritativeEvidencePresent: boolean;
    exactIdentifierVerified: boolean;
    requiredConceptCoverage: boolean;
    conflictFree: boolean;
    freshnessOk: boolean;
    authorityCoverageOk: boolean;
    provenanceComplete: boolean;
  };
}

export interface EvidenceBundle {
  question: string;
  intent: QueryIntent;
  scope: RetrievalScope;
  evidence: EvidenceItem[];
  rejectedCandidates: RejectedEvidenceCandidate[];
  conflicts: EvidenceConflict[];
  freshness: {
    state: EvidenceFreshnessState;
    requiresVerification: boolean;
    reasons: string[];
  };
  exactIdentifierValidation: {
    required: boolean;
    verified: boolean;
    requiredDirectives: Array<{ type: "cmdlet" | "policy" | "entity"; value: string }>;
    missingRequiredDirectives: Array<{ type: "cmdlet" | "policy" | "entity"; value: string }>;
  };
  authorityCoverage: {
    requestedDomains: SourceDomain[];
    coveredDomains: SourceDomain[];
    missingDomains: SourceDomain[];
  };
  answerability: AnswerabilityStatus;
  diagnostics: EvidenceBundleDiagnostics;
}

export interface BuildEvidenceBundleResult {
  bundle: EvidenceBundle;
  retrieval: HybridRetrievalResult;
}

export type AnswerPlanSectionId =
  | "direct_answer"
  | "key_components"
  | "relationships"
  | "prerequisites"
  | "steps"
  | "validation"
  | "purpose"
  | "behavior"
  | "parameters"
  | "examples"
  | "context"
  | "checks"
  | "corrective_actions"
  | "limitations"
  | "compared_dimensions"
  | "configuration"
  | "caveats";

export type PlannedClaimType =
  | "concept_definition"
  | "configuration_behavior"
  | "procedure"
  | "prerequisite"
  | "cmdlet_semantics"
  | "parameter_semantics"
  | "troubleshooting_guidance"
  | "licensing_or_status"
  | "comparison_dimension";

export interface PlannedClaim {
  claimId: string;
  claimType: PlannedClaimType;
  sectionId: AnswerPlanSectionId;
  proposition: string;
  evidenceIds: string[];
  supportStrength: "direct" | "supporting";
  mandatory: boolean;
  requiresCaveat: boolean;
  authorityContext: {
    sourceIds: string[];
    routePriorities: Array<"primary" | "supporting">;
  };
}

export interface UnsupportedAspect {
  aspectId: string;
  reason:
    | "missing_authority"
    | "insufficient_evidence"
    | "exact_identifier_unverified"
    | "freshness_verification_required"
    | "conflict_unresolved";
  detail: string;
}

export interface RequiredCaveat {
  code:
    | "partial_coverage"
    | "preview_evidence_used"
    | "freshness_verification_required"
    | "unresolved_conflict"
    | "missing_adjacent_authority"
    | "exact_identifier_unverified";
  detail: string;
}

export interface AnswerPlan {
  question: string;
  intent: QueryIntent;
  answerability: AnswerabilityStatus;
  answerType: QueryIntent["expectedAnswerType"];
  plannedClaims: PlannedClaim[];
  requiredCaveats: RequiredCaveat[];
  unsupportedAspects: UnsupportedAspect[];
  evidenceReferences: {
    usedEvidenceIds: string[];
    unusedEvidenceIds: string[];
  };
  freshnessInstructions: {
    mustVerifyBeforeFinalAnswer: boolean;
    reasons: string[];
  };
  previewInstructions: {
    previewEvidenceUsed: boolean;
    requiredLabel: boolean;
  };
  exactIdentifierState: EvidenceBundle["exactIdentifierValidation"];
  recommendedStructure: {
    format: "bullets" | "steps" | "short_paragraphs";
    orderedSections: AnswerPlanSectionId[];
  };
  diagnostics: {
    latencyMs: number;
    decomposition: {
      requestedConcepts: string[];
      supportedConcepts: string[];
      omittedConcepts: string[];
    };
    duplicateClaimsCollapsed: number;
    canonicalUrlCoverage: {
      complete: boolean;
      missingEvidenceIds: string[];
      note: string;
    };
  };
}

export interface GroundedDraftClaim {
  claimId: string;
  generatedText: string;
}

export interface GroundedDraftCaveat {
  code: RequiredCaveat["code"];
  text: string;
}

export interface GroundedDraftUnsupportedAspect {
  aspectId: string;
  text: string;
}

export interface GroundedAnswerDraft {
  answerText: string;
  realizedClaims: GroundedDraftClaim[];
  caveats: GroundedDraftCaveat[];
  unsupportedAspects: GroundedDraftUnsupportedAspect[];
}

export interface ClaimEvidenceContext {
  evidenceId: string;
  title: string;
  headingPath: string[];
  excerpt: string;
  sourceDomain: EvidenceItem["source"]["sourceDomain"];
  sourceStatus: EvidenceItem["source"]["sourceStatus"];
  authorityTier: EvidenceItem["source"]["authorityTier"];
}

export interface ClaimRealizationTask {
  claimId: string;
  proposition: string;
  claimType: PlannedClaimType;
  sectionId: AnswerPlanSectionId;
  evidence: ClaimEvidenceContext[];
  authorityContext: string[];
  requiresCaveat: boolean;
  mandatory: boolean;
}

export interface ClaimRealization {
  claimId: string;
  text: string;
}

export interface CorrectiveRetryInput {
  previousText: string;
  issues: GroundingValidationIssue[];
  expectedClaimId: string;
}

export interface GroundingValidationIssue {
  code:
    | "wrong_claim_id"
    | "empty_claim_text"
    | "unknown_claim_id"
    | "missing_mandatory_claim"
    | "claim_generation_failed"
    | "claim_without_evidence"
    | "missing_required_caveat"
    | "missing_unsupported_aspect"
    | "insufficient_answer_contains_claims"
    | "exact_identifier_violation"
    | "preview_caveat_missing"
    | "freshness_caveat_missing"
    | "schema_invalid";
  message: string;
  claimId?: string;
}

export interface GroundingValidationResult {
  valid: boolean;
  issues: GroundingValidationIssue[];
  coverage: {
    mandatoryClaimsTotal: number;
    mandatoryClaimsRealized: number;
    unknownClaimCount: number;
    missingCaveatCount: number;
  };
}

export interface GroundedAnswer {
  answerability: AnswerabilityStatus;
  answerText: string;
  realizedClaims: Array<{
    claimId: string;
    generatedText: string;
    evidenceIds: string[];
  }>;
  caveats: GroundedDraftCaveat[];
  unsupportedAspects: GroundedDraftUnsupportedAspect[];
  evidenceReferences: {
    usedEvidenceIds: string[];
    claimEvidenceMap: Record<string, string[]>;
  };
  freshnessState: AnswerPlan["freshnessInstructions"];
  previewState: AnswerPlan["previewInstructions"];
  exactIdentifierState: AnswerPlan["exactIdentifierState"];
  validation: GroundingValidationResult;
  diagnostics: {
    generatorProviderId: string;
    generationLatencyMs: number;
    validationLatencyMs: number;
    totalLatencyMs: number;
    claimTaskCount: number;
    mandatoryClaimTaskCount: number;
    successfulClaimCount: number;
    failedClaimCount: number;
    requestCount: number;
    retryCount: number;
    firstAttemptValid: boolean;
    finalAttemptValid: boolean;
    firstAttemptIssues: GroundingValidationIssue[];
    attempts: Array<{
      attempt: number;
      mode: "initial" | "corrective";
      claimId: string;
      latencyMs: number;
      validationValid: boolean;
      validationIssueCodes: GroundingValidationIssue["code"][];
      tokenUsage: {
        inputTokens: number | null;
        outputTokens: number | null;
      };
    }>;
    tokenUsage: {
      inputTokens: number | null;
      outputTokens: number | null;
    };
  };
}

export interface GenerateGroundedAnswerOptions {
  maxTokens?: number;
  temperature?: number;
  correction?: CorrectiveRetryInput;
  promptProfile?: "baseline" | "hardened";
  claimConcurrency?: number;
  includeOptionalClaims?: boolean;
  claimRetryLimit?: number;
}
