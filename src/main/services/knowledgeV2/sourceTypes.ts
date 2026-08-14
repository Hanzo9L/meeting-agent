export type SourceDomain =
  | "teams_admin"
  | "teams_powershell"
  | "graph"
  | "entra"
  | "m365"
  | "teams_dev";

export type SourceAudience =
  | "administrator"
  | "it_pro"
  | "developer"
  | "security"
  | "platform_admin";

export type SourceAuthorityTier = "tier1" | "secondary";

export type SourceType = "documentation" | "reference" | "platform";

export type SourceStatus = "ga" | "beta" | "preview" | "mixed";
export type SourceTransport = "github" | "learn_mcp";

export type SourceAuthorityRole =
  | "teams_admin_primary"
  | "teams_powershell_cmdlet_primary"
  | "graph_api_primary"
  | "entra_identity_primary"
  | "m365_tenant_primary"
  | "teams_dev_specialized";

export interface SourceContentTrack {
  id: string;
  status: Exclude<SourceStatus, "mixed">;
  includeGlobs: string[];
  excludeGlobs: string[];
  defaultRetrievalEligible: boolean;
  synchronizationEnabled: boolean;
}

export interface GitHubTransportConfig {
  transport: "github";
  owner: string;
  repo: string;
  branch: string;
  webBaseUrl: string;
  rawBaseUrl: string;
}

export interface LearnMcpTransportConfig {
  transport: "learn_mcp";
  endpoint: string;
  canonicalBaseUrl: string;
  locale: string;
  searchScope: {
    includePathPrefixes: string[];
  };
  cacheEnabled: boolean;
}

export type AcquisitionConfig = GitHubTransportConfig | LearnMcpTransportConfig;

/**
 * Deterministic rule for reconstructing a trusted Microsoft Learn canonical URL
 * from a GitHub-transport source's persisted repository path. Only defined for
 * sources whose repo-path-to-Learn-URL mapping has been verified against real
 * Microsoft Learn pages (no version/moniker query strings, no locale ambiguity).
 */
export interface GitHubLearnUrlMapping {
  /** Learn base URL the mapped path is appended to, e.g. "https://learn.microsoft.com/entra". */
  learnBaseUrl: string;
  /** Repo-relative prefix stripped from the persisted source path before mapping, e.g. "docs/". */
  repoPathPrefix: string;
  /** Regex (source string) the resulting Learn pathname must match, defense-in-depth against misconfiguration. */
  expectedPathPattern: string;
}

export interface LearnMapping {
  productAreas: string[];
  preferredLocale: string;
  /** Present only when this source's GitHub path structure has a verified 1:1 Learn URL mapping. */
  githubCanonicalUrl?: GitHubLearnUrlMapping;
}

export interface SourceNormalizationHints {
  dateFields: string[];
  statusFields: string[];
  ownerFields: string[];
}

export interface CanonicalGitHubInfo {
  owner: string;
  repo: string;
  branch: string;
  webBaseUrl: string;
  rawBaseUrl: string;
}

export type SourceRevision =
  | {
      transport: "github";
      repository: string;
      branch: string;
      commitSha: string;
      blobSha: string;
      path: string;
    }
  | {
      transport: "learn_mcp";
      canonicalUrl: string;
      locale: string;
      retrievedAt: string;
      contentHash: string;
      lastUpdated?: string;
      documentId?: string;
      sourcePath?: string;
    };

export interface KnowledgeSourceDefinition {
  id: string;
  displayName: string;
  description: string;
  product: string;
  domains: SourceDomain[];
  subdomains: string[];
  audiences: SourceAudience[];
  sourceType: SourceType;
  authorityTier: SourceAuthorityTier;
  authorityRoles: SourceAuthorityRole[];
  defaultRetrievalEligible: boolean;
  synchronizationEnabled: boolean;
  acquisition: AcquisitionConfig;
  contentTracks: SourceContentTrack[];
  learnMapping?: LearnMapping;
  normalizationHints?: SourceNormalizationHints;
}

export interface SourceRegistry {
  version: "1.0";
  generatedAt: string;
  sources: KnowledgeSourceDefinition[];
}

export type DomainAuthorityPriority = Record<SourceDomain, string[]>;

