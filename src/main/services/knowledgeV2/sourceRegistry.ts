import {
  DEFAULT_KNOWLEDGE_BASE_BRANCH,
  DEFAULT_KNOWLEDGE_BASE_REPO_URL
} from "@shared/constants";
import type {
  AcquisitionConfig,
  DomainAuthorityPriority,
  KnowledgeSourceDefinition,
  SourceAudience,
  SourceAuthorityRole,
  SourceDomain,
  SourceTransport,
  SourceRegistry
} from "./sourceTypes";

const SOURCE_IDS = {
  teamsAdmin: "ms-teams-admin",
  teamsPowerShell: "ms-teams-powershell",
  graph: "ms-graph-docs",
  entra: "ms-entra-docs",
  m365: "ms-m365-docs",
  teamsDev: "ms-teams-dev-docs",
  sharepoint: "ms-sharepoint-docs",
  sharepointPowerShell: "ms-sharepoint-powershell"
} as const;

const DOMAIN_AUTHORITY_PRIORITY: DomainAuthorityPriority = {
  teams_admin: [
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.m365,
    SOURCE_IDS.entra,
    SOURCE_IDS.graph,
    SOURCE_IDS.teamsDev,
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell
  ],
  teams_powershell: [
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.m365,
    SOURCE_IDS.entra,
    SOURCE_IDS.graph,
    SOURCE_IDS.teamsDev,
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell
  ],
  graph: [
    SOURCE_IDS.graph,
    SOURCE_IDS.entra,
    SOURCE_IDS.m365,
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.teamsDev,
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell
  ],
  entra: [
    SOURCE_IDS.entra,
    SOURCE_IDS.m365,
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.graph,
    SOURCE_IDS.teamsDev,
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell
  ],
  m365: [
    SOURCE_IDS.m365,
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.entra,
    SOURCE_IDS.graph,
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.teamsDev,
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell
  ],
  teams_dev: [
    SOURCE_IDS.teamsDev,
    SOURCE_IDS.graph,
    SOURCE_IDS.entra,
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.m365,
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell
  ],
  sharepoint: [
    SOURCE_IDS.sharepoint,
    SOURCE_IDS.sharepointPowerShell,
    SOURCE_IDS.m365,
    SOURCE_IDS.entra,
    SOURCE_IDS.teamsAdmin,
    SOURCE_IDS.graph,
    SOURCE_IDS.teamsPowerShell,
    SOURCE_IDS.teamsDev
  ]
};

const LEARN_MCP_ENDPOINT = "https://learn.microsoft.com/api/mcp";

