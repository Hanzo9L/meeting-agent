import type { QueryAnswerType } from "../retrievalV2/queryIntent";
import type { AnswerabilityStatus } from "./types";
import type {
  ContextReference,
  ExplanationContextBlock,
  ExplanationContextType
} from "./explanationContextTypes";

export type AnswerPresentationProfile =
  | "helpdesk_detailed"
  | "live_assist_quick";

export type PresentationSectionId =
  | "summary"
  | "prerequisites"
  | "what_to_do"
  | "commands"
  | "what_to_verify"
  | "caveats"
  | "sources"
  | "unsupported_gaps";

export interface PresentationProofFactRef {
  claimId: string;
  renderedText: string;
  mandatory: boolean;
  sectionId: string;
}

export interface PresentationCaveatRef {
  code: string;
  text: string;
  mandatory: boolean;
}

export interface PresentationUnsupportedGap {
  aspectId: string;
  detail: string;
}

export interface PresentationSection {
  sectionId: PresentationSectionId;
  title: string;
  proofFactClaimIds: string[];
  contextBlockIds: string[];
  caveatCodes: string[];
  unsupportedAspectIds: string[];
}

export interface AnswerPresentationPlan {
  profile: AnswerPresentationProfile;
  answerability: AnswerabilityStatus;
  answerType: QueryAnswerType;
  sections: PresentationSection[];
  selectedProofFacts: PresentationProofFactRef[];
  selectedContextBlockIds: string[];
  selectedCaveats: PresentationCaveatRef[];
  unsupportedGaps: PresentationUnsupportedGap[];
  sourceContextBlockIds: string[];
}

export interface PresentedAnswer {
  profile: AnswerPresentationProfile;
  answerText: string;
  plan: AnswerPresentationPlan;
  contextBlocksUsed: ExplanationContextBlock[];
  contextReferences: ContextReference[];
  diagnostics: {
    latencyMs: number;
    sectionCount: number;
    proofFactCount: number;
    contextBlockCount: number;
    providerRequestCount: 0;
  };
}

export interface DualPresentedAnswers {
  helpdeskDetailed: PresentedAnswer;
  liveAssistQuick: PresentedAnswer;
  planningLatencyMs: number;
  renderingLatencyMs: number;
}

export const CONTEXT_TYPE_SECTION: Partial<
  Record<ExplanationContextType, PresentationSectionId>
> = {
  prerequisite: "prerequisites",
  procedure: "what_to_do",
  command: "commands",
  cmdlet_reference: "commands",
  parameter_reference: "commands",
  verification: "what_to_verify",
  example: "what_to_do",
  definition: "summary",
  conceptual_explanation: "summary",
  supporting_context: "summary"
};
