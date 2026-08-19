# I5 — Gap Remediation Report

Forensic / source-discovery only. No production retrieval change, no R0.4 edit, no ingest, no UI, no STT, no commit.

## Repo state at I5 close

| Repo | Path | Branch | HEAD | Frozen hashes |
| --- | --- | --- | --- | --- |
| Relay | `C:\Users\joegc\projects\meeting-agent` | `cursor/msteams-docs-knowledge-base` | `e1e4dab` | n/a |
| learn-rag | `C:\Users\joegc\projects\learn-rag\learn-rag` | `master` | `b967fb8` | `search.py` `8702daf1ee2b2843`, `scope_select.py` `2a8caaabd00f4b08` |

Frozen files, `corpus.db`, and `hnsw.bin` were not modified. Relay changes in this phase are evaluation artifacts only.

Corpus at inspection: **1233 parents** (`teams` 930, `sharepoint` 283, `teams-ps` 14, `m365` 6). Fingerprints unchanged from I4: corpus `7e6b69cb0ab95823`, index `87a6960b9ebc6701`.

No I4 markdown report was on disk. Reconciliation used `eval/runs/two-sigma-uc-i4/results.json` plus a read-only R0.4 rank replay (`top_k=100`) and SQLite inspection.

---

## 1. Reconciled I4 totals

Original automated counts:

- well_served 22
- partial 6 (`TSUC04`, `TSUC13`, `TSUC20`, `TSUC25`, `TSUC26`, `TSUC27`)
- story_required 2 (`TSUC29`, `TSUC30`)
- gaps 0

**Authoritative totals after I5 evidence correction:**

| Bucket | Count | IDs |
| --- | ---: | --- |
| well_served | **21** | TSUC01–03, 05–12, 14–19, 21, 23–24, 28 |
| partial | **6** | TSUC04, TSUC13, TSUC20, TSUC25, TSUC26, TSUC27 |
| corpus_gap | **1** | TSUC22 |
| story_required | **2** | TSUC29, TSUC30 |

Thirty scenarios. Scenario questions were not edited. TSUC20 stays partial (one weak Microsoft “service logs” hit). TSUC29/TSUC30 remain behavioral and out of technical retrieval scope.

The I4 runner graded `well_served` at ≥2 theme-token hits. That heuristic is why TSUC22 was mis-binned.

---

## 2. TSUC22 discrepancy resolution

**Original grade:** `well_served` (2/4 theme hits: “tcpdump or packet capture”, “host or port filter”).

**Returned evidence (I4 top 5):** Teams admin meeting-quality page and four CQD pages. No Linux man page, no `ss`, no `tcpdump`.

**Local corpus:** `systemctl`, `journalctl`, `tcpdump`, `/linux/`, `man7.org`, `freedesktop.org` all count **0**.

The two hits are token overlap (`packet`, `capture`, `host`, `port`) against call-quality documentation. That is not Linux authority.

**Reconciled grade:** `corpus_gap`.

`eval/runs/two-sigma-uc-i4/results.json` now records `i5Reconciliation`, moves TSUC22 out of `wellServed`, and sets `gaps: ["TSUC22"]`. Stored `themeHits` from the original run were left intact as historical runner output.

---

## 3–7. Remaining weak technical scenarios

### TSUC04 — Direct Routing geo redundancy / SBC failover (partial)

Question: design Direct Routing for a global org; SBC placement; SBC or carrier failure.

**What is already local**

| Topic | Local? | Useful rank on this question |
| --- | --- | --- |
| Plan Direct Routing | yes | 1–2 (overview/infrastructure); **failover-mechanism section = 9** |
| Local Media Optimization | yes | 3 |
| Connect SBC | yes | 4 |
| Multi-tenant SBC failover | yes | 5 / 22 (wrong scenario: hosting, not enterprise geo-pair) |
| SIP OPTIONS / Monitor Direct Routing | yes | 7 |
| Configure call routing / PSTN usages / multiple routes | yes | **18** |
| **Trunk failover on outbound calls** | **yes** | **not in top 40** |
| Direct Routing SBA (branch survivability) | yes | **not in top 40** |
| Voice-route priority / another SBC in the route | yes, on routing + trunk-failover pages | routing 18; trunk-failover missing from pool |
| Geo-redundancy / carrier-diversity phrases | **zero hits** | n/a |

