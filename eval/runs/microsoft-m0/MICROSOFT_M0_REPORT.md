# PHASE M0 — Microsoft Learn Retrieval Comparison

Isolated retrieval benchmark. No integration. No local-engine changes. No A0.x continuation.

**Verdict (one choice):**

### B. MICROSOFT USEFUL FOR COVERAGE ONLY

Microsoft is valuable for corpus discovery/freshness but not runtime retrieval.

Microsoft did not find a Teams Direct Routing one-way-audio runbook (M01 kill test). Natural-language PowerShell search missed `Get-CsOnlineUser` (M04), which frozen R0.4 HIGH routing already supplies. Microsoft does surface current Copilot governance articles that are absent from the local corpus (M03). That is coverage value, not a Tier-2 rescue path.

---

## Safety

Recorded before grading. Frozen hashes re-checked after the run.

| Item | Value |
|---|---|
| Working directory (benchmark run) | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| learn-rag project path | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| Relay workspace | `C:\Users\joegc\projects\meeting-agent` |
| Relay branch | `cursor/msteams-docs-knowledge-base` (dirty I2–I4 `src/` from prior work; **not modified by M0**) |
| learn-rag git | `master` (untracked eval-only M0/A0 scripts; **`service/search.py` and `service/scope_select.py` unchanged**) |
| Frozen R0.4 retrieval | **Not changed** |
| Relay production source | **Not changed by this phase** |
| R0–R0.5 / A0–A0.4 artifacts | **Preserved** (untouched under `eval/runs/retrieval-r0*` and `eval/runs/answer-a0*`) |
| Corpus / embeddings / HNSW / FTS | **Not changed** |
| Frozen ground truth | **Not overwritten** |

Frozen SHA-256 prefixes (must still match):

- `service/search.py` `8702daf1ee2b2843`
- `service/scope_select.py` `2a8caaabd00f4b08`
- `eval/ground_truth/priority14_retrieval.json` `59f6572dc5f3d3d5`

`frozen_ok: true` in `results.json`.

No confidence-floor trigger was implemented. No Microsoft MCP/CLI was wired into Relay.

Eval-only harness used: `learn-rag/eval/run_m0.py` (does not import production Relay). On Windows, Python `subprocess` cannot launch bare `npx` (WinError 2); the harness used `npx.cmd`.

---

## 1. CLI / version verification

`npx @microsoft/learn-cli` **works**. Did not stop. Did not build a custom MCP client.

| Field | Actual |
|---|---|
| Package | `@microsoft/learn-cli` |
| Version | `0.1.0` |
| Unpacked size | 42,528 bytes (17 files) |
| Tarball | `https://registry.npmjs.org/@microsoft/learn-cli/-/learn-cli-0.1.0.tgz` |
| Binary name | `mslearn` |
| Commands | `search`, `fetch`, `code-search`, `doctor`, `help` |
| Search JSON | **Yes** (`search <query> --json`) |
| Fetch full page | **Yes** (`fetch <url>`) |
| Fetch named section | **Yes** (`fetch <url> --section "<heading>"`) |
| Auth | **None** (`doctor` MCP connected without credentials) |
| Endpoint | `https://learn.microsoft.com/api/mcp` |
| Tools discovered | `microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search` |
| `doctor` reachability | HTTP **405** (GET against MCP POST endpoint; still reported `ok`) |
| Node runtime seen by doctor | 24.11.1, supported |

JSON search shape (verified): `{ "results": [ { "title", "content", "contentUrl" } ] }`. Typically 10 hits. `content` is a long markdown snippet. URLs often include `#section` fragments.

Search does **not** stream a first-hit timestamp. First-result availability is the same instant as full search complete.

---

## 2. Actual search / fetch commands used

Exact questions. No query rewrite. No hints.

```text
npx.cmd --yes @microsoft/learn-cli search "<question>" --json
npx.cmd --yes @microsoft/learn-cli fetch <url>
npx.cmd --yes @microsoft/learn-cli fetch <url> --section "<heading>"
```

Local control (unchanged R0.4):

```text
question → automatic HIGH/NONE router → frozen hybrid retrieval → top 5 parents
```

Raw run: `eval/runs/microsoft-m0/results.json`. Fetches: `eval/runs/microsoft-m0/fetches/`.

---

## 3. Local top-5 for M01–M06 (frozen R0.4 control)

### M01 — one-way audio

Question: How would you troubleshoot one-way audio on a Teams Direct Routing call?

