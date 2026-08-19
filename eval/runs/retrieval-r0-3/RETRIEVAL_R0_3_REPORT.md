# PHASE R0.3 — Candidate Recall Depth Audit

Date: 2026-08-17  
Read-only. No retrieval change. No ground-truth change. No reranker.

## Recommendation

**B. ROUTING/CANDIDATE GENERATION STILL REQUIRED**

12/13 frozen answerable targets are already inside the production fused pool by rank 5. Q14 unscoped is not. At the current hybrid settings (`candidates=30`) `Get-CsOnlineUser` is absent from both the vector list and the lexical list, so it cannot appear in top 50 and a perfect reranker on that pool cannot recover it. Explicit `msteams-ps` scope still places it at fused rank 2.

A reranker can address precision for Q13 (correct SAM Step 3 is fused rank 5; wrong Step 5 is rank 3). It cannot solve unscoped Q14.

---

## 1. Safety

| Check | Result |
|---|---|
| learn-rag directory | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| `service/search.py` | sha256[:16] `8702daf1ee2b2843` (R0.1/R0.2 freeze) |
| `build/transform.py` | `9ebb37b3313c23c0` |
| `eval/run_r0_1.py` | `c514a53628ba899b` |
| Frozen GT | `eval/ground_truth/priority14_retrieval.json` sha256 `59f6572dc5f3d3d574bb4054199b5c32542d18eedd07dc07d16b228a8562ee40` |
| Relay `src/` | not edited |
| R0 / R0.1 / R0.2 artifacts | preserved; this run wrote only `eval/runs/retrieval-r0-3/` |

Production depth used the existing `SearchEngine.search(..., candidates=30)` fused list (`last_fused_ids`). Q14 diagnosis also called the same method with `candidates=100` and `service="msteams-ps"`. No code in `search.py` was changed.

---

## 2. Machine-computed Recall@K

Unscoped, frozen R0.2 targets, production candidate generation (`candidates=30`). Denominator = 13 answerable. Q03 = SOURCE_GAP, excluded.

| K | Recall |
|---|---|
| 1 | **7/13** |
| 3 | **11/13** |
| 5 | **12/13** |
| 10 | **12/13** |
| 20 | **12/13** |
| 30 | **12/13** |
| 50 | **12/13** |

@1 and @3 reproduce R0.2. The +1 at @5 is Q13 (Step 3 at fused rank 5). The remaining miss at every K is Q14 unscoped (`NOT_IN_TOP_50`).

---

## 3. First acceptable rank (unscoped, candidates=30)

| Q | First rank | URL | Section | Vector | Lexical | Fused | matched_by | Level |
|---|---|---|---|---|---|---|---|---|
| Q01 | 3 | direct-routing-configure | Overview | 4 | 11 | 3 | vector+lexical | SECTION |
| Q02 | 3 | issues-with-outbound-calls | Some users are unable to make calls | 5 | 10 | 3 | vector+lexical | SECTION |
| Q03 | SOURCE_GAP | — | — | — | — | — | — | — |
| Q04 | 3 | direct-routing-voice-routing | Call routing overview | 1 | 13 | 3 | vector+lexical | SECTION |
| Q05 | 2 | direct-routing-plan | Public trusted certificate for the SBC | 1 | 4 | 2 | vector+lexical | SECTION |
| Q06 | 1 | configure-dynamic-emergency-calling | Overview | 5 | 1 | 1 | vector+lexical | ARTICLE |
| Q07 | 1 | aa-cq-setup-auto-attendant | Steps to create an auto attendant | 3 | 7 | 1 | vector+lexical | ARTICLE |
| Q08 | 1 | rooms/create-resource-account | Create resource account & assign the license | 1 | 3 | 1 | vector+lexical | ARTICLE |
| Q09 | 1 | teams-rooms-resource-account-sign-in-issues | Overview | 2 | 5 | 1 | vector+lexical | ARTICLE |
| Q10 | 1 | teams-rooms-known-issues-windows | Software issues | 2 | 3 | 1 | vector+lexical | ARTICLE |
| Q11 | 1 | rooms-pro-management | Overview | 3 | 2 | 1 | vector+lexical | ARTICLE |
| Q12 | 1 | monitor-call-quality-qos | Monitor and troubleshoot call quality | 4 | 8 | 1 | vector+lexical | ARTICLE |
| Q13 | 5 | get-ready-copilot-sharepoint-advanced-management | Step 3: Prevent accidental oversharing | 2 | 28 | 5 | vector+lexical | SECTION |
| Q14 | **NOT_IN_TOP_50** | get-csonlineuser (indexed) | Get-CsOnlineUser | none | none | none | — | ARTICLE |

---