Microsoft’s published failover story is three different things:

1. **Teams SIP proxy FQDN failover** (`sip` / `sip2` / `sip3`) — Microsoft datacenter region failover. Present at rank 9.
2. **Customer trunk failover** — another SBC in the voice routing policy, `FailoverResponseCodes` 408/503/504, `FailoverTimeSeconds`. Present as `direct-routing-trunk-failover-on-outbound-call` and in Connect-SBC settings. **Does not surface.**
3. **Vendor box HA** — pairing, preempt, media preservation. Microsoft explicitly sends implementers to certified-SBC documentation.

Microsoft does **not** publish a “geographic redundancy design for Direct Routing” page. Carrier diversity is implied by multiple PSTN usages / routes / gateways, not by a carrier-diversity guide.

**Vendor needed?** Catalog only. Official AudioCodes Mediant Teams Direct Routing configuration note and Mediant HA parameters cover device pairing and OPTIONS validation. Do not ingest until the interview environment names AudioCodes.

**Root cause:** ranking/query-shape on already-local Microsoft resiliency pages, plus a true vendor-implementation gap for box HA. Not “Microsoft documentation is missing the trunk-failover article.”

**Proposed fix:** `RANKING_FORENSIC` (covered by the one bounded phrase adjustment below). No new Microsoft ingest required for customer-SBC failover.

---

### TSUC13 — one-way audio (partial)

**Classification: B** — no single runbook, but a bounded Microsoft set can support a safe evidence bundle.

Local phrase search for “one-way audio” / “one way audio” / “one-way media”: **0**.

Failure-domain coverage:

| Domain | Local? | Rank on this question |
| --- | --- | --- |
| Direct Routing media path / ports | Plan Direct Routing media section | not top 5 (licensing/GCC occupy 1–2, 4–5) |
| Media bypass | yes | **14** |
| RTP/SRTP/ICE on DR media protocols | yes | **28** |
| NAT/firewall ICE symptoms | inbound DR issues | **3** (no-ringback / ICE drop, not one-way) |
| Call Analytics | yes | **not in top 43** |
| M365 URLs and IP ranges | **absent** | n/a |
| Teams online call flows | **absent** | n/a |
| Monitor meetings/calls | yes | **36** |

Top 5 is GCC High Audio Conferencing + licensing. That is lexical gravity from “Direct Routing” + “audio”, not a media-path answer.

**Not C:** Microsoft evidence is enough for a safe bundle (signaling vs media, media processor vs bypass, ICE/firewall, Call Analytics) once the missing URLs/IP and call-flow pages are added and ranking is not hijacked by GCC High.

**Not A:** there is no dedicated authoritative one-way-audio page to ingest.

**Vendor:** only for SBC NAT/RTP translation. Not required for the Microsoft evidence bundle.

**Proposed fix:** `INGEST_SMALL_SOURCE_SET` (URLs/IP + online call flows) plus the shared phrase adjustment so Call Analytics / media bypass can enter top 5.

---

### TSUC20 / TSUC22 — Linux (partial + corpus_gap)

Linux authority is genuinely absent. Same source family closes both.

I4 TSUC20 top 5: SharePoint Copilot file-processing status (ranks 1–3, 5) and Direct Routing SBC logs (rank 4). Theme hit “service logs” is not `journalctl`.

**Minimum proposed set (12 pages, not an encyclopedia):**

1. systemctl (freedesktop systemd)
2. journalctl (freedesktop systemd)
3. ps(1) (man7)
4. grep(1) (man7)
5. tail(1) (man7)
6. chmod(1) (man7)
7. ss(8) (man7 / iproute2)
8. ip(8) (man7 / iproute2)
9. ping(8) (man7 / iputils)
10. tcpdump (tcpdump.org, pin a released man page at ingest)
11. pcap-filter(7)
12. Python interpreter tutorial (`docs.python.org/3/tutorial/interpreter.html`) for script execution only