- Route/scope: **GLOBAL** / NONE (`no high-confidence corpus cue`)
- Router: 101 ms · Retrieval: **182 ms**
- GT: Q03 **SOURCE_GAP**

| Rank | Title | Section | URL | matched_by |
|---|---|---|---|---|
| 1 | Audio Conferencing with Direct Routing, GCC High and DoD | Deploy Audio Conferencing with Direct Routing for GCC High and DoD | https://learn.microsoft.com/microsoftteams/audio-conferencing-with-direct-routing-for-gcch-and-dod | vector, lexical |
| 2 | Plan Direct Routing | Licensing and other requirements | https://learn.microsoft.com/microsoftteams/direct-routing-plan | vector, lexical |
| 3 | Issues that affect inbound Direct Routing calls | No ringback tone when Teams receives a call from a PSTN endpoint | https://learn.microsoft.com/troubleshoot/microsoftteams/phone-system/direct-routing/issues-with-inbound-calls | vector, lexical |
| 4 | Plan Direct Routing | Overview | https://learn.microsoft.com/microsoftteams/direct-routing-plan | vector, lexical |
| 5 | Audio Conferencing with Direct Routing, GCC High and DoD | Audio Conferencing capabilities not supported… | https://learn.microsoft.com/microsoftteams/audio-conferencing-with-direct-routing-for-gcch-and-dod | vector, lexical |

Same A0 Q03 neighbor packet: Audio Conferencing, licensing, inbound ringback.

### M02 — routing chain

Question: Explain the Direct Routing chain from voice-routing policy to PSTN usage to voice route to SBC/gateway.

- Route/scope: **GLOBAL** / NONE
- Router: 13 ms · Retrieval: **342 ms**
- GT: Q04 `Configure call routing for Direct Routing` / **Call routing overview**

| Rank | Title | Section | URL | matched_by |
|---|---|---|---|---|
| 1 | Direct Routing - Connecting analog devices | Step 4: Assign the voice route to the PSTN usage: | https://learn.microsoft.com/microsoftteams/direct-routing-analog-devices | vector, lexical |
| 2 | Configure call routing for Direct Routing | Example 1: Configuration steps | https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing | vector, lexical |
| 3 | Configure call routing for Direct Routing | **Call routing overview** | https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing | vector, lexical |
| 4 | Configure call routing for Direct Routing | Example 2: Configuration steps | https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing | vector, lexical |
| 5 | Direct Routing - Connecting analog devices | Step 3: Create a voice route and associate it with the PSTN usage | https://learn.microsoft.com/microsoftteams/direct-routing-analog-devices | vector, lexical |

### M03 — Copilot governance

Question: What would you secure or review in SharePoint and OneDrive before rolling out Microsoft 365 Copilot?

- Route/scope: **GLOBAL** / NONE (`Copilot spans SharePoint and microsoft-365; leave global`)
- Router: 10 ms · Retrieval: **213 ms**
- GT: Q13 SAM how-to (Overview / Steps 1–3). Step 5 backup is **not** acceptable.

| Rank | Title | Section | URL | matched_by |
|---|---|---|---|---|
| 1 | Roll out SharePoint and OneDrive | Overview | https://learn.microsoft.com/sharepoint/roll-out-sharepoint-onedrive | vector, lexical |
| 2 | Plan for SharePoint and OneDrive in Microsoft 365 | Overview | https://learn.microsoft.com/sharepoint/plan-for-sharepoint-onedrive | vector, lexical |
| 3 | Get ready for Microsoft 365 Copilot with SharePoint Advanced Management | Step 5: Implement backup and restore procedures | https://learn.microsoft.com/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management | vector, lexical |
| 4 | Roll out SharePoint and OneDrive | Pilot rollout of SharePoint and OneDrive | https://learn.microsoft.com/sharepoint/roll-out-sharepoint-onedrive | vector, lexical |
| 5 | Get ready for Microsoft 365 Copilot with SharePoint Advanced Management | **Step 3: Prevent accidental oversharing** | https://learn.microsoft.com/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management | vector, lexical |

### M04 — Teams Voice PowerShell audit

Question: How would you use PowerShell to audit Teams Voice users and their voice configuration?

- Route/scope: **SCOPED** `msteams-ps` / HIGH (`explicit PowerShell token`)
- Router: 10 ms · Retrieval: **310 ms**
- GT: Q14 `Get-CsOnlineUser`