## 4. Q13 SAM ranks (frozen acceptable = Overview, Steps 1–3)

Article: `https://learn.microsoft.com/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management`

| Section | Acceptable? | Vector | Lexical | Fused |
|---|---|---|---|---|
| Overview | yes | 9 | — | **14** |
| Step 1: Use Content Management Assessment | yes | 10 | 27 | **10** |
| Step 2: Employ site lifecycle management and archiving | yes | 15 | — | **18** |
| Step 3: Prevent accidental oversharing | yes | 2 | 28 | **5** |
| Step 4: Use the SharePoint Admin Agent | no | 16 | — | 19 |
| Step 5: Implement backup and restore procedures | no | 1 | 11 | **3** |

Overview fused rank 14 is confirmed. The first frozen-correct target a reranker can see is **Step 3 at fused rank 5**. Minimum candidate-set size: **5**.

Wrong sibling Step 5 sits at fused rank 3 (above every acceptable section). That is a precision problem, not a candidate-generation miss.

---

## 5. Q14 unscoped vs scoped

`Get-CsOnlineUser` **is indexed** (`parent_id=0d0e05a0a4f37672b97e`, canonical module URL). Frozen GT has only this article.

### Unscoped, production (`candidates=30`, fused_n=43)

| | Vector | Lexical | Fused |
|---|---|---|---|
| Get-CsOnlineUser | none | none | none |

Cause: **target absent from vector candidates; target absent from lexical candidates**. Not a post-fusion truncation. Not a scope filter (search was unscoped).

### Unscoped, diagnostic over-generation (`candidates=100` via existing `search()` argument; not a code change)

| | Vector | Lexical | Fused |
|---|---|---|---|
| Get-CsOnlineUser | **25** | **85** | **24** |

Lexical rank 85 explains the production miss: FTS LIMIT 30 never sees it. Vector unique-parent rank 25 is also outside the production HNSW k=30 unique-parent list.

### Explicit `service=msteams-ps`, `candidates=30`

| | Vector | Lexical | Fused |
|---|---|---|---|
| Get-CsOnlineUser | **1** | **4** | **2** |

Unscoped candidate generation at the current 30-wide pool does **not** contain the PowerShell evidence deeply enough for a reranker. Explicit scope/routing is required unless candidate generation itself is widened (that would be a retrieval change; not done here).

No other frozen acceptable Teams Voice PowerShell target exists in GT besides `Get-CsOnlineUser`.

---

## 6. Causes for rank > 10

Only **Q14** is outside top 10.

| Q | Cause |
|---|---|
| Q14 unscoped | Target indexed, but absent from vector candidates **and** absent from lexical candidates at `candidates=30`. Therefore absent from RRF. Not excluded by a filter. |

No other answerable question has first rank > 10.

---

## 7. Theoretical perfect-reranker coverage

A perfect reranker can promote a target to #1 only if it is already in the candidate set. Measured on the **production** fused pool (`candidates=30`).

| Candidate set K | Answerable questions fixable to top-1 |
|---|---|
| 5 | **12/13** |
| 10 | **12/13** |
| 20 | **12/13** |
| 30 | **12/13** |
| 50 | **12/13** |

The missing 1/13 at every K is Q14. Q13 becomes fixable at K=5.

---

## 8. Latency (warm, no rerank)

14 questions × 4 repeats. `candidates = max(K, 30)` so K≤30 matches production generation; K=50 uses `candidates=50`.

| K | p50 ms | p95 ms | max ms |
|---|---|---|---|
| 3 | 9.0 | 12.9 | 21.3 |
| 5 | 8.8 | 11.5 | 12.2 |
| 10 | 10.6 | 23.8 | 64.0 |
| 20 | 13.3 | 24.1 | 81.9 |
| 30 | 11.0 | 26.1 | 26.5 |
| 50 | 11.2 | 13.8 | 22.7 |

Over-fetching 20–30 parents does not move the profile out of the ~10–15 ms p50 / <30 ms p95 band (still far under 200 ms). Isolated max spikes at K=10/20 look like single-query outliers, not a new baseline.

---

## 9. Interpretation

**A** is not used: 12/13 are in top 10, but not 13/13, and Q14 is a candidate-generation hole, not a precision hole.

**C** is not used: 12/13 frozen targets are already in the production pool by rank 5. The foundation is not broadly insufficient.

**B. ROUTING/CANDIDATE GENERATION STILL REQUIRED** — Q14 unscoped remains absent from the current fused pool even at rank 50. A reranker on that pool cannot fix it. Scoped PowerShell search already can.

No retrieval change. No reranker implemented. No Relay integration.

Command: `python eval/run_r0_3.py` from `C:\Users\joegc\projects\learn-rag\learn-rag`.