const DEFAULT_SOURCE_REGISTRY: SourceRegistry = {
  version: "1.0",
  generatedAt: "static",
  sources: [
    {
      id: SOURCE_IDS.teamsAdmin,
      displayName: "Microsoft Teams Administration Docs",
      description: "Primary Microsoft Teams administration and IT Pro guidance.",
      product: "Microsoft Teams",
      domains: ["teams_admin"],
      subdomains: ["voice", "meeting_policy", "calling", "tenant_configuration"],
      audiences: ["administrator", "it_pro"],
      sourceType: "documentation",
      authorityTier: "tier1",
      authorityRoles: ["teams_admin_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: true,
      acquisition: {
        transport: "learn_mcp",
        endpoint: LEARN_MCP_ENDPOINT,
        canonicalBaseUrl: "https://learn.microsoft.com/en-us/microsoftteams",
        locale: "en-us",
        searchScope: {
          includePathPrefixes: ["/en-us/microsoftteams/"]
        },
        cacheEnabled: true
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          includeGlobs: ["microsoftteams/**"],
          excludeGlobs: ["**/archive/**", "**/includes/**", "**/media/**"],
          defaultRetrievalEligible: true,
          synchronizationEnabled: true
        }
      ],
      learnMapping: {
        productAreas: ["microsoftteams"],
        preferredLocale: "en-us"
      },
      normalizationHints: {
        dateFields: ["ms.date", "ms.update-cycle", "updatedDate"],
        statusFields: ["ms.topic", "ms.service", "ms.subservice"],
        ownerFields: ["author", "ms.author"]
      }
    },
    {
      id: SOURCE_IDS.teamsPowerShell,
      displayName: "Teams PowerShell Docs",
      description: "Primary authority for Teams cmdlet semantics and PowerShell configuration.",
      product: "Microsoft Teams",
      domains: ["teams_powershell", "teams_admin"],
      subdomains: ["cmdlet_reference", "calling_configuration", "policy_management"],
      audiences: ["administrator", "it_pro"],
      sourceType: "reference",
      authorityTier: "tier1",
      authorityRoles: ["teams_powershell_cmdlet_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: true,
      acquisition: {
        transport: "github",
        owner: "MicrosoftDocs",
        repo: "office-docs-powershell",
        branch: "main",
        webBaseUrl: "https://github.com/MicrosoftDocs/office-docs-powershell/blob/main",
        rawBaseUrl:
          "https://raw.githubusercontent.com/MicrosoftDocs/office-docs-powershell/main"
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          includeGlobs: [
            "teams/docs-conceptual/**/*.md",
            "teams/teams-ps/MicrosoftTeams/**/*.md"
          ],
          excludeGlobs: ["**/archive/**", "**/media/**"],
          defaultRetrievalEligible: true,
          synchronizationEnabled: true
        }
      ],
      learnMapping: {
        productAreas: ["powershell", "microsoftteams"],
        preferredLocale: "en-us"
      },
      normalizationHints: {
        dateFields: ["ms.date", "updatedDate"],
        statusFields: ["ms.topic", "ms.service"],
        ownerFields: ["author", "ms.author"]
      }
    },
    {
      id: SOURCE_IDS.graph,
      displayName: "Microsoft Graph Docs",
      description: "API authority for Graph semantics, with GA and beta tracks explicitly separated.",
      product: "Microsoft Graph",
      domains: ["graph", "teams_admin"],
      subdomains: ["v1_reference", "beta_reference", "teams_graph_dependencies"],
      audiences: ["developer", "administrator"],
      sourceType: "reference",
      authorityTier: "tier1",
      authorityRoles: ["graph_api_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: false,
      acquisition: {
        transport: "github",
        owner: "microsoftgraph",
        repo: "microsoft-graph-docs-contrib",
        branch: "main",
        webBaseUrl: "https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main",
        rawBaseUrl:
          "https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-docs-contrib/main"
      },
      contentTracks: [
        {
          id: "v1-ga",
          status: "ga",
          includeGlobs: ["api-reference/v1.0/**/*.md"],
          excludeGlobs: [],
          defaultRetrievalEligible: true,
          synchronizationEnabled: false
        },
        {
          id: "beta-preview",
          status: "beta",
          includeGlobs: ["api-reference/beta/**/*.md"],
          excludeGlobs: [],
          defaultRetrievalEligible: false,
          synchronizationEnabled: false
        }
      ],
      learnMapping: {
        productAreas: ["graph"],
        preferredLocale: "en-us"
      }
    },
    {
      id: SOURCE_IDS.entra,
      displayName: "Microsoft Entra Docs",
      description:
        "Primary identity and Conditional Access authority for dependencies affecting Teams administration.",
      product: "Microsoft Entra",
      domains: ["entra", "teams_admin"],
      subdomains: [
        "conditional_access",
        "authentication",
        "authorization",
        "guest_identity",
        "device_identity",
        "app_service_principal"
      ],
      audiences: ["administrator", "security", "it_pro"],
      sourceType: "documentation",
      authorityTier: "tier1",
      authorityRoles: ["entra_identity_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: true,
      acquisition: {
        transport: "github",
        owner: "MicrosoftDocs",
        repo: "entra-docs",
        branch: "main",
        webBaseUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/main",
        rawBaseUrl: "https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main"
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          includeGlobs: [
            "docs/identity/conditional-access/**/*.md",
            "docs/identity/authentication/**/*.md",
            "docs/identity/role-based-access-control/**/*.md",
            "docs/identity/devices/**/*.md",
            "docs/identity-platform/**/*.md"
          ],
          excludeGlobs: ["**/archive/**", "**/media/**", "**/includes/**"],
          defaultRetrievalEligible: true,
          synchronizationEnabled: true
        }
      ],
      learnMapping: {
        productAreas: ["entra"],
        preferredLocale: "en-us",
        githubCanonicalUrl: {
          learnBaseUrl: "https://learn.microsoft.com/entra",
          repoPathPrefix: "docs/",
          expectedPathPattern: "^/entra/"
        }
      }
    },
    {
      id: SOURCE_IDS.m365,
      displayName: "Microsoft 365 Docs",
      description: "Tenant and platform administration authority for M365-level dependencies.",
      product: "Microsoft 365",
      domains: ["m365", "teams_admin"],
      subdomains: ["tenant_configuration", "licensing", "copilot_dependencies"],
      audiences: ["administrator", "platform_admin", "it_pro"],
      sourceType: "documentation",
      authorityTier: "tier1",
      authorityRoles: ["m365_tenant_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: false,
      acquisition: {
        transport: "github",
        owner: "MicrosoftDocs",
        repo: "microsoft-365-docs",
        branch: "public",
        webBaseUrl: "https://github.com/MicrosoftDocs/microsoft-365-docs/blob/public",
        rawBaseUrl: "https://raw.githubusercontent.com/MicrosoftDocs/microsoft-365-docs/public"
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          includeGlobs: ["microsoft-365/**/*.md"],
          excludeGlobs: ["**/archive/**", "**/media/**"],
          defaultRetrievalEligible: true,
          synchronizationEnabled: false
        }
      ]
    },
    {
      id: SOURCE_IDS.teamsDev,
      displayName: "Microsoft Teams Developer Docs",
      description:
        "Specialized Teams developer platform source. Not default authority for general Teams admin questions.",
      product: "Microsoft Teams",
      domains: ["teams_dev"],
      subdomains: ["apps", "bots", "tabs", "meeting_extensibility"],
      audiences: ["developer"],
      sourceType: "platform",
      authorityTier: "secondary",
      authorityRoles: ["teams_dev_specialized"],
      defaultRetrievalEligible: false,
      synchronizationEnabled: true,
      acquisition: {
        transport: "github",
        owner: "MicrosoftDocs",
        repo: "msteams-docs",
        branch: DEFAULT_KNOWLEDGE_BASE_BRANCH,
        webBaseUrl: `https://github.com/MicrosoftDocs/msteams-docs/blob/${DEFAULT_KNOWLEDGE_BASE_BRANCH}`,
        rawBaseUrl: `https://raw.githubusercontent.com/MicrosoftDocs/msteams-docs/${DEFAULT_KNOWLEDGE_BASE_BRANCH}`
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          includeGlobs: ["msteams-platform/**/*.md"],
          excludeGlobs: ["**/archive/**", "**/includes/**", "**/assets/**", "**/media/**"],
          defaultRetrievalEligible: false,
          synchronizationEnabled: true
        }
      ],
      learnMapping: {
        productAreas: ["microsoftteams"],
        preferredLocale: "en-us",
        githubCanonicalUrl: {
          learnBaseUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform",
          repoPathPrefix: "msteams-platform/",
          expectedPathPattern: "^/en-us/microsoftteams/platform/"
        }
      }
    },
    {
      id: SOURCE_IDS.sharepoint,
      displayName: "SharePoint Admin & Governance Docs",
      description:
        "Primary authority for SharePoint administration: site/library permissions, sharing controls, oversharing governance, and how SharePoint permissions affect Microsoft 365 Copilot content discovery. Scoped to admin/security/governance content; excludes SPFx and general SharePoint development.",
      product: "SharePoint",
      domains: ["sharepoint"],
      subdomains: [
        "site_permissions",
        "sharing_links",
        "sensitivity_governance",
        "copilot_content_discovery"
      ],
      audiences: ["administrator", "security", "it_pro"],
      sourceType: "documentation",
      authorityTier: "tier1",
      authorityRoles: ["sharepoint_admin_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: false,
      acquisition: {
        transport: "learn_mcp",
        endpoint: LEARN_MCP_ENDPOINT,
        canonicalBaseUrl: "https://learn.microsoft.com/en-us/sharepoint",
        locale: "en-us",
        searchScope: {
          includePathPrefixes: ["/en-us/sharepoint/"]
        },
        cacheEnabled: true
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          includeGlobs: ["sharepoint/**"],
          excludeGlobs: ["**/archive/**", "**/includes/**", "**/media/**", "**/spfx/**"],
          defaultRetrievalEligible: true,
          synchronizationEnabled: false
        }
      ],
      learnMapping: {
        productAreas: ["sharepoint"],
        preferredLocale: "en-us"
      },
      normalizationHints: {
        dateFields: ["ms.date", "updated_at"],
        statusFields: ["ms.topic", "ms.service", "ms.subservice"],
        ownerFields: ["author", "ms.author"]
      }
    },
    {
      id: SOURCE_IDS.sharepointPowerShell,
      displayName: "SharePoint Online PowerShell Docs",
      description: "Primary authority for SharePoint Online (SPO*) cmdlet semantics.",
      product: "SharePoint",
      domains: ["sharepoint"],
      subdomains: ["admin_powershell"],
      audiences: ["administrator", "it_pro"],
      sourceType: "reference",
      authorityTier: "tier1",
      authorityRoles: ["sharepoint_powershell_cmdlet_primary"],
      defaultRetrievalEligible: true,
      synchronizationEnabled: true,
      acquisition: {
        transport: "github",
        owner: "MicrosoftDocs",
        repo: "OfficeDocs-SharePoint-PowerShell",
        branch: "main",
        webBaseUrl: "https://github.com/MicrosoftDocs/OfficeDocs-SharePoint-PowerShell/blob/main",
        rawBaseUrl:
          "https://raw.githubusercontent.com/MicrosoftDocs/OfficeDocs-SharePoint-PowerShell/main"
      },
      contentTracks: [
        {
          id: "ga",
          status: "ga",
          // K2 is deliberately bounded to cmdlets relevant to site/library
          // permissions, sharing controls, external users, oversharing
          // reporting, data-access governance, restricted access insights,
          // and Copilot/M365 agent content-discovery insights. The module
          // has 300+ cmdlets covering unrelated areas (CDN, migration,
          // containers, taxonomy, geo-move, themes, etc.) that are out of
          // scope for this slice and are intentionally excluded here rather
          // than ingested and never surfaced as authoritative.
          includeGlobs: [
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Connect-SPOService.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Disconnect-SPOService.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOSite.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Set-SPOSite.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/New-SPOSite.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Remove-SPOSite.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOTenant.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Set-SPOTenant.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOUser.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Add-SPOUser.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Set-SPOUser.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Remove-SPOUser.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOSiteGroup.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/New-SPOSiteGroup.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Set-SPOSiteGroup.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Remove-SPOSiteGroup.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOExternalUser.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Remove-SPOExternalUser.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOSiteUserInvitations.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Remove-SPOSiteUserInvitations.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/New-SPOSiteSharingReportJob.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPODataAccessGovernanceInsight.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Start-SPODataAccessGovernanceInsight.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Export-SPODataAccessGovernanceInsight.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Remove-SPODataAccessGovernanceInsight.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPORestrictedAccessForSitesInsights.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Start-SPORestrictedAccessForSitesInsights.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOCopilotAgentInsightsReport.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Start-SPOCopilotAgentInsightsReport.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Get-SPOM365AgentAccessInsightsReport.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Start-SPOM365AgentAccessInsightsReport.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Set-SPOCopilotPromoOptInStatus.md",
            "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/Revoke-SPOUserSession.md"
          ],
          excludeGlobs: ["**/archive/**", "**/media/**"],
          defaultRetrievalEligible: true,
          synchronizationEnabled: true
        }
      ],
      learnMapping: {
        productAreas: ["powershell", "sharepoint"],
        preferredLocale: "en-us",
        githubPowerShellModule: {
          learnModuleSegment: "microsoft.online.sharepoint.powershell",
          repoPathPrefix: "sharepoint/sharepoint-ps/Microsoft.Online.SharePoint.PowerShell/",
          repository: "microsoftdocs/officedocs-sharepoint-powershell",
          cmdletTitlePattern:
            "^(?:Get|Set|Grant|Revoke|Remove|New|Test|Enable|Disable|Add|Repair|Start|Stop|Register|Unregister|Approve|Deny|Request|Restore|Move|Rename|Connect|Disconnect|Import|Export|Invoke|Recover|Submit|Update|Upgrade)-SPO[A-Za-z0-9]+$"
        }
      },
      normalizationHints: {
        dateFields: ["ms.date", "updatedDate"],
        statusFields: ["ms.topic", "ms.service"],
        ownerFields: ["author", "ms.author"]
      }
    }
  ]
};

