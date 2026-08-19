# PHASE R0.1 — Mechanical Retrieval Corrections

Date: 2026-08-17  
Engine: `C:\Users\joegc\projects\learn-rag\learn-rag`  
Relay production source (`meeting-agent/src`): **not modified**  
YAML rerank (Mode B/C): **not used**  
New sources: **none**  
Commit: none

## Recommendation

**B. CONDITIONAL** — the three mechanical corrections worked, but retrieval is not yet strong enough for a Relay answer-path prototype.

Excluding Q03 SOURCE_GAP, unscoped answerable totals are **6/13 top-1** and **12/13 top-3**. The STRONG gate required **10/13 top-1**. Q04's canonical overview is now fused rank 3. Q14 PowerShell-scoped retrieval places `Get-CsOnlineUser` at fused rank 2. Chrome headings no longer win. Warm p95 is **20.2 ms**.

The remaining bounded defect is the same class R0 left after chrome is removed: **intra-article H2 ranking** (analog-device steps and configuration examples still outrank authored overviews). Unscoped Q14 still misses; that is expected without a query router, which this slice was forbidden to add.

Do not integrate into Relay. Do not add another tuning layer. Do not begin answer generation.

---

## 0. Safety / baseline

| Check | Result |
|---|---|
| learn-rag working directory | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| learn-rag git | `master`, untracked project files only; no commit |
| Relay git | `cursor/msteams-docs-knowledge-base`; `src/` dirty from prior I2–I4 work, **not edited in R0.1** |
| R0 artifacts | preserved under `eval/runs/retrieval-r0/` |
| Mode B/C | not run as acceptance |

R0 Mode-A baseline loaded from `eval/runs/retrieval-r0/results.json` (not re-tuned):

| Metric | R0 Mode A |
|---|---|
| top-1 | **6/14** |
| top-3 | **11/14** |
| COMPLETE | 3 (Q08, Q09, Q11) |
| PARTIAL | 8 |
| INSUFFICIENT | 3 (Q03, Q13, Q14) |
| warm p50 | 12.5 ms |
| warm p95 | 28.1 ms |
| parents / children | 1553 / 2575 |

That baseline reproduced as a loaded artifact. Comparison below uses those exact numbers.

---

## 1. Files changed (learn-rag only)

| File | Change |
|---|---|
| `build/transform.py` | Retrieval-parent hygiene: chrome headings and navigation-only `Next steps` are not indexed as answer parents |
| `service/search.py` | Phrase/cmdlet FTS construction; `Timing.fts_query`; scoped candidate generation before fused-pool truncation; no silent global fallback |
| `tests/test_r01.py` | Hygiene, lexical, and scope tests |
| `eval/run_r0_1.py` | Priority-14 harness (hybrid only; Q14 unscoped + `msteams-ps` scoped) |

Relay `src/`, Deepgram, Electron, embeddings, HNSW architecture, R1–R4/WB-21, and answer synthesis were not modified.

---

## 2. Fix A — chrome parent hygiene

Implemented in `is_chrome_heading` / `is_navigation_only_next_steps` / `is_indexable_retrieval_parent` in `build/transform.py`. `parse_file` skips non-indexable sections. Source articles are not deleted. Chrome H2s remain in the markdown; they are not inserted into `parents`, FTS, or HNSW.

**Always excluded** (case-insensitive, punctuation/whitespace folded):

- `Feedback`
- `See also`
- `Related topics` / `Related topic`
- `References`
- same-class `Related articles` / `Related content` / `Related … articles|topics|content`

Not excluded merely for containing the word "reference" (`Country and region code reference table` stays).

**`Next steps`:** not blindly dropped. Navigation-only bodies (See/Review/Implement link lists with little leftover prose) are excluded. Substantive technical `Next steps` (policies, configuration) are kept.

Rebuild: `python -m build.run --full --skip-sync` (0 new embeddings; 320 stale vectors pruned).

