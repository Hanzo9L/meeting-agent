import type {
  BoundEvidence,
  FacetCoverage
} from "./multiSearchEvidenceOrchestrator";
import type { QuestionFacet } from "../questionUnderstandingPort";
import type { V2ReadinessStatus } from "@shared/types";

export interface SynthesizedAnswerBinding {
  text: string;
  evidenceIds: string[];
}

export interface SynthesizedAnswerBullet
extends SynthesizedAnswerBinding {
  facetId: string;
}

export interface UnsupportedAnswerFacet {
  facetId: string;
  reason: string;
}

export interface InterviewSynthesisDiagnostics {
  configuredModel: string;
  actualModel: string | null;
  reasoningEffort: "medium";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface SynthesizedInterviewAnswer {
  directAnswer: SynthesizedAnswerBinding | null;
  bullets: SynthesizedAnswerBullet[];
  unsupportedFacets: UnsupportedAnswerFacet[];
  confidence: "high" | "medium" | "low";
  diagnostics: InterviewSynthesisDiagnostics;
}

export interface InterviewAnswerSynthesisInput {
  originalQuestion: string;
  normalizedQuestion: string;
  facets: QuestionFacet[];
  facetCoverage: FacetCoverage[];
  evidence: BoundEvidence[];
}

export interface InterviewAnswerSynthesisPort {
  getReadiness?(): V2ReadinessStatus;
  synthesize(
    input: InterviewAnswerSynthesisInput
  ): Promise<SynthesizedInterviewAnswer>;
}