const SOURCE_ID_PATTERN = /^[a-z0-9-]+$/;
const OWNER_REPO_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;
const TRANSPORTS: SourceTransport[] = ["github", "learn_mcp"];

function assertValidAcquisitionConfig(source: KnowledgeSourceDefinition): void {
  const acquisition = source.acquisition as AcquisitionConfig;
  if (!TRANSPORTS.includes(acquisition.transport)) {
    throw new Error(`Source ${source.id}: unsupported transport.`);
  }

  if (acquisition.transport === "github") {
    if (!OWNER_REPO_TOKEN_PATTERN.test(acquisition.owner)) {
      throw new Error(`Source ${source.id}: malformed repository owner "${acquisition.owner}".`);
    }
    if (!OWNER_REPO_TOKEN_PATTERN.test(acquisition.repo)) {
      throw new Error(`Source ${source.id}: malformed repository name "${acquisition.repo}".`);
    }
    if (!acquisition.branch.trim()) {
      throw new Error(`Source ${source.id}: missing repository branch.`);
    }
    if (!acquisition.webBaseUrl.startsWith("https://github.com/")) {
      throw new Error(`Source ${source.id}: invalid GitHub web base URL.`);
    }
    if (!acquisition.rawBaseUrl.startsWith("https://raw.githubusercontent.com/")) {
      throw new Error(`Source ${source.id}: invalid GitHub raw base URL.`);
    }
    return;
  }

  if (!acquisition.endpoint.startsWith("https://")) {
    throw new Error(`Source ${source.id}: Learn MCP endpoint must be https.`);
  }
  if (!acquisition.canonicalBaseUrl.startsWith("https://learn.microsoft.com/")) {
    throw new Error(`Source ${source.id}: Learn canonical base URL must be learn.microsoft.com.`);
  }
  if (acquisition.searchScope.includePathPrefixes.length === 0) {
    throw new Error(`Source ${source.id}: Learn MCP includePathPrefixes cannot be empty.`);
  }
}

