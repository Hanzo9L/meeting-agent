# Issue 2 — Ranking forensic (read-only)

Diagnosis only. Production retrieval, query shaping, corpus, ranking/fusion, UI, and STT were not modified. No commit, no push.

## 0. Safety / fingerprints

### Relay

- cwd: `C:\Users\joegc\projects\meeting-agent`
- branch: `cursor/msteams-docs-knowledge-base`
- HEAD: `fdf2e0915a1746379125cb2fd5ae9a024fa84328`
- Working tree remains intentionally dirty (unrelated UI/intent work). Not reset.

### learn-rag

- cwd: `C:\Users\joegc\projects\learn-rag\learn-rag`
- branch: `master`
- HEAD: `762e9b287c7fed4c112501d4beb8df786bf296cd`
- `git status --short`: clean

### Frozen retrieval fingerprints (unchanged)

| Artifact | sha256[:16] | Notes |
|---|---|---|
| `service/search.py` | `252e9b3ced85b9b0` | I6B FTS shape + RRF. Matches I10 / relay_bridge freeze |
| `service/scope_select.py` | `2a8caaabd00f4b08` | HIGH cmdlet/SharePoint/Copilot-global only |
| Query-shaping surface | same `search.py` `build_fts_query` + `PHRASE_ALIASES` / `TECHNICAL_PHRASES`; `service/asr_normalize.py` `e003a8076adc0c90`; `service/query_cues.py` `c451e8a72d7dc419` (cues are **not** applied as hard search scope) |
| `data/corpus.db` | `5697ee158796c34c` | |
| `data/hnsw.bin` | `6cb36a85bc36acf3` | |

Relay live path: accepted question text is sent to `relay_bridge.search_evidence` with **`top_k=5`, `candidates=30`**. Vector embed uses the **raw** question, not the FTS rewrite. `select_scope` ASR-normalizes for cues only; `SearchEngine.search` does not.

Probe: `eval/runs/issue-2-ranking/probe_raw.json` (production `candidates=30` fused list, plus diagnostic `candidates=120` only to see if a better parent exists outside the production candidate cap).

---

## 1. Case selection

Current live failures from I9 overlay/snapshots take priority over the old Priority-14 bank:

| ID | QUESTION | CURRENT TOP 5 (prod) | EXPECTED DOMAIN | WHAT MAKES RESULT WRONG |
|---|---|---|---|---|
| LIVE-H1-typed | What does Get-CsOnlineUser return? | Get-CsOnlineUser; VoiceRoutingPolicy; PhoneNumberAssignment; CallQueue; TeamsCallingPolicy | Teams PS Get-CsOnlineUser | **Typed path is rank-1 correct.** I9 overlay failure was the STT form below. |
| LIVE-H1-stt | What does Gixonline user return? | VoiceRoutingPolicy; **Get-CsOnlineUser #2**; Enable users homed online; PstnUsage; **Linux ps(1)** | Same cmdlet | Rank 1 is the wrong cmdlet. Linux process list is unrelated. Matches I9 overlay. |
| LIVE-H2 | A user can use Teams but cannot call external numbers. How do you troubleshoot? | Outbound “some users”; Call Analytics *roles*; Teams Phone setup numbers; PSTN option; AA transfer-to-external | DR outbound PSTN troubleshooting | Rank 1 is the frozen GT section. Peers 2–5 are adjacent (roles, setup, AA). |
| LIVE-Q-SBC-FAIL | What happens if the SBC fails? | Trunk failover network-errors; SIP-code failover; Overview; multi-tenant failover; SBC settings | Microsoft DR trunk failover / SIP FQDN resiliency | Rank 1 is a narrow subsection; Overview is #3. Not vendor pollution in top 5. |
| LIVE-Q-GEO | What would geographic redundancy look like? | **AudioCodes Mediant HA 1+1 Overview**; country/region codes; LMO scenarios; CQD dimensions; CQD classifiers | Microsoft geo-redundant SBC / sip.pstnhub 1/2/3 / carrier diversity | Rank 1 is vendor pair HA, not Microsoft geo architecture. Country-code table is a lexical accident (“geographic”). |
| HIST-Q03-ONEWAY | How would you troubleshoot one-way audio on a Teams Direct Routing call? | Monitor CQA; media-bypass separate trunks; GCC High Audio Conferencing; **AudioCodes pairing**; outbound some-users | Microsoft one-way-audio / media-path diagnosis | No parent in this corpus contains “one-way audio”. Aliases pull media bypass / CQD. |
| HIST-Q01-ARCH | Explain Direct Routing and the role of the SBC. | **AudioCodes infra prerequisites**; AudioCodes infra; analog-device Step 1; AudioCodes “About DR”; **Plan DR Overview #5** | Microsoft Plan/Configure Direct Routing overview | Vendor implementation and analog-device PowerShell beat Microsoft overview. |
| LIVE-H4-POOR-AUDIO | A user is complaining of poor audio. How would you determine where the problem is? | Call Analytics troubleshoot; CQD measurements; CQD “what is quality”; CQD dimensions; **Teams Rooms hardware** | Call Analytics / CQD path isolation | Rank 1 is useful. #5 Rooms hardware is a different problem. |
| HIST-Q13-COPILOT | What would you secure or review in SharePoint and OneDrive before rolling out Microsoft 365 Copilot? | SP/OD rollout Overview; Plan SP/OD Overview; **SAM Step 5 backup**; Pilot rollout; **SAM Step 3 oversharing #5** | SAM / oversharing / Copilot governance | Rank 1 is generic SP/OD rollout. Backup restores, not oversharing, outrank Step 3. |
| HIST-TEAMS-ROLLOUT | How would you roll out Teams to a large organization? | Network requirements; network optimization; **Rooms Pro update rings**; Teams Phone PSTN option; upgrade onboarding checklists | Enterprise Teams adoption/voice rollout architecture | Network prep is adjacent. Rooms “Update Rings” is a lexical accident. |
| LIVE-Q-CERT | What does the certificate do? | **AudioCodes wildcard CSR x4**; What’s New cert changelog; (Plan DR public trusted cert is **#7**) | Microsoft DR public trusted SBC certificate | Underspecified follow-up. Vendor CSR procedures and a changelog beat the Microsoft requirement section. |
| CTRL-AUDIOCODES | How would you configure an AudioCodes Mediant SBC for Teams Direct Routing? | Terminology appendix; Terminology; Enabling Online User; SIP Trunk to Teams; Teams_52_123 chrome | AudioCodes Mediant DR **plus** Microsoft DR plan | Vendor SHOULD appear. Rank 1 is glossary chrome, not the procedure. |
| CTRL-LINUX | A Linux service is failing intermittently. How would you investigate it? | **systemctl**; CQD reliability; Teams meeting investigate; ps(1); CQD quality | Linux systemd/service | Rank 1 is useful. Microsoft CQD/meeting pages in top 5 are the reverse pollution case. |

---

## 2–5. Per-case inspection

Production fused unique parents are typically ~13–49 because **`candidates=30`**. There is no real “top 100” on the live path; 100 was requested by fetching the full fused list (still capped by 30+30 RRF). `candidates=120` was diagnostic only.

### LIVE-H1-typed — Get-CsOnlineUser (correct text)

**Route:** HIGH `msteams-ps` / `teams-ps` (cmdlet token). Linux cannot enter.

**Query shape:** FTS `"Get-CsOnlineUser" OR "return"`. No phrases, no aliases. Vector = raw question.

**Top ranked domain:** Microsoft PowerShell. **First useful:** Get-CsOnlineUser Synopsis/Description, **rank 1**. Body is the authored SYNOPSIS + SYNTAX + DESCRIPTION (not the old changelog debris).

**Mixed corpus:** none in top 5.

**Parent quality:** correct article; sibling Get-* cmdlets in 2–5 are adjacent, not misleading if UI shows peers.

**Primary:** OTHER (typed rank-1 is already the asked cmdlet). Live I9 used STT.

**Smallest fix:** `NO_CHANGE_NEEDED` for typed; STT case is separate.

### LIVE-H1-stt — `Gixonline user` (I9 accepted)

**Route:** NONE (no cmdlet hyphenation, no ASR alias for `gixonline`). Global corpus.

**Query shape:** FTS `"Gixonline" OR "user" OR "return"`. ASR unchanged (alias table has `get cs online user` → `Get-CsOnlineUser`, **not** `gixonline`). Generic `user`/`return` + vector neighborhood of other Get-Cs* cmdlets. `WEAK_UNIGRAMS` does not drop `user`.

**First useful:** Get-CsOnlineUser, **rank 2**. Rank 1 VoiceRoutingPolicy is a different cmdlet that also “returns information about…”. Rank 5 **Linux ps(1)** is vector-only, unrelated.

**Mixed corpus:** Linux in top 5 without Linux intent. **Yes, pollution.**

**Parent quality:** rank 1 is a real cmdlet page answering a different question. Rank 5 is man-page chrome.

**Primary:** `RANK1_WRONG_TOP5_GOOD`  
**Secondary:** `MIXED_CORPUS_POLLUTION`, `QUERY_SHAPE_WEAK`  
**Smallest fix:** `BOUNDED_QUERY_SHAPE` (scope/cmdlet repair on mangled tokens) — not a keyterms change in this phase. `SOURCE_FILTER` would hide Linux on non-Linux questions.

### LIVE-H2 — cannot call external numbers

**Route:** NONE. Cues topic=troubleshooting but **cues are not search scope**.

**Query shape:** unigrams `user Teams but cannot call external numbers`. No `direct routing` / `pstn` / `sbc` phrase. `cannot` is **not** a stopword, so it survives. No aliases.

**First useful:** Issues with outbound calls → Some users are unable to make calls, **rank 1** (Priority-14 GT).

**Peers 2–5:** Call Analytics *support roles* (not outbound PSTN); Phone setup; AA transfer-to-external (different article). Adjacent, not vendor pollution.

**Primary:** OTHER — rank-1 is the frozen GT section. Treat peers as noisy.  
**Secondary:** `QUERY_SHAPE_WEAK` (no PSTN/DR phrase)  
**Smallest fix:** `UI_PEER_SOURCES_ONLY` if the complaint is “card looks like a setup wizard”; otherwise `BOUNDED_QUERY_SHAPE`.

### LIVE-Q-SBC-FAIL — SBC fails

**Route:** NONE. Cue wants teams-voice but not applied. Failover clause **is** added (`fails` + `sbc` → `"failover"`).

**Query shape:** `"happens" OR "if" OR "SBC" OR "fails" OR "failover"`. Generic `happens`/`if` kept.

**First useful:** Trunk failover Overview **rank 3**. Rank 1 (network-error subsection) is still about SBC/trunk failure and is usable, but it is a narrower H2 than the question.

**Plan DR “SIP signaling: FQDNs, ports, failover mechanism”** is **rank 24** in the production fused list (geo FQDNs), not top 5.

**Mixed corpus:** Microsoft-only top 5.

**Primary:** `RANK1_WRONG_TOP5_GOOD`  
**Secondary:** `SOURCE_FRAGMENT_QUALITY` (subsection vs overview)  
**Smallest fix:** `UI_PEER_SOURCES_ONLY` or later bounded heading preference — **not** done here.

### LIVE-Q-GEO — geographic redundancy (I9 rapid Q3)

**Route:** NONE. No product names.

**Query shape:** `"geographic" OR "redundancy" OR "look" OR "like"`. ASR filler regex **strips `like`**. No SBC/DR/failover. Vector + `redundancy` matches AudioCodes **HA 1+1** Overview.

**First useful Microsoft authority:** Plan Direct Routing → SIP signaling FQDNs/failover is **absent from production fused 44**. Appears at **wide candidates=120 rank 32**. PSTN “use more than one connectivity type” is production **rank 18** (carrier diversity, weak). Country-code table rank 2 is a lexical accident.

**Mixed corpus:** AudioCodes rank 1 on a generic Microsoft architecture question. **Pollution.** Linux chmod appears later (~28).

**Parent quality:** Mediant HA is real vendor pair redundancy, **not** Microsoft geo-redundant trunks / sip.pstnhub.microsoft.com 1/2/3.

**Primary:** `MIXED_CORPUS_POLLUTION`  
**Secondary:** `QUERY_SHAPE_WEAK`, `CORRECT_BELOW_TOP5` (Microsoft FQDN failover only with a wider candidate cap)  
**Smallest fix:** `BOUNDED_QUERY_SHAPE` and/or `SOURCE_FILTER` for vendor HA on non-vendor questions. `TARGETED_SOURCE_ADD` is **not** required — the Microsoft page already exists.

### HIST-Q03-ONEWAY — one-way audio

**Route:** NONE. Aliases fire: `one way audio` → `media bypass`, `call analytics`, `call flows`.

**Corpus scan (read-only):** **zero** parents contain “one-way audio” / “one way audio” in title, section, or first 4k body. Frozen GT SOURCE_GAP still holds.

**First useful-adjacent:** Call Analytics “Troubleshoot user call quality problems” **rank 39**. Media-bypass “About media bypass” **rank 23**. Nothing is a one-way-audio runbook. GCC High Audio Conferencing rank 3 is the old false friend.

**Mixed corpus:** AudioCodes “verifying pairing” rank 4 — vendor checklist, not one-way audio.

**Primary:** `SOURCE_MISSING`  
**Secondary:** `QUERY_SHAPE_WEAK` (alias expansion), `MIXED_CORPUS_POLLUTION`  
**Smallest fix:** `TARGETED_SOURCE_ADD` **only if** a Microsoft one-way-audio parent is authorized later. Do not invent aliases now.

### HIST-Q01-ARCH — Explain DR and the SBC

**Route:** NONE. FTS `"direct routing" OR "SBC"` only. `explain`/`role` dropped as weak.

**First useful:** Plan Direct Routing Overview **rank 5**; Configure Direct Routing Overview **rank 8**.

**Rank 1–4:** AudioCodes infrastructure tables / analog-device `New-CsOnlinePSTNGateway` snippet / AudioCodes “About DR”. Vendor pages copy Microsoft prerequisite lists, so lexical+vector both like them.

**Mixed corpus:** 3/5 AudioCodes in top 5. **Pollution for a generic Microsoft architecture question.**

**Primary:** `MIXED_CORPUS_POLLUTION`  
**Secondary:** `RANK1_WRONG_TOP5_GOOD`  
**Smallest fix:** `SOURCE_FILTER` (vendor not first on generic DR explain) or `BOUNDED_QUERY_SHAPE`. Microsoft overview is already in top 5.

### LIVE-H4-POOR-AUDIO

**First useful:** Call Analytics troubleshoot user call quality **rank 1**. Matches I9 overlay.

**Rank 5:** Teams Rooms on Windows hardware issues — different domain.

**Primary:** OTHER — rank-1 Call Analytics is the right isolation page.  
**Secondary:** noisy CQD dimension tables / Rooms hardware as peers  
**Smallest fix:** `UI_PEER_SOURCES_ONLY`

### HIST-Q13-COPILOT

**Route:** NONE because Copilot is forced global (correct, to keep SAM/Copilot parents).

**Query shape:** `secure review SharePoint OneDrive rolling out Microsoft 365 Copilot`. `rolling`/`out`/`Microsoft`/`365` boost generic rollout pages.

**First useful:** SAM Step 3 Prevent accidental oversharing **rank 5**. Rank 3 is SAM **Step 5 backup** — Copilot-branded but answers the wrong step.

**Primary:** `RANK1_WRONG_TOP5_GOOD`  
**Secondary:** `QUERY_SHAPE_WEAK`, `SOURCE_FRAGMENT_QUALITY` (backup vs oversharing)  
**Smallest fix:** `BOUNDED_QUERY_SHAPE`

### HIST-TEAMS-ROLLOUT

**Query shape:** `roll out Teams large organization`. No voice/adoption/pilot phrases.

**Rank 1–2:** network prep (necessary but not a rollout program). **Rank 3:** Rooms Pro **Update Rings** — “rings”/organization lexical accident.

**First useful-adjacent:** Skype-to-Teams upgrade framework / onboarding checklists **rank 5–7**. No dedicated “enterprise Teams Voice rollout architecture” parent dominates.

**Primary:** `QUERY_SHAPE_WEAK`  
**Secondary:** `SOURCE_FRAGMENT_QUALITY`; possible `SOURCE_MISSING` for a true global voice-rollout plan article  
**Smallest fix:** `BOUNDED_QUERY_SHAPE` then coverage review

### LIVE-Q-CERT — What does the certificate do?

**Query shape:** single token `"certificate"`. No DR/SBC context (I8 follow-up has no session resolver — known pending).

**First useful Microsoft:** Plan Direct Routing → Public trusted certificate for the SBC **rank 7**. Rank 5 is What’s New changelog.

**Top 4:** AudioCodes wildcard CSR / deploy intermediate certs.

**Primary:** `MIXED_CORPUS_POLLUTION`  
**Secondary:** `QUERY_SHAPE_WEAK` (underspecified + no follow-up binder)  
**Smallest fix:** `BOUNDED_QUERY_SHAPE` / session context (out of ranking) plus `SOURCE_FILTER`

### CTRL-AUDIOCODES (control)

Vendor in top 5 is **expected**. Rank 1 is **A.1 Terminology** glossary. SIP Trunk to Teams is **rank 4**. Microsoft Plan DR overview is not in top 5.

**Primary:** `SOURCE_FRAGMENT_QUALITY`  
**Secondary:** Microsoft authority missing from top 5 on a mixed vendor+Teams question  
**Smallest fix:** `SOURCE_QUALITY_CLEANUP` (deprioritize glossary/address chrome)

### CTRL-LINUX (control)

**First useful:** systemctl **rank 1**. Expected.

**Ranks 2, 3, 5:** Microsoft CQD / Teams meeting investigation because FTS keeps `service` / `failing` / `investigate`. Reverse mixed-corpus: **Microsoft pollutes a Linux question**.

**Primary:** `MIXED_CORPUS_POLLUTION` (Microsoft into Linux intent)  
**Secondary:** `QUERY_SHAPE_WEAK`  
**Smallest fix:** `BOUNDED_QUERY_SHAPE` or `SOURCE_FILTER` when Linux is explicit

---

## 6. Classification summary

| ID | Primary | Secondary | Smallest fix |
|---|---|---|---|
| LIVE-H1-typed | OTHER (rank-1 already correct on typed text) | adjacent Get-* siblings | NO_CHANGE_NEEDED |
| LIVE-H1-stt | RANK1_WRONG_TOP5_GOOD | MIXED_CORPUS_POLLUTION, QUERY_SHAPE_WEAK | BOUNDED_QUERY_SHAPE |
| LIVE-H2 | OTHER (rank-1 is frozen GT) | QUERY_SHAPE_WEAK (noisy peers) | UI_PEER_SOURCES_ONLY |
| LIVE-Q-SBC-FAIL | RANK1_WRONG_TOP5_GOOD | SOURCE_FRAGMENT_QUALITY | UI_PEER_SOURCES_ONLY |
| LIVE-Q-GEO | MIXED_CORPUS_POLLUTION | QUERY_SHAPE_WEAK, CORRECT_BELOW_TOP5 | BOUNDED_QUERY_SHAPE |
| HIST-Q03-ONEWAY | SOURCE_MISSING | QUERY_SHAPE_WEAK, MIXED_CORPUS_POLLUTION | TARGETED_SOURCE_ADD |
| HIST-Q01-ARCH | MIXED_CORPUS_POLLUTION | RANK1_WRONG_TOP5_GOOD | SOURCE_FILTER |
| LIVE-H4-POOR-AUDIO | OTHER (rank-1 Call Analytics) | Rooms/CQD peer noise | UI_PEER_SOURCES_ONLY |
| HIST-Q13-COPILOT | RANK1_WRONG_TOP5_GOOD | QUERY_SHAPE_WEAK, SOURCE_FRAGMENT_QUALITY | BOUNDED_QUERY_SHAPE |
| HIST-TEAMS-ROLLOUT | QUERY_SHAPE_WEAK | SOURCE_FRAGMENT_QUALITY | BOUNDED_QUERY_SHAPE |
| LIVE-Q-CERT | MIXED_CORPUS_POLLUTION | QUERY_SHAPE_WEAK | BOUNDED_QUERY_SHAPE |
| CTRL-AUDIOCODES | SOURCE_FRAGMENT_QUALITY | Microsoft DR overview not in top 5 | SOURCE_QUALITY_CLEANUP |
| CTRL-LINUX | MIXED_CORPUS_POLLUTION | QUERY_SHAPE_WEAK | BOUNDED_QUERY_SHAPE |

---

## 7. Product-standard notes

- AudioCodes 1+1 HA is **not** an acceptable rank-1 for “what would geographic redundancy look like?”
- AudioCodes infrastructure tables are **not** an acceptable rank-1 for “explain Direct Routing and the role of the SBC”
- Linux `ps(1)` is **not** acceptable on a Teams cmdlet question
- Generic SharePoint rollout Overview is **not** an acceptable rank-1 for Copilot oversharing/governance
- Rooms “Update Rings” is **not** an acceptable Teams enterprise-rollout hit
- One-way audio currently **cannot** be answered from this corpus; fail-closed is more honest than media-bypass aliases

---

## 8. What was not done

No aliases, top_k, fusion weights, reranker, title boosts, vendor penalties, source filters, or corpus edits.

---

## 9. Likely fix classes (later, not now)

1. **Vendor/Linux not first on generic Microsoft questions** (geo, explain DR, certificate, STT cmdlet).  
2. **Bounded query shape** for underspecified architecture words (`geographic redundancy`, `roll out`, `certificate`) and mangled cmdlets.  
3. **Parent chrome** (glossary, address blocks, What’s New, backup-step vs oversharing).  
4. **Coverage:** one-way audio remains a gap.

Do not apply a single global vendor penalty: AudioCodes **should** win L3/H3-style vendor config questions.

---

## 10. Decision gate

## E. MULTIPLE CAUSES — NEED ONE SMALL FIX PER CLASS
