import { performance } from "node:perf_hooks";
import type {
  AnswerExecutionFailure,
  AnswerExecutionPort,
  AnswerExecutionRequest,
  AnswerExecutionResult,
  GroundedAnswerExecutionSuccess
} from "./answerExecutionPort";
import { persistEvidenceCard } from "../evidence/evidenceCardBuilder";
import type { EvidenceSearchClient, EvidenceSearchSuccess } from "../evidence/evidenceTypes";
import { MultiSearchEvidenceOrchestrator } from "../evidence/multiSearchEvidenceOrchestrator";
import type { InterviewAnswerSynthesisPort } from "../evidence/interviewAnswerSynthesisPort";
import { lookupApprovedPersonalStory } from "@shared/approvedPersonalStories";
import {
  buildPersonalResponseBlock,
  formatInterviewAnswerText,
  isPersonalResponseMode
} from "@shared/evidenceCard";
import { classifyQuestionIntent } from "@shared/questionIntent";

const EVIDENCE_UNAVAILABLE =
  "Microsoft evidence retrieval is unavailable.";

function emptyPersonalRetrieval(query: string): EvidenceSearchSuccess {
  return {
    ok: true,
    query,
    route: {
      confidence: "NONE",
      service: null,
      repo: null,
      reason: "personal_response"
    },
    results: [],
    timing: { total_ms: 0 },
    topK: 5,
    engine: "learn-rag-r0.4",
    corpusFingerprint: "",
    indexFingerprint: ""
  };
}

function failure(
  code: AnswerExecutionFailure["code"],
  message: string
): AnswerExecutionFailure {
  return {
    ok: false,
    code,
    stage: "evidence_retrieval",
    userSafeMessage: message
  };
}

export interface EvidenceLatencyEvent {
  event:
    | "retrieval_started"
    | "retrieval_completed"
    | "synthesis_started"
    | "synthesis_completed";
  timestampMs: number;
  conversationId: string;
  userMessageId: string;
  model?: string | null;
  reasoningEffort?: "medium";
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  status?: string;
  fallbackReason?: string | null;
}

export class EvidenceAnswerExecutionPort implements AnswerExecutionPort {
  private readonly orchestrator: MultiSearchEvidenceOrchestrator;

  constructor(
    search: EvidenceSearchClient,
    private readonly options: {
      synthesis?: InterviewAnswerSynthesisPort | null;
      onLatencyEvent?: (event: EvidenceLatencyEvent) => void;
    } = {}
  ) {
    this.orchestrator = new MultiSearchEvidenceOrchestrator(search);
  }

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    const started = performance.now();
    const intent = classifyQuestionIntent(request.question);
    const personal = isPersonalResponseMode(intent.responseMode)
      ? buildPersonalResponseBlock(lookupApprovedPersonalStory(request.question))
      : null;
    const liveTrace =
      request.presentationProfile === "live_assist_quick";
    if (liveTrace) {
      this.options.onLatencyEvent?.({
        event: "retrieval_started",
        timestampMs: Date.now(),
        conversationId: request.conversationId,
        userMessageId: request.userMessageId
      });
    }
    const retrieval = await this.orchestrator.execute({
      question: request.question,
      facets: request.retrievalQueries
    });
    if (liveTrace) {
      this.options.onLatencyEvent?.({
        event: "retrieval_completed",
        timestampMs: Date.now(),
        conversationId: request.conversationId,
        userMessageId: request.userMessageId,
        status: retrieval.ok ? "succeeded" : "failed"
      });
    }
    const retrievalMs = performance.now() - started;
    if (!retrieval.ok && !personal) {
      return failure(
        "evidence_retrieval_failed",
        retrieval.failure.message || EVIDENCE_UNAVAILABLE
      );
    }

