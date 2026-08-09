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

export type EvidenceAspectAnswerObject =
  | "mechanism"
  | "cmdlet_identifier"
  | "cmdlet_semantics"
  | "procedure"
  | "configuration_behavior"
  | "relationship"
  | "status"
  | "comparison"
  | "fact";

export type EvidenceAspectBreadth = "narrow" | "bounded" | "broad";

export type EvidenceAspectSupportStrength = "direct" | "supporting" | "contextual";

export type EvidenceSupportFacet =
  | "purpose"
  | "mechanism"
  | "behavior"
  | "operation"
  | "identifier"
  | "relationship"
  | "procedure"
  | "configuration";

export type EvidenceAspectSubjectKind =
  | "cmdlet"
  | "policy"
  | "entity"
  | "technology"
  | "product"
  | "unresolved";

export interface EvidenceAspectSubject {
  kind: EvidenceAspectSubjectKind;
  value: string;
  terms: string[];
}

export interface EvidenceAspectRelationship {
  predicate: string;
  participants: Array<{
    role: string;
    subject: EvidenceAspectSubject;
  }>;
}

export interface EvidenceAspectAuthorityRequirement {
  requiredRoles: SourceAuthorityRole[];
  requiredDomains: SourceDomain[];
  requireCanonicalIdentity: boolean;
  identityType: "cmdlet" | "policy" | "entity" | null;
}

export interface EvidenceAspectDerivation {
  ruleIds: string[];
  questionSpans: string[];
  unresolved: boolean;
}

export interface EvidenceAspect {
  aspectId: string;
  requirement: "mandatory" | "optional";
  /** Primary subject label for diagnostics and planner-facing compatibility. */
  subject: string;
  subjectTerms: string[];
  subjects: EvidenceAspectSubject[];
  operation: string | null;
  answerObject: EvidenceAspectAnswerObject;
  relationship: EvidenceAspectRelationship | null;
  breadth: EvidenceAspectBreadth;
  requiredFacets: EvidenceSupportFacet[];
  authorityRequirement: EvidenceAspectAuthorityRequirement;
  minimumSupportStrength: "direct";
  supportType: Exclude<EvidenceSupportType, "contextual">;
  canonicalIdentifier: {
    type: "cmdlet" | "policy" | "entity";
    value: string;
  } | null;
  derivation: EvidenceAspectDerivation;
}

export interface EvidenceAspectSupport {
  aspectId: string;
  candidateId: string;
  strength: EvidenceAspectSupportStrength;
  matchedFacets: EvidenceSupportFacet[];
  missingFacets: EvidenceSupportFacet[];
  authoritySatisfied: boolean;
  canonicalIdentityVerified: boolean;
  topical: boolean;
  reasonCodes: string[];
  qualityScore: number;
}

export interface EvidenceAspectCoverage {
  aspects: EvidenceAspect[];
  evidenceByAspect: Record<string, string[]>;
  supportByAspect: Record<string, EvidenceAspectSupport[]>;
  supportedMandatoryAspectIds: string[];
  unsupportedMandatoryAspectIds: string[];
  authorityLimitedAspectIds: string[];
  supportingOnlyAspectIds: string[];
  contextualOnlyAspectIds: string[];
  supportedOptionalAspectIds: string[];
}

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
  decisionSnapshot: GroundingDecisionSnapshot;
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
  aspectCoverage: EvidenceAspectCoverage;
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
  | "purpose"
  | "mechanism"
  | "behavior"
  | "relationship"
  | "identifier_operation"
  | "procedure_step"
  | "configuration"
  | "concept_definition"
  | "configuration_behavior"
  | "procedure"
  | "prerequisite"
  | "cmdlet_semantics"
  | "parameter_semantics"
  | "troubleshooting_guidance"
  | "licensing_or_status"
  | "comparison_dimension";

