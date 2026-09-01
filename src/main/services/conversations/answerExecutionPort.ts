import { performance } from "node:perf_hooks";
import {
  assembleDeterministicAnswer,
  attemptGroundedSynthesis,
  buildAnswerPlan,
  buildExplanationContext,
  buildGroundedSynthesisPayload,
  expandInterviewQuickClaims,
  mapAnswerCitations,
  presentGroundedAnswer,
  runQuestionToEvidenceBundle
} from "../answerV2";
import { deriveInterviewAnswerConcepts } from "../answerV2/interviewAnswerConcepts";
import {
  documentIdsForInterviewPacks
} from "../answerV2/interviewAuthorityPack";
import { routeInterviewPacks } from "../answerV2/interviewPackRouter";
import { classifyInterviewQuestionShape } from "../answerV2/interviewQuestionShape";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { resolveKnowledgeV2DatabasePath } from "../knowledgeV2";
import type {
  AnswerabilityStatus,
  GroundedSynthesisProvider
} from "../answerV2";
import type { AnswerPresentationProfile } from "../answerV2/answerPresentationTypes";
import type { ContextReference } from "../answerV2/explanationContextTypes";
import type { QuestionFacet } from "../questionUnderstandingPort";

export interface AnswerExecutionRequest {
  conversationId: string;
  userMessageId: string;
  /** Exact accepted STT thought shown in the durable user turn. */
  originalQuestion?: string;
  /** Normalized V2.1 question used for retrieval and synthesis. */
  question: string;
  presentationProfile?: AnswerPresentationProfile;
  /**
   * Disables only the post-grounding presentation synthesis call. Retrieval,
   * R2-R4, validation, and citation mapping remain unchanged.
   */
  presentationSynthesis?: "optional" | "disabled";
  /** Optional bounded validation scope; production routing leaves this unset. */
  eligibleDocumentIds?: string[];
  /** V2.1 live-only ordered semantic search plan. */
  retrievalQueries?: QuestionFacet[];
}

export interface AnswerExecutionCitation {
  citationId: string;
  factualRangeId: string;
  claimId?: string | null;
  answerRange: {
    startOffset: number;
    endOffset: number;
  };
  evidenceId: string;
  spanId: string;
  supportingSpanIds: string[];
  documentId: string;
  sourceTitle: string;
  canonicalUrl: string;
  sourceId: string;
  authorityRole: string;
  headingPath: string[];
  sectionId: string;
  sourceStatus: string;
  preview: boolean;
}

export interface GroundedAnswerExecutionSuccess {
  ok: true;
  answerability: AnswerabilityStatus;
  /** Profile-selected presented answer shown to the user. */
  answerText: string;
  /** Unchanged R4 extractive factual baseline. */
  factualAnswerText: string;
  presentationProfile: AnswerPresentationProfile;
  helpdeskDetailedText: string;
  liveAssistQuickText: string;
  snapshot: {
    snapshotId: string;
    snapshotHash: string;
    schemaVersion: string;
    resolverPolicyVersion: string;
    corpusRevisionHash: string;
    createdAt: string;
  };
  /** WB-21 factual citations (ranges relative to factualAnswerText). */
  citations: AnswerExecutionCitation[];
  /** Presentation-layer context source attribution (not R4 claims). */
  contextReferences: ContextReference[];
  retrievalSummary?: {
    eligibleDocumentCount: number | null;
    eligibleChunkCount: number;
    scoredChunkCount: number;
    returnedCandidateCount: number;
    topEvidence: Array<{
      documentId: string;
      title: string;
      canonicalUrl: string;
      headingPath: string[];
    }>;
  };
  interviewQuick?: {
    questionShape: string;
    selectedPacks: string[];
    packReasons: string[];
    derivedConcepts: string[];
  };
  diagnostics: {
    retrievalMs: number;
    evidenceResolutionMs: number;
    planningMs: number;
    assemblyMs: number;
    citationMappingMs: number;
    contextBuildMs: number;
    presentationPlanningMs: number;
    presentationRenderMs: number;
    synthesisMs: number;
    pipelineTotalMs: number;
    factualGroundingGenerationRequests: 0;
    presentationSynthesisRequests: 0 | 1;
    presentationSynthesisStatus:
      | "not_configured"
      | "bypassed_by_policy"
      | "bypassed_insufficient_evidence"
      | "succeeded"
      | "provider_failed"
      | "validation_failed";
    presentationSynthesisFallbackReason: string | null;
    interviewSynthesis?: {
      configuredModel: string;
      actualModel: string | null;
      reasoningEffort: "medium";
      latencyMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      estimatedCostUsd: number | null;
    };
  };
}

