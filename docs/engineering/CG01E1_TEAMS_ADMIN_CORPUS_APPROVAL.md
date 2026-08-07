# CG-01E1.1 Teams Admin Corpus Approval Gate

SANITIZED PROPOSED INITIAL TEAMS ADMIN CORPUS
Accepted: 76
Needs human decision: 11
Candidates deferred: 73
Excluded: 210
Removed from automatic acceptance as non-article assets: 26

## Scope
- Source manifest: `eval/runs/discovery/cg01e1-2026-08-07T18-55-12-407Z.json`
- Sanitized manifest run: `cg01e1s-2026-08-07T19-08-55-854Z`
- No discovery rerun and no corpus indexing occurred in this pass.

## Approval Set
- Automatically proposed for approval: 76 sanitized accepted entries.
- Human-decision queue: 11 sanitized needs_review entries (listed individually below).
- Candidate queue (deferred): 73 entries.
- Excluded queue: 210 entries.

## Coverage Assessment
- core_admin: adequate
- voice_direct_routing: adequate
- voice_calling: strong
- meetings: adequate
- external_collaboration: weak
- messaging_teams_management: strong
- devices: adequate
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
- security_compliance_intersections: accepted=0, needs_review=1, candidate=2, excluded=45
- Zero accepted appears consistent with authority boundaries (Entra/Intune/Purview/M365 often primary for those controls).

## Accepted Entries Requiring Human Reconsideration
- None flagged by deterministic metadata checks.

## Human-Review Queue (All needs_review Entries)
- ta-e29b4f89732a6c7b
  - title: Manage the Approvals app in Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/approval-admin
  - taxonomy_domains: security_compliance_intersections
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-7250acae638929e4
  - title: Overview of custom meeting templates in Microsoft Teams
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/custom-meeting-templates-overview
  - taxonomy_domains: meetings
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
- ta-bd9043cb48505a35
  - title: Plan for Operator Connect Conferencing
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/operator-connect-conferencing-plan
  - taxonomy_domains: voice_calling
  - why_review: needs_review_cross_product_authority
  - recommendation: EXCLUDE
  - rationale: Cross-product authority hints suggest primary ownership is outside Teams Admin.
- ta-61f265890ab647a7
  - title: Configure Operator Connect
  - canonical_url: https://learn.microsoft.com/en-us/microsoftteams/operator-connect-configure
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

## Candidate Queue Summary (Deferred)
- core_admin: 10
- voice_direct_routing: 4
- voice_calling: 20
- meetings: 17
- external_collaboration: 11
- messaging_teams_management: 11
- devices: 11
- security_compliance_intersections: 2

## Excluded Summary
- Excluded total: 210
- excluded_unrelated_namespace: 141
- excluded_non_article_asset: 46
- excluded_developer_material: 15
- excluded_marketing_content: 6
- excluded_end_user_help: 2

## Accepted Corpus Review (Grouped by Primary Domain)
### core_admin (9)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-manage-voice-applications-policies | domains=core_admin,voice_calling | queries=TA-CORE-002,TA-CALL-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/easy-policy-setup-edu | domains=core_admin | queries=TA-CORE-001
- Managing policy packages in Teams | https://learn.microsoft.com/en-us/microsoftteams/manage-policy-packages | domains=core_admin,messaging_teams_management | queries=TA-CORE-001,TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-queues-app | domains=core_admin,voice_calling | queries=TA-CORE-002,TA-CALL-001,TA-CALL-003
- Manage Teams with policies | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-with-policies | domains=core_admin,messaging_teams_management | queries=TA-CORE-001,TA-MSG-001
- Manage meeting and events policies in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview | domains=core_admin,meetings,messaging_teams_management | queries=TA-CORE-001,TA-MEET-001,TA-MSG-001,TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/policy-assignment-overview | domains=core_admin,voice_direct_routing,voice_calling,meetings | queries=TA-CORE-001,TA-VOICE-001,TA-CALL-001,TA-MEET-001
- Manage channel policies in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/teams-policies | domains=core_admin,messaging_teams_management,external_collaboration | queries=TA-CORE-001,TA-MSG-001,TA-EXT-002,TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/using-admin-roles | domains=core_admin,messaging_teams_management,devices | queries=TA-CORE-002,TA-MSG-001,TA-DEVICES-001,TA-DEVICES-002

### voice_direct_routing (12)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/audio-conferencing-with-direct-routing-for-gcch-and-dod | domains=voice_direct_routing | queries=TA-VOICE-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/cloud-voice-landing-page | domains=voice_direct_routing,messaging_teams_management | queries=TA-VOICE-003,TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-border-controllers | domains=voice_direct_routing | queries=TA-VOICE-002,TA-VOICE-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-configure | domains=voice_direct_routing | queries=TA-VOICE-001,TA-VOICE-003
- Connect your Session Border Controller (SBC) to Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-connect-the-sbc | domains=voice_direct_routing | queries=TA-VOICE-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-landing-page | domains=voice_direct_routing | queries=TA-VOICE-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-media-bypass | domains=voice_direct_routing | queries=TA-VOICE-002,TA-VOICE-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-trunk-failover-on-outbound-call | domains=voice_direct_routing | queries=TA-VOICE-002
- Configure call routing for Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-001,TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/location-based-routing-plan | domains=voice_direct_routing | queries=TA-VOICE-002
- Manage call routing policies for Direct Routing | https://learn.microsoft.com/en-us/microsoftteams/manage-voice-routing-policies | domains=voice_direct_routing,voice_calling | queries=TA-VOICE-001,TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-your-network-topology | domains=voice_direct_routing,meetings | queries=TA-VOICE-001,TA-MEET-001