export type AnswerPlanSchemaVersion = "atomic-source-bound-answer-plan/v1";
export type AnswerPlannerPolicyVersion =
  "minimal-atomic-source-bound-planner/r3";

export interface ClaimSourceSpan {
  spanId: string;
  evidenceId: string;
  chunkId: string;
  documentId: string;
  sourceId: string;
  sourcePath: string;
  sectionId: string;
  headingPath: string[];
  sourceField: "text" | "title" | "heading";
  fieldIndex: number | null;
  sentenceIndex: number | null;
  startOffset: number;
  endOffset: number;
  text: string;
  contentHash: string;
  authorityRole: SourceAuthorityRole;
  sourceOrder: number;
}

export interface PlannedClaim {
  claimId: string;
  groundingSnapshotId: string;
  groundingSnapshotHash: string;
  requiredAspectId: string;
  coveredFacets: EvidenceSupportFacet[];
  claimType: PlannedClaimType;
  sectionId: AnswerPlanSectionId;
  proposition: string;
  evidenceIds: string[];
  sourceSpans: ClaimSourceSpan[];
  supportStrength: "direct" | "supporting";
  status: "mandatory" | "supporting";
  mandatory: boolean;
  requiresCaveat: boolean;
  caveatCodes: RequiredCaveat["code"][];
  unsupportedAspectIds: string[];
  ordering: {
    sequence: number;
    procedureStep: number | null;
    sourceOrder: number;
    spanOrder: number;
  };
  authorityContext: {
    sourceIds: string[];
    routePriorities: Array<"primary" | "supporting">;
    authorityRoles: SourceAuthorityRole[];
  };
}

export interface UnsupportedAspect {
  aspectId: string;
  reason:
    | "missing_authority"
    | "insufficient_evidence"
    | "exact_identifier_unverified"
    | "freshness_verification_required"
    | "conflict_unresolved"
    | "source_span_unavailable";
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
  planIdentity: {
    planId: string;
    planHash: string;
    schemaVersion: AnswerPlanSchemaVersion;
    plannerPolicyVersion: AnswerPlannerPolicyVersion;
  };
  snapshotBinding: GroundingDecisionSnapshotBinding;
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
    facetCoverage: Array<{
      aspectId: string;
      requiredFacets: EvidenceSupportFacet[];
      plannedFacets: EvidenceSupportFacet[];
      missingFacets: EvidenceSupportFacet[];
    }>;
    evidenceWithoutIndependentClaims: string[];
    canonicalUrlCoverage: {
      complete: boolean;
      missingEvidenceIds: string[];
      note: string;
    };
  };
}

export interface AnswerPlanIntegrityIssue {
  code:
    | "plan_hash_mismatch"
    | "plan_id_mismatch"
    | "plan_snapshot_binding_mismatch"
    | "claim_unknown_aspect"
    | "claim_unsupported_aspect"
    | "claim_evidence_mismatch"
    | "claim_span_out_of_bounds"
    | "claim_span_text_mismatch"
    | "claim_span_hash_mismatch"
    | "claim_authority_role_mismatch"
    | "required_facet_unplanned";
  message: string;
  claimId?: string;
  aspectId?: string;
  spanId?: string;
}

