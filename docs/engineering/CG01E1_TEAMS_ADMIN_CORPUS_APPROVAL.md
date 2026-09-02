# CG-01E1.1 Teams Admin Corpus Approval Gate

SANITIZED PROPOSED INITIAL TEAMS ADMIN CORPUS
Accepted: 106
Needs human decision: 26
Candidates deferred: 108
Excluded: 293
Removed from automatic acceptance as non-article assets: 0

## Scope
- Source manifest: `eval/runs/discovery/cg01e1-2026-09-02T13-18-33-421Z.json`
- Sanitized manifest run: `cg01e1s-2026-09-02T15-37-49-498Z`
- No discovery rerun and no corpus indexing occurred in this pass.

## Approval Set
- Automatically proposed for approval: 106 sanitized accepted entries.
- Human-decision queue: 26 sanitized needs_review entries (listed individually below).
- Candidate queue (deferred): 108 entries.
- Excluded queue: 293 entries.

## Coverage Assessment
- core_admin: adequate
- voice_direct_routing: strong
- voice_calling: strong
- meetings: adequate
- external_collaboration: weak
- messaging_teams_management: strong
- devices: strong
- security_compliance_intersections: absent

## Known Validation Articles
- Direct Routing: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page`)
- Meeting policies: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview`)
- External access: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/manage-external-access`)
- Guest access: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/guest-access`)
- Call queue: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-call-queue`)
- Auto attendants: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-auto-attendant`)
- Teams Rooms: FOUND (`https://learn.microsoft.com/en-us/microsoftteams/rooms/aboutunifieddevicemanagement-pmp1`)

## Security/Compliance Interpretation
- security_compliance_intersections: accepted=0, needs_review=2, candidate=1, excluded=44
- Zero accepted appears consistent with authority boundaries (Entra/Intune/Purview/M365 often primary for those controls).

## Accepted Entries Requiring Human Reconsideration
- None flagged by deterministic metadata checks.

## Human-Review Queue (All needs_review Entries)
- ta-3ee2343684cb7560
  - title: Setup - Auto Attendant
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-auto-attendant
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-e29b4f89732a6c7b
  - title: Manage the Approvals app in Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/approval-admin
  - taxonomy_domains: security_compliance_intersections
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-384f4d26b084bcce
  - title: Collaborate with guests from other Microsoft 365 cloud environments
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/collaborate-guests-cross-cloud
  - taxonomy_domains: external_collaboration
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-6adba618c9d7cf8e
  - title: Considerations for Teams Phone Mobile
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/considerations-teams-phone-mobile
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: INCLUDE
  - rationale: Appears Teams-admin-relevant and useful if reviewer confirms operational ownership.
- ta-7250acae638929e4
  - title: Overview of custom meeting templates in Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/custom-meeting-templates-overview
  - taxonomy_domains: meetings
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-6df50739737763c8
  - title: Deploy Teams panels and Microsoft Teams Rooms on Android using Intune
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/devices/mtra-panels-deploy
  - taxonomy_domains: devices
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-3349ef88d78507a6
  - title: The Meeting app status is Unhealthy
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/devices/pmpsignal-meeting-app-status
  - taxonomy_domains: devices
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-05bcec85caf3b49e
  - title: Microsoft Teams displays
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/devices/teams-displays
  - taxonomy_domains: devices
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-b7850ff56e9323ce
  - title: Step 2 - Create a resource account
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/hybrid-meetings-device-config-account
  - taxonomy_domains: devices
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-bd9043cb48505a35
  - title: Plan for Operator Connect Conferencing
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/operator-connect-conferencing-plan
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-597726d2fac91943
  - title: Manage phone numbers for Teams Phone Mobile
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/operator-connect-mobile-configure-numbers
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-8179bb31a7fad7d1
  - title: Phone number management for Hong Kong
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/phone-reference/manage-numbers/phone-number-management-for-hong-kong
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: INCLUDE
  - rationale: Appears Teams-admin-relevant and useful if reviewer confirms operational ownership.
