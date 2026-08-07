import type { SourceAuthorityRole, SourceStatus } from "../knowledgeV2";

export type CandidateRetrievalMethod = "exact" | "lexical" | "semantic";

export interface CandidateAuthorityContext {
  sourceId: string;
  trackId: string;
  sourceStatus: SourceStatus | "unknown";
  authorityTier: "tier1" | "secondary" | "unknown";
  authorityRoles: SourceAuthorityRole[];
  routePriority: "primary" | "supporting";
}

export interface CandidateProvenance {
  sourcePath: string;
  canonicalUrl: string;
  sourceRevision: Record<string, unknown>;
  headingPath: string[];
  sectionId: string;
}

export interface CandidateExactMatch {
  directiveType: "cmdlet" | "policy" | "entity";
  directiveValue: string;
  required: boolean;
  matchedField:
    | "title"
    | "entity"
    | "metadata"
    | "metadata_weak"
    | "section"
    | "canonical_identifier"
    | "chunk_text"
    | "chunk_text_weak";
}

export interface RetrievalCandidate {
  candidateId: string;
  method: CandidateRetrievalMethod;
  documentId: string;
  chunkId: string;
  sectionId: string;
  headingPath: string[];
  title: string;
  text: string;
  authority: CandidateAuthorityContext;
  provenance: CandidateProvenance;
  scores: {
    lexical: number | null;
    exactMatch: number | null;
    semanticSimilarity: number | null;
  };
  semanticRank?: number;
  exactMatch?: CandidateExactMatch;
  retrievalReasons: string[];
}

export interface PopulationDiagnostics {
  eligiblePopulation: number;
  matchedPopulation: number;
  returnedPopulation: number;
}

export interface ExactMatchAttempt {
  directiveType: "cmdlet" | "policy" | "entity";
  directiveValue: string;
  required: boolean;
  matchedCount: number;
}

export interface ExactMatchDiagnostics extends PopulationDiagnostics {
  attempted: ExactMatchAttempt[];
  missedRequired: ExactMatchAttempt[];
}

export interface LexicalDiagnostics extends PopulationDiagnostics {
  lexicalQuery: string;
  queryTerms: string[];
}

