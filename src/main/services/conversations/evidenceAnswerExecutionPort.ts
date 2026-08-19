import { performance } from "node:perf_hooks";
import type {
  AnswerExecutionFailure,
  AnswerExecutionPort,
  AnswerExecutionRequest,
  AnswerExecutionResult
} from "./answerExecutionPort";
import { persistEvidenceCard } from "../evidence/evidenceCardBuilder";
import type { EvidenceSearchClient } from "../evidence/evidenceTypes";

const EVIDENCE_UNAVAILABLE =
  "Microsoft evidence retrieval is unavailable.";

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
    const retrieved = await this.search.search(request.question);
    const retrievalMs = performance.now() - started;
    if (!retrieved.ok) {
      return failure("evidence_retrieval_failed", retrieved.message || EVIDENCE_UNAVAILABLE);
    }

    const persisted = persistEvidenceCard(retrieved);
    const hasEvidence = persisted.payload.primary !== null;
    const diagnostics = {
      retrievalMs,
      evidenceResolutionMs: retrieved.timing.total_ms ?? retrievalMs,
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
      answerability: hasEvidence ? "answered" : "insufficient_evidence",
      answerText: persisted.content,
      factualAnswerText: persisted.payload.primary?.preview ?? persisted.content,
      presentationProfile: request.presentationProfile ?? "helpdesk_detailed",
      helpdeskDetailedText: persisted.content,
      liveAssistQuickText: persisted.content,
      snapshot: persisted.snapshot,
      citations: persisted.citations,
      contextReferences: persisted.contextReferences,
      retrievalSummary: {
        eligibleDocumentCount: retrieved.results.length,
        eligibleChunkCount: retrieved.results.length,
        scoredChunkCount: retrieved.results.length,
        returnedCandidateCount: retrieved.results.length,
        topEvidence: retrieved.results.map((hit) => ({
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