- ta-4bd48162df59b700
  - title: Phone number management for Singapore
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/phone-reference/manage-numbers/phone-number-management-for-singapore
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: INCLUDE
  - rationale: Appears Teams-admin-relevant and useful if reviewer confirms operational ownership.
- ta-9a9eaf22d779f8c8
  - title: Phone number management for Spain
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/phone-reference/manage-numbers/phone-number-management-for-spain
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-cfdaecd1e6b442e9
  - title: Phone number management for the United Kingdom
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/phone-reference/manage-numbers/phone-number-management-for-the-u-k
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: INCLUDE
  - rationale: Appears Teams-admin-relevant and useful if reviewer confirms operational ownership.
- ta-6dc317711c73cfd5
  - title: Phone number management for the United States
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/phone-reference/manage-numbers/phone-number-management-for-the-u-s
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: INCLUDE
  - rationale: Appears Teams-admin-relevant and useful if reviewer confirms operational ownership.
- ta-b8d0fd5a15815c77
  - title: Phones for Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/phones/phones-for-teams
  - taxonomy_domains: devices
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-b111f2d9054bf626
  - title: Plan for governance in Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/plan-teams-governance
  - taxonomy_domains: messaging_teams_management
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-728d300c67f55bb9
  - title: How to create and configure resource accounts for Teams Rooms and panels
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/rooms/create-resource-account
  - taxonomy_domains: devices
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-81422e06b14715ef
  - title: Share Files and Loop components in external (federated) chats
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/share-files-loop-in-external-chats
  - taxonomy_domains: external_collaboration
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-db6ccf926d47ac0b
  - title: Shared channels in Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/shared-channels
  - taxonomy_domains: external_collaboration, messaging_teams_management, security_compliance_intersections
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-f8b8cb7c5337e273
  - title: Shared channels errors in Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/shared-channels-errors
  - taxonomy_domains: external_collaboration
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-924f301df0b3cf4f
  - title: Teams Premium feature usage report
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/teams-analytics-and-reports/teams-premium-usage-report
  - taxonomy_domains: core_admin
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-ad3cf6c2e1b9611f
  - title: Microsoft Teams analytics and reporting
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/teams-analytics-and-reports/teams-reporting-reference
  - taxonomy_domains: core_admin
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-2a450c922f3c11ef
  - title: Use Call Analytics to troubleshoot poor call quality
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/use-call-analytics-to-troubleshoot-poor-call-quality
  - taxonomy_domains: voice_calling, core_admin
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-886d30a528b6fc1d
  - title: New VDI solution for Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/vdi-2
  - taxonomy_domains: core_admin
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.

## Candidate Queue Summary (Deferred)
- core_admin: 18
- voice_direct_routing: 5
- voice_calling: 43
- meetings: 15
- external_collaboration: 12
- messaging_teams_management: 11
- devices: 21
- security_compliance_intersections: 1

## Excluded Summary
- Excluded total: 293
- excluded_unrelated_namespace: 192
- excluded_non_article_asset: 69
- excluded_developer_material: 19
- excluded_marketing_content: 9
- excluded_end_user_help: 4