| Rank | Title | Section | URL | matched_by |
|---|---|---|---|---|
| 1 | Get-CsOnlineVoiceRoutingPolicy | Get-CsOnlineVoiceRoutingPolicy | https://learn.microsoft.com/powershell/module/microsoftteams/get-csonlinevoiceroutingpolicy | vector, lexical |
| 2 | **Get-CsOnlineUser** | Get-CsOnlineUser | https://learn.microsoft.com/powershell/module/microsoftteams/get-csonlineuser | vector, lexical |
| 3 | Get-CsOnlineVoiceRoute | Get-CsOnlineVoiceRoute | https://learn.microsoft.com/powershell/module/microsoftteams/get-csonlinevoiceroute | vector, lexical |
| 4 | Get-CsTeamsCallingPolicy | Get-CsTeamsCallingPolicy | https://learn.microsoft.com/powershell/module/microsoftteams/get-csteamscallingpolicy | vector, lexical |
| 5 | Get-CsAutoAttendant | Get-CsAutoAttendant | https://learn.microsoft.com/powershell/module/microsoftteams/get-csautoattendant | vector, lexical |

### M05 — SBC certificate

Question: How would you renew or replace an SBC certificate used for Teams Direct Routing?

- Route/scope: **GLOBAL** / NONE
- Router: 10 ms · Retrieval: **182 ms**
- GT: Q05 Plan Direct Routing / **Public trusted certificate for the SBC**

| Rank | Title | Section | URL | matched_by |
|---|---|---|---|---|
| 1 | SBC connectivity issues | Overview of the SIP options process | https://learn.microsoft.com/troubleshoot/microsoftteams/phone-system/direct-routing/sip-options-tls-certificate-issues | vector, lexical |
| 2 | Plan Direct Routing | **Public trusted certificate for the SBC** | https://learn.microsoft.com/microsoftteams/direct-routing-plan | vector, lexical |
| 3 | What's New Direct Routing | Validation test that switches … certificates issued by a new CA | https://learn.microsoft.com/microsoftteams/direct-routing-whats-new | vector, lexical |
| 4 | What's New Direct Routing | Update on upcoming certificate changes | https://learn.microsoft.com/microsoftteams/direct-routing-whats-new | vector, lexical |
| 5 | What's New Direct Routing | Testing endpoint for upcoming certificate changes | https://learn.microsoft.com/microsoftteams/direct-routing-whats-new | vector, lexical |

### M06 — CQD vs per-call

Question: What is the difference between Call Quality Dashboard and per-user/per-call troubleshooting, and when would you use each?

- Route/scope: **GLOBAL** / NONE
- Router: 12 ms · Retrieval: **247 ms**
- GT: Q12 both CQD overview article **and** Call Analytics article

| Rank | Title | Section | URL | matched_by |
|---|---|---|---|---|
| 1 | Monitor and improve call quality for Microsoft Teams | Monitor and troubleshoot call quality | https://learn.microsoft.com/microsoftteams/monitor-call-quality-qos | vector, lexical |
| 2 | Use Call Analytics to troubleshoot poor call quality | What does each Teams Support role do? | https://learn.microsoft.com/microsoftteams/use-call-analytics-to-troubleshoot-poor-call-quality | vector, lexical |
| 3 | Dimensions and measurements - Call Quality Dashboard (CQD) | Measurements | https://learn.microsoft.com/microsoftteams/dimensions-and-measures-available-in-call-quality-dashboard | vector, lexical |
| 4 | Monitor Direct Routing | Monitor Call Quality Analytics dashboard and SBC logs | https://learn.microsoft.com/microsoftteams/direct-routing-monitor-and-troubleshoot | vector, lexical |
| 5 | Set up call analytics for Microsoft Teams | Overview | https://learn.microsoft.com/microsoftteams/set-up-call-analytics | vector, lexical |

---

## 4. Microsoft top-10 for M01–M06

Search field metadata is always `title`, `content`, `contentUrl`. Snippets below are truncated from `content`.

### M01 search 2077 ms · 10 results