function assertValidAuthorityRoles(source: KnowledgeSourceDefinition): void {
  const domainToRoles: Record<SourceDomain, SourceAuthorityRole[]> = {
    teams_admin: ["teams_admin_primary", "teams_powershell_cmdlet_primary", "m365_tenant_primary"],
    teams_powershell: ["teams_powershell_cmdlet_primary", "teams_admin_primary"],
    graph: ["graph_api_primary"],
    entra: ["entra_identity_primary"],
    m365: ["m365_tenant_primary"],
    teams_dev: ["teams_dev_specialized"],
    sharepoint: ["sharepoint_admin_primary", "sharepoint_powershell_cmdlet_primary"]
  };

  if (source.authorityRoles.length === 0) {
    throw new Error(`Source ${source.id}: authorityRoles cannot be empty.`);
  }

  const allowedRoles = new Set(source.domains.flatMap((domain) => domainToRoles[domain]));
  for (const role of source.authorityRoles) {
    if (!allowedRoles.has(role)) {
      throw new Error(`Source ${source.id}: authority role "${role}" is invalid for configured domains.`);
    }
  }
}

export function validateSourceRegistry(registry: SourceRegistry): void {
  const ids = new Set<string>();
  for (const source of registry.sources) {
    if (!SOURCE_ID_PATTERN.test(source.id)) {
      throw new Error(`Source ${source.id}: id must match ${SOURCE_ID_PATTERN.toString()}.`);
    }
    if (ids.has(source.id)) {
      throw new Error(`Duplicate source id: ${source.id}`);
    }
    ids.add(source.id);

    assertValidAcquisitionConfig(source);

    assertValidAuthorityRoles(source);

    const trackIds = new Set<string>();
    let hasGaTrack = false;
    for (const track of source.contentTracks) {
      if (trackIds.has(track.id)) {
        throw new Error(`Source ${source.id}: duplicate content track id "${track.id}".`);
      }
      trackIds.add(track.id);
      if (source.acquisition.transport === "github" && track.includeGlobs.length === 0) {
        throw new Error(
          `Source ${source.id}: content track "${track.id}" must include at least one glob for github transport.`
        );
      }
      if (track.status === "ga") {
        hasGaTrack = true;
      }
    }

    if (source.contentTracks.length === 0) {
      throw new Error(`Source ${source.id}: at least one content track is required.`);
    }

    if (hasGaTrack) {
      const conflictingTrack = source.contentTracks.find(
        (track) =>
          (track.status === "beta" || track.status === "preview") && track.defaultRetrievalEligible
      );
      if (conflictingTrack) {
        throw new Error(
          `Source ${source.id}: track "${conflictingTrack.id}" cannot be default eligible while GA track exists.`
        );
      }
    }
  }

  for (const [domain, orderedIds] of Object.entries(DOMAIN_AUTHORITY_PRIORITY) as Array<
    [SourceDomain, string[]]
  >) {
    if (orderedIds.length === 0) {
      throw new Error(`Domain ${domain}: authority priority cannot be empty.`);
    }
    const missing = orderedIds.find((id) => !ids.has(id));
    if (missing) {
      throw new Error(`Domain ${domain}: unknown source id "${missing}" in authority priority.`);
    }
  }
}