    const searchSuccess = retrieval.ok
      ? retrieval.result
      : emptyPersonalRetrieval(request.question);
    let interviewAnswer: Awaited<
      ReturnType<InterviewAnswerSynthesisPort["synthesize"]>
    > | null = null;
    let synthesisMs = 0;
    let synthesisRequests: 0 | 1 = 0;
    let synthesisStatus:
      GroundedAnswerExecutionSuccess["diagnostics"]["presentationSynthesisStatus"] =
      "bypassed_by_policy";
    let synthesisFallbackReason: string | null = null;
    let synthesisModel: string | null = null;
    if (
      request.presentationProfile === "live_assist_quick" &&
      retrieval.ok &&
      !personal &&
      retrieval.evidence.length > 0
    ) {
      const readiness = this.options.synthesis?.getReadiness?.();
      synthesisModel = readiness?.model ?? null;
      if (
        !this.options.synthesis ||
        (readiness && readiness.state !== "ready")
      ) {
        synthesisStatus = "not_configured";
        synthesisFallbackReason =
          readiness?.reason ?? "interview_synthesis_not_configured";
      } else {
        const synthesisStarted = performance.now();
        synthesisRequests = 1;
        this.options.onLatencyEvent?.({
          event: "synthesis_started",
          timestampMs: Date.now(),
          conversationId: request.conversationId,
          userMessageId: request.userMessageId,
          model: synthesisModel,
          reasoningEffort: "medium"
        });
        try {
          interviewAnswer = await this.options.synthesis.synthesize({
            originalQuestion:
              request.originalQuestion ?? request.question,
            normalizedQuestion: request.question,
            facets: retrieval.facets,
            facetCoverage: retrieval.facetCoverage,
            evidence: retrieval.evidence
          });
          synthesisStatus = "succeeded";
          synthesisModel =
            interviewAnswer.diagnostics.configuredModel;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown";
          synthesisStatus = message.startsWith(
            "interview_synthesis_"
          )
            ? "validation_failed"
            : "provider_failed";
          synthesisFallbackReason = message;
        }
        synthesisMs = performance.now() - synthesisStarted;
        this.options.onLatencyEvent?.({
          event: "synthesis_completed",
          timestampMs: Date.now(),
          conversationId: request.conversationId,
          userMessageId: request.userMessageId,
          model: synthesisModel,
          reasoningEffort: "medium",
          inputTokens:
            interviewAnswer?.diagnostics.inputTokens ?? null,
          outputTokens:
            interviewAnswer?.diagnostics.outputTokens ?? null,
          totalTokens:
            interviewAnswer?.diagnostics.totalTokens ?? null,
          status: synthesisStatus,
          fallbackReason: synthesisFallbackReason
        });
      }
    } else if (
      request.presentationProfile === "live_assist_quick" &&
      retrieval.ok &&
      !personal &&
      retrieval.evidence.length === 0
    ) {
      synthesisStatus = "bypassed_insufficient_evidence";
      synthesisFallbackReason = "interview_synthesis_insufficient_evidence";
    }
    const liveFallback =
      request.presentationProfile === "live_assist_quick" &&
      !personal &&
      !interviewAnswer
        ? {
            message: "Answer synthesis unavailable." as const,
            status:
              retrieval.ok && retrieval.evidence.length > 0
                ? "Authoritative evidence available — expand sources." as const
                : null
          }
        : null;
    const persisted = persistEvidenceCard(searchSuccess, {
      responseMode: intent.responseMode,
      personal,
      interviewAnswer,
      liveFallback,
      synthesis: {
        attempted: synthesisRequests === 1,
        status: synthesisStatus,
        model: synthesisModel,
        fallbackReason: synthesisFallbackReason
      }
    });
    const hasEvidence = persisted.payload.primary !== null;
    const hasSynthesizedAnswer = Boolean(
      interviewAnswer?.directAnswer ||
      interviewAnswer?.bullets.length
    );
    const answerability =
      interviewAnswer && !hasSynthesizedAnswer
        ? "insufficient_evidence"
        : interviewAnswer?.unsupportedFacets.length
          ? "partial"
          : personal || hasEvidence
            ? "answered"
            : "insufficient_evidence";
    const diagnostics = {
      retrievalMs,
      evidenceResolutionMs: searchSuccess.timing.total_ms ?? retrievalMs,
      planningMs: 0,
      assemblyMs: 0,
      citationMappingMs: 0,
      contextBuildMs: 0,
      presentationPlanningMs: 0,
      presentationRenderMs: 0,
      synthesisMs,
      pipelineTotalMs: performance.now() - started,
      factualGroundingGenerationRequests: 0 as const,
      presentationSynthesisRequests: synthesisRequests,
      presentationSynthesisStatus: synthesisStatus,
      presentationSynthesisFallbackReason: synthesisFallbackReason,
      interviewSynthesis: interviewAnswer?.diagnostics
    };

    return {
      ok: true,
      answerability,
      answerText: persisted.content,
      factualAnswerText: interviewAnswer
        ? formatInterviewAnswerText(interviewAnswer)
        : personal
        ? persisted.payload.personal?.storyText ??
          persisted.payload.personal?.prompt ??
          persisted.content
        : persisted.payload.primary?.preview ?? persisted.content,
      presentationProfile: request.presentationProfile ?? "helpdesk_detailed",
      helpdeskDetailedText: persisted.content,
      liveAssistQuickText: persisted.content,
      snapshot: persisted.snapshot,
      citations: persisted.citations,
      contextReferences: persisted.contextReferences,
      retrievalSummary: {
        eligibleDocumentCount: searchSuccess.results.length,
        eligibleChunkCount: searchSuccess.results.length,
        scoredChunkCount: searchSuccess.results.length,
        returnedCandidateCount: searchSuccess.results.length,
        topEvidence: searchSuccess.results.map((hit) => ({
          documentId: hit.parentId,
          title: hit.title,
          canonicalUrl: hit.url,
          headingPath: [hit.title, hit.section].filter(Boolean)
        }))
      },
      diagnostics
    };
  }
}
