import type { TeamsAdminTaxonomy } from "./types";

export const TEAMS_ADMIN_TAXONOMY: TeamsAdminTaxonomy = {
  version: "cg01e1-taxonomy-v1",
  sourceId: "ms-teams-admin",
  domains: [
    {
      domainId: "core_admin",
      displayName: "Core Administration",
      keywords: [
        "teams admin center",
        "teams administration",
        "teams users",
        "teams policy",
        "teams licensing",
        "teams reports",
        "teams monitoring",
        "teams service health"
      ]
    },
    {
      domainId: "voice_direct_routing",
      displayName: "Teams Voice / Direct Routing",
      keywords: [
        "teams phone",
        "direct routing",
        "voice routing policy",
        "pstn usage",
        "voice routes",
        "sbc",
        "media bypass",
        "emergency calling"
      ]
    },
    {
      domainId: "voice_calling",
      displayName: "Calling Features",
      keywords: [
        "operator connect",
        "calling plans",
        "call queue",
        "auto attendant",
        "dial plan",
        "number management",
        "caller id",
        "calling policy"
      ]
    },
    {
      domainId: "meetings",
      displayName: "Meetings Administration",
      keywords: [
        "meeting policy",
        "meeting settings",
        "meeting configuration",
        "meeting template",
        "webinar",
        "town hall",
        "conferencing"
      ]
    },
    {
      domainId: "external_collaboration",
      displayName: "External Collaboration",
      keywords: [
        "external access",
        "federation",
        "guest access",
        "shared channels",
        "cross-tenant communication"
      ]
    },
    {
      domainId: "messaging_teams_management",
      displayName: "Messaging and Teams Management",
      keywords: [
        "messaging policy",
        "teams and channels management",
        "private channels",
        "shared channels governance",
        "team templates",
        "teams lifecycle"
      ]
    },
    {
      domainId: "devices",
      displayName: "Devices",
      keywords: [
        "teams rooms",
        "teams phone devices",
        "teams panels",
        "teams displays",
        "device management",
        "device health"
      ]
    },
    {
      domainId: "security_compliance_intersections",
      displayName: "Security and Compliance Intersections",
      keywords: [
        "teams conditional access",
        "teams compliance",
        "teams retention",
        "teams data loss prevention",
        "teams defender integration"
      ]
    }
  ]
};