### voice_calling (21)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-manage-resource-accounts | domains=voice_calling | queries=TA-CALL-004
- Plan - Overview of Teams Phone Agent, Auto Attendant, and Call Queue | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-plan-overview | domains=voice_calling | queries=TA-CALL-001,TA-CALL-003
- Set up Teams Phone Agent, Auto Attendant, and Call Queue Authorized Users | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-authorized-users | domains=voice_calling | queries=TA-CALL-001,TA-CALL-003,TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-auto-attendant | domains=voice_calling | queries=TA-CALL-001,TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-auto-attendant-cmdlets | domains=voice_calling | queries=TA-CALL-001,TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue | domains=voice_calling | queries=TA-CALL-001,TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-cmdlets | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-priorities | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-recording-automatic | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-recording-compliance | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue-shared-history | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/configure-dynamic-emergency-calling | domains=voice_calling | queries=TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-auto-attendant | domains=voice_calling | queries=TA-CALL-004
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/create-a-phone-system-call-queue | domains=voice_calling | queries=TA-CALL-003
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/create-and-manage-dial-plans | domains=voice_calling | queries=TA-CALL-002
- Planning Teams dial plans for Teams Phone | https://learn.microsoft.com/en-us/microsoftteams/dial-plans-routing-overview | domains=voice_calling | queries=TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-translate-numbers | domains=voice_calling | queries=TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/operator-connect-conferencing-configure | domains=voice_calling | queries=TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/operator-connect-mobile-configure | domains=voice_calling | queries=TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/routing-calls-to-unassigned-numbers | domains=voice_calling | queries=TA-CALL-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/what-are-emergency-locations-addresses-and-call-routing | domains=voice_calling | queries=TA-CALL-002

### meetings (11)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/configure-desktop-sharing | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/configure-lobby-sensitive-meetings | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-email-communications | domains=meetings | queries=TA-MEET-002
- Manage meeting templates in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/manage-meeting-templates | domains=meetings | queries=TA-MEET-002
- Manage Teams meeting auto recording | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-auto-recording | domains=meetings | queries=TA-MEET-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-audio-and-video | domains=meetings | queries=TA-MEET-001
- Manage meeting policies for content sharing | https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-content-sharing | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/voice-and-face-recognition | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/voice-recognition | domains=meetings | queries=TA-MEET-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/voice-isolation | domains=meetings | queries=TA-MEET-001
- IT Admins - Manage lobby options in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/who-can-bypass-meeting-lobby | domains=meetings | queries=TA-MEET-001

### external_collaboration (3)
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-external-access | domains=external_collaboration,messaging_teams_management | queries=TA-EXT-001,TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/meeting-settings-in-teams | domains=external_collaboration | queries=TA-EXT-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/teams-client-desktop-admin | domains=external_collaboration | queries=TA-EXT-002

### messaging_teams_management (10)
- Chat, teams, channels, & apps in Microsoft Teams | https://learn.microsoft.com/en-us/microsoftteams/deploy-chat-teams-channels-microsoft-teams-landing-page | domains=messaging_teams_management,external_collaboration | queries=TA-MSG-001,TA-EXT-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/guest-access | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-apps | domains=messaging_teams_management | queries=TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-channel-moderation-in-teams | domains=messaging_teams_management | queries=TA-MSG-001,TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-teams-skypeforbusiness-admin-center | domains=messaging_teams_management | queries=TA-MSG-002
- Manage messaging policies in Teams | https://learn.microsoft.com/en-us/microsoftteams/messaging-policies-in-teams | domains=messaging_teams_management | queries=TA-MSG-001,TA-MSG-002
- Plan for lifecycle management in Teams | https://learn.microsoft.com/en-us/microsoftteams/plan-teams-lifecycle | domains=messaging_teams_management | queries=TA-MSG-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/scripts/powershell-script-teams-messaging-policy-edu | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/sms-microsoft-teams-policy | domains=messaging_teams_management | queries=TA-MSG-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/voice-and-calling-policies | domains=messaging_teams_management | queries=TA-MSG-001

### devices (10)
- Manage devices in Teams | https://learn.microsoft.com/en-us/microsoftteams/devices/device-management | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/devices/manage-device-tags | domains=devices | queries=TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/manage-feedback-policies-in-teams | domains=devices | queries=TA-DEVICES-001
- Manage Teams phones | https://learn.microsoft.com/en-us/microsoftteams/phones/manage-teams-phones | domains=devices | queries=TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/aboutunifieddevicemanagement-pmp1 | domains=devices | queries=TA-DEVICES-001,TA-DEVICES-002
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/managed-meeting-rooms-portal | domains=devices | queries=TA-DEVICES-001
- Managing settings for Teams devices | https://learn.microsoft.com/en-us/microsoftteams/rooms/pro-portal-settings | domains=devices | queries=TA-DEVICES-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-manage | domains=devices | queries=TA-DEVICES-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-pro-management | domains=devices | queries=TA-DEVICES-001
- (untitled) | https://learn.microsoft.com/en-us/microsoftteams/rooms/surface-hub-manage-config | domains=devices | queries=TA-DEVICES-001

### security_compliance_intersections (0)
- none
## Recommendation For CG-01E2 Input
- Base set: 76 sanitized accepted entries.
- Plus only explicitly human-approved needs_review entries.
- Candidate and excluded queues remain out of scope for initial indexing.

## No-Mutation Confirmation
- No MCP search rerun.
- No Teams Admin indexing/chunking/FTS/embedding operations.
- No PowerShell corpus mutation.