export interface AnswerExecutionFailure {
  ok: false;
  code:
    | "grounding_execution_failed"
    | "grounded_answer_validation_failed"
    | "citation_validation_failed"
    | "evidence_retrieval_failed";
  stage:
    | "retrieval_grounding"
    | "answer_planning"
    | "extractive_assembly"
    | "citation_mapping"
    | "evidence_retrieval";
  userSafeMessage: string;
}

export type AnswerExecutionResult =
  | GroundedAnswerExecutionSuccess
  | AnswerExecutionFailure;

export interface AnswerExecutionPort {
  execute(request: AnswerExecutionRequest): Promise<AnswerExecutionResult>;
}

/**
 * Retained only as a fail-closed test/dependency-injection adapter. Production
 * Helpdesk wiring uses GroundedAnswerExecutionPort.
 */
export class UnavailableAnswerExecutionPort implements AnswerExecutionPort {
  async execute(_request: AnswerExecutionRequest): Promise<AnswerExecutionFailure> {
    return {
      ok: false,
      code: "grounding_execution_failed",
      stage: "retrieval_grounding",
      userSafeMessage: "The grounded answer service is unavailable."
    };
  }
}

export interface GroundedAnswerExecutionPortOptions {
  databasePath?: string;
  synthesisProvider?: GroundedSynthesisProvider | null;
}

export class GroundedAnswerExecutionPort implements AnswerExecutionPort {
  constructor(
    private readonly options: GroundedAnswerExecutionPortOptions = {}
  ) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    const profile: AnswerPresentationProfile =
      request.presentationProfile ?? "helpdesk_detailed";
    const interviewQuick = profile === "live_assist_quick";
    const intentResult = extractQueryIntent(request.question);
    const questionShape = classifyInterviewQuestionShape(intentResult.intent);
    const packRoute = routeInterviewPacks(intentResult.intent, questionShape);
    const derivedConcepts = deriveInterviewAnswerConcepts({
      intent: intentResult.intent,
      shape: questionShape,
      packIds: packRoute.packIds
    });
    const databasePath =
      this.options.databasePath ?? resolveKnowledgeV2DatabasePath();
    let eligibleDocumentIds = request.eligibleDocumentIds;
    if (
      interviewQuick &&
      eligibleDocumentIds === undefined &&
      packRoute.packIds.length > 0
    ) {
      eligibleDocumentIds = documentIdsForInterviewPacks(
        packRoute.packIds,
        databasePath
      );
    }

    const pipelineStarted = performance.now();
    let groundingRun: Awaited<
      ReturnType<typeof runQuestionToEvidenceBundle>
    >;
    const groundingStarted = performance.now();
    try {
      groundingRun = await runQuestionToEvidenceBundle({
        question: request.question,
        databasePath,
        eligibleDocumentIds,
        multiConceptSelection: interviewQuick
      });
    } catch {
      return {
        ok: false,
        code: "grounding_execution_failed",
        stage: "retrieval_grounding",
        userSafeMessage:
          "Relay could not complete authoritative evidence retrieval."
      };
    }
    const groundingMs = performance.now() - groundingStarted;
    const evidenceResolutionMs =
      groundingRun.bundle.diagnostics.latencyMs.total;