---

## 3. Fix B — lexical query construction

**Before R0.1:** every non-stopword token, quoted, joined with `OR` (max 24).

**After:** `build_fts_query()` combines, still with OR (not AND):

1. Cmdlet-shaped tokens (`Verb-Noun` with a capital after the hyphen), quoted whole: `"Get-CsOnlineUser"`
2. Multi-word technical phrases present in the query (`direct routing`, `voice routing policy`, `pstn usage`, `voice route`, `call quality dashboard`, `teams rooms`, `resource account`, `auto attendant`, `call queue`, `sharepoint advanced management`, plus Title-Case runs)
3. Remaining useful unigrams
4. Weak conversational unigrams omitted when they are not inside a phrase: explain, walk, troubleshoot, role, chain, process, configure, use
5. If nothing survives, fall back to ordinary non-stopword terms

Hyphens in `voice-routing policy` are folded so the three-word phrase still matches. Punctuation is stripped of FTS5 syntax.

Every Priority-14 question's final FTS string is in §7 and `raw_results.json`.

---

## 4. Fix C — scope before truncation

**Before:** global vector + global lexical → RRF → truncate fused pool to 24 → apply `service`/`repo` filter.

**After:** when `SearchEngine.search()` is given `service` and/or `repo` (and/or `subservice`):

- Lexical FTS is `JOIN parents` restricted to that scope **before** LIMIT
- Vector HNSW over-queries, then only scoped parents are eligible for the vector list **before** fusion
- Empty scoped corpus returns `[]` (no fabricated/global hits)
- `allow_unscoped_fallback=False` by default; the engine does not silently fall back to global retrieval

Unscoped `search()` is unchanged except for Fixes A and B.

Q14 scoped run used the existing explicit parameter `service="msteams-ps"`. No query router was added.

---

## 5. Tests

```
python -m unittest tests.test_r01 -v    # 21 tests OK
python -m tests.smoke                   # 0 failures
python -m unittest tests.test_blockers  # still OK
```

Fix A: Feedback / See also / Related topics / References not indexed; technical sections remain; meaningful Next steps kept; navigation-only Next steps dropped; `parse_file` integration.

Fix B: `Get-CsOnlineUser` clause; `voice routing policy` and `pstn usage` phrases; ordinary NL still valid; punctuation/hyphens; graceful degradation; `explain`/`role` not required clauses.

Fix C: unscoped still returns hits; scoped PowerShell generates PowerShell candidates; Q14-like query includes `Get-CsOnlineUser` under `msteams-ps`; `repo=teams` does not search SharePoint parents; empty scope returns nothing; no silent fallback to the global winner.

---

## 6. Corpus counts (verified from SQLite)

| Metric | Before | After |
|---|---|---|
| Parents | 1553 | **1233** |
| Children / HNSW vectors | 2575 | **2255** |
| Feedback parents | 227 | **0** |
| See also parents | 8 | **0** |
| Related topics parents | 27 | **0** |
| References parents | 3 | **0** |
| Related-articles class (extra hygiene) | 54 | **0** |
| Next steps excluded | — | **1** (SharePoint Restrict discovery link-out list) |
| Next steps retained | 3 | **2** (voice-apps operational closeout; Rooms policies/bandwidth) |

Zero remaining Feedback / See also / Related topics / References parents was verified with `SELECT section FROM parents` after rebuild, not assumed.

---

## 7. Per-question generated FTS5 query

