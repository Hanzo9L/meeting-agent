# PHASE R0.2 — Frozen Ground-Truth Retrieval Evaluation

Date: 2026-08-17  
Engine: `C:\Users\joegc\projects\learn-rag\learn-rag`  
Relay production source: **not modified**  
Retrieval code: **unchanged**

## Verdict

**R0.1 RETRIEVAL RECALL NOT CONFIRMED**

Machine-computed unscoped answerable recall is **7/13 top-1** and **11/13 top-3**. R0.1 claimed **6/13** and **12/13**. Ground truth was not edited after seeing the score.

Q03 is **SOURCE_GAP** (1) and is excluded from those denominators.

---

## 0. Safety

| Check | Result |
|---|---|
| learn-rag cwd | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| learn-rag git | untracked project tree; no commit |
| Relay `src/` | dirty from prior I2–I4 work; **not edited in R0.2** |
| R0 artifacts | preserved `eval/runs/retrieval-r0/` |
| R0.1 artifacts | preserved `eval/runs/retrieval-r0-1/` (this run wrote only `retrieval-r0-2/`) |
| Retrieval freeze | `service/search.py` sha256[:16] `8702daf1ee2b2843` |
| | `build/transform.py` sha256[:16] `9ebb37b3313c23c0` |
| | `eval/run_r0_1.py` sha256[:16] `c514a53628ba899b` |

Hashes were identical after the rerun. No retrieval, embedding, HNSW, FTS, phrase-list, Deepgram, Electron, or answer-generation change was required.

---

## 1. Files changed

Learn-rag (evaluation only):

| File | Role |
|---|---|
| `eval/ground_truth/priority14_retrieval.json` | Frozen machine-readable GT |
| `eval/ground_truth/PRIORITY14_GROUND_TRUTH.md` | Human companion |
| `eval/evaluate_priority14.py` | Deterministic evaluator |
| `eval/run_r0_2.py` | Re-runs frozen R0.1 search into a new folder, then scores |
| `eval/__init__.py` | Package marker for `-m eval.evaluate_priority14` |
| `tests/test_r02_eval.py` | URL/section/scoring tests |

Meeting-agent (reports only):

- `eval/runs/retrieval-r0-2/RETRIEVAL_R0_2_REPORT.md`
- `eval/runs/retrieval-r0-2/results.json`
- `eval/runs/retrieval-r0-2/raw_results.json`
- `eval/runs/retrieval-r0-2/scored.json`

Not changed: `service/search.py`, `build/transform.py`, `eval/run_r0_1.py`, corpus, embeddings, HNSW, Relay `src/`.

---

## 2. Retrieval code unchanged

`eval/run_r0_2.py` refuses to run if those three frozen hashes drift. This run did not drift. Search calls are the same 14 question strings, same `top_k=3`, same Q14 extra `service="msteams-ps"` path as R0.1.

---

## 3. Ground-truth schema

`priority14-retrieval-gt/v1`

Each question:

- `question_id`, `question`
- `status`: `ANSWERABLE` | `SOURCE_GAP`
- `result_path` (usually `unscoped`)
- optional `scoped_result_path` (`powershell_scoped` on Q14)
- `acceptable_sources[]`:
  - `url` (canonical Learn URL)
  - `titles[]` (optional constraint)
  - `sections[]` (required for `SECTION`)
  - `match_level`: `ARTICLE` | `SECTION`
- `notes`

Matching is exact after normalization (URL: locale prefix, trailing slash, case, fragment stripped; heading: case, whitespace, punctuation fold). No substring URL match. No LLM. No embedding similarity.

---

## 4. Question-by-question acceptable targets

See `eval/ground_truth/PRIORITY14_GROUND_TRUTH.md`. Summary:

| Q | Status | Level | Canonical target |
|---|---|---|---|
| Q01 | ANSWERABLE | SECTION | Plan DR Overview; Configure DR Overview |
| Q02 | ANSWERABLE | SECTION | issues-with-outbound-calls :: Some users are unable to make calls |
| Q03 | SOURCE_GAP | — | none |
| Q04 | ANSWERABLE | SECTION | direct-routing-voice-routing :: Call routing overview |
| Q05 | ANSWERABLE | SECTION | Plan DR :: Public trusted certificate for the SBC |
| Q06 | ANSWERABLE | ARTICLE + SECTION | configure-dynamic-emergency-calling (article); DR considerations emergency H2s |
| Q07 | ANSWERABLE | ARTICLE | aa-cq-setup-auto-attendant; aa-cq-setup-call-queue |
| Q08 | ANSWERABLE | ARTICLE | rooms/create-resource-account |
| Q09 | ANSWERABLE | ARTICLE | teams-rooms-resource-account-sign-in-issues |
| Q10 | ANSWERABLE | ARTICLE + SECTION | Windows Rooms known-issues (article); Android room-device issues (section) |
| Q11 | ANSWERABLE | ARTICLE | rooms-pro-management |
| Q12 | ANSWERABLE | ARTICLE | monitor-call-quality-qos; use-call-analytics-to-troubleshoot-poor-call-quality |
| Q13 | ANSWERABLE | SECTION | Get ready for Copilot SAM Overview + Steps 1–3 (not Step 5 backup) |
| Q14 | ANSWERABLE | ARTICLE | Get-CsOnlineUser (unscoped scoreboard; scoped scored separately) |