| Rank | Title | URL | Snippet (truncated) |
|---|---|---|---|
| 1 | Troubleshoot Microsoft Teams Voice Issues - Training | https://learn.microsoft.com/training/modules/troubleshoot-microsoft-teams-voice-issues/ | Module TOC: monitor/troubleshoot audio/video, emergency calling, Direct Routing. Learning objectives only. |
| 2 | Issues that affect inbound Direct Routing calls | https://learn.microsoft.com/troubleshoot/microsoftteams/phone-system/direct-routing/issues-with-inbound-calls | Inbound PSTN issues. **No ringback** / SIP 180 then 183. Same local L3. |
| 3 | The speaking participant's microphone has a problem | https://learn.microsoft.com/azure/communication-services/resources/troubleshooting/voice-video-calling/audio-issues/microphone-issue | ACS Calling SDK. Phrase **“one-way audio”** = silent outgoing mic. UFD events. Not Teams DR. |
| 4 | Audio drops when on Teams call - Microsoft Q&A | https://learn.microsoft.com/answers/a/12655846 | Community audio-dropout thread. Not a runbook. |
| 5 | Monitor Direct Routing | https://learn.microsoft.com/microsoftteams/direct-routing-monitor-and-troubleshoot | Generic DR monitor; points to diagnose-direct-routing-issues. |
| 6 | Troubleshoot VoIP call quality | https://learn.microsoft.com/azure/communication-services/concepts/voice-video-calling/troubleshoot-web-voip-quality | ACS web VoIP. Section **One-way or missing audio**. Not DR/SBC/RTP path. |
| 7 | Troubleshoot audio, video, and client issues - Training | https://learn.microsoft.com/training/modules/troubleshoot-audio-video-client-issues/ | Training TOC: Call Analytics, CQD, DR Health Dashboard. |
| 8 | There's a network issue in the call | https://learn.microsoft.com/azure/communication-services/resources/troubleshooting/voice-video-calling/audio-issues/network-issue | ACS SDK. Temporary one-way audio during network reconnect. |
| 9 | Issues that affect inbound Direct Routing calls | …/issues-with-inbound-calls#incoming-calls-aren't-blocked-as-expected | Caller-ID blocking mismatch. Not media. |
| 10 | Issues with Local Media Optimization for Direct Routing | …/issues-with-lmo#incoming-calls-fail-or-go-to-voicemail-if-both-lmo-and-lbr-are-enabled | LMO/LBR inbound fail / voicemail. Not one-way audio. |

### M02 search 2470 ms · 10 results

Ranks **1–7** are the same article `direct-routing-voice-routing` (mostly Example 1 / Example 2 fragments). Rank **7** is the unfragmented article URL (intro, not the Call routing overview heading). Ranks 8–9 ACS telephony “Use direct routing to connect to existing telephony service”. Rank 10 Plan Direct Routing.

Microsoft ranks the **correct article** at #1. Search snippets are example-heavy. Overview heading is not the top snippet.

### M03 search 1949 ms · 10 results

| Rank | Title | URL | Governance cues in snippet |
|---|---|---|---|
| 1 | Microsoft 365 Copilot data and compliance readiness | https://learn.microsoft.com/microsoft-365/copilot/microsoft-365-copilot-minimum-requirements-data-compliance | SAM, oversharing (checklist; links to SAM how-to) |
| 2 | Roll out SharePoint and OneDrive | https://learn.microsoft.com/sharepoint/roll-out-sharepoint-onedrive | Generic rollout (in local corpus) |
| 3 | Secure Microsoft 365 Copilot for small businesses | https://learn.microsoft.com/microsoft-365/admin/security-and-compliance/m365b-copilot-security | SMB Copilot security |
| 4 | Considerations to manage Microsoft 365 Copilot and Channel Agent… | https://learn.microsoft.com/purview/ai-m365-copilot-considerations | Purview / information protection |
| 5 | Configure a secure and governed foundation for Microsoft 365 Copilot | https://learn.microsoft.com/microsoft-365/copilot/configure-secure-governed-data-foundation-microsoft-365-copilot | SAM, oversharing, **Restricted Content Discovery** |
| 6–8 | Set up Microsoft 365 Copilot and assign licenses | https://learn.microsoft.com/microsoft-365/copilot/microsoft-365-copilot-setup | SAM, oversharing, **Restricted Access Control** |
| 9–10 | Configure a secure and governed foundation… | same as rank 5 | oversharing, RAC / SAM |

**Frozen GT SAM how-to URL is not in Microsoft top-10.** Microsoft instead ranks newer Copilot foundation / setup / SMB pages.

### M04 search 1914 ms · 10 results (unscoped)

| Rank | Title | URL |
|---|---|---|
| 1 | Manage - Voice applications policies | https://learn.microsoft.com/microsoftteams/aa-cq-manage-voice-applications-policies |
| 2–3 | Overview and configuration of voice and face enrollment | https://learn.microsoft.com/microsoftteams/rooms/voice-and-face-recognition |
| 4 | Get-CsOnlineVoicemailUserSettings | https://learn.microsoft.com/powershell/module/microsoftteams/get-csonlinevoicemailusersettings |
| 5, 8 | Get-CsTeamsVoiceApplicationsPolicy | https://learn.microsoft.com/powershell/module/microsoftteams/get-csteamsvoiceapplicationspolicy |
| 6 | Setup - Authorized Users | https://learn.microsoft.com/microsoftteams/aa-cq-setup-authorized-users |
| 7 | Manage voice isolation… | https://learn.microsoft.com/microsoftteams/voice-isolation |
| 9–10 | Get-CsOnlineVoicemailUserSettings | same voicemail cmdlet |

