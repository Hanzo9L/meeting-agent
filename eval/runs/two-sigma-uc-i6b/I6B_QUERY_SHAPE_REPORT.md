# I6B — Bounded Query-Shape Adjustment

One retrieval-shaping change in learn-rag `build_fts_query`. No new sources, embeddings, HNSW, FTS schema, fusion, rerank, classifiers, Relay UI, STT, generation, or Microsoft runtime search. No commit.

## 1. Baseline hashes and repo state

| Repo | Path | Branch | HEAD | Notes |
| --- | --- | --- | --- | --- |
| Relay | `C:\Users\joegc\projects\meeting-agent` | `cursor/msteams-docs-knowledge-base` | `e1e4dab` | Working tree intentionally dirty. Eval artifacts only. |
| learn-rag | `C:\Users\joegc\projects\learn-rag\learn-rag` | `master` | `b967fb8` | Retrieval change in `service/search.py` only. |

| File | Before | After |
| --- | --- | --- |
| `service/search.py` | `8702daf1ee2b2843` | `252e9b3ced85b9b0` |
| `service/scope_select.py` | `2a8caaabd00f4b08` | `2a8caaabd00f4b08` (untouched) |

I6A baseline (this corpus): GOOD 23, PARTIAL 5, MISS 0, PERSONAL 2.

I6A target ranks used as the forensic baseline (not memory):

| Target | I6A grade | Useful ranks |
| --- | --- | --- |
| TSUC04 | PARTIAL | Trunk failover not in top 40; voice routing 18 |
| TSUC13 | PARTIAL | Media bypass 14; call-flows / URLs / Call Analytics not in top 50 |
| TSUC26 | PARTIAL | AutoAttendant 1; CallQueue 6; ApplicationInstance absent |
| TSUC27 | PARTIAL | Top 5 AA/CQ; planning 8 / 13 / 22 / 28 |

Router was not the blocker. `select_scope` unchanged. TSUC26 remains HIGH `msteams-ps`. Others NONE/global.

---

## 2. Root cause for each target

### TSUC04 — `fails` never becomes `failover`

Question: *“…what happens if an SBC or carrier **fails**?”*

I6A FTS:

```
"direct routing" OR "design" OR "global" OR "organization" OR "place" OR "SBCs" OR "happens" OR "if" OR "SBC" OR "carrier" OR "fails"
```

Microsoft pages say **failover** (`Trunk failover on outbound calls`, Plan Direct Routing “failover mechanism”). The query never emitted that term, so the already-local trunk-failover parent stayed outside the lexical pool.

### TSUC13 — `one-way audio` split into `one` / `way` / `audio`

I6A FTS:

```
"direct routing" OR "one" OR "way" OR "audio" OR "Teams" OR "call"
```

`audio` as a unigram selects GCC High Audio Conferencing. Authoritative local vocabulary is **media bypass**, **call analytics**, **call flows**, RTP/ICE/firewall — none of which appear as query clauses.

### TSUC26 — plurals break phrases; `resource account` ≠ `application instance`

I6A FTS:

```
"Which Teams PowerShell" OR "Auto Attendants" OR "Call Queues" OR "cmdlets" OR "inspect" OR "resource" OR "accounts"
```

`resource account` / `auto attendant` / `call queue` are already in `TECHNICAL_PHRASES`, but **plurals** (`accounts`, `Attendants`, `Queues`) did not match. The cmdlet page for resource accounts is titled **Get-CsOnlineApplicationInstance**. Named-cmdlet control already proved the island is sufficient.

### TSUC27 — `Teams Voice` vs `Teams Phone`

I6A FTS already preserved Title-Case `"Teams Voice"`. Microsoft planning pages say **Teams Phone**. `rollout` / `global` / `migration` are too generic to select upgrade-framework / network-readiness without becoming a broad-question classifier.

---

## 3. Exact code change

One production file: `learn-rag/service/search.py`.

Diffstat: **52 insertions, 1 deletion** (~51 production lines including comments/docstring; over the ~30 LOC target but still one file and eight entries). Tests: `tests/test_r01.py`, `tests/test_r04_scope.py`.

### Phrase additions (2)

| Entry | Class | Why |
| --- | --- | --- |
| `one way audio` | technical phrase preservation | Hyphen splits to `one` `way` `audio`; keep as one lexical unit. |
| `teams voice` | technical phrase preservation | Spoken product nickname as one unit (alias below). |

### Alias / synonym additions (6 emitted strings)

| From | To | Class | Why |
| --- | --- | --- | --- |
| `one way audio` | `media bypass`, `call analytics`, `call flows` | troubleshooting synonym | Microsoft media-path vocabulary for one-way / media-flow questions. |
| `teams voice` | `teams phone` | Microsoft terminology equivalence | Current product name. **Skipped** when the query contains PowerShell or a cmdlet so Q14/TSUC23 cmdlet lookup is not expanded into planning docs. |
| `resource account` + (`auto attendant` \| `call queue`) | `application instance` | Microsoft terminology equivalence | Voice-app resource accounts are application instances. Rooms resource accounts are not (Q08 unchanged). |
| `fail` / `fails` / `failed` / `failure` | `failover` | troubleshooting synonym | Direct Routing / SBC docs. **Only** when `direct routing`, `session border controller`, or token `sbc` is already present. Linux “failed service” does not fire. |

