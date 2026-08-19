import type { SourceAuthorityRole, SourceDomain, SourceStatus } from "../knowledgeV2";
import type { QueryDomain, QueryIntent } from "./queryIntent";

export type ScopeMode =
  | "narrow"
  | "cross_domain"
  | "broad_due_to_ambiguity";

export interface RetrievalCandidateBudget {
  maxLexicalCandidates: number;
  maxSemanticCandidates: number;
  broadScopeWarningThreshold: number;
}

export interface ExactMatchDirective {
  type: "cmdlet" | "policy" | "entity";
  value: string;
  required: boolean;
}

export interface SourceRouteScope {
  sourceId: string;
  priority: "primary" | "supporting";
  authorityRoles: SourceAuthorityRole[];
  eligibleTrackIds: string[];
  eligibleTrackStatuses: SourceStatus[];
  rationale: string[];
  subdomainHints: string[];
}

export interface RetrievalScope {
  intent: QueryIntent;
  selectedDomains: QueryDomain[];
  focusSubdomains: string[];
  /**
   * Optional hard document allowlist used by bounded validation/retrieval
   * modes. When set, retrieval is scoped to these document IDs and does not
   * also require the routed source/track filter. Undefined preserves normal
   * domain/source routing; an empty list deliberately searches no documents.
   */
  eligibleDocumentIds?: string[];
  eligibleSources: SourceRouteScope[];
  excludedSources: Array<{ sourceId: string; reason: string }>;
  sourcePriorityChain: string[];
  strategy: {
    exact: boolean;
    lexical: boolean;
    semantic: boolean;
    semanticPreference: "primary" | "secondary";
  };
  exactMatchDirectives: ExactMatchDirective[];
  candidateBudget: RetrievalCandidateBudget;
  scopeMode: ScopeMode;
  freshnessVerification: {
    required: boolean;
    reasons: string[];
  };
  betaPolicy: {
    allowsBeta: boolean;
    excludedBetaTracks: Array<{ sourceId: string; trackId: string }>;
  };
  estimatedCandidatePopulation: number;
  routingWarnings: string[];
  routingRationale: string[];
}

export interface DomainRouteResult {
  scope: RetrievalScope;
  latencyMs: number;
}

export interface DomainRouter {
  route(intent: QueryIntent): DomainRouteResult;
}

export type DomainRouteRuleContext = {
  intent: QueryIntent;
  primaryDomain: SourceDomain;
  selectedDomains: SourceDomain[];
};