**`Get-CsOnlineUser` is absent.** No Direct Routing voice-routing policy/route audit cmdlets. Microsoft latched onto the token “voice” (AA/CQ, Rooms enrollment, voicemail, voice isolation).

### M05 search 1941 ms · 10 results

Ranks 1–3 (and 7): **SBC connectivity issues** / SIP OPTIONS TLS (same page; snippet includes request/renew CA, install on SBC, drop old TLS). Rank 4: ACS Direct Routing infrastructure. Rank 5/8: What's new Direct Routing (CA changes). Rank 6: Q&A. Rank 9: certified SBCs. Rank **10**: Plan Direct Routing / Public trusted certificate for the SBC (**frozen GT**).

### M06 search 1903 ms · 10 results

| Rank | Title | Side |
|---|---|---|
| 1 | Improve call quality in Microsoft Teams (`monitor-call-quality-qos`) | **Both** listed: CQD org-wide vs admin center per-user |
| 2 | Microsoft Teams Virtual Appointments in Call Quality Dashboard | CQD, Frontline product |
| 3 | What is Call Quality Dashboard (CQD)? | CQD |
| 4 | Use Call Analytics to troubleshoot poor call quality | **Per-user/per-call** |
| 5, 7 | Use CQD to manage call and meeting quality | CQD |
| 6, 8–10 | Skype for Business Server CQD plan/use | Legacy CQD noise |

One query returns **both** CQD and Call Analytics. Also returns Skype-for-Business CQD and Virtual Appointments CQD.

---

## 5. Fetched top-3 content metadata

All 18 full fetches succeeded. All 18 section fetches succeeded. No fetch errors.

| Q | Rank | Page title | Full chars | Full ms | Section heading | Section chars | Section ms | In local corpus |
|---|---|---|---|---|---|---|---|---|
| M01 | 1 | Troubleshoot Microsoft Teams Voice Issues | 1333 | 2413 | Learning objectives | 267 | 1967 | No |
| M01 | 2 | Issues that affect inbound Direct Routing calls | 11000 | 2350 | No ringback tone… | 1720 | 1886 | Yes |
| M01 | 3 | The speaking participant's microphone has a problem | 5669 | 2319 | How to detect using the SDK | 1152 | 1463 | No |
| M02 | 1–3 | Configure call routing for Direct Routing | 23789 | 1469–2416 | Example headings | 3494–7058 | 1477–1936 | Yes |
| M03 | 1 | Microsoft 365 Copilot data and compliance readiness | 3658 | 1833 | Microsoft SharePoint | 1504 | 2344 | No |
| M03 | 2 | Roll out SharePoint and OneDrive | 3437 | 2219 | (page) | 3437 | 2151 | Yes |
| M03 | 3 | Secure Microsoft 365 Copilot for small businesses | 8333 | 2696 | Keep sensitive or personal data… | 1425 | 2052 | No |
| M04 | 1 | Manage - Voice applications policies | 14118 | 1496 | (page) | 14118 | 1402 | Yes |
| M04 | 2–3 | Overview and configuration of voice and face enrollment | 13421 | 1952–2647 | Admin settings | 3387 | 1792–2052 | No |
| M05 | 1–3 | SBC connectivity issues | 11166 | 1548–1969 | Overview of the SIP options process | 10196 | 1398–2303 | Yes |
| M06 | 1 | Improve call quality in Microsoft Teams | 3971 | 1434 | Monitor and troubleshoot call quality | 1602 | 1508 | Yes |
| M06 | 2 | Virtual Appointments in CQD | 6125 | 2715 | (page) | 6125 | 2175 | No |
| M06 | 3 | What is Call Quality Dashboard (CQD)? | 4990 | 2245 | (page) | 4990 | 2065 | Yes |

M02 full-page fetch of rank 1 **does** contain the Call routing overview (policy → PSTN usage → voice route → SBC). Section fetch of the example heading does **not** isolate that overview; you need the full page or an explicit `--section "Call routing overview"`.

---

## 6. M01 — one-way audio kill test

### A. Dedicated source?

