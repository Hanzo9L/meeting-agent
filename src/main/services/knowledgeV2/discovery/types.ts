export type TeamsAdminDiscoveryMode = "plan" | "execute";

export type TeamsAdminDiscoveryStatus = "candidate" | "accepted" | "excluded" | "needs_review";

export type TeamsAdminAuthorityClassification =
  | "teams_admin_primary"
  | "teams_admin_cross_product_supporting"
  | "out_of_scope";

export type TeamsAdminReasonCode =
  | "accepted_teams_admin_namespace"
  | "accepted_admin_terminology"
  | "excluded_non_article_asset"
  | "excluded_developer_material"
  | "excluded_end_user_help"
  | "excluded_marketing_content"
  | "excluded_unrelated_namespace"
  | "excluded_non_learn_host"
  | "excluded_invalid_url"
  | "needs_review_cross_product_authority"
  | "candidate_insufficient_admin_signal";

export type TeamsAdminDomainId =
  | "core_admin"
  | "voice_direct_routing"
  | "voice_calling"
  | "meetings"
  | "external_collaboration"
  | "messaging_teams_management"
  | "devices"
  | "security_compliance_intersections";

export interface TeamsAdminTaxonomyDomain {
  domainId: TeamsAdminDomainId;
  displayName: string;
  keywords: string[];
}

export interface TeamsAdminTaxonomy {
  version: string;
  sourceId: "ms-teams-admin";
  domains: TeamsAdminTaxonomyDomain[];
}

export interface TeamsAdminDiscoveryQuery {
  queryId: string;
  domainId: TeamsAdminDomainId;
  queryText: string;
  sourceId: "ms-teams-admin";
  expectedPathPrefix: "/microsoftteams/";
  rationale: string;
  enabled: boolean;
}

export interface TeamsAdminSearchResultCandidate {
  url: string;
  title?: string;
  snippet?: string;
  locale?: string;
  raw: Record<string, unknown>;
}

export interface TeamsAdminManifestEntry {
  entryId: string;
  canonicalUrl: string;
  locale: string | null;
  articlePath: string;
  title: string | null;
  snippet: string | null;
  sourceId: "ms-teams-admin";
  discoveryQueryIds: string[];
  taxonomyDomains: TeamsAdminDomainId[];
  discoveryCount: number;
  status: TeamsAdminDiscoveryStatus;
  reasonCodes: TeamsAdminReasonCode[];
  authorityClassification: TeamsAdminAuthorityClassification;
  adjacentDomainHints: string[];
  learnMetadata: Record<string, unknown>;
  discoveredAt: string;
  manifestVersion: string;
}

export interface TeamsAdminQueryRunMetric {
  queryId: string;
  domainId: TeamsAdminDomainId;
  toolName: string;
  attempted: boolean;
  success: boolean;
  resultCount: number;
  latencyMs: number;
  error: string | null;
}

export interface TeamsAdminDomainCoverage {
  domainId: TeamsAdminDomainId;
  queryCount: number;
  successfulQueries: number;
  failedQueries: number;
  rawHits: number;
  uniqueCandidates: number;
  accepted: number;
  excluded: number;
  needsReview: number;
  candidate: number;
  duplicateHits: number;
  warnings: string[];
}

export interface TeamsAdminDiscoveryArtifacts {
  jsonPath: string;
  jsonlPath: string;
  markdownPath: string;
}

export interface TeamsAdminDiscoverySummary {
  rawSearchHits: number;
  uniqueCanonicalArticles: number;
  duplicateHits: number;
  acceptedCount: number;
  excludedCount: number;
  needsReviewCount: number;
  candidateCount: number;
  overlapCount: number;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
}

export interface TeamsAdminPowerShellSafetyCounts {
  documents: number;
  activeChunks: number;
  embeddings: number;
}

export interface TeamsAdminDiscoveryRunResult {
  runId: string;
  mode: TeamsAdminDiscoveryMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sourceId: "ms-teams-admin";
  taxonomyVersion: string;
  manifestVersion: string;
  queries: TeamsAdminDiscoveryQuery[];
  discoveredTools: string[];
  queryMetrics: TeamsAdminQueryRunMetric[];
  entries: TeamsAdminManifestEntry[];
  coverage: TeamsAdminDomainCoverage[];
  summary: TeamsAdminDiscoverySummary;
  directRoutingValidation: {
    targetCanonicalUrl: string;
    discovered: boolean;
    matchingEntryId: string | null;
    discoveredByQueryIds: string[];
  };
  powerShellSafety: {
    before: TeamsAdminPowerShellSafetyCounts;
    after: TeamsAdminPowerShellSafetyCounts;
    unchanged: boolean;
  };
  warnings: string[];
  errors: string[];
  artifacts: TeamsAdminDiscoveryArtifacts;
}

export interface TeamsAdminDiscoveryRunRequest {
  mode: TeamsAdminDiscoveryMode;
  artifactsDir?: string;
  dbPath?: string;
  signal?: AbortSignal;
  maxResultsPerQuery?: number;
  maxConcurrency?: number;
}

export interface TeamsAdminSanitizedEntry {
  entryId: string;
  canonicalUrl: string;
  articlePath: string;
  title: string | null;
  taxonomyDomains: TeamsAdminDomainId[];
  discoveryQueryIds: string[];
  originalStatus: TeamsAdminDiscoveryStatus;
  originalReasonCodes: TeamsAdminReasonCode[];
  sanitizedStatus: TeamsAdminDiscoveryStatus;
  sanitizedReasonCodes: TeamsAdminReasonCode[];
  originalAuthorityClassification: TeamsAdminAuthorityClassification;
  sanitizedAuthorityClassification: TeamsAdminAuthorityClassification;
  originalAdjacentDomainHints: string[];
  sanitizedAdjacentDomainHints: string[];
  changed: boolean;
  changeReason: string | null;
}

export interface TeamsAdminSanitizedSummary {
  uniqueCanonicalArticles: number;
  originalCounts: {
    accepted: number;
    needsReview: number;
    candidate: number;
    excluded: number;
  };
  sanitizedCounts: {
    accepted: number;
    needsReview: number;
    candidate: number;
    excluded: number;
  };
  changedEntries: number;
  movedFromAccepted: number;
  movedFromAcceptedToExcluded: number;
  movedFromAcceptedToNeedsReview: number;
  excludedNonArticleAssets: number;
}

export interface TeamsAdminSanitizedManifest {
  runId: string;
  generatedAt: string;
  sanitizationVersion: string;
  sourceManifestPath: string;
  sourceRunId: string;
  sourceManifestVersion: string;
  sourceTaxonomyVersion: string;
  discoveredTools: string[];
  queryCount: number;
  entries: TeamsAdminSanitizedEntry[];
  summary: TeamsAdminSanitizedSummary;
  coverage: TeamsAdminDomainCoverage[];
  directRoutingValidation: {
    targetCanonicalUrl: string;
    acceptedInSanitizedSet: boolean;
    sanitizedStatus: TeamsAdminDiscoveryStatus | null;
    queryIds: string[];
  };
}