## Accepted Corpus Review (Grouped by Primary Domain)
### core_admin (11)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-manage-voice-applications-policies | domains=core_admin,voice_calling | queries=TA-CORE-002,TA-CALL-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/easy-policy-setup-edu | domains=core_admin | queries=TA-CORE-001
- Managing policy packages in Teams | https://learn.microsoft.com/en-us/microsoftteams/manage-policy-packages | domains=core_admin,messaging_teams_management | queries=TA-CORE-001,TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-queues-app | domains=core_admin,voice_calling | queries=TA-CORE-002,TA-CALL-001,TA-CALL-003
- Manage Teams with policies | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-with-policies | domains=core_admin,messaging_teams_management | queries=TA-CORE-001,TA-MSG-001
- Manage meeting and events policies in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview | domains=core_admin,meetings,messaging_teams_management | queries=TA-CORE-001,TA-MEET-001,TA-MSG-001,TA-MSG-002
- Quality of service (QoS) set up on Teams phones | https://learn.microsoft.com/en-us/microsoftteams/phones/qos-on-teams-phones | domains=core_admin | queries=TA-CORE-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/policy-assignment-overview | domains=core_admin,voice_direct_routing,meetings,messaging_teams_management,voice_calling | queries=TA-CORE-001,TA-VOICE-001,TA-MEET-001,TA-MSG-001,TA-CALL-011
- Implement Quality of Service (QoS) in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/qos-in-teams | domains=core_admin | queries=TA-CORE-003
- Manage channel policies in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/teams-policies | domains=core_admin,external_collaboration,messaging_teams_management | queries=TA-CORE-001,TA-EXT-002,TA-MSG-001,TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/using-admin-roles | domains=core_admin,messaging_teams_management,devices | queries=TA-CORE-002,TA-MSG-001,TA-DEVICES-001,TA-DEVICES-002

### voice_direct_routing (22)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/audio-conferencing-with-direct-routing-for-gcch-and-dod | domains=voice_direct_routing | queries=TA-VOICE-003,TA-VOICE-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/cloud-voice-network-settings | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-007,TA-CALL-009
- Planning Teams dial plans for Teams Phone | https://learn.microsoft.com/en-us/microsoftteams/dial-plans-routing-overview | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-003,TA-CALL-002,TA-CALL-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-border-controllers | domains=voice_direct_routing | queries=TA-VOICE-003,TA-VOICE-004,TA-VOICE-005,TA-VOICE-002,TA-VOICE-007
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-configure | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-001,TA-VOICE-003,TA-VOICE-004,TA-CALL-007,TA-CALL-011
- Connect your Session Border Controller (SBC) to Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-connect-the-sbc | domains=voice_direct_routing | queries=TA-VOICE-004,TA-VOICE-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-enable-users | domains=voice_direct_routing | queries=TA-VOICE-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-health-dashboard | domains=voice_direct_routing | queries=TA-VOICE-005,TA-VOICE-006
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-001,TA-CALL-011
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-media-optimization | domains=voice_direct_routing | queries=TA-VOICE-003,TA-VOICE-007
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-media-optimization-configure | domains=voice_direct_routing | queries=TA-VOICE-007
- Plan Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-003,TA-VOICE-004,TA-VOICE-005,TA-VOICE-006,TA-CALL-008,TA-CALL-007
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-media-bypass | domains=voice_direct_routing | queries=TA-VOICE-003,TA-VOICE-004,TA-VOICE-005,TA-VOICE-002,TA-VOICE-007
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-sbc-multiple-tenants | domains=voice_direct_routing | queries=TA-VOICE-004,TA-VOICE-006
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-trunk-failover-on-outbound-call | domains=voice_direct_routing | queries=TA-VOICE-004,TA-VOICE-002
- Configure call routing for Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-001,TA-VOICE-003,TA-CALL-002,TA-VOICE-004,TA-CALL-005,TA-CALL-011
- What's new for Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-whats-new | domains=voice_direct_routing | queries=TA-VOICE-005
- Plan Location-Based Routing for Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/location-based-routing-plan | domains=voice_direct_routing | queries=TA-VOICE-003,TA-VOICE-004,TA-VOICE-002,TA-VOICE-007
- Manage call routing policies for Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/manage-voice-routing-policies | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-001,TA-CALL-002,TA-CALL-005,TA-CALL-011
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-your-network-topology | domains=voice_direct_routing,meetings,voice_calling | queries=TA-VOICE-001,TA-MEET-001,TA-VOICE-007,TA-CALL-009
- Teams settings and policies reference | https://learn.microsoft.com/en-us/microsoftteams/settings-policies-reference | domains=voice_direct_routing,meetings,messaging_teams_management,voice_calling | queries=TA-VOICE-001,TA-MEET-001,TA-MEET-002,TA-MSG-001,TA-MSG-002,TA-CALL-009,TA-CALL-011
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/troubleshoot/phone-system/direct-routing/diagnose-direct-routing-issues | domains=voice_direct_routing | queries=TA-VOICE-006