export interface AnswerPlanIntegrityValidation {
  valid: boolean;
  issues: AnswerPlanIntegrityIssue[];
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

export type GroundingSnapshotSchemaVersion = "grounding-decision-snapshot/v1";
export type GroundingResolverPolicyVersion =
  "proposition-aware-evidence-policy/r2.2";

export interface GroundingDecisionSnapshotBinding {
  snapshotId: string;
  snapshotHash: string;
  schemaVersion: GroundingSnapshotSchemaVersion;
  resolverPolicyVersion: GroundingResolverPolicyVersion;
  corpusRevisionHash: string;
}

export interface GroundingDecisionSnapshot extends GroundingDecisionSnapshotBinding {
  createdAt: string;
  questionHash: string;
  intentHash: string;
  scopeHash: string;
  evidenceSetHash: string;
  sourceRevisionCount: number;
}

export interface GroundingDecisionBoundaryIssue {
  code:
    | "bundle_snapshot_hash_mismatch"
    | "bundle_snapshot_id_mismatch"
    | "plan_snapshot_id_mismatch"
    | "plan_snapshot_hash_mismatch"
    | "snapshot_schema_version_mismatch"
    | "resolver_policy_version_mismatch"
    | "corpus_revision_mismatch";
  message: string;
}

export interface GroundingDecisionBoundaryValidation {
  valid: boolean;
  issues: GroundingDecisionBoundaryIssue[];
}

export interface GroundedAnswerDiagnostics {
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
}

export type ExtractiveAssemblerPolicyVersion =
  "deterministic-extractive-assembler/r4";

export interface ExtractiveRenderedClaim {
  claimId: string;
  requiredAspectId: string;
  sectionId: AnswerPlanSectionId;
  status: PlannedClaim["status"];
  renderedText: string;
  transformation:
    | "none"
    | "whitespace_normalized"
    | "source_artifact_removed";
  evidenceIds: string[];
  sourceSpans: ClaimSourceSpan[];
  answerTextRange: {
    startOffset: number;
    endOffset: number;
  };
}

export interface ExtractivePolicyUnit {
  kind: "caveat" | "unsupported_aspect" | "limitation";
  code: string;
  text: string;
  answerTextRange: {
    startOffset: number;
    endOffset: number;
  };
}

export interface ExtractiveAssemblyIssue {
  code:
    | "plan_integrity_failed"
    | "invalid_claim_order"
    | "invalid_procedure_order"
    | "missing_mandatory_claim"
    | "unsupported_claim"
    | "empty_rendered_claim"
    | "rendered_claim_not_source_bound"
    | "insufficient_contains_claims";
  message: string;
  claimId?: string;
}

export interface ExtractiveAssemblyProvenance {
  assemblerPolicyVersion: ExtractiveAssemblerPolicyVersion;
  planId: string;
  planHash: string;
  renderedClaims: ExtractiveRenderedClaim[];
  omittedClaimIds: string[];
  policyUnits: ExtractivePolicyUnit[];
  validation: {
    valid: boolean;
    issues: ExtractiveAssemblyIssue[];
  };
  factualTextAudit: {
    factualUnitCount: number;
    allFactualUnitsAttributed: boolean;
    unattributedText: string[];
  };
}

export interface GroundedAnswer {
  snapshotBinding: GroundingDecisionSnapshotBinding;
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
  diagnostics: GroundedAnswerDiagnostics;
  /** Present only for deterministic R4 assembly. */
  extractiveAssembly?: ExtractiveAssemblyProvenance;
}

export interface GroundedAnswerSuccess {
  ok: true;
  answer: GroundedAnswer;
}

export interface GroundedAnswerFailure {
  ok: false;
  failure: {
    code:
      | "decision_snapshot_mismatch"
      | "grounding_validation_failed"
      | "answer_plan_integrity_failed"
      | "assembly_validation_failed";
    message: string;
    snapshotIssues: GroundingDecisionBoundaryIssue[];
    groundingIssues: GroundingValidationIssue[];
    failedClaimIds: string[];
    diagnostics?: GroundedAnswerDiagnostics;
    planIntegrityIssues?: AnswerPlanIntegrityIssue[];
    assemblyIssues?: ExtractiveAssemblyIssue[];
  };
}

export type GroundedAnswerResult = GroundedAnswerSuccess | GroundedAnswerFailure;

export interface GenerateGroundedAnswerOptions {
  maxTokens?: number;
  temperature?: number;
  correction?: CorrectiveRetryInput;
  promptProfile?: "baseline" | "hardened";
  claimConcurrency?: number;
  includeOptionalClaims?: boolean;
  claimRetryLimit?: number;
}