    const planningStarted = performance.now();
    let plan: ReturnType<typeof buildAnswerPlan>;
    let originalPlan: ReturnType<typeof buildAnswerPlan>;
    try {
      originalPlan = buildAnswerPlan(groundingRun.bundle);
      plan = originalPlan;
      if (interviewQuick) {
        plan = expandInterviewQuickClaims({
          bundle: groundingRun.bundle,
          plan: originalPlan,
          concepts: derivedConcepts,
          shape: questionShape
        });
      }
    } catch {
      return {
        ok: false,
        code: "grounding_execution_failed",
        stage: "answer_planning",
        userSafeMessage:
          "Relay could not construct a source-bound answer plan."
      };
    }
    const planningMs = performance.now() - planningStarted;

    let assembled: ReturnType<
      typeof assembleDeterministicAnswer
    >;
    try {
      assembled = assembleDeterministicAnswer({
        bundle: groundingRun.bundle,
        plan
      });
      if (!assembled.ok && interviewQuick && plan !== originalPlan) {
        plan = originalPlan;
        assembled = assembleDeterministicAnswer({
          bundle: groundingRun.bundle,
          plan: originalPlan
        });
      }
    } catch {
      if (interviewQuick && plan !== originalPlan) {
        try {
          plan = originalPlan;
          assembled = assembleDeterministicAnswer({
            bundle: groundingRun.bundle,
            plan: originalPlan
          });
        } catch {
          return {
            ok: false,
            code: "grounded_answer_validation_failed",
            stage: "extractive_assembly",
            userSafeMessage:
              "Relay rejected the answer because its grounding integrity could not be verified."
          };
        }
      } else {
        return {
          ok: false,
          code: "grounded_answer_validation_failed",
          stage: "extractive_assembly",
          userSafeMessage:
            "Relay rejected the answer because its grounding integrity could not be verified."
        };
      }
    }
    if (!assembled.ok) {
      return {
        ok: false,
        code: "grounded_answer_validation_failed",
        stage: "extractive_assembly",
        userSafeMessage:
          "Relay rejected the answer because its grounding integrity could not be verified."
      };
    }

    let citationMapping: ReturnType<typeof mapAnswerCitations>;
    const mapCitations = (): ReturnType<typeof mapAnswerCitations> =>
      mapAnswerCitations({
        bundle: groundingRun.bundle,
        plan,
        answer: assembled.answer
      });
    try {
      citationMapping = mapCitations();
      if (
        !citationMapping.validation.valid &&
        interviewQuick &&
        plan !== originalPlan &&
        assembled.ok
      ) {
        plan = originalPlan;
        assembled = assembleDeterministicAnswer({
          bundle: groundingRun.bundle,
          plan: originalPlan
        });
        if (!assembled.ok) {
          return {
            ok: false,
            code: "grounded_answer_validation_failed",
            stage: "extractive_assembly",
            userSafeMessage:
              "Relay rejected the answer because its grounding integrity could not be verified."
          };
        }
        citationMapping = mapCitations();
      }
    } catch {
      if (interviewQuick && plan !== originalPlan) {
        plan = originalPlan;
        assembled = assembleDeterministicAnswer({
          bundle: groundingRun.bundle,
          plan: originalPlan
        });
        if (!assembled.ok) {
          return {
            ok: false,
            code: "grounded_answer_validation_failed",
            stage: "extractive_assembly",
            userSafeMessage:
              "Relay rejected the answer because its grounding integrity could not be verified."
          };
        }
        try {
          citationMapping = mapCitations();
        } catch {
          return {
            ok: false,
            code: "citation_validation_failed",
            stage: "citation_mapping",
            userSafeMessage:
              "Relay rejected the answer because its source citations could not be validated."
          };
        }
      } else {
        return {
          ok: false,
          code: "citation_validation_failed",
          stage: "citation_mapping",
          userSafeMessage:
            "Relay rejected the answer because its source citations could not be validated."
        };
      }
    }
    if (!citationMapping.validation.valid) {
      return {
        ok: false,
        code: "citation_validation_failed",
        stage: "citation_mapping",
        userSafeMessage:
          "Relay rejected the answer because its source citations could not be validated."
      };
    }

