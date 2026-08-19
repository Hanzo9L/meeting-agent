# PHASE R0.5 — Local Cross-Encoder Reranker Trial

Date: 2026-08-17  
Frozen retriever, R0.4 router, and R0.2 ground truth were not modified. No new sources. No Relay integration. No answer generation.

## Recommendation

**NO RERANKER**

**C. STOP** — reranker does not justify added complexity

Neither local FastEmbed model materially improved frozen TOP-1 precision. Hybrid remains **7/13** top-1. Model A falls to **5/13**. Model B falls to **6/13**. The acceptance floor was ≥10/13 top-1. Both models also displace current TOP-1 winners (Q07 to rank 5, Q08 to rank 2) and push Q14’s frozen `Get-CsOnlineUser` from hybrid rank 2 to rank 5. Warm rerank p95 is ~1.3–1.6 s, far above the 150 ms combined budget.

A bounded win on Q04 (Model B) and Q13 (Model A) does not offset those losses.

---

## 1. Safety

| Check | Result |
|---|---|
| learn-rag working directory | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| git status (before this phase) | clean on `master` at `b967fb8` |
| R0–R0.4 artifacts | preserved; this run wrote only `eval/runs/retrieval-r0-5/` |
| `service/search.py` | sha256[:16] `8702daf1ee2b2843` (unchanged) |
| `service/scope_select.py` | `2a8caaabd00f4b08` (unchanged) |
| `build/transform.py` | `9ebb37b3313c23c0` (unchanged) |
| `eval/run_r0_1.py` | `c514a53628ba899b` (unchanged) |
| Frozen GT | `59f6572dc5f3d3d574bb4054199b5c32542d18eedd07dc07d16b228a8562ee40` (unchanged) |
| Relay production source | not edited |

Frozen components matched. Work continued.

---

## 2. Files changed

### learn-rag (new)

| File | Role |
|---|---|
| `service/rerank.py` | 143-line reorder-only FastEmbed wrapper + `search_then_rerank` |
| `tests/test_r05_rerank.py` | membership, determinism, GT, router-first, no-cloud, disable tests |
| `eval/run_r0_5.py` | Priority-14 A/B harness |

### meeting-agent (artifacts only)

| File | Role |
|---|---|
| `eval/runs/retrieval-r0-5/RETRIEVAL_R0_5_REPORT.md` | this report |
| `eval/runs/retrieval-r0-5/results.json` | machine results |
| `eval/runs/retrieval-r0-5/raw_results.json` | same payload |

Not changed: retrieval scoring, router, ground truth, embeddings, HNSW, FTS, phrases, parent hygiene, YAML ranking, Deepgram, Relay, Electron, R1–R4/WB-21, answer generation.

---

## 3. Reranker module contract

`service/rerank.py`

Input:

- question
- frozen top-N `Hit` parents (N=5)

Output (`RerankResult`):

- same candidates reordered
- `rerank_scores` aligned to the new order
- `original_ranks`
- `model` identifier
- `rerank_ms`
- per-candidate truncation diagnostics

Rules:

- Membership is a permutation of the input set. No new parents.
- `Hit.score` (hybrid retrieval) is not rewritten.
- Disabled path (`reranker=None` or `enabled=False`) returns hybrid order.
- Pipeline is `select_scope` → `SearchEngine.search(top_k=5)` → optional rerank.

---

## 4. Model A details

| | |
|---|---|
| id | `Xenova/ms-marco-MiniLM-L-6-v2` |
| backend | FastEmbed `TextCrossEncoder` (local ONNX) |
| advertised size | **0.08 GB** |
| license | apache-2.0 |
| cold init (download + load, first run) | **3690.5 ms** |
| description | MiniLM-L-6-v2 optimized for re-ranking |

---

## 5. Model B details

| | |
|---|---|
| id | `jinaai/jina-reranker-v1-tiny-en` |
| backend | FastEmbed `TextCrossEncoder` (local ONNX) |
| advertised size | **0.13 GB** |
| license | apache-2.0 |
| cold init (download + load, first run) | **3988.1 ms** |
| description | tiny English reranker, 8K context |

No additional models were tested. Both FastEmbed models loaded successfully. No cloud scoring API.

---

## 6. Input / truncation policy

One policy for both models:

```
Title: {title}
Section: {section}
{body[:1600]}
```