| Target | Found in Microsoft top-10? |
|---|---|
| One-way audio (Teams Direct Routing) | **No** |
| No audio in one direction on DR | **No** |
| Direct Routing media troubleshooting runbook | **No** |
| RTP / media-path troubleshooting for DR | **No** |

Hits that contain the **phrase** “one-way audio” are **Azure Communication Services Calling SDK** pages (microphone silent; network reconnect). Wrong product. Training modules are TOC/objectives only (1333 chars). Inbound ringback is the same local neighbor, not one-way media.

### B. Materially closer than local ringback / licensing / Audio Conferencing?

**No.** ACS SDK microphone/network pages are closer on the **string** “one-way audio” and farther from the **requested procedure** (Teams Direct Routing media/RTP/SBC). Training is an outline, not a runbook.

### C. Does a fetched page/section contain an actual DR one-way-audio troubleshooting path?

**No.** Fetched ACS page is client-microphone SDK detection (UFD events). Fetched training page is a module landing page. Fetched inbound-calls page is ringback / SIP 18x.

**NO DEDICATED MICROSOFT RUNBOOK FOUND**

---

## 7. M02 — routing-chain comparison

Known correct local section: `Configure call routing for Direct Routing :: Call routing overview`.

| | Local | Microsoft |
|---|---|---|
| Article `direct-routing-voice-routing` | Ranks 2–4 | Ranks **1–7** |
| Exact overview section | **Rank 3** | Not the top snippet; page-level hit at rank 7; **full fetch of rank 1 includes the overview** |
| Analog-device neighbors | Ranks 1, 5 | Not in top 10 |
| Snippet quality vs overview | Local returns the overview parent at rank 3 | Search snippets are Example 1/2 configuration steps |

Microsoft **ranks the article more highly**. It does **not** rank the overview heading above the examples. Fetch recovers the overview cleanly from the full page.

Ranking vs frozen GT URL: both found it. Microsoft article rank better; local section rank better.

---

## 8. M03 — Copilot / SharePoint comparison

Evaluation cues (not injected into the query): SAM, oversharing / DAG, Restricted Access Control, Restricted Content Discovery.

| | Local | Microsoft |
|---|---|---|
| Dedicated SAM how-to (frozen GT) | Rank 3 (wrong Step 5) and rank 5 (Step 3 oversharing) | **Absent from top-10** |
| Generic SP/OD rollout | Ranks 1, 2, 4 | Rank 2 |
| Current Copilot foundation / data-compliance | Not in local top-5; M03 rank-1 fetch **not in corpus** | Rank 1, 5, 9, 10 |
| RAC / RCD named | Local SAM Step 3 is the GT governance step | Named in ranks 5–9 snippets |

Microsoft ranks **current Copilot governance** pages the local index does not have. Microsoft **misses** the frozen SAM how-to that local already retrieves. Local still mixes generic rollout and backup Step 5 above the acceptable oversharing step.

---

## 9. M04 — PowerShell comparison

Local automatic HIGH PowerShell routing solves candidate starvation: `Get-CsOnlineUser` at rank 2 plus voice-routing/calling cmdlets.

Microsoft search was **not** pre-scoped (per spec). It did **not** naturally surface `Get-CsOnlineUser`. It surfaced AA/CQ voice-applications policies, Teams Rooms voice enrollment, voicemail user settings, and voice isolation.

This is the opposite of a rescue: unscoped Microsoft search is **worse** than the frozen local router on the exact NL PowerShell audit question.

---

## 10. M05 — certificate comparison

Microsoft **does** have more than a requirements list:

- SIP OPTIONS / TLS page (MS ranks 1–3; local rank 1): if Health Dashboard shows expired/revoked, **request or renew from a trusted CA, install on the SBC, tear down old TLS** (restart SBC **or contact the vendor**). Points to Plan Direct Routing for supported CAs.
- Plan Direct Routing public-trusted-certificate section (MS rank **10**; local rank **2**): requirements / CA list, not vendor UI.

That is **Microsoft-side renewal operations**, not AudioCodes/Ribbon/Oracle GUI or vendor CLI. Do not call vendor-specific renewal supported. Microsoft does not provide those steps here.

Local already has the procedural SIP page at rank 1 **and** the GT requirements section at rank 2. Microsoft buries the GT section at rank 10.

---

## 11. M06 — CQD vs per-call comparison

**Yes, one query returns both sides.**

- CQD / org-wide: MS rank 1 (same monitor article as local L1), rank 3 What is CQD?, ranks 5/7 CQD QoE guide.
- Per-user/per-call: MS rank 4 Call Analytics (local L2). Rank 1 snippet already names Teams admin center for individual users vs CQD for org-wide trends.