    const provenance = assembled.answer.extractiveAssembly;
    if (!provenance) {
      return {
        ok: false,
        code: "grounded_answer_validation_failed",
        stage: "extractive_assembly",
        userSafeMessage:
          "Relay rejected the answer because extractive provenance was missing."
      };
    }

    const contextStarted = performance.now();
    const explanation = buildExplanationContext({
      bundle: groundingRun.bundle,
      plan
    });
    const contextBuildMs = performance.now() - contextStarted;
    const presented = presentGroundedAnswer({
      plan,
      answer: assembled.answer,
      provenance,
      contextBlocks: explanation.blocks
    });

    const deterministicPresentedAnswer =
      profile === "live_assist_quick"
        ? presented.liveAssistQuick
        : presented.helpdeskDetailed;
    let visibleAnswerText = deterministicPresentedAnswer.answerText;
    let visibleProofFactRanges =
      deterministicPresentedAnswer.proofFactRanges;
    let synthesisMs = 0;
    let presentationSynthesisRequests: 0 | 1 = 0;
    let presentationSynthesisStatus:
      GroundedAnswerExecutionSuccess["diagnostics"]["presentationSynthesisStatus"] =
      "not_configured";
    let presentationSynthesisFallbackReason: string | null = null;
    let synthesisAccepted = false;
    const synthesisPayload =
      request.presentationSynthesis === "disabled"
        ? null
        : buildGroundedSynthesisPayload({
            question: request.question,
            profile,
            bundle: groundingRun.bundle,
            plan,
            answer: assembled.answer,
            provenance,
            citationMapping,
            selectedClaimIds: provenance.renderedClaims.map(
              (claim) => claim.claimId
            ),
            selectedCaveats:
              deterministicPresentedAnswer.plan.selectedCaveats,
            selectedUnsupportedGaps:
              deterministicPresentedAnswer.plan.unsupportedGaps
          });
    if (request.presentationSynthesis === "disabled") {
      presentationSynthesisStatus = "bypassed_by_policy";
      presentationSynthesisFallbackReason =
        "presentation_synthesis_disabled";
    } else {
      const synthesisStarted = performance.now();
      const synthesisAttempt = await attemptGroundedSynthesis({
        provider: this.options.synthesisProvider,
        payload: synthesisPayload
      });
      synthesisMs = performance.now() - synthesisStarted;
      presentationSynthesisRequests = synthesisAttempt.requestCount;
      presentationSynthesisStatus = synthesisAttempt.status;
      presentationSynthesisFallbackReason =
        synthesisAttempt.fallbackReason;
      if (synthesisAttempt.rendered) {
        visibleAnswerText = synthesisAttempt.rendered.answerText;
        visibleProofFactRanges =
          synthesisAttempt.rendered.proofFactRanges;
        synthesisAccepted = true;
      } else if (
        profile === "helpdesk_detailed" &&
        synthesisPayload?.executableWorkflow
      ) {
        visibleAnswerText = `${visibleAnswerText.trim()}\n\nRunnable PowerShell\n\`\`\`powershell\n${synthesisPayload.executableWorkflow.script}\n\`\`\``;
      }
    }
    const presentedRangeByClaimId = new Map(
      visibleProofFactRanges.map((range) => [
        range.claimId,
        range
      ])
    );