export function getDefaultSourceRegistry(): SourceRegistry {
  const registry = structuredClone(DEFAULT_SOURCE_REGISTRY);
  validateSourceRegistry(registry);
  return registry;
}

export function getDomainAuthorityPriority(domain: SourceDomain): string[] {
  return [...DOMAIN_AUTHORITY_PRIORITY[domain]];
}

export function getSourceById(sourceId: string): KnowledgeSourceDefinition | undefined {
  return getDefaultSourceRegistry().sources.find((source) => source.id === sourceId);
}

export function isGitHubBackedSource(source: KnowledgeSourceDefinition): boolean {
  return source.acquisition.transport === "github";
}

export function querySources(filters: {
  domain?: SourceDomain;
  product?: string;
  audience?: SourceAudience;
  authorityRole?: SourceAuthorityRole;
  defaultRetrievalEligible?: boolean;
  includePreview?: boolean;
}): KnowledgeSourceDefinition[] {
  const registry = getDefaultSourceRegistry();
  return registry.sources.filter((source) => {
    if (filters.domain && !source.domains.includes(filters.domain)) return false;
    if (filters.product && source.product.toLowerCase() !== filters.product.toLowerCase()) return false;
    if (filters.audience && !source.audiences.includes(filters.audience)) return false;
    if (filters.authorityRole && !source.authorityRoles.includes(filters.authorityRole)) return false;
    if (
      typeof filters.defaultRetrievalEligible === "boolean" &&
      source.defaultRetrievalEligible !== filters.defaultRetrievalEligible
    ) {
      return false;
    }
    if (!filters.includePreview) {
      const hasOnlyPreviewTracks = source.contentTracks.every(
        (track) => track.status === "beta" || track.status === "preview"
      );
      if (hasOnlyPreviewTracks) return false;
    }
    return true;
  });
}

