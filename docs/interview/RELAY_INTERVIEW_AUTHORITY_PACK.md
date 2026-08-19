# Relay Interview Authority Pack (I1)

Status: compiled authority-pack specification and evaluation set  
Verified: 2026-08-16  
Production changes: none  
Dataset: `eval/datasets/interview-authority-i1.jsonl`

## Purpose and boundary

I1 defines a small local-first authority surface for live technical interviews. It does not change R1-R4, WB-21, G1/G2 synthesis, QA Assist, persistence, source authority roles, production routing, or the database.

The pack is an allowlisted view over authoritative documents, not a new general corpus. Existing indexed documents are reused by canonical URL and source ID. Missing documents are explicit refresh/ingestion candidates for a later materialization slice.

The preparation document referenced by the request was not present in the workspace or searchable prior conversation context. Therefore, topic coverage and question shapes in this compilation come only from the explicit I1 request. No model-answer prose was ingested or treated as factual authority. Behavioral and personal-story questions are excluded.

## 1. Prep-topic coverage

| Interview area | Covered question shapes | Dataset IDs |
| --- | --- | --- |
| Teams Voice / Direct Routing | architecture, PSTN models, external-call failure, one-way audio, routing chain, SBC certificates, media bypass, dial plans, number assignment, emergency calling | Q-001–Q-010 |
| Call quality | tool choice, media metrics, individual vs population scope, CQD network data, QoS | Q-011–Q-015 |
| Auto Attendants / Call Queues | design/build, resource accounts, overflow/timeout/voicemail, schedules, agent requirements | Q-016–Q-020 |
| Teams Rooms | room account/calendar, lockout, no audio, fleet management, updates/Intune/Conditional Access | Q-021–Q-025 |
| Teams PowerShell | user voice audit, routing-chain checks, effective assignment state, AA/CQ inspection | Q-026–Q-029 |
| SharePoint / OneDrive / Copilot | pre-rollout governance, Restricted Content Discovery, oversharing reports | Q-030–Q-032 |
| Entra support | sign-in/CA/MFA troubleshooting, smart lockout distinctions | Q-033–Q-034 |
| Linux operator | service logs, text processing, sockets/capture, scheduling | Q-035–Q-038 |
| Trader voice | authority-discovery placeholder only | Q-039 |

## 2. Authority and pack model

| Pack ID | Primary authority | Existing Relay source/role | Treatment |
| --- | --- | --- | --- |
| `teams_voice_direct_routing` | Microsoft Teams Learn | `ms-teams-admin` / `teams_admin_primary` | Reuse indexed pages; add only missing allowlisted pages |
| `call_quality_troubleshooting` | Microsoft Teams Learn | `ms-teams-admin` / `teams_admin_primary` | Mostly missing locally; bounded addition |
| `auto_attendants_call_queues` | Microsoft Teams Learn | `ms-teams-admin` / `teams_admin_primary` | Reuse current AA/CQ pages; refresh licensing page |
| `teams_rooms` | Microsoft Teams Learn | `ms-teams-admin` / `teams_admin_primary` | Reuse management pages; add account, update, and CA pages |
| `teams_powershell_interview_subset` | Microsoft-owned Teams PowerShell docs | `ms-teams-powershell` / `teams_powershell_cmdlet_primary` | Filter existing corpus; no duplicate ingestion |
| `sharepoint_onedrive_copilot_governance` | SharePoint, Copilot, and Purview Learn | `ms-sharepoint-docs` / `sharepoint_admin_primary`; M365/Purview authority remains distinct | Reuse governance pages; add current rollout and Purview pages |
| `entra_identity_support` | Microsoft Entra Learn/GitHub docs | `ms-entra-docs` / `entra_identity_primary` | Filter the existing broad Entra corpus |
| `linux_operator` | Upstream systemd/GNU/iproute2/tcpdump docs | No current production role | Separate future source and authority role |
| `trader_voice_unresolved` | Vendor documentation not yet selected | None | Topic detection only; factual answers fail closed |

An interview pack must not change the authority of a document. The pack is retrieval eligibility metadata layered over the existing source/domain/role contract.

## 3. Selected Microsoft documents

Legend:

- **reuse**: canonical page is already indexed locally.
- **add**: verified current page is absent from the local corpus and is a bounded materialization candidate.
- **reference-only**: retained to identify retirement/supersession; not eligible to answer current-how-to questions.

### A. Teams Voice / Direct Routing

1. **reuse** — [PSTN connectivity options](https://learn.microsoft.com/en-us/microsoftteams/pstn-connectivity)
2. **add** — [Plan Direct Routing](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan)
3. **reuse** — [Session Border Controllers certified for Direct Routing](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-border-controllers)
4. **reuse** — [Connect your Session Border Controller to Direct Routing](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-connect-the-sbc)
5. **add** — [SIP protocol for Direct Routing](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-protocols-sip)
6. **add** — [Direct Routing Health Dashboard](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-health-dashboard)
7. **reuse** — [Plan for media bypass with Direct Routing](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-media-bypass)
8. **reuse** — [Configure call routing for Direct Routing](https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing)
9. **reuse** — [Planning Teams dial plans](https://learn.microsoft.com/en-us/microsoftteams/dial-plans-routing-overview)
10. **reuse** — [Create and manage dial plans](https://learn.microsoft.com/en-us/microsoftteams/create-and-manage-dial-plans)
11. **add** — [Assign, change, or remove a phone number for a user](https://learn.microsoft.com/en-us/microsoftteams/assign-change-or-remove-a-phone-number-for-a-user)
12. **reuse** — [Manage emergency calling](https://learn.microsoft.com/en-us/microsoftteams/what-are-emergency-locations-addresses-and-call-routing)
13. **reuse** — [Plan and configure dynamic emergency calling](https://learn.microsoft.com/en-us/microsoftteams/configure-dynamic-emergency-calling)
14. **add** — [Normalization rules for Teams dial plans](https://learn.microsoft.com/en-us/microsoftteams/phone-normalization-rules)
15. **add** — [Troubleshoot SBC SIP OPTIONS, TLS, and certificate issues](https://learn.microsoft.com/en-us/troubleshoot/microsoftteams/phone-system/direct-routing/sip-options-tls-certificate-issues)

This set establishes the supported SBC role, certificate/CN/SAN and trusted-CA requirements, TLS/SIP behavior, signaling and media paths, routing policy → PSTN usage → route → gateway chain, normalization, phone-number assignment, and emergency-location concepts. Vendor SBC administration remains outside Microsoft authority.

### B. Call Quality / Troubleshooting

1. **add** — [Monitor call quality and QoS](https://learn.microsoft.com/en-us/microsoftteams/monitor-call-quality-qos)
2. **add** — [Monitor and troubleshoot Teams meetings and calls](https://learn.microsoft.com/en-us/microsoftteams/monitor-troubleshoot-teams-meetings-calls)
3. **add** — [Data and reports in Call Quality Dashboard](https://learn.microsoft.com/en-us/microsoftteams/cqd-data-and-reports)
4. **add** — [What is Call Quality Dashboard](https://learn.microsoft.com/en-us/microsoftteams/cqd-what-is-call-quality-dashboard)
5. **add** — [Upload tenant and building data for CQD](https://learn.microsoft.com/en-us/microsoftteams/cqd-upload-tenant-building-data)
6. **add** — [Implement Quality of Service in Microsoft Teams](https://learn.microsoft.com/en-us/microsoftteams/qos-in-teams)
7. **add** — [Manage call and meeting quality](https://learn.microsoft.com/en-us/microsoftteams/quality-of-experience-review-guide)

Primary selection rule: use the current Teams admin-center meeting/call troubleshooting page for individual and in-progress sessions, and CQD for organization/site/population trends. Both `use-call-analytics-to-troubleshoot-poor-call-quality` and `use-real-time-telemetry-to-troubleshoot-poor-meeting-quality` identify themselves as earlier experiences and are excluded from the active pack.

### C. Auto Attendants / Call Queues

1. **reuse** — [Plan Teams Phone Agent, Auto Attendant, and Call Queue](https://learn.microsoft.com/en-us/microsoftteams/aa-cq-plan-overview)
2. **reuse** — [Design call flows](https://learn.microsoft.com/en-us/microsoftteams/aa-cq-design-call-flows)
3. **reuse** — [Set up an Auto Attendant](https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-auto-attendant)
4. **reuse** — [Set up a Call Queue](https://learn.microsoft.com/en-us/microsoftteams/aa-cq-setup-call-queue)
5. **reuse** — [Manage resource accounts](https://learn.microsoft.com/en-us/microsoftteams/aa-cq-manage-resource-accounts)
6. **add** — [AA/CQ prerequisites and licensing](https://learn.microsoft.com/en-us/microsoftteams/aa-cq-reference-prerequisites-licensing)
7. **add** — [Teams Phone Resource Account licensing](https://learn.microsoft.com/en-us/microsoftteams/teams-add-on-licensing/virtual-user)
8. **add** — [Manage Shared Voicemail](https://learn.microsoft.com/en-us/microsoftteams/manage-shared-voicemail)

The pack may use GA Auto Attendant and Call Queue sections. Teams Phone Agent material marked Frontier/Public Preview must not be generalized as GA AA/CQ behavior.

### D. Microsoft Teams Rooms

1. **add** — [Deploy Microsoft Teams Rooms](https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-deploy)
2. **add** — [Create and configure a Teams Rooms resource account](https://learn.microsoft.com/en-us/microsoftteams/rooms/create-resource-account)
3. **add** — [Teams Rooms licenses](https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-licensing)
4. **reuse** — [Manage Microsoft Teams Rooms](https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-manage)
5. **reuse** — [Teams Rooms Pro Management](https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-pro-management)
6. **add** — [Teams Rooms resource-account inventory and status](https://learn.microsoft.com/en-us/microsoftteams/rooms/resource-accounts)
7. **add** — [Teams Rooms update management](https://learn.microsoft.com/en-us/microsoftteams/rooms/update-management)
8. **add** — [Conditional Access and Intune compliance for Teams Rooms](https://learn.microsoft.com/en-us/microsoftteams/rooms/conditional-access-and-compliance-for-devices)
9. **reuse** — [Transition Android device management to Pro Management Portal](https://learn.microsoft.com/en-us/microsoftteams/rooms/aboutunifieddevicemanagement-pmp1)
10. **add** — [Teams Rooms security](https://learn.microsoft.com/en-us/microsoftteams/rooms/security)
11. **add** — [Authentication in Teams Rooms on Windows](https://learn.microsoft.com/en-us/microsoftteams/rooms/rooms-authentication)
12. **reuse** — [Manage settings in Pro Management Portal](https://learn.microsoft.com/en-us/microsoftteams/rooms/pro-portal-settings)
13. **add** — [Teams Rooms health signals](https://learn.microsoft.com/en-us/microsoftteams/rooms/signals)
14. **add** — [Teams Rooms events](https://learn.microsoft.com/en-us/microsoftteams/rooms/view-events)
15. **add** — [Troubleshoot Teams Rooms resource-account sign-in](https://learn.microsoft.com/en-us/troubleshoot/microsoftteams/teams-rooms-and-devices/teams-rooms-resource-account-sign-in-issues)

`create-resource-account` is the authority for the Exchange room mailbox and `Set-CalendarProcessing` relationship. Exchange-wide administration is not added.

### E. Teams PowerShell interview subset

All entries already exist in `ms-teams-powershell`; the pack selects them by canonical cmdlet title/path:

1. [Get-CsOnlineUser](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlineuser)
2. [Set-CsPhoneNumberAssignment](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/set-csphonenumberassignment)
3. [Get-CsOnlineVoiceRoutingPolicy](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlinevoiceroutingpolicy)
4. [Get-CsOnlinePstnUsage](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlinepstnusage)
5. [Get-CsOnlineVoiceRoute](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlinevoiceroute)
6. [Get-CsOnlinePSTNGateway](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlinepstngateway)
7. [Get-CsTenantDialPlan](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-cstenantdialplan)
8. [Get-CsEffectiveTenantDialPlan](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-cseffectivetenantdialplan)
9. [Get-CsTeamsCallingPolicy](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csteamscallingpolicy)
10. [Get-CsOnlineApplicationInstance](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csonlineapplicationinstance)
11. [Get-CsAutoAttendant](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-csautoattendant)
12. [Get-CsCallQueue](https://learn.microsoft.com/en-us/powershell/module/microsoftteams/get-cscallqueue)

There is no verified `Get-CsTeamsDevice` or `Get-CsTeamsRoom` document in the current Teams PowerShell corpus. Teams Rooms reporting must use Teams Rooms/admin authority unless a specific supported API or cmdlet is later verified.

### F. SharePoint / OneDrive / Microsoft 365 Copilot governance

1. **add** — [Get ready for Copilot with SharePoint Advanced Management](https://learn.microsoft.com/en-us/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management)
2. **reuse** — [Data access governance reports](https://learn.microsoft.com/en-us/sharepoint/data-access-governance-reports)
3. **reuse** — [Site permissions snapshot report](https://learn.microsoft.com/en-us/sharepoint/data-access-governance-site-permissions-report)
4. **reuse** — [Sharing links activity reports](https://learn.microsoft.com/en-us/sharepoint/data-access-governance-sharing-links-report)
5. **reuse** — [What is SharePoint Advanced Management](https://learn.microsoft.com/en-us/sharepoint/advanced-management)
6. **add** — [Restricted Access Control for SharePoint sites](https://learn.microsoft.com/en-us/sharepoint/restricted-access-control)
7. **reuse** — [Restricted Content Discovery](https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery)
8. **add** — [Data, privacy, and security for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-privacy)
9. **add** — [Microsoft Purview protections for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/purview/ai-m365-copilot)

Restricted Content Discovery is a temporary site-level discoverability control; it does not change existing permissions and does not support OneDrive. Copilot permission-boundary claims come from Copilot/M365 authority, not merely from a SharePoint page mentioning Copilot.

### G. Entra / Identity support

1. **add** — [Troubleshoot sign-in errors](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-troubleshoot-sign-in-errors)
2. **add** — [Use the sign-in diagnostic](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-use-sign-in-diagnostics)
3. **reuse** — [Troubleshoot Conditional Access](https://learn.microsoft.com/en-us/entra/identity/conditional-access/troubleshoot-conditional-access)
4. **reuse** — [Microsoft Entra multifactor authentication overview](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-mfa-howitworks)
5. **reuse** — [Microsoft Entra smart lockout](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-password-smart-lockout)
6. **reuse** — [Teams administrator roles](https://learn.microsoft.com/en-us/microsoftteams/using-admin-roles)

This pack supports diagnosis, not broad identity architecture. It excludes application development, External ID families, workload identity design, entitlement management, and device-registration material unrelated to the interview scenarios.

## 4. Freshness and deprecation decisions

The selected pages were resolved on Microsoft Learn on 2026-08-16. The existing Teams/SharePoint Learn acquisition did not persist page-level `updated_date`, so “verified” means the canonical page rendered and its current notices were inspected; it does not invent an unavailable date.

| Topic | Current decision |
| --- | --- |
| Restricted SharePoint Search | Retiring. New enablement blocked starting 2026-07-31. Keep only as reference-only retirement evidence; use Restricted Content Discovery and broader governance controls for current answers. |
| Restricted Content Discovery | Current control. Describe as temporary/selective, SharePoint-site-only, and permissions-preserving. |
| Teams call-quality admin experience | Use `monitor-troubleshoot-teams-meetings-calls`. Exclude the older Call Analytics and Real-Time Analytics experience pages as primary guidance because both identify themselves as superseded. |
| CQD | Current and actively updated; the page includes 2026 schema/interface changes. |
| AA/CQ outbound PSTN | Honor the licensing change effective 2025-11-01. Do not repeat older resource-account outbound-calling guidance without the current prerequisites page. |
| Teams Phone Agent | Preview-specific statements remain preview and cannot establish GA Auto Attendant/Call Queue behavior. |
| Teams Rooms Android management | Transition to Teams Rooms Pro Management Portal is active in August 2026; overlapping Teams admin-center workflows are scheduled for decommissioning in September 2026. |
| Teams Rooms updates | Prefer Pro Management Portal-supported firmware/application updates; avoid generic manual-update advice. |
| Entra sign-in/CA | Selected local Entra documents show 2025–2026 update dates, including Conditional Access updates in March 2026 and smart-lockout guidance in June 2026. |

Freshness spot checks from live Learn metadata: PSTN connectivity `ms.date` 2026-07-31; phone-number management 2026-05-28; Restricted Access Control 2026-07-30; Teams Rooms licensing 2026-08-14.

AA/CQ pages currently expose anomalous future-dated `ms.date` values of 2026-08-31 while their observed revisions predate this verification. Treat the live revision and feature-status notices as authoritative, and record the date anomaly during refresh. The older Pro Management overview also has stale region text; newer Android-transition guidance controls portal/end-point availability claims.

Refresh acceptance must reject a selected page if:

1. the canonical URL no longer resolves;
2. Learn marks it retired, deprecated, or replaced;
3. its active guidance points to a successor page;
4. a preview-only feature is required for a GA claim;
5. the page's authority no longer matches the pack role.

## 5. Current corpus reuse and projected size

Current corpus at compilation:

| Source | Documents | Chunks | Embedded chunks |
| --- | ---: | ---: | ---: |
| `ms-teams-admin` | 101 | 2,056 | 2,056 |
| `ms-teams-powershell` | 622 | 15,026 | 15,026 |
| `ms-sharepoint-docs` | 16 | 230 | 230 |
| `ms-sharepoint-powershell` | 33 | 1,415 | 1,415 |
| `ms-entra-docs` | 658 | 11,189 | 11,187 |
| `ms-powershell-core` | 4 | 355 | 355 |

Compiled Microsoft allowlist:

- 72 document references: 60 conceptual/admin/governance pages plus 12 Teams PowerShell cmdlet pages.
- 39 are already local: 27 conceptual/admin pages plus all 12 cmdlet pages.
- Reused selected chunks: 838.
- 33 verified pages require bounded materialization.
- Expected new chunks: approximately 480–690 at current chunking density.
- Expected complete Microsoft interview pack: approximately 1,320–1,530 chunks.

This is about 4% of the current 1,434-document corpus and is small enough to use as a first-pass candidate population.

No documents were downloaded or indexed in I1. “Actual” pack size therefore remains 39 reusable local documents / 838 chunks until a later materialization run.

## 6. Linux operator supplemental pack

Linux authority must remain separate from Microsoft roles. Recommended future source role: `linux_upstream_primary`, scoped only to `linux_operator`.

Selected upstream pages:

1. [systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)
2. [journalctl](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html)
3. [systemd.timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
4. [systemd.time](https://www.freedesktop.org/software/systemd/man/latest/systemd.time.html)
5. [GNU grep manual](https://www.gnu.org/software/grep/manual/grep.html)
6. [GNU awk manual](https://www.gnu.org/software/gawk/manual/gawk.html)
7. [GNU sed manual](https://www.gnu.org/software/sed/manual/sed.html)
8. [GNU sort](https://www.gnu.org/software/coreutils/manual/html_node/sort-invocation.html)
9. [GNU uniq](https://www.gnu.org/software/coreutils/manual/html_node/uniq-invocation.html)
10. [crontab(5)](https://www.man7.org/linux/man-pages/man5/crontab.5.html)
11. [cron(8)](https://www.man7.org/linux/man-pages/man8/cron.8.html)
12. [ss(8)](https://www.man7.org/linux/man-pages/man8/ss.8.html)
13. [tcpdump 4.99.6](https://www.tcpdump.org/manpages/tcpdump.1-4.99.6.html)
14. [libpcap capture-filter grammar](https://www.tcpdump.org/manpages/libpcap-1.10.6/pcap-filter.7.txt)

Version caveat: systemd and utility options vary by installed distribution/version. The pack may explain stable basics but must not claim every documented latest option exists on the interviewer's host. The tcpdump/libpcap links are pinned because the unversioned tcpdump page follows development content.

## 7. Trader voice unresolved topics

Topic aliases may detect:

- turret systems;
- hoots/shouts;
- ringdowns;
- compliance recording;
- market-hours change control.

No factual pack is authorized. Before answering platform-specific behavior, Relay needs vendor/platform/model, deployment architecture, recording platform, market/jurisdiction, and change-control context. Until then, the only safe answer is a short clarification framework. The dataset's Q-039 enforces this fail-closed boundary.

## 8. Evaluation question bank

`eval/datasets/interview-authority-i1.jsonl` contains 39 technical interview questions. Every record preserves the existing additive JSONL schema and adds:

- `interviewTopic`;
- `expectedAuthorityPack`;
- `answerType`;
- `liveQuickTargetWords`;
- required concepts;
- prohibited unsupported claims;
- known source hints.

Behavioral questions and personal-story scoring are absent. Linux records explicitly expect the future supplemental pack. Trader voice expects unresolved vendor authority rather than a factual answer.

## 9. Proposed Interview Quick retrieval scope

Plan only:

1. Extract the existing deterministic query intent.
2. Match an interview topic using a small alias map derived from the dataset.
3. Restrict eligible documents to that pack's canonical-URL allowlist while preserving current domains, authority roles, source status, and method constraints.
4. Run existing exact, lexical, semantic, fusion, R2-R4, and WB-21 unchanged.
5. If mandatory aspects remain unsupported, run one broad-corpus fallback with the original domain scope.
6. Render the existing deterministic Live Quick result; cloud synthesis policy is outside I1.

The smallest implementation seam is a pack manifest that resolves to existing `(source_id, canonical_url)` pairs and contributes an additional SQL document predicate. It does not require a new database, ANN index, authority taxonomy, or routing framework.

Fallback must not silently combine unrelated targeted and broad evidence. The ordinary authority, aspect, and multi-span binding contracts continue to decide support.

## 10. Expected latency benefit

This is an estimate, not an I1 benchmark:

- The current exact workflow scopes 17,437 eligible chunks, returns 2,400 lexical candidates, and scores 1,300 semantic candidates.
- Narrow conceptual domains measured about 1,645–2,056 eligible chunks and 1.7–2.1 seconds hybrid retrieval.
- The completed interview pack is projected at roughly 1,320–1,530 total Microsoft chunks, with individual topic packs much smaller.

The working hypothesis is:

- semantic SQL/preselection for a matched pack falls below roughly 300 ms;
- ordinary conceptual/troubleshooting hybrid retrieval falls into roughly 0.6–1.5 seconds warm;
- multi-output workflow questions remain slower because exact-directive fan-out is independent of corpus size.

No latency improvement is claimed until the manifest filter is implemented and benchmarked. I1 does not change production retrieval.

## 11. Before-interview refresh strategy

Before an interview:

1. fetch only the selected manifest URLs/repository paths;
2. record canonical URL, retrieval timestamp, source revision/ETag where available, Learn update metadata, and status notice;
3. reject redirects outside the approved Microsoft product path;
4. compare content hashes and re-index only changes;
5. verify all selected chunks have compatible embeddings;
6. emit a pack report listing missing, retired, preview, changed, and reused pages;
7. run the 39-question dataset locally.

During an interview:

- local pack first;
- no Learn/GitHub network dependency;
- broad local corpus only on a targeted-pack evidence miss.

Future, not I1: Microsoft Learn MCP may be considered as an authoritative miss fallback. It must not become a query-time dependency for common questions.

## 12. Explicit gaps

- The referenced preparation document itself was unavailable.
- Microsoft documentation cannot establish employer-specific topology, tenant configuration, carrier behavior, SBC-vendor operations, or incident history.
- Direct Routing certificate installation/renewal steps are SBC-vendor-specific.
- Emergency-calling legal and regulatory obligations require jurisdiction-specific authority.
- Teams Rooms hardware recovery and firmware behavior may require OEM authority.
- No supported Teams PowerShell Rooms-reporting cmdlet was verified in the current corpus.
- Linux commands need platform/version context.
- Trader voice needs named vendor authority.
- Interview coaching, behavioral stories, and claims about the candidate's personal experience are outside factual grounding.

## 13. Explicit exclusions

- Whole Microsoft repositories or product families.
- Teams developer/app-platform content.
- Broad Exchange administration.
- Broad Entra identity platform/application development.
- SharePoint development/SPFx.
- General Purview, compliance, eDiscovery, retention, or DLP content beyond direct Copilot/SharePoint relevance.
- Teams Phone Agent preview claims as GA AA/CQ facts.
- Vendor SBC configuration manuals.
- Generic trader-voice facts.
- Tenant execution, remediation, or write workflows.
- Query-time MCP fallback.
- Production routing, database, audio/STT, persistence, synthesis, R1-R4, or WB-21 changes.