    let citations: AnswerExecutionCitation[];
    try {
      citations = citationMapping.citations
        .filter(
          (citation) =>
            citation.validation.state === "valid" &&
            citation.canonicalUrl !== null &&
            presentedRangeByClaimId.has(citation.claimId)
        )
        .map((citation) => {
          const presentedRange = presentedRangeByClaimId.get(
            citation.claimId
          )!;
          const factualText = citationMapping.answerText.slice(
            citation.answerRange.startOffset,
            citation.answerRange.endOffset
          );
          const presentedText = visibleAnswerText.slice(
            presentedRange.startOffset,
            presentedRange.endOffset
          );
          if (
            !synthesisAccepted &&
            factualText !== presentedText
          ) {
            throw new Error(
              `Presented proof range diverged from WB-21 factual range for ${citation.claimId}`
            );
          }
          if (!presentedText.trim()) {
            throw new Error(
              `Presented proof range is empty for ${citation.claimId}`
            );
          }
          return {
            citationId: citation.citationId,
            factualRangeId: citation.factualRangeId,
            claimId: citation.claimId,
            answerRange: {
              startOffset: presentedRange.startOffset,
              endOffset: presentedRange.endOffset
            },
            evidenceId: citation.evidenceId,
            spanId: citation.spanId,
            supportingSpanIds: [...citation.supportingSpanIds],
            documentId: citation.documentId,
            sourceTitle: citation.sourceTitle,
            canonicalUrl: citation.canonicalUrl!,
            sourceId: citation.sourceId,
            authorityRole: citation.authorityRole,
            headingPath: [...citation.headingPath],
            sectionId: citation.sectionId,
            sourceStatus: citation.sourceStatus,
            preview:
              citation.sourceStatus.toLowerCase() === "preview" ||
              citationMapping.previewState.previewEvidenceUsed
          };
        });
    } catch {
      return {
        ok: false,
        code: "citation_validation_failed",
        stage: "citation_mapping",
        userSafeMessage:
          "Relay rejected the answer because its presented citation coordinates could not be validated."
      };
    }
    const snapshot = groundingRun.bundle.decisionSnapshot;
    return {
      ok: true,
      answerability: assembled.answer.answerability,
      answerText: visibleAnswerText || assembled.answer.answerText,
      factualAnswerText: assembled.answer.answerText,
      presentationProfile: profile,
      helpdeskDetailedText:
        profile === "helpdesk_detailed" && synthesisAccepted
          ? visibleAnswerText
          : presented.helpdeskDetailed.answerText,
      liveAssistQuickText:
        profile === "live_assist_quick" && synthesisAccepted
          ? visibleAnswerText
          : presented.liveAssistQuick.answerText,
      snapshot: {
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.snapshotHash,
        schemaVersion: snapshot.schemaVersion,
        resolverPolicyVersion: snapshot.resolverPolicyVersion,
        corpusRevisionHash: snapshot.corpusRevisionHash,
        createdAt: snapshot.createdAt
      },
      citations,
      contextReferences:
        deterministicPresentedAnswer.contextReferences,
      retrievalSummary: {
        eligibleDocumentCount: eligibleDocumentIds?.length ?? null,
        eligibleChunkCount:
          groundingRun.retrievalPopulation.eligibleChunks,
        scoredChunkCount:
          groundingRun.retrievalPopulation.scoredChunks,
        returnedCandidateCount:
          groundingRun.retrievalPopulation.returnedCandidates,
        topEvidence: groundingRun.bundle.evidence.slice(0, 5).map(
          (item) => ({
            documentId: item.documentId,
            title: item.source.title,
            canonicalUrl: item.source.canonicalUrl,
            headingPath: [...item.location.headingPath]
          })
        )
      },
      interviewQuick: interviewQuick
        ? {
            questionShape,
            selectedPacks: packRoute.packIds,
            packReasons: packRoute.reasons,
            derivedConcepts
          }
        : undefined,
      diagnostics: {
        retrievalMs: Math.max(0, groundingMs - evidenceResolutionMs),
        evidenceResolutionMs,
        planningMs,
        assemblyMs: assembled.answer.diagnostics.totalLatencyMs,
        citationMappingMs:
          citationMapping.diagnostics.latencyMs,
        contextBuildMs:
          contextBuildMs + explanation.diagnostics.latencyMs,
        presentationPlanningMs: presented.planningLatencyMs,
        presentationRenderMs: presented.renderingLatencyMs,
        synthesisMs,
        pipelineTotalMs: performance.now() - pipelineStarted,
        factualGroundingGenerationRequests: 0,
        presentationSynthesisRequests,
        presentationSynthesisStatus,
        presentationSynthesisFallbackReason
      }
    };
  }
}