Noise: Virtual Appointments CQD (rank 2, not in corpus), Skype for Business Server CQD (ranks 6, 8–10). Local packs both GT articles in top-2 without Skype dilution.

---

## 12. LOCAL vs MICROSOFT grades

Human review. Not an LLM grader. Grades describe whether the **retrieved top evidence** answers the asked procedure.

| Q | LOCAL | MICROSOFT | Notes |
|---|---|---|---|
| M01 | **MISS** | **MISS** | Frozen GT is SOURCE_GAP. Microsoft also has no DR one-way-audio runbook. |
| M02 | **GOOD** | **GOOD** | Local overview at rank 3. Microsoft article at rank 1; snippets are examples; full fetch includes overview. |
| M03 | **GOOD** | **GOOD** | Local has SAM (wrong subsection first). Microsoft has current Copilot foundation pages; misses SAM how-to. |
| M04 | **EXCELLENT** | **MISS** | Local scoped cmdlets. Microsoft “voice” misfire. |
| M05 | **GOOD** | **GOOD** | Both have Microsoft renew operations on the SIP TLS page. Neither has vendor SBC UI. Local also has GT requirements at rank 2. |
| M06 | **EXCELLENT** | **GOOD** | Local both GT in top-2. Microsoft both sides by rank 4, plus Skype/Frontline noise. |

---

## 13. Ranking wins / losses

Compare source quality/rank only. Do not compare scores.

| Q | Local best rank | Microsoft best rank | Winner |
|---|---|---|---|
| M01 | None (no dedicated source) | None (ACS phrase-hit rank 3 is wrong product) | **ROUGHLY EQUAL** |
| M02 | Overview section **3**; article 2 | Article **1**; overview heading not top snippet | **MICROSOFT BETTER** (article) |
| M03 | SAM how-to **3/5** (Step 3 at 5) | SAM how-to **absent**; Copilot foundation **1** | **LOCAL BETTER** vs frozen GT |
| M04 | `Get-CsOnlineUser` **2** | GT **absent** | **LOCAL BETTER** |
| M05 | SIP procedure **1** + GT cert **2** | SIP procedure **1**; GT cert **10** | **LOCAL BETTER** |
| M06 | CQD **1** + Call Analytics **2** | CQD **1** + Call Analytics **4** | **ROUGHLY EQUAL** |

Scoreboard: Microsoft 1, Local 3, Equal 2.

The Microsoft “win” (M02) is an article we already have. The local wins include the PowerShell starvation case Microsoft was hypothesized to rescue.

---

## 14. Local coverage gaps discovered by Microsoft

Only Microsoft results judged **GOOD or EXCELLENT** that are **absent from the local corpus**. Do not ingest.

| Canonical URL | Title | Why it matters | Likely family |
|---|---|---|---|
| https://learn.microsoft.com/microsoft-365/copilot/microsoft-365-copilot-minimum-requirements-data-compliance | Microsoft 365 Copilot data and compliance readiness | Current Copilot SharePoint/OneDrive governance checklist; links to SAM | `microsoft-365` / Copilot |
| https://learn.microsoft.com/microsoft-365/copilot/configure-secure-governed-data-foundation-microsoft-365-copilot | Configure a secure and governed foundation for Microsoft 365 Copilot | Current oversharing / guardrails / RCD / RAC language | `microsoft-365` / Copilot |
| https://learn.microsoft.com/microsoft-365/copilot/microsoft-365-copilot-setup | Set up Microsoft 365 Copilot and assign licenses | Setup + security-measures that name SAM / RAC / oversharing | `microsoft-365` / Copilot |

Not listed (not GOOD for the asked question, even if missing):

- Learn **training** module landing pages (M01 ranks 1, 7) — TOC only.
- **ACS Calling SDK** audio pages (M01 ranks 3, 6, 8) — wrong product.
- Microsoft Q&A threads.
- Teams Rooms voice/face enrollment (M04) — wrong “voice”.
- Virtual Appointments CQD (M06 rank 2) — adjacent product, not the CQD vs Call Analytics contrast.
- ACS Direct Routing infrastructure (M05 rank 4) — ACS telephony, not Teams SBC vendor renewal.

---

## 15. Search latency

CLI `--version` after warmup: **1306 ms** (startup tax; paid once per process).

Local warmup (frozen engine): **251 ms**.

| | n | min | p50 | max |
|---|---|---|---|---|
| Local retrieval | 6 | 182 ms | **213 ms** | 342 ms |
| Microsoft search | 6 | 1903 ms | **1941 ms** | 2470 ms |