| Q | Final FTS |
|---|---|
| Q01 | `"direct routing" OR "SBC"` |
| Q02 | `"Teams" OR "user" OR "make" OR "internal" OR "calls" OR "but" OR "cannot" OR "call" OR "external" OR "PSTN" OR "numbers"` |
| Q03 | `"direct routing" OR "one" OR "way" OR "audio" OR "Teams" OR "call"` |
| Q04 | `"direct routing" OR "voice routing policy" OR "pstn usage" OR "voice route" OR "SBC" OR "gateway"` |
| Q05 | `"direct routing" OR "renew" OR "replace" OR "SBC" OR "certificate" OR "Teams"` |
| Q06 | `"direct routing" OR "emergency" OR "calling" OR "Teams" OR "location" OR "information"` |
| Q07 | `"auto attendant" OR "call queue" OR "building" OR "ultimately" OR "routes" OR "callers"` |
| Q08 | `"resource account" OR "teams room" OR "Microsoft"` |
| Q09 | `"teams room" OR "resource account" OR "locked" OR "out" OR "cannot" OR "sign"` |
| Q10 | `"teams room" OR "joins" OR "meeting" OR "but" OR "far" OR "end" OR "cannot" OR "hear" OR "room" OR "check"` |
| Q11 | `"teams rooms" OR "manage" OR "monitor" OR "fleet" OR "Microsoft" OR "at" OR "scale"` |
| Q12 | `"call quality dashboard" OR "difference" OR "per" OR "user" OR "call" OR "troubleshooting"` |
| Q13 | `"secure" OR "review" OR "SharePoint" OR "OneDrive" OR "rolling" OR "out" OR "Microsoft" OR "365" OR "Copilot"` |
| Q14 | `"Teams Voice" OR "PowerShell" OR "audit" OR "users" OR "voice" OR "configuration"` |

Q14 scoped used the same FTS string; only candidate generation was scoped.

---

## 8. Full 14-question results (hybrid only)

Rank grades: TOP1_CORRECT / TOP3_CORRECT / MISS. Completeness: COMPLETE / PARTIAL / INSUFFICIENT / SOURCE_GAP.

