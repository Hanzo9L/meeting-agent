export type SourceDomain =
  | "teams_admin"
  | "teams_powershell"
  | "graph"
  | "entra"
  | "m365"
  | "teams_dev"
  | "sharepoint";

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
  | "teams_dev_specialized"
  | "sharepoint_admin_primary"
  | "sharepoint_powershell_cmdlet_primary";

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

/**
 * Deterministic rule for reconstructing a trusted Microsoft Learn
 * PowerShell-module canonical URL from a GitHub-transport source whose
 * documents are one-file-per-cmdlet with a title that equals the cmdlet
 * name (Learn URL slug = title.toLowerCase()). Generalizes the pattern
 * originally hardcoded for Teams PowerShell (see K1.1 diagnosis) to any
 * registered PowerShell reference source without introducing case- or
 * structure-transforming guesswork elsewhere.
 */
export interface GitHubPowerShellModuleMapping {
  /** Learn PowerShell module URL segment, e.g. "microsoftteams" or "microsoft.online.sharepoint.powershell". */
  learnModuleSegment: string;
  /** Repo-relative directory containing exactly one file per cmdlet, e.g. "teams/teams-ps/MicrosoftTeams/". */
  repoPathPrefix: string;
  /** "owner/repo" this mapping is verified against; defense-in-depth against a misconfigured source pointing at the wrong repo. */
  repository: string;
  /** Regex (source string) a genuine cmdlet title must match, e.g. verb-prefixed module noun. */
  cmdletTitlePattern: string;
}

export interface LearnMapping {
  productAreas: string[];
  preferredLocale: string;
  /** Present only when this source's GitHub path structure has a verified 1:1 Learn URL mapping. */
  githubCanonicalUrl?: GitHubLearnUrlMapping;
  /** Present only for one-file-per-cmdlet GitHub sources with a verified Learn PowerShell module mapping. */
  githubPowerShellModule?: GitHubPowerShellModuleMapping;
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

