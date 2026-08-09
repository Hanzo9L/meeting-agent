import { performance } from "node:perf_hooks";
import {
  assembleDeterministicAnswer,
  buildAnswerPlan,
  mapAnswerCitations,
  runQuestionToEvidenceBundle
} from "../answerV2";
import type {
  AnswerabilityStatus,
  GroundingDecisionSnapshot
} from "../answerV2";

export interface AnswerExecutionRequest {
  conversationId: string;
  userMessageId: string;
  question: string;
}

export interface AnswerExecutionCitation {
  citationId: string;
  factualRangeId: string;
  answerRange: {
    startOffset: number;
    endOffset: number;
  };
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
  answerText: string;
  snapshot: Pick<
    GroundingDecisionSnapshot,
    | "snapshotId"
    | "snapshotHash"
    | "schemaVersion"
    | "resolverPolicyVersion"
    | "corpusRevisionHash"
    | "createdAt"
  >;
  citations: AnswerExecutionCitation[];
  diagnostics: {
    retrievalMs: number;
    evidenceResolutionMs: number;
    planningMs: number;
    assemblyMs: number;
    citationMappingMs: number;
    pipelineTotalMs: number;
    answerGenerationRequestCount: 0;
  };
}

export interface AnswerExecutionFailure {
  ok: false;
  code:
    | "grounding_execution_failed"
    | "grounded_answer_validation_failed"
    | "citation_validation_failed";
  stage:
    | "retrieval_grounding"
    | "answer_planning"
    | "extractive_assembly"
    | "citation_mapping";
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
}

export class GroundedAnswerExecutionPort implements AnswerExecutionPort {
  constructor(
    private readonly options: GroundedAnswerExecutionPortOptions = {}
  ) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    const pipelineStarted = performance.now();
    let groundingRun: Awaited<
      ReturnType<typeof runQuestionToEvidenceBundle>
    >;
    const groundingStarted = performance.now();
    try {
      groundingRun = await runQuestionToEvidenceBundle({
        question: request.question,
        databasePath: this.options.databasePath
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
    try {
      plan = buildAnswerPlan(groundingRun.bundle);
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
    } catch {
      return {
        ok: false,
        code: "grounded_answer_validation_failed",
        stage: "extractive_assembly",
        userSafeMessage:
          "Relay rejected the answer because its grounding integrity could not be verified."
      };
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
    try {
      citationMapping = mapAnswerCitations({
        bundle: groundingRun.bundle,
        plan,
        answer: assembled.answer
      });
    } catch {
      return {
        ok: false,
        code: "citation_validation_failed",
        stage: "citation_mapping",
        userSafeMessage:
          "Relay rejected the answer because its source citations could not be validated."
      };
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

    const citations: AnswerExecutionCitation[] =
      citationMapping.citations
        .filter(
          (citation) =>
            citation.validation.state === "valid" &&
            citation.canonicalUrl !== null
        )
        .map((citation) => ({
          citationId: citation.citationId,
          factualRangeId: citation.factualRangeId,
          answerRange: { ...citation.answerRange },
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
        }));
    const snapshot = groundingRun.bundle.decisionSnapshot;
    return {
      ok: true,
      answerability: assembled.answer.answerability,
      answerText: assembled.answer.answerText,
      snapshot: {
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.snapshotHash,
        schemaVersion: snapshot.schemaVersion,
        resolverPolicyVersion: snapshot.resolverPolicyVersion,
        corpusRevisionHash: snapshot.corpusRevisionHash,
        createdAt: snapshot.createdAt
      },
      citations,
      diagnostics: {
        retrievalMs: Math.max(0, groundingMs - evidenceResolutionMs),
        evidenceResolutionMs,
        planningMs,
        assemblyMs: assembled.answer.diagnostics.totalLatencyMs,
        citationMappingMs:
          citationMapping.diagnostics.latencyMs,
        pipelineTotalMs: performance.now() - pipelineStarted,
        answerGenerationRequestCount: 0
      }
    };
  }
}