Microsoft search is ~9–10× slower than local retrieval. First-result time is not separately measurable (JSON returns the full list).

Per-question Microsoft search: M01 2077 · M02 2470 · M03 1949 · M04 1914 · M05 1941 · M06 1903 ms.

---

## 16. Fetch latency

| | n | min | p50 | max |
|---|---|---|---|---|
| Full page fetch | 18 | 1434 ms | **1969 ms** | 2715 ms |
| Named section fetch | 18 | 1398 ms | **1886 ms** | 2344 ms |

Fetch is another ~2 s per URL. A top-3 rescue would add ~6 s of fetches on top of ~2 s search, plus CLI startup if a new process is spawned.

Do not reject Microsoft solely for latency. For Tier-2 this is acceptable **if** it added coverage on hard cases. It did not on M01/M04.

---

## 17. Errors / throttling

| Event | Count |
|---|---|
| Search failures | 0 |
| JSON parse errors | 0 |
| Full fetch failures | 0 |
| Section fetch failures | 0 |
| HTTP 429 / throttle | **None observed** |
| Auth prompts | None |
| `doctor` HTTP 405 | Expected on GET to MCP POST endpoint; doctor still `ok` |

Windows note: `subprocess` `npx` → WinError 2; `npx.cmd` works.

---

## 18. Dependencies / cost

| Item | Observation |
|---|---|
| Microsoft authentication | **Not required** |
| API charge | **None observed** (public Learn MCP) |
| npm package | `@microsoft/learn-cli@0.1.0`, unpacked **42.5 KB**, 17 files |
| Internet at runtime | **Required** (MCP `https://learn.microsoft.com/api/mcp`) |
| Credentials added | **None** |
| Extra runtime deps | Node/npx (already present). No Relay code change. |

---

## 19. Eval-oracle disagreements (frozen GT unchanged)

Microsoft top-1 is **not** treated as truth.

| Q | Frozen GT | Local vs GT | Microsoft vs GT | Disagreement |
|---|---|---|---|---|
| M01 | SOURCE_GAP (no target URL) | No GT URL | No GT URL | Agree there is no frozen target. Microsoft still found no dedicated DR runbook. |
| M02 | `direct-routing-voice-routing` / Call routing overview | Article ranks 2–4; overview **3** | Article ranks 1–7 | Both found GT URL. Microsoft top snippets are examples, not overview. |
| M03 | SAM how-to / Steps 1–3 | URL ranks 3 and 5; rank 3 is **wrong Step 5** | **Miss** (empty `microsoft_gt_hits`) | Microsoft top-1 is a different Copilot readiness article. Do not overwrite GT. |
| M04 | `Get-CsOnlineUser` | Rank **2** | **Miss** | Microsoft top-1 is AA/CQ voice applications. Local is correct. |
| M05 | Plan Direct Routing / Public trusted certificate | Rank **2** | Rank **10** | Microsoft top-1 is SIP OPTIONS TLS (also useful for renew). GT still the requirements section. |
| M06 | monitor-call-quality-qos **and** Call Analytics | Ranks **1 and 2** | Ranks **1 and 4** | Both found both URLs. |

Do not promote Microsoft M03/M04/M05 top-1 into frozen ground truth.

---

## 20. Is Microsoft Learn retrieval useful as Tier 2?

**Not as a runtime rescue.** Reasons:

1. **M01 kill test failed.** Microsoft’s own search does not have a dedicated Teams Direct Routing one-way-audio / one-direction media / RTP-path runbook. ACS “one-way audio” is a different product.
2. **M04 is worse than local.** Unscoped Microsoft search cannot replace the R0.4 HIGH PowerShell router. A local-confidence-floor → Microsoft fallback would **drop** `Get-CsOnlineUser` on the question where local already works.
3. **M02/M05/M06** mostly re-rank pages already in the corpus. Fetch of pages we already have is not a coverage rescue.
4. **M03** is the real Microsoft value: newer Copilot governance articles missing from the local index. That is an **ingest/freshness** finding, not a reason to call Learn MCP at answer time.

Latency (~2 s search + ~2 s per fetch) would be acceptable for a rare fallback. The missing piece is **utility on the hard misses**, not speed.

No threshold logic was added. Prior Q03 work already showed a high-confidence near-miss can still be wrong; this phase does not choose a trigger.

---

### B. MICROSOFT USEFUL FOR COVERAGE ONLY

Microsoft is valuable for corpus discovery/freshness but not runtime retrieval.
