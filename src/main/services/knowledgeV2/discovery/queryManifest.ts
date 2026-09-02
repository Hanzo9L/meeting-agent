import type { TeamsAdminDiscoveryQuery } from "./types";

export const TEAMS_ADMIN_DISCOVERY_QUERIES_VERSION = "cg01e1-query-manifest-v2";

export const TEAMS_ADMIN_DISCOVERY_QUERIES: TeamsAdminDiscoveryQuery[] = [
  {
    queryId: "TA-CORE-001",
    domainId: "core_admin",
    queryText: "Microsoft Teams admin center policy management",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Baseline Teams administration controls and policy guidance.",
    enabled: true
  },
  {
    queryId: "TA-CORE-002",
    domainId: "core_admin",
    queryText: "Microsoft Teams administration users licensing reports monitoring",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Broader core admin topics and tenant operation responsibilities.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-001",
    domainId: "voice_direct_routing",
    queryText: "Microsoft Teams Direct Routing administration voice routing policy",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Primary Direct Routing and policy coverage.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-002",
    domainId: "voice_direct_routing",
    queryText: "Microsoft Teams Direct Routing SBC media bypass emergency calling",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "SBC, media bypass, and emergency voice administration details.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-003",
    domainId: "voice_direct_routing",
    queryText: "Plan Direct Routing Microsoft Teams",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Landing and planning page validation for Direct Routing authority.",
    enabled: true
  },
  {
    queryId: "TA-CALL-001",
    domainId: "voice_calling",
    queryText: "Microsoft Teams call queues auto attendants administration",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Workload administration for queueing and attendant features.",
    enabled: true
  },
  {
    queryId: "TA-CALL-002",
    domainId: "voice_calling",
    queryText: "Microsoft Teams Operator Connect Calling Plans dial plans number management",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Telephony connectivity and numbering lifecycle coverage.",
    enabled: true
  },
  {
    queryId: "TA-CALL-003",
    domainId: "voice_calling",
    queryText: "Microsoft Teams create call queue admin center",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Explicit call queue administration coverage.",
    enabled: true
  },
  {
    queryId: "TA-CALL-004",
    domainId: "voice_calling",
    queryText: "Microsoft Teams create auto attendant admin center",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Explicit auto attendant administration coverage.",
    enabled: true
  },
  {
    queryId: "TA-MEET-001",
    domainId: "meetings",
    queryText: "Microsoft Teams meeting policies settings configuration admin",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Core meetings admin policy and settings guidance.",
    enabled: true
  },
  {
    queryId: "TA-MEET-002",
    domainId: "meetings",
    queryText: "Microsoft Teams webinars town halls meeting templates administration",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Advanced meeting events and template controls.",
    enabled: true
  },
  {
    queryId: "TA-EXT-001",
    domainId: "external_collaboration",
    queryText: "Microsoft Teams external access federation administrator",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Inter-org communications and federation policy settings.",
    enabled: true
  },
  {
    queryId: "TA-EXT-002",
    domainId: "external_collaboration",
    queryText: "Microsoft Teams guest access shared channels cross-tenant",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Guest and shared-channel collaboration controls.",
    enabled: true
  },
  {
    queryId: "TA-MSG-001",
    domainId: "messaging_teams_management",
    queryText: "Microsoft Teams messaging policies teams channels management",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Messaging governance and teams/channel administration.",
    enabled: true
  },
  {
    queryId: "TA-MSG-002",
    domainId: "messaging_teams_management",
    queryText: "Microsoft Teams private channels shared channels lifecycle governance templates",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Channel model governance and lifecycle management.",
    enabled: true
  },
  {
    queryId: "TA-DEVICES-001",
    domainId: "devices",
    queryText: "Microsoft Teams Rooms devices administration configuration",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Teams Rooms and shared meeting device management.",
    enabled: true
  },
  {
    queryId: "TA-DEVICES-002",
    domainId: "devices",
    queryText: "Microsoft Teams phones panels displays device health management",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Broader Teams endpoint device lifecycle and health.",
    enabled: true
  },
  {
    queryId: "TA-SEC-001",
    domainId: "security_compliance_intersections",
    queryText: "Microsoft Teams administrator security compliance retention conditional access",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Teams-specific security/compliance intersections with admin scope.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-004",
    domainId: "voice_direct_routing",
    queryText: "Microsoft Teams Direct Routing configure session border controller connection",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Direct Routing SBC connection configuration and onboarding guidance.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-005",
    domainId: "voice_direct_routing",
    queryText: "Microsoft Teams Direct Routing certificates SIP signaling firewall ports",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Certificate, SIP signaling, and firewall requirements for Direct Routing.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-006",
    domainId: "voice_direct_routing",
    queryText: "Microsoft Teams Direct Routing monitor troubleshoot health SBC",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Direct Routing health monitoring and SBC troubleshooting coverage.",
    enabled: true
  },
  {
    queryId: "TA-VOICE-007",
    domainId: "voice_direct_routing",
    queryText: "Microsoft Teams local media optimization network topology voice",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Local Media Optimization and voice network topology guidance.",
    enabled: true
  },
  {
    queryId: "TA-CALL-005",
    domainId: "voice_calling",
    queryText: "Microsoft Teams dial plan normalization rules voice routing",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Dial plan normalization and voice-routing administration coverage.",
    enabled: true
  },
  {
    queryId: "TA-CALL-006",
    domainId: "voice_calling",
    queryText: "Microsoft Teams phone number management porting order carrier",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Phone-number ordering, porting, and carrier lifecycle guidance.",
    enabled: true
  },
  {
    queryId: "TA-CALL-007",
    domainId: "voice_calling",
    queryText: "Microsoft Teams Calling Plans PSTN connectivity options compare",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Calling Plans and PSTN connectivity option comparison coverage.",
    enabled: true
  },
  {
    queryId: "TA-CALL-008",
    domainId: "voice_calling",
    queryText: "Microsoft Teams Operator Connect configure carrier",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Operator Connect carrier configuration and enablement guidance.",
    enabled: true
  },
  {
    queryId: "TA-CALL-009",
    domainId: "voice_calling",
    queryText: "Microsoft Teams emergency calling policies dynamic location",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Emergency calling policy and dynamic-location administration coverage.",
    enabled: true
  },
  {
    queryId: "TA-CALL-010",
    domainId: "voice_calling",
    queryText: "Microsoft Teams call quality dashboard call analytics troubleshoot",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Call Quality Dashboard and Call Analytics troubleshooting guidance.",
    enabled: true
  },
  {
    queryId: "TA-CALL-011",
    domainId: "voice_calling",
    queryText: "Microsoft Teams voice routing policy PSTN usage records",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Voice routing policy and PSTN usage record administration coverage.",
    enabled: true
  },
  {
    queryId: "TA-DEVICES-003",
    domainId: "devices",
    queryText: "Microsoft Teams Rooms resource account create configure",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Teams Rooms resource-account creation and configuration guidance.",
    enabled: true
  },
  {
    queryId: "TA-DEVICES-004",
    domainId: "devices",
    queryText: "Microsoft Teams Rooms deployment plan requirements",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Teams Rooms deployment planning and prerequisite coverage.",
    enabled: true
  },
  {
    queryId: "TA-DEVICES-005",
    domainId: "devices",
    queryText: "Microsoft Teams Rooms Pro management portal device health",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Teams Rooms Pro portal management and device-health guidance.",
    enabled: true
  },
  {
    queryId: "TA-DEVICES-006",
    domainId: "devices",
    queryText: "Microsoft Teams devices Intune enrollment compliance policy",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Intune enrollment and compliance-policy coverage for Teams devices.",
    enabled: true
  },
  {
    queryId: "TA-CORE-003",
    domainId: "core_admin",
    queryText: "Microsoft Teams network requirements bandwidth QoS media ports",
    sourceId: "ms-teams-admin",
    expectedPathPrefix: "/microsoftteams/",
    rationale: "Core Teams network, bandwidth, QoS, and media-port requirements.",
    enabled: true
  }
];