### Mechanism (not an entry)

Plural-insensitive match of existing `TECHNICAL_PHRASES` (`accounts` → `account`, `Attendants` → `attendant`, `Queues` → `queue`). Canonical phrase is emitted. Unigrams stay literal.

### Explicitly not added

No `upgrade`, `network readiness`, `deployment planning`, hard-coded titles, cmdlet names, TSUC/Q IDs, or per-question rules. Further TSUC27 growth would be benchmark-specific.

---

## 4. Query before / after

| ID | FTS before | FTS after |
| --- | --- | --- |
| TSUC04 | `… "SBC" OR "carrier" OR "fails"` | same **+ `"failover"`** |
| TSUC13 | `"direct routing" OR "one" OR "way" OR "audio" OR "Teams" OR "call"` | `"one way audio" OR "direct routing" OR "Teams" OR "call" OR "media bypass" OR "call analytics" OR "call flows"` |
| TSUC26 | `"Auto Attendants" OR "Call Queues" … "resource" OR "accounts"` | `"resource account" OR "auto attendant" OR "call queue" … OR "application instance"` |
| TSUC27 | `"Teams Voice" OR "phase" OR "global" OR "rollout" …` | `"teams voice" OR … OR "teams phone"` |

Controls (must not grow aliases):

- Q08 Rooms resource account: no `application instance`
- Q14 PowerShell + Teams Voice: no `teams phone`; `"Get-CsOnlineUser"` still a cmdlet clause
- Q13 Copilot “rolling out”: no `teams phone` / `upgrade`
- `script` / `automate` / `global` / `rollout` alone: no extra aliases; router stays NONE

---

## 5. Top-rank before / after

### TSUC04 — PARTIAL, improved

| Needle | I6A | I6B |
| --- | ---: | ---: |
| Plan Direct Routing | 1 | 1 |
| SIP signaling / failover mechanism (Plan DR section) | 9 (I5) / not in I6A top 5 | **3** |
| Trunk failover on outbound calls | not in top 40 | **21** |
| Voice routing | 18 | 18 |

Top 5: Plan DR infra, Plan DR overview, **Plan DR failover mechanism (new)**, LMO, multi-tenant SBC. Connect-SBC dropped 4 → 6.

### TSUC13 — PARTIAL, improved

| Needle | I6A | I6B |
| --- | ---: | ---: |
| Monitor DR / Call Quality Analytics dashboard | not in top 5 | **1** |
| Media bypass | 14 | **2** |
| Teams call flows | not in top 50 | **24** |
| Use Call Analytics | not in top 50 | **26** |
| URLs and IP address ranges | not in top 50 | still absent |
| GCC High Audio Conferencing | 1 | 3 (still in top 5) |

Media / Call Analytics evidence is now top 2. Call-flows entered the pool. No one-way-audio runbook (not required).

### TSUC26 — PARTIAL, improved on ApplicationInstance

HIGH `msteams-ps` unchanged.

| Cmdlet | I6A | I6B |
| --- | ---: | ---: |
| Get-CsAutoAttendant | 1 | 1 |
| Get-CsCallQueue | 6 | **8** (slightly worse) |
| Get-CsOnlineApplicationInstance | absent | **6** |

Named-cmdlet control still works: ApplicationInstance 1, CallQueue 2, AutoAttendant 3.

### TSUC27 — PARTIAL, unchanged

Top 5 identical to I6A (AA/CQ policies / authorized users / business decisions / GCC High / voice-routing policy). Planning still 8 / 13 / 22 / 28. `"teams phone"` was not enough to beat vector AA/CQ dominance. No further aliases added.

---

## 6. Four-target grading

| ID | I6A | I6B | Verdict |
| --- | --- | --- | --- |
| TSUC04 | PARTIAL | PARTIAL | Failover material entered top 5 and trunk-failover entered top 25. Dedicated article still not top 10. |
| TSUC13 | PARTIAL | PARTIAL | Media bypass + Call Analytics in top 5. GCC High/ringback remain. URLs/IP still missing. |
| TSUC26 | PARTIAL | PARTIAL | ApplicationInstance entered the pool (6). CallQueue did not improve (6 → 8). |
| TSUC27 | PARTIAL | PARTIAL | No material movement. |

Do not force PASS.

---

## 7. Full 30-bank regression

| | I6A | I6B |
| --- | ---: | ---: |
| GOOD | 23 | **23** |
| PARTIAL | 5 | **5** |
| MISS | 0 | **0** |
| PERSONAL | 2 | **2** |

