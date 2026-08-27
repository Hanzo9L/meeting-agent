import { performance } from "node:perf_hooks";
import type {
  AnswerExecutionFailure,
  AnswerExecutionPort,
  AnswerExecutionRequest,
  AnswerExecutionResult
} from "./answerExecutionPort";
import { persistEvidenceCard } from "../evidence/evidenceCardBuilder";
import type {
  EvidenceSearchClient,
  EvidenceSearchSuccess
} from "../evidence/evidenceTypes";
import { lookupApprovedPersonalStory } from "@shared/approvedPersonalStories";
import {
  buildPersonalResponseBlock,
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

export class EvidenceAnswerExecutionPort implements AnswerExecutionPort {
  constructor(private readonly search: EvidenceSearchClient) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    const started = performance.now();
    const intent = classifyQuestionIntent(request.question);
    const personal = isPersonalResponseMode(intent.responseMode)
      ? buildPersonalResponseBlock(lookupApprovedPersonalStory(request.question))
      : null;
    const retrieved = await this.search.search(request.question);
    const retrievalMs = performance.now() - started;
    if (!retrieved.ok && !personal) {
      return failure("evidence_retrieval_failed", retrieved.message || EVIDENCE_UNAVAILABLE);
    }

    const searchSuccess = retrieved.ok
      ? retrieved
      : emptyPersonalRetrieval(request.question);
    const persisted = persistEvidenceCard(searchSuccess, {
      responseMode: intent.responseMode,
      personal
    });
    const hasEvidence = persisted.payload.primary !== null;
    const answerability =
      personal || hasEvidence ? "answered" : "insufficient_evidence";
    const diagnostics = {
      retrievalMs,
      evidenceResolutionMs: searchSuccess.timing.total_ms ?? retrievalMs,
      planningMs: 0,
      assemblyMs: 0,
      citationMappingMs: 0,
      contextBuildMs: 0,
      presentationPlanningMs: 0,
      presentationRenderMs: 0,
      synthesisMs: 0,
      pipelineTotalMs: performance.now() - started,
      factualGroundingGenerationRequests: 0 as const,
      presentationSynthesisRequests: 0 as const,
      presentationSynthesisStatus: "bypassed_by_policy" as const,
      presentationSynthesisFallbackReason: null
    };

    return {
      ok: true,
      answerability,
      answerText: persisted.content,
      factualAnswerText: personal
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