| Q | Top-1 | Top-2 | Top-3 | Rank | Completeness | vs R0 Mode A |
|---|---|---|---|---|---|---|
| Q01 | Analog devices Step 1 (connect SBC) | Plan DR Support boundaries | Configure Direct Routing Overview | TOP3_CORRECT | PARTIAL | Chrome `See also` gone. Still not Plan/Configure overview at #1. |
| Q02 | AA transfer to external PSTN | PSTN connectivity What's next? | Issues with outbound calls | TOP3_CORRECT | PARTIAL | Unchanged pattern. |
| Q03 | GCC High Audio Conferencing | Plan DR Licensing | Inbound DR no ringback | MISS | **SOURCE_GAP** | Unchanged. Not treated as retrieval success. |
| Q04 | Analog devices Step 4 | Call routing Example 1 | **Call routing overview** | TOP3_CORRECT | PARTIAL | **Canonical overview now #3** (R0: not in top 3). |
| Q05 | SIP OPTIONS/TLS overview | **Plan DR Public trusted certificate** | What's New CA change | TOP3_CORRECT | PARTIAL | Mild regression: cert was R0 #1, now #2. |
| Q06 | **Dynamic emergency calling Overview** | DR emergency call routing | DR dynamic emergency | TOP1_CORRECT | PARTIAL | Same article family; Overview now #1. |
| Q07 | **Setup Auto Attendant steps** | AA design | Call-flow best practices | TOP1_CORRECT | PARTIAL | Improved (R0 AA setup was #3). CQ setup still not top 3. |
| Q08 | **create-resource-account + license** | Rooms deploy resource accounts | Rooms resource accounts configure | TOP1_CORRECT | COMPLETE | Next steps no longer in top 3. |
| Q09 | **Fix RA sign-in Overview** | Rooms auth differences | Fix RA sign-in Resolution | TOP1_CORRECT | COMPLETE | Same canonical troubleshoot URL; Resolution now #3. |
| Q10 | Rooms Windows software issues | Android room devices | Rooms Windows hardware | TOP3_CORRECT | PARTIAL | Unchanged class (known issues, not far-end media runbook). |
| Q11 | **Rooms Pro management Overview** | device settings | Rooms deploy | TOP1_CORRECT | COMPLETE | Unchanged. |
| Q12 | Monitor/troubleshoot call quality | Call Analytics support roles | CQD measurements | TOP1_CORRECT | PARTIAL | CQD phrase + per-user Call Analytics both in top 3. |
| Q13 | Roll out SP/OD Overview | Plan SP/OD Overview | Get ready for Copilot SAM **Step 5 backup** | TOP3_CORRECT | PARTIAL | Improved vs R0 MISS. Governance Overview is fused **14**, not top 3. |
| Q14 unscoped | AA voice applications policies | Authorized users Step 4 | voice applications settings | MISS | INSUFFICIENT | Still starved globally. |
| Q14 scoped `msteams-ps` | Get-CsOnlineVoiceRoutingPolicy | **Get-CsOnlineUser** | Get-CsOnlineVoiceRoute | TOP1_CORRECT | COMPLETE | **Fix C works.** |

---

## 9. Answerable-question totals (exclude Q03 SOURCE_GAP)

**Unscoped Q14** (13 questions: Q01, Q02, Q04–Q14):

| | R0.1 | STRONG gate |
|---|---|---|
| top-1 | **6/13** | 10/13 — **missed** |
| top-3 | **12/13** | 12/13 — met |

Top-1: Q06, Q07, Q08, Q09, Q11, Q12.  
Top-3 miss: Q14 unscoped only.

**Q14 scoped substituted** (tests Fix C, not a production router):

| | R0.1 |
|---|---|
| top-1 | 7/13 |
| top-3 | 13/13 |

STRONG top-1 gate is still missed.

Including Q03 as a 14-row scoreboard (unscoped): top-1 **6/14**, top-3 **12/14** (R0 was 6/14 and 11/14).

---

## 10. Q01 analysis

R0 top-1 was Connect SBC **See also**. That heading is no longer an indexed parent (DB count 0).

New top 3:

1. Direct Routing - Connecting analog devices :: Step 1: Connect the SBC to Direct Routing
2. Plan Direct Routing :: Support boundaries
3. Configure Direct Routing :: Overview

`See also` cannot win. Remaining miss vs an "explain DR + SBC" overview is H2 ranking among technical sections, not chrome.

---

## 11. Q04 analysis

Canonical parent is present:

`Configure call routing for Direct Routing :: Call routing overview`  
`https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing`  
`parent_id=601fbf6e4fdfbb3f78d2`

| Channel | Rank |
|---|---|
| Vector | **1** |
| Lexical | **13** |
| Fused (pool) | **3** |
| Fused (returned top-k) | **3** |

Target (top 3 minimum) **met**. Top 1 preferred, not met: analog-devices Step 4 and Example 1 still fuse above the overview. No Q04-specific boost was added. Lexical rank 13 is why fusion is 3 despite vector rank 1.

---

## 12. Q13 analysis (no YAML rerank)

Correct SAM/Copilot governance article: **Get ready for Microsoft 365 Copilot with SharePoint Advanced Management**.

| Parent | Vector | Lexical | Fused |
|---|---|---|---|
| Get ready … :: Step 5 backup (returned #3) | 1 | 11 | **3** |
| Get ready … :: Step 3 prevent oversharing | 2 | 28 | 5 |
| Get ready … :: Overview | 9 | — | **14** |

**Improved** vs R0 Mode A (MISS; generic rollout only). Not the Mode B win (Overview TOP1 COMPLETE). The returned SAM hit is the backup step, not the governance overview. No Q13-specific boost.

---

## 13. Q14 analysis

`Get-CsOnlineUser` remains indexed (`ms.service=msteams-ps`, canonical module URL).

| Run | Vector | Lexical | Fused pool | Returned |
|---|---|---|---|---|
| Unscoped | None (not in 30) | None (not in 30) | None | AA/CQ policy pages |
| Scoped `service=msteams-ps` | **1** | **4** | **2** | #2 of 3 |

Scoped top 3: `Get-CsOnlineVoiceRoutingPolicy`, `Get-CsOnlineUser`, `Get-CsOnlineVoiceRoute`. Materially correct Teams Voice PowerShell parents. Target **met**.

Unscoped still cannot recover the cmdlet from the global fused pool. That is a routing/classification problem, not a scoped-generation bug. No silent fallback.

---

## 14. Q03 SOURCE_GAP

No parent title/section/URL in this corpus contains a dedicated one-way-audio Direct Routing runbook. Hits are GCC High Audio Conferencing, licensing, and inbound ringback. **SOURCE_GAP**. Not scored as retrieval success. No Entra/extra Teams/SBC vendor ingest was performed.

---

## 15. Latency (warm, after changes)

60 warm queries (14 unscoped × 4 repeats + Q14 scoped × 4).

| | min | p50 | p95 | max |
|---|---|---|---|---|
| total | 6.8 | **10.8** | **20.2** | 35.2 |
| embed | 4.6 | 7.7 | 18.0 | 31.3 |
| HNSW | 0.24 | 0.32 | 0.99 | 1.13 |
| lexical | 0.98 | 1.9 | 3.2 | 11.1 |
| fusion | 0.02 | 0.03 | 0.05 | 0.05 |
| fetch | 0.16 | 0.26 | 0.34 | 0.55 |

Target warm p95 < 200 ms: **pass**. Not a regression vs R0 ~28 ms (p95 improved). Cold engine init 1148 ms; first query 24 ms.

---

## 16. Regressions

- Q05: correct cert parent moved from R0 top-1 to top-2 (SIP OPTIONS overview now #1). Still top 3.
- Q09: Resolution section moved from #1 to #3; Overview of the same article is #1. Still COMPLETE.
- Unscoped Q14 unchanged miss (expected without a router).
- Q01/Q04: analog-device steps still outrank overviews.

No chrome regression: Feedback/See also/Related topics/References counts are 0 in SQLite.

---

## 17. Remaining bounded defects

1. **H2 ranking among remaining technical parents** — examples and numbered analog-device steps still beat authored overviews (Q01, Q04). This is not chrome and was not a fourth architecture.
2. **Unscoped cmdlet retrieval** — Fix C works when `service`/`repo` is supplied. There is still no query router to supply that scope from a natural-language question.
3. **Q13 subsection ranking** — SAM article is now in the fused pool; Overview is fused 14; backup Step 5 is the top-3 hit.
4. **Q03 SOURCE_GAP** — coverage, not ranking.
5. Leftover weak unigrams in some FTS strings (`but`, `out`, `at`, `per`) — not observed as the Q04/Q14 failure mode.

---

## Acceptance gate

| Criterion | Result |
|---|---|
| ≥10/13 answerable top-1 | **No** (6/13 unscoped, 7/13 with Q14 scoped) |
| ≥12/13 answerable top-3 | **Yes** (12/13 unscoped, 13/13 with Q14 scoped) |
| Q04 overview top 3 | **Yes** (fused 3; vector 1; lexical 13) |
| Q14 scoped PS top 3 | **Yes** (`Get-CsOnlineUser` fused 2) |
| Chrome no longer wins | **Yes** (DB counts 0; Q01 See also gone) |
| Warm p95 < 200 ms | **Yes** (20.2 ms) |
| No question-specific boosts | **Yes** |

STRONG gate **missed** on top-1. Stop. No additional tuning layer.

---

## Recommendation

**B. CONDITIONAL** — one clearly bounded retrieval defect remains (intra-article technical H2 ranking, plus the still-unscoped Q14 path which is a router problem this slice was not allowed to solve).

Do not integrate into Relay. Do not modify Deepgram. Do not begin answer generation. Do not begin follow-up/context work.