---

## 5. Machine-computed result (unscoped)

| Q | Human R0.1 | Machine R0.2 | Match | Why |
|---|---|---|---|---|
| Q01 | TOP3 | TOP3 | SECTION rank 3 | Configure Direct Routing :: Overview |
| Q02 | TOP3 | TOP3 | SECTION rank 3 | Some users are unable to make calls |
| Q03 | SOURCE_GAP | SOURCE_GAP | — | excluded from denominators |
| Q04 | TOP3 | TOP3 | SECTION rank 3 | Call routing overview (Example 1 at #2 did not count) |
| Q05 | TOP3 | TOP3 | SECTION rank 2 | Public trusted certificate for the SBC |
| Q06 | TOP1 | TOP1 | ARTICLE rank 1 | Configure dynamic emergency calling |
| Q07 | TOP1 | TOP1 | ARTICLE rank 1 | Setup Auto Attendant |
| Q08 | TOP1 | TOP1 | ARTICLE rank 1 | create-resource-account |
| Q09 | TOP1 | TOP1 | ARTICLE rank 1 | Fix RA sign-in Overview |
| Q10 | TOP3 | **TOP1** | ARTICLE rank 1 | Windows known-issues Software issues |
| Q11 | TOP1 | TOP1 | ARTICLE rank 1 | Rooms Pro management |
| Q12 | TOP1 | TOP1 | ARTICLE rank 1 | Monitor and troubleshoot call quality |
| Q13 | TOP3 | **MISS** | none | SAM Step 5 backup is not an allowed governance heading |
| Q14 | MISS | MISS | none | unscoped AA policy pages |

Q14 scoped (not in 13-count): human R0.1 TOP1; machine **TOP3** because `Get-CsOnlineUser` is rank 2 and `Get-CsOnlineVoiceRoutingPolicy` is not in frozen GT.

---

## 6–8. Totals

| | Machine | R0.1 claim |
|---|---|---|
| Answerable top-1 | **7/13** | 6/13 |
| Answerable top-3 | **11/13** | 12/13 |
| SOURCE_GAP | **1** (Q03) | 1 (Q03) |

Top-1 correct: Q06, Q07, Q08, Q09, **Q10**, Q11, Q12.  
Top-3 misses: Q13, Q14.

---

## 9. Comparison to R0.1 claimed 6/13 and 12/13

The claimed totals were prose grades. Frozen matching disagrees on two answerable questions:

1. **Q10** — R0.1 wrote TOP3 PARTIAL (“known issues, not a far-end media runbook”) while still treating those known-issues URLs as the in-corpus checks. Frozen GT encodes those URLs as acceptable (Windows ARTICLE). Rank 1 is that article, so the machine reports TOP1. That raises top-1 from 6 to 7.
2. **Q13** — R0.1 counted SAM **Step 5 backup** as TOP3. Frozen GT is SECTION-level on Overview / Steps 1–3 because R0.1 itself said Overview is the governance parent and Step 5 is the wrong subsection. Rank 3 is Step 5, so the machine reports MISS. That lowers top-3 from 12 to 11.

Ground truth was not edited to restore 6/13 and 12/13.

---

## 10. Human vs frozen evaluator

Differed:

- Q10: TOP3 → TOP1
- Q13: TOP3 → MISS
- Q14 scoped (diagnostic only): TOP1 → TOP3 (`Get-CsOnlineUser` is #2)

Agreed: Q01–Q09, Q11, Q12, Q14 unscoped, Q03 SOURCE_GAP.

No ground-truth mistake was found that required stopping mid-run. The Q10/Q13 gaps are human-grade vs frozen-rule disagreements, not corpus or matcher bugs.

---

## 11. Tests

```
python -m unittest tests.test_r02_eval -v
```

12 tests OK, covering: exact URL; locale; trailing slash; section fold; wrong sibling fails SECTION; sibling passes ARTICLE; unrelated article fails; SOURCE_GAP excluded from denominator; top-1/top-3 independent; output stable; frozen GT marks Q03 SOURCE_GAP.

`python -m unittest tests.test_r01` still OK (retrieval behavior untouched).

---

## 12. Exact benchmark command

From `C:\Users\joegc\projects\learn-rag\learn-rag`:

```
.\.venv\Scripts\python.exe eval\run_r0_2.py
```

Equivalent scoring-only:

```
.\.venv\Scripts\python.exe -m eval.evaluate_priority14 --results C:\Users\joegc\projects\meeting-agent\eval\runs\retrieval-r0-2\raw_results.json --ground-truth eval\ground_truth\priority14_retrieval.json --out C:\Users\joegc\projects\meeting-agent\eval\runs\retrieval-r0-2\scored.json
```

---

## Stop

Do not tune retrieval. Do not add phrases, reranker, YAML ranking, Entra, one-way-audio sources, Relay integration, STT, or answer rendering.

**R0.1 RETRIEVAL RECALL NOT CONFIRMED**