**Grade changes:** none.

**Top-5 material changes:**

| ID | What changed | Grade |
| --- | --- | --- |
| TSUC04 | Failover-mechanism section entered rank 3; Connect-SBC 4 → 6 | still PARTIAL |
| TSUC13 | Monitor Call Analytics + media bypass occupy 1–2 | still PARTIAL |
| TSUC24 | Rank 1/2 swap: Get-CsOnlineVoiceRoutingPolicy now first (question asks voice-routing policy first). Same five parents. | still GOOD |
| TSUC26 | Top 5 reordered (OnlineUser dropped 2 → 4); ApplicationInstance now rank 6 | still PARTIAL |

No previously GOOD case degraded. TSUC24 remains the correct Direct Routing cmdlet island.

---

## 8. Priority-14 regression (mandatory)

Evaluator: `select_scope` + `SearchEngine.search(top_k=5)` + frozen `eval/ground_truth/priority14_retrieval.json`. `eval/run_r0_4.py` correctly refuses the new `search.py` hash; this run uses the same grading functions without that freeze gate.

| | Historical R0.4 (old corpus) | I6B (I6A corpus + query shape) |
| --- | --- | --- |
| top1 | 7/13 | 6/13 |
| top3 | 12/13 | 11/13 |
| top5 | **13/13** | **13/13** |
| Q03 | SOURCE_GAP excluded | SOURCE_GAP excluded |
| Q04 Call routing overview | rank **3** | rank **3** (FTS unchanged) |
| Q14 Get-CsOnlineUser | rank **2**, HIGH `msteams-ps` | rank **2**, HIGH `msteams-ps` |

top5 did **not** drop below 13/13. I6B does not fail this gate.

top1/top3 vs historical R0.4: Q02 is now TOP5 (outbound-calls parent at rank 4). Q02 FTS is **identical** to R0.4 (`cannot` / `call` / `external` / `PSTN` — no fail/failover, no one-way aliases). Ranks 2–3 are I6A-ingested Phone System / PSTN-connectivity pages. Not an I6B query-shape miss. Q08 Rooms resource account did not emit `application instance`. Q14 did not emit `teams phone`.

---

## 9. Latency

Packed I6B eval (targets `top_k=50` then 30-bank then P14 in one process) showed inflated tails (bank p50 38 ms, max 167 ms). That pass is **not** the latency measurement.

Dedicated warmed 30-bank, `top_k=5`, three discard queries first:

| | I6A 30-bank | I6B clean warm |
| --- | ---: | ---: |
| p50 | 13.4 ms | **13.6 ms** |
| p95 | 31.6 ms | **28.4 ms** |
| max | 44.3 ms | **38.8 ms** |

Four targets (same clean pass): TSUC04 18.8 ms, TSUC13 22.7 ms, TSUC26 12.1 ms, TSUC27 11.8 ms. No material latency change.

---

## 10. Diff review

`git diff --stat service/search.py`: `52 insertions, 1 deletion`. `scope_select.py` not modified.

Each addition is general Microsoft/admin-docs behavior, not a TSUC ID:

1. `one way audio` — phrase preservation for a standard media symptom name.
2. `teams voice` → `teams phone` — product-name equivalence, gated off PowerShell/cmdlets.
3. `one way audio` → `media bypass` / `call analytics` / `call flows` — troubleshooting synonyms used across Direct Routing media docs.
4. `resource account` + AA/CQ → `application instance` — documented Microsoft voice-apps terminology; Rooms excluded by co-occurrence.
5. DR/SBC + fail* → `failover` — documented Direct Routing failover vocabulary.
6. Plural fold on existing phrases — mechanical, not benchmark-specific.

Nothing exists only because a specific benchmark question needed a title or cmdlet. TSUC27-only planning phrases were considered and **rejected**.

Mechanical tests (`tests.test_r01.LexicalQueryTests`, `tests.test_r04_scope.RouterCueTests`): 25 passed. Module source contains no TSUC/Q IDs, no `Get-CsCallQueue` / `Get-CsOnlineApplicationInstance` / article titles.

---

## 11. Bounded hypothesis

**Partially succeeded.**

The query-shape mismatch was real for TSUC04, TSUC13, and TSUC26, and a general phrase/alias layer moved already-local parents into a better candidate range. TSUC27 is not a phrase-preservation problem: the useful planning pages exist, but broad rollout language still loses to AA/CQ on the vector side. Fixing that with `upgrade` / `network readiness` / `deployment planning` aliases would start encoding this benchmark’s wording, which this phase forbids.

Production LOC (51) exceeded the ~30-line sketch because of comments plus the gated alias block. The **entry count stayed at 8** (≤10). No second round of rules.

Relay was not integrated. Retrieval hashes above are the I6B search.py state. Do not commit or push.

---

## B. PARTIAL BENEFIT — DO NOT EXPAND RULESET FURTHER