**Expected corpus size:** 12 documents. If heading-split, systemd/ip manuals explode; ingest those as **one parent per page**. Budget **12–40 parents**, not hundreds. Future source role: `linux_upstream_primary`, scoped only when the question is Linux. Do not mix into Microsoft Teams retrieval.

Dropped from the earlier I1 authority-pack Linux list: awk, sed, sort, uniq, cron/crontab, systemd.timer. Those are encyclopedia, not interview-minimum.

**Proposed fix:** `INGEST_SMALL_SOURCE_SET` for both Linux scenarios.

---

### TSUC26 — PowerShell AA/CQ/resource accounts (partial)

All three expected cmdlets **exist** in `teams-ps` (14 parents total):

- `Get-CsAutoAttendant`
- `Get-CsCallQueue`
- `Get-CsOnlineApplicationInstance`

Router: **HIGH `msteams-ps`** — correct. Not a missing-source problem. Not a wrong-scope problem.

Natural-language question ranks (R0.4, `top_k=100`, still only **7 unique parents** because `candidates=30` collapses inside the 14-doc island):

| Cmdlet | Rank |
| --- | ---: |
| Get-CsAutoAttendant | **1** |
| Get-CsOnlineUser | 2 |
| Set-CsPhoneNumberAssignment | 3 |
| Microsoft Teams cmdlet help reference | 4 |
| Get-CsTeamsCallingPolicy | 5 |
| Get-CsCallQueue | **6** (outside production `top_k=5`) |
| Get-CsOnlineApplicationInstance | **not in pool** |

`Get-CsOnlineApplicationInstance` body says “application instance”, never “resource account”. The query phrase `resource account` therefore pulls user/number-assignment cmdlets.

Control: the same engine with the three cmdlet names in the query returns ApplicationInstance **1**, CallQueue **2**, AutoAttendant **4**.

**Issue type:** query shape / phrase extraction, not missing docs, not metadata, not a bad router.

**Proposed fix:** `QUERY_SHAPE_ADJUSTMENT` — this is the proof case for the one bounded retrieval change.

---

### TSUC27 — global Teams Voice rollout (partial)

**Classification: D** — `SOURCE_MISSING` + `QUERY_SHAPE_WEAK` + one present-but-buried page.

Top 5: AA/CQ voice-applications policies, authorized users, AA/CQ business decisions, GCC High Audio Conferencing, manage-voice-routing-policies. That matches the prep-doc warning not to let AA/CQ dominate a rollout question.

Local presence of planning material:

| Needed topic | Local? |
| --- | --- |
| PSTN connectivity options | **yes** (6 sections) — **not in TSUC27 top 25** |
| Upgrade framework | no |
| Evaluate environment / upgrade journey | no |
| Prepare network | no |
| Network planner | no |
| Phone System setup landing | no |
| cloud-voice-landing-page | no |
| Shared Calling / pilot-essentials | no |
| SharePoint OneDrive rollout | yes — **ranks 22 and 24, wrong product** |

**Proposed fix:** `INGEST_SMALL_SOURCE_SET` (Teams Phone / upgrade / network / pilot family). Do not build a broad-question router in the next change.

---

### TSUC25 — script-from-scratch methodology (partial)

**Classification: D** — interview context plus personal story. Not a technical-corpus gap.

The interviewer is testing: opportunity identification, input discovery, **read-only audit first**, modular design, logging, error handling, retry/checkpoint, idempotency, test mode, controlled remediation, validation, documentation.

R0.4 correctly HIGH-routes to PowerShell and returns voice-routing getters. That answers “which cmdlets inspect routing,” not “how you design a script.” Idempotency/logging/remediation are not in cmdlet help and should not be added as fake Microsoft authority.

**Smallest mechanism:** keep using `docs/interview/two_sigma_final_round_prep_relay_ready.md` as the answer framework (already on disk, not ingested). Personal example belongs to **TSUC30**, not to retrieval.

**Proposed fix:** `INTERVIEW_CONTEXT_ONLY`.

---

## 8. Linux source recommendation

See family `linux_upstream_minimum` in `source_candidates.json`. Twelve upstream pages, separate from Microsoft, estimated **12–40 parents**. Do not ingest in I5.