export function getSourcePriorityChainForDomain(domain: SourceDomain): KnowledgeSourceDefinition[] {
  const registry = getDefaultSourceRegistry();
  const sourceById = new Map(registry.sources.map((source) => [source.id, source]));
  return DOMAIN_AUTHORITY_PRIORITY[domain]
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is KnowledgeSourceDefinition => Boolean(source));
}

export function formatSourceRegistryReport(): string {
  const registry = getDefaultSourceRegistry();
  const lines: string[] = [];
  lines.push(`Source Registry v${registry.version}`);
  lines.push(`GeneratedAt: ${registry.generatedAt}`);
  lines.push(`Teams Developer Canonical Repo: ${DEFAULT_KNOWLEDGE_BASE_REPO_URL}`);
  lines.push("");
  for (const source of registry.sources) {
    const tracks = source.contentTracks
      .map(
        (track) =>
          `${track.id}[${track.status}] eligible=${track.defaultRetrievalEligible} sync=${track.synchronizationEnabled}`
      )
      .join(", ");
    lines.push(`- ${source.id}: ${source.displayName}`);
    if (source.acquisition.transport === "github") {
      lines.push(
        `  transport=github repo=${source.acquisition.owner}/${source.acquisition.repo}#${source.acquisition.branch}`
      );
    } else {
      lines.push(
        `  transport=learn_mcp endpoint=${source.acquisition.endpoint} base=${source.acquisition.canonicalBaseUrl}`
      );
    }
    lines.push(`  domains=${source.domains.join(", ")}`);
    lines.push(`  roles=${source.authorityRoles.join(", ")}`);
    lines.push(`  tier=${source.authorityTier} defaultEligible=${source.defaultRetrievalEligible}`);
    lines.push(`  tracks=${tracks}`);
  }
  return lines.join("\n");
}