- Authored title, section heading, and section body only.
- No summaries, YAML scores, or question-specific hints.
- If `len(body) > 1600`, keep the start of the body and set `truncated=true`.
- Token approximation: `document_chars / 4`.
- Observed max approx tokens on this set: **432** (under MiniLM’s 512-token window after headers).
- Longest original body seen: **30134** chars (Q07); **5/5** Q14 cmdlet pages truncated.

Diagnostics are stored per question under `input.truncated_n`, `max_original_body_chars`, `max_document_chars`, `max_approx_tokens`.

---

## 7. Per-question first acceptable rank

Machine scoring against frozen R0.2 targets. Candidate parent_ids were identical across hybrid / A / B for every question.

| Q | Scope | Hybrid | Model A | Model B |
|---|---|---|---|---|
| Q01 | GLOBAL | 3 | 2 | 5 |
| Q02 | GLOBAL | 3 | 2 | 3 |
| Q03 | GLOBAL | SOURCE_GAP | SOURCE_GAP | SOURCE_GAP |
| Q04 | GLOBAL | 3 | 2 | **1** |
| Q05 | GLOBAL | 2 | 3 | 3 |
| Q06 | GLOBAL | 1 | 1 | 1 |
| Q07 | GLOBAL | 1 | **5** | **5** |
| Q08 | GLOBAL | 1 | 2 | 2 |
| Q09 | GLOBAL | 1 | 1 | 1 |
| Q10 | GLOBAL | 1 | 1 | 1 |
| Q11 | GLOBAL | 1 | 1 | 1 |
| Q12 | GLOBAL | 1 | 1 | 1 |
| Q13 | GLOBAL | 5 | **2** | 4 |
| Q14 | SCOPED `msteams-ps` | 2 | **5** | **5** |

Q03 remains SOURCE_GAP and is excluded from denominators.

---

## 8. Top-1 / top-3 / top-5 totals

Denominator = 13 answerable.

| | top-1 | top-3 | top-5 |
|---|---|---|---|
| Frozen hybrid (R0.4 path) | **7/13** | **12/13** | **13/13** |
| Model A | **5/13** | **11/13** | **13/13** |
| Model B | **6/13** | **9/13** | **13/13** |

13/13 remain inside top 5 (no candidate loss). Top-1 precision got worse, not better. Target ≥10/13 top-1 was not met.

---

## 9. Q04 — routing chain

Frozen target: `Configure call routing for Direct Routing :: Call routing overview` (SECTION).

Hybrid top 5 already contained it at **rank 3**, behind analog Step 4 and Example 1.

| | Rank of overview | Rerank score |
|---|---|---|
| Hybrid | 3 | — |
| Model A | 2 | 5.2005 |
| Model B | **1** | 2.6269 |

Model B does prefer the overview over Example 1/2. Model A moves it to 2 but puts analog Step 3 first. This is a real precision win for B on this one question. It is not enough to adopt B.

---

## 10. Q13 — SharePoint / Copilot

Frozen acceptable: SAM article Overview / Steps 1–3. **Not** Step 5.

Hybrid: Step 5 at rank 3; first acceptable **Step 3 at rank 5**.

| | First acceptable | Step 5 after rerank |
|---|---|---|
| Hybrid | Step 3 @ 5 | rank 3 |
| Model A | Step 3 @ **2** | rank 5 (demoted) |
| Model B | Step 3 @ 4 | rank 5 (demoted) |

Model A moves the acceptable SAM section up and does not treat wrong Step 5 as the answer. Generic “Roll out SharePoint and OneDrive” Overview still wins Model A rank 1, so Q13 is still not TOP-1.

---

## 11. Q14 — PowerShell audit

Automatic R0.4 router ran first: HIGH `msteams-ps` / `teams-ps`. No manual scope.

Frozen target: `Get-CsOnlineUser` ARTICLE.

| | Rank | Rerank score |
|---|---|---|
| Hybrid | **2** | — |
| Model A | **5** | −8.9642 |
| Model B | **5** | −0.7804 |

Both models prefer `Get-CsTeamsCallingPolicy` and other cmdlets over `Get-CsOnlineUser`. Truncation of long cmdlet reference bodies (all 5 truncated; original up to 26984 chars) is recorded; even so, the rerankers moved the frozen target **down**.

---

## 12. Regressions from current TOP-1 winners