---

## 9. Automation-methodology classification

TSUC25 = interview framework + optional personal story (TSUC30).  
Do not ingest generic prose into Microsoft technical authority.  
Cmdlet pages remain valid **only** for the read-only discovery slice.

---

## 10. Remediation matrix

See `eval/runs/two-sigma-uc-i5/remediation_matrix.json`. Summary:

| Scenario | Grade | Root cause | Existing useful rank | Missing source? | Vendor needed? | Proposed fix | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TSUC04 | partial | Local trunk-failover/SBA/voice-routing buried; no MS geo-redundancy page | Plan DR 1–2; failover section 9; voice routing 18; trunk-failover >40 | MS geo-design page does not exist; trunk-failover already local | Later, AudioCodes HA only | RANKING_FORENSIC | More DR overviews will not surface trunk-failover |
| TSUC13 | partial (B) | No one-way runbook; GCC High dominates; URLs/IP and call-flows absent | Inbound ICE rank 3; media bypass 14; Call Analytics >43 | URLs/IP, online call flows | Only SBC NAT, not now | INGEST_SMALL_SOURCE_SET | Ingest without phrase change still loses to GCC High |
| TSUC20 | partial | Linux absent | None | Yes | No | INGEST_SMALL_SOURCE_SET | Do not build a Linux encyclopedia |
| TSUC22 | corpus_gap | I4 false well_served; Linux absent | CQD only | Yes | No | INGEST_SMALL_SOURCE_SET | Same pack as TSUC20 |
| TSUC25 | partial (D) | Methodology ≠ cmdlet docs | Voice getters top 5 | No (do not invent MS methodology) | No | INTERVIEW_CONTEXT_ONLY | Do not pollute MS corpus |
| TSUC26 | partial | Query shape inside 14-doc PS island | AA 1; CQ 6; AppInstance not in pool | No | No | QUERY_SHAPE_ADJUSTMENT | Proven by named-cmdlet control |
| TSUC27 | partial (D) | Planning pages missing; AA/CQ gravity | pstn-connectivity local but >25 | Upgrade/network/pilot/Phone landing | No | INGEST_SMALL_SOURCE_SET | No broad router in next change |

---

## 11. Ordered implementation recommendation

Interview staffing order, not benchmark chasing:

1. **One bounded R0.4 phrase/query-shape adjustment** (later phase, not this one). Extend `TECHNICAL_PHRASES` / FTS extraction so already-local parents enter the candidate pool:
   - Direct Routing + fail/failover/carrier → `trunk failover`, `voice route`, `PSTN usage`
   - one-way audio → `media bypass`, `call analytics`, `ICE`
   - resource account + Auto Attendant/Call Queue → `application instance`
   - Do not add a reranker, verifier, or new engine.
2. **Ingest Microsoft media/firewall/call-flow family** (3 pages) — TSUC13, highest remaining call-quality gap after phrase change.
3. **Ingest Linux minimum pack** (12 pages, separate role) — TSUC20/TSUC22. Role explicitly asked Linux CLI comfort.
4. **Ingest Teams Phone / upgrade / network / pilot family** (~6 pages) — TSUC27. Broad architecture is lower priority than DR/call-quality/Linux.
5. **Leave TSUC25 on interview context.** Use the prep doc. Do not ingest methodology.
6. **Do not ingest AudioCodes** unless the live interview names Mediant. Microsoft already covers Teams-side multi-SBC failover.

Three source families. One retrieval adjustment. No new architecture.

---

## 12. Why not A, C, or D

- **Not A:** TSUC04, TSUC13, and TSUC26 already have the important Microsoft/cmdlet pages and still fail. Source expansion alone will not surface trunk-failover, Call Analytics, or `Get-CsOnlineApplicationInstance`.
- **Not C:** Linux and Teams-upgrade/network pages are truly absent. Retrieval change first would still leave TSUC20/22/27 closed.
- **Not D:** Every remaining technical gap has a safe path: existing Microsoft pages + a small allowlist + interview context. No need to synthesize answers.

## B. TARGETED SOURCES + ONE BOUNDED RETRIEVAL ADJUSTMENT