### voice_calling (32)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-manage-resource-accounts | domains=voice_calling | queries=TA-CALL-001,TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-auto-attendant-cmdlets | domains=voice_calling | queries=TA-CALL-001,TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue | domains=voice_calling | queries=TA-CALL-001,TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-cmdlets | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-priorities | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-template-recording-automatic | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-template-recording-compliance | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-template-shared-history | domains=voice_calling | queries=TA-CALL-003
- On-network Conferencing for Audio Conferencing | https://learn.microsoft.com/en-us/microsoftteams/audio-conferencing-on-network | domains=voice_calling | queries=TA-CALL-011
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/configure-dynamic-emergency-calling | domains=voice_calling | queries=TA-CALL-002,TA-CALL-008,TA-CALL-009
- Emergency calling considerations for Microsoft Calling Plans | https://learn.microsoft.com/en-us/microsoftteams/considerations-calling-plan | domains=voice_calling | queries=TA-CALL-009
- Considerations for Operator Connect | https://learn.microsoft.com/en-us/microsoftteams/considerations-operator-connect | domains=voice_calling | queries=TA-CALL-008
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/cqd-upload-tenant-building-data | domains=voice_calling | queries=TA-CALL-010
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-auto-attendant | domains=voice_calling | queries=TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-call-queue | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/create-and-manage-dial-plans | domains=voice_calling | queries=TA-CALL-002,TA-CALL-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-translate-numbers | domains=voice_calling,voice_direct_routing | queries=TA-CALL-002,TA-VOICE-004,TA-CALL-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-emergency-call-routing-policies | domains=voice_calling | queries=TA-CALL-009
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-phone-numbers-for-your-organization | domains=voice_calling | queries=TA-CALL-006
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-phone-numbers-for-your-organization/contact-tns-service-desk | domains=voice_calling | queries=TA-CALL-006
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-voice-applications-policies | domains=voice_calling | queries=TA-CALL-001
- Improve call quality in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/monitor-call-quality-qos | domains=voice_calling | queries=TA-CALL-010
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/operator-connect-conferencing-configure | domains=voice_calling | queries=TA-CALL-002,TA-CALL-008
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/operator-connect-configure | domains=voice_calling | queries=TA-CALL-002,TA-CALL-008
- Configure Operator Connect for India | https://learn.microsoft.com/en-us/microsoftteams/operator-connect-india-configure | domains=voice_calling | queries=TA-CALL-008
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/operator-connect-mobile-configure | domains=voice_calling | queries=TA-CALL-002,TA-CALL-011
- Submitting a port request | https://learn.microsoft.com/en-us/microsoftteams/phone-number-calling-plans/transfer-phone-numbers-to-teams | domains=voice_calling | queries=TA-CALL-006
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/phone-reference/manage-numbers/contact-tns-service-desk | domains=voice_calling | queries=TA-CALL-006
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/routing-calls-to-unassigned-numbers | domains=voice_calling | queries=TA-CALL-002,TA-CALL-005
- Set up Teams Phone in your organization | https://learn.microsoft.com/en-us/microsoftteams/setting-up-your-phone-system | domains=voice_calling | queries=TA-CALL-008,TA-CALL-007
- Configure Shared Calling | https://learn.microsoft.com/en-us/microsoftteams/shared-calling-setup | domains=voice_calling | queries=TA-CALL-009,TA-CALL-011
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/what-are-emergency-locations-addresses-and-call-routing | domains=voice_calling | queries=TA-CALL-002,TA-CALL-008,TA-CALL-009