Baseline TOP1_CORRECT before reranking: **Q06, Q07, Q08, Q09, Q10, Q11, Q12**

| Model | Retained TOP1 | Displaced, still in top 5 | Regressed to MISS |
|---|---|---|---|
| A | Q06, Q09, Q10, Q11, Q12 | Q07 → rank 5, Q08 → rank 2 | none |
| B | Q06, Q09, Q10, Q11, Q12 | Q07 → rank 5, Q08 → rank 2 | none |

Q07 is the serious regression: both models send the frozen auto-attendant setup parent from rank 1 to rank 5 (Model A score −2.52 vs conceptual siblings). A reranker that “fixes” Q04/Q13 while destroying Q07 is not acceptable.

---

## 13. Cold initialization

| Model | Cold init |
|---|---|
| A MiniLM-L-6 | 3690.5 ms (includes first Hugging Face fetch) |
| B jina tiny | 3988.1 ms (includes first Hugging Face fetch) |

Download/setup is excluded from warm query latency, as specified. FastEmbed catalog sizes: 0.08 GB and 0.13 GB.

---

## 14. Warm latency

Do not compare these retrieval times to the R0.4-only p50 (~12 ms): this process had two cross-encoders resident. Hybrid **ranks** still matched R0.4.

### Model A (ms)

| | min | p50 | p95 | max |
|---|---|---|---|---|
| router (scored 14) | 14.93 | 29.42 | 34.60 | 144.47 |
| retrieval (scored 14) | 200.74 | 305.49 | 367.94 | 384.81 |
| rerank warm (n=42) | 365.42 | **1358.53** | **1605.37** | 2618.98 |
| total scored (router+retrieval+rerank) | 1583.73 | 1659.39 | **1948.20** | 1968.12 |

### Model B (ms)

| | min | p50 | p95 | max |
|---|---|---|---|---|
| rerank warm (n=42) | 220.56 | **1082.41** | **1351.50** | 1435.25 |
| total scored | 1339.78 | 1491.35 | **1788.30** | 2551.30 |

Combined warm p95 target was **< 150 ms**. Measured combined p95 is about **1.8–1.9 s**. Not optimized in this slice (no ONNX/runtime tuning).

---

## 15. Model size

| Model | FastEmbed `size_in_GB` |
|---|---|
| A `Xenova/ms-marco-MiniLM-L-6-v2` | 0.08 |
| B `jinaai/jina-reranker-v1-tiny-en` | 0.13 |

---

## 16. Selected winner

**NO RERANKER**

Criteria in order:

1. Frozen top-1: hybrid 7/13 beats A 5/13 and B 6/13. Neither reaches ≥10/13.
2. Serious regressions: both displace Q07 (1→5) and Q14 (2→5).
3. Latency: rerank p95 > 1.3 s vs 150 ms budget.
4. Size/simplicity: unused if quality fails.

Do not choose a reranker merely because it exists.

---

## 17. Remaining retrieval defects

Without a reranker, the frozen R0.4 path still stands:

- Top-1 is **7/13**. Q01, Q02, Q04, Q05, Q13, Q14 are correct but not rank 1.
- Q13’s first acceptable parent is hybrid rank 5; wrong SAM Step 5 sits at rank 3.
- Q14 needs HIGH PowerShell scope to enter the pool; even then `Get-CsOnlineUser` is rank 2, not 1.
- Q03 remains SOURCE_GAP.
- Cross-encoder reranking of the proven top-5 set did not raise TOP-1 and hurt several already-good questions.

---

## Tests

`python -m unittest tests.test_r05_rerank -v` → **13 OK**

| # | Requirement | Result |
|---|---|---|
| 1 | membership unchanged | pass |
| 2 | only order changes | pass |
| 3 | deterministic repeated input | pass |
| 4 | frozen GT evaluator on reranked hits | pass |
| 5 | Q03 SOURCE_GAP excluded | pass |
| 6 | automatic router before retrieval | pass |
| 7 | no cloud scoring client | pass |
| 8 | retrieval score not rewritten | pass |
| 9 | no candidate outside the input top set | pass |
| 10 | reranker disable (`None` / `enabled=False`) | pass |

---

## Acceptance

**C. STOP** — reranker does not justify added complexity

Do not integrate into Relay. Do not begin answer generation. Do not modify Deepgram.