### meetings (10)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/configure-desktop-sharing | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/configure-lobby-sensitive-meetings | domains=meetings | queries=TA-MEET-001
- Manage meeting templates in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/manage-meeting-templates | domains=meetings | queries=TA-MEET-002
- Manage Teams meeting auto recording | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-auto-recording | domains=meetings | queries=TA-MEET-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-audio-and-video | domains=meetings,core_admin | queries=TA-MEET-001,TA-CORE-003
- Manage meeting policies for content sharing | https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-content-sharing | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/voice-and-face-recognition | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/voice-recognition | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/voice-isolation | domains=meetings | queries=TA-MEET-001
- IT Admins - Manage lobby options in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/who-can-bypass-meeting-lobby | domains=meetings | queries=TA-MEET-001

### external_collaboration (3)
- Chat, teams, channels, & apps in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/deploy-chat-teams-channels-microsoft-teams-landing-page | domains=external_collaboration,messaging_teams_management | queries=TA-EXT-002,TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/meeting-settings-in-teams | domains=external_collaboration | queries=TA-EXT-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/teams-client-desktop-admin | domains=external_collaboration | queries=TA-EXT-002

### messaging_teams_management (12)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/cloud-voice-landing-page | domains=messaging_teams_management,voice_calling | queries=TA-MSG-002,TA-CALL-008,TA-CALL-007
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/guest-access | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-apps | domains=messaging_teams_management | queries=TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-channel-moderation-in-teams | domains=messaging_teams_management | queries=TA-MSG-001,TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-external-access | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-in-modern-portal | domains=messaging_teams_management | queries=TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-skypeforbusiness-admin-center | domains=messaging_teams_management | queries=TA-MSG-002
- Manage messaging policies in Teams | https://learn.microsoft.com/en-us/microsoftteams/messaging-policies-in-teams | domains=messaging_teams_management | queries=TA-MSG-001,TA-MSG-002
- Plan for lifecycle management in Teams | https://learn.microsoft.com/en-us/microsoftteams/plan-teams-lifecycle | domains=messaging_teams_management | queries=TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/scripts/powershell-script-teams-messaging-policy-edu | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/sms-microsoft-teams-policy | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/voice-and-calling-policies | domains=messaging_teams_management | queries=TA-MSG-001

### devices (16)
- Manage devices in Teams | https://learn.microsoft.com/en-us/microsoftteams/devices/device-management | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/devices/manage-device-tags | domains=devices | queries=TA-DEVICES-002
- The Monitored or Offline status is Unhealthy | https://learn.microsoft.com/en-us/microsoftteams/devices/pmpsignal-unmonitored-offline | domains=devices | queries=TA-DEVICES-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-resource-accounts | domains=devices | queries=TA-DEVICES-003
- Manage Teams phones | https://learn.microsoft.com/en-us/microsoftteams/phones/manage-teams-phones | domains=devices | queries=TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/aboutunifieddevicemanagement-pmp1 | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-002,TA-DEVICES-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/androidupdatemanagementinpmp | domains=devices | queries=TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/enrolling-mtrp-managed-service | domains=devices | queries=TA-DEVICES-004,TA-DEVICES-005
- Health reports in the Teams Management Pro portal | https://learn.microsoft.com/en-us/microsoftteams/rooms/health-reports | domains=devices | queries=TA-DEVICES-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/managed-meeting-rooms-portal | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-005
- Managing settings for Teams devices | https://learn.microsoft.com/en-us/microsoftteams/rooms/pro-portal-settings | domains=devices | queries=TA-DEVICES-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-configure-accounts | domains=devices | queries=TA-DEVICES-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-manage | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-004
- Microsoft Teams Rooms Maintenance and Operations | https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-operations | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-005
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-pro-management | domains=devices | queries=TA-DEVICES-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/surface-hub-manage-config | domains=devices | queries=TA-DEVICES-001

### security_compliance_intersections (0)
- none
## Recommendation For CG-01E2 Input
- Base set: 106 sanitized accepted entries.
- Plus only explicitly human-approved needs_review entries.
- Candidate and excluded queues remain out of scope for initial indexing.

## No-Mutation Confirmation
- No MCP search rerun.
- No Teams Admin indexing/chunking/FTS/embedding operations.
- No PowerShell corpus mutation.

