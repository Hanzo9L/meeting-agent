# PHASE R0 — learn-rag Retrieval Kill Test

Date: 2026-08-17  
Engine: `C:\Users\joegc\projects\learn-rag\learn-rag`  
Relay production source (`meeting-agent/src`): **not modified**  
Commit: none

## Recommendation

**B. CONDITIONAL** — retrieval is promising but one clearly bounded problem must be fixed first.

Warm p95 is 28 ms (target 200 ms). Several Priority-14 questions return coherent authored Microsoft sections rather than 2200-character chunks. The kill-test gate of **12/14 top-3** is not met (Mode A: **11/14** top-3, **6/14** top-1). YAML rerank does not improve the real question set overall.

The bounded problem to fix before any Relay prototype: **parent ranking among H2 splits, plus cmdlet retrieval**. Leftover headings (`See also`, `Feedback`, `Example 1`) outrank the overview section that actually answers; `Get-CsOnlineUser` is in the index and never enters the hybrid candidate pool.

Do not integrate into Relay. Do not start the next phase.

---

## 0. Repository safety

| Check | Result |
|---|---|
| Working directory at start | `C:\Users\joegc\projects\meeting-agent` |
| Relay git | branch `cursor/msteams-docs-knowledge-base`, dirty I2–I4 / eval files |
| learn-rag root | `C:\Users\joegc\projects\learn-rag\learn-rag` (separate git repo, no commit) |
| Relay `src/` changed for this experiment | **No** |
| Eval artifacts | `eval/runs/retrieval-r0/` only |

---

## 1. Source vs DESIGN.md (verified in code, not docs)

| Claim | Source |
|---|---|
| `--skip-sync` reuses local clones | Parsed but originally unused; `fetch.sync()` always ran. **Fixed.** |
| `ON DELETE CASCADE` keeps children clean | Schema declared it; `sqlite3.connect` did not `PRAGMA foreign_keys=ON`. **Fixed + tested.** |
| One `prefix`+`learn_base` per repo | False for teams-ps conceptual vs cmdlet, and for `/troubleshoot/microsoftteams/`. **Fixed with url_maps.** |
| YAML `ms.subservice`, `description`, `audience`, `ms.collection` stored | Originally dropped; only topic/service/date columns. **Minimal columns added.** |
| ~18 ms query | Design claim, not measured here. Measured warm p50 = **12.5 ms**, p95 = **28.1 ms**. |
| Entra wired | DESIGN says not wired; `MicrosoftDocs/entra-docs` HTTP 200 on this machine, **not ingested** (branch not used). |
| Conditional YAML reranker | DESIGN described it; unused until this experiment's Mode B (eval-only). |
| Query service "not yet built" | README stale; `service/api.py` exists. Untouched. |

---

## 2. Minimal fixes made (learn-rag only)

1. **FK enforcement** — `open_db()` sets `PRAGMA foreign_keys=ON`; `write_parents` deletes FTS + children before parents (no `INSERT OR REPLACE` orphaning).
2. **`--skip-sync`** — honored when `repos/<slug>/.git` exists.
3. **Canonical URLs** — longest-prefix `url_maps` for cmdlet vs conceptual vs troubleshoot.
4. **Incremental integrity** — delete-then-insert per `repo::path`; orphan child sweep; vector-cache prune of dead hashes.
5. **Metadata columns** — `ms_subservice`, `ms_collection`, `audience`, `description`.
6. **Corpus acquisition** — `OfficeDocs-SkypeForBusiness` and `OfficeDocs-SharePoint` GitHub clones returned **404**. Seeded those trees from published Learn HTML (`python -m build.seed_learn`). PowerShell cloned from `office-docs-powershell`.
7. **Mode B/C** — deterministic `service/query_cues.py` + `service/metadata_rank.py`. Default `search()` remains Mode A.

Not changed: embedding model, HNSW, parent/child sizes, Deepgram, Electron, Relay DB, R1–R4, OpenAI, answer synthesis.

---

## 3. Tests

```
python -m unittest tests.test_blockers -v   # 10 tests OK
python -m tests.smoke                       # 0 failures
```

- FK: delete parent → children gone (not schema-text-only).
- `--skip-sync`: `fetch.sync` is not called when clone exists; still called when missing.
- URLs: Teams admin, PS cmdlet, PS conceptual, SharePoint, M365 Copilot, troubleshoot namespace.
- Idempotence: second `write_parents` does not duplicate children; deleted source removes parents/children/FTS; vector cache drops dead hashes.

---

## 4. Corpus size

| Metric | Value |
|---|---|
| Parents | 1553 |
| Children / HNSW vectors | 2575 |
| SQLite `corpus.db` | 12.3 MB |
| `hnsw.bin` | 4.5 MB |
| Teams (Learn seed) | 179 files → 1182 parents |
| SharePoint (Learn seed) | 47 files → 347 parents |
| Teams PowerShell (git, bounded cmdlets) | 14 parents |
| M365 Copilot (local get-ready page) | 7 parents |
| Entra | **not ingested** |

`ms.subservice` in this corpus is mostly `teams-calling` and `itpro-rooms`, not DESIGN's `teams-voice` / `teams-rooms`.

---

## 5–7. Mode results (same 14 questions)

| | Top-1 | Top-3 | COMPLETE | PARTIAL | INSUFFICIENT | warm p95 |
|---|---|---|---|---|---|---|
| **A baseline** (vector+FTS+RRF) | **6/14** | **11/14** | 3 | 8 | 3 | 21.5 ms |
| **B YAML rerank** | **5/14** | **9/14** | 4 | 6 | 4 | 38.5 ms |
| **C confident filter** | **6/14** | **11/14** | 3 | 8 | 3 | 26.6 ms |

Mode C ≈ Mode A. Rooms hard-filter on `teams-rooms` emptied the pool (`itpro-rooms` in YAML) and fell back. PowerShell `msteams-ps` filter also emptied the hybrid pool (`fallback=true`) because `Get-CsOnlineUser` was not in the fused 24.

---

## 8–10. Priority-14 accuracy (Mode A is the kill-test baseline)

- Top-1: **6/14** (need 10)
- Top-3: **11/14** (need 12)
- COMPLETE: Q08, Q09, Q11
- INSUFFICIENT: Q03, Q13, Q14

---

## 11. Per-question top 3 (Mode A unless noted)

| Q | Top-1 | Top-2 | Top-3 | Grade |
|---|---|---|---|---|
| Q01 DR + SBC | Connect SBC **See also** | Analog devices Step 1 | Configure Direct Routing Overview | TOP3 PARTIAL. Plan Overview not retrieved. #1 is a leftover H2. |
| Q02 internal OK, no PSTN | AA transfer to external PSTN | PSTN connectivity What's next? | **Issues with outbound calls :: Some users are unable to make calls** | TOP3 PARTIAL. Right troubleshoot section is #3. Mode B dropped it. |
| Q03 one-way audio | GCC High Audio Conferencing | Plan DR Licensing | SIP call flow troubleshooting | **MISS / INSUFFICIENT** |
| Q04 routing chain | Analog devices Step 4 | Call routing **Example 1** | Call routing **Example 2** | TOP3 PARTIAL. Canonical **Call routing overview** is in the DB and not in top 3. |
| Q05 SBC cert | **Plan DR :: Public trusted certificate** | SIP OPTIONS/TLS troubleshoot | What's New cert changes | TOP1 PARTIAL. Microsoft requirements yes; vendor renew steps are not in MS docs. Mode B replaced this with Connect-SBC admin-center. |
| Q06 emergency + location | DR considerations :: emergency call routing | Dynamic emergency calling Overview | DR considerations :: dynamic emergency | TOP1 PARTIAL. Location/LIS is a sibling section. |
| Q07 AA → CQ | Call-flow best practices | Auto Attendants design | **Setup Auto Attendant steps** | TOP3 PARTIAL. CQ setup missing in A; Mode B put AA setup + CQ setup in top 2. |
| Q08 Rooms resource account | **create-resource-account Overview** | assign license | Next steps | TOP1 **COMPLETE** |
| Q09 Rooms lockout / sign-in | **Fix resource account sign-in :: Resolution** | Symptoms | Overview | TOP1 **COMPLETE**. Canonical troubleshoot URL correct. |
| Q10 far end cannot hear | Known issues Windows :: Hardware | Software issues | Android room devices | TOP3 PARTIAL. USB mic/speaker known issues, not a far-end media runbook. |
| Q11 Rooms fleet | **Rooms Pro management Overview** | device settings | Rooms deploy | TOP1 **COMPLETE**. Mode B demoted this. |
| Q12 CQD vs per-call | Monitor and troubleshoot call quality | Monitor DR / CQD | CQD FAQ | TOP1 PARTIAL. Both sides present in top 3; not a clean pair of CQD overview + per-user TAC. |
| Q13 SP/OD before Copilot | Roll out SharePoint and OneDrive | Plan SP/OD | Pilot rollout | **MISS**. Generic rollout, not governance. Mode B top-1 is **Get ready for Copilot with SAM** (COMPLETE). |
| Q14 PS audit voice users | AA voice applications policies | Authorized users policy assign | voice applications assign | **MISS**. `Get-CsOnlineUser` is indexed and unused. |

---

## 12–13. Latency and machine

**Cold (separate):** engine init **1141 ms** (ONNX already on disk). First query **28 ms**.

**Warm (168 queries = 14 × 3 modes × 4 repeats), all stages included:**

| | min | p50 | p95 | max |
|---|---|---|---|---|
| total | 7.0 | **12.5** | **28.1** | 50.1 |
| embed | 4.7 | 7.9 | 22.4 | 45.8 |
| HNSW | 0.27 | 0.36 | 0.52 | 13.0 |
| lexical | 1.2 | 3.3 | 5.9 | 17.5 |
| fusion | 0.02 | 0.04 | 0.06 | 3.8 |
| parent fetch | 0.24 | 0.34 | 0.70 | 6.7 |
| rerank | 0 | 0 | 0.32 | 0.74 |

Target warm p95 < 200 ms: **pass**. The ~18 ms design figure is in range of this machine's p50, not a fake number — but this is x64 Python on Snapdragon X, 16 GB RAM, 1553 parents / 2575 vectors. Process RSS could not be read (ARM/psapi).

---

## 14. Canonical URL audit

Checked against live Learn:

| Source | Mapping | Verdict |
|---|---|---|
| Teams admin `Teams/direct-routing-plan.md` | `https://learn.microsoft.com/microsoftteams/direct-routing-plan` | Correct (locale-less; Learn redirects). |
| PS cmdlet `Get-CsOnlineUser.md` | `.../powershell/module/microsoftteams/get-csonlineuser` | Correct. |
| PS conceptual `teams/docs-conceptual/` | `.../microsoftteams/...` | Matches published conceptual namespace. |
| Troubleshoot SIP/TLS | `.../troubleshoot/microsoftteams/phone-system/direct-routing/sip-options-tls-certificate-issues` | Correct; **requires url_maps**, not the Teams admin prefix. |
| SharePoint | `.../sharepoint/...` | Correct for seeded admin/governance pages. |
| Copilot get-ready | `.../microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management` | Correct. |

GitHub public mirrors for Teams admin and SharePoint docs 404 from this network. Seeded pages still contain Learn chrome and an Edit link pointing at `OfficeDocs-SkypeForBusiness` (the page HTML still names that repo).

---

## 15. YAML / frontmatter value

**Did YAML improve retrieval? No, not on this question set.**

- Helps when `ms.topic` matches and the right article is already nearby (Q07 how-to, Q13 Copilot how-to).
- Hurts when many pages share `troubleshooting` / `how-to` / `concept-article` (Q02, Q05, Q09, Q11, Q12) or when leftover H2s inherit the article's YAML (every split of an article gets the same frontmatter).
- Microsoft labels here are `concept-article` / `how-to` / `teams-calling` / `itpro-rooms`, not DESIGN's `conceptual` / `teams-voice` / `teams-rooms`. Aliases were added; they were not enough.
- Do not keep Mode B/C complexity for a Relay prototype unless ranking among same-article H2s is fixed first.

---

## 16. One-way audio source sufficiency

**Insufficient.** Zero parents contain "one-way" in title, section, or URL. Top hits were GCC High Audio Conferencing, licensing, or SIP ladder. Media-bypass documentation was not treated as a full one-way-audio runbook. A Microsoft troubleshooting path for one-way DR audio is not in this corpus.

---

## 17. Routing-chain result

The canonical parent **is in the corpus**:

`Configure call routing for Direct Routing :: Call routing overview`  
`https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing`

It states voice routing policy → PSTN usages → voice routes → online PSTN gateway/SBC.

**It did not rank in top 3.** Mode A/C: analog-devices Step 4, then Example 1/2 of the same article. Mode B: GCC High Audio Conferencing at #1. This is a serious ranking failure of the kind the brief flagged.

---

## 18. PowerShell result

`Get-CsOnlineUser` is indexed (26 984 characters, `ms.service=msteams-ps`, canonical module URL). Retrieval returned Auto Attendant **voice applications policies**. Mode C `service=msteams-ps` returned **no hits in the fused 24** and fell back. This is not a deprecation-footnote miss; the right cmdlet never competed.

---

## 19. SharePoint / Copilot result

Mode A/C: generic "Roll out SharePoint and OneDrive" — **not** governance.  
Mode B: **Get ready for Microsoft 365 Copilot with SharePoint Advanced Management**, including oversharing / DAG / RAC / Restricted Content Discovery — **COMPLETE**. YAML found the page the baseline did not. That is the one clear metadata win. It does not justify keeping Mode B as-is given the regressions.

---

## 20. Blockers / unknowns

- GitHub `MicrosoftDocs/OfficeDocs-SkypeForBusiness` and `OfficeDocs-SharePoint` **404**; Teams/SharePoint markdown was HTML-extracted from Learn. Body quality is usable but includes chrome (`Note`, Feedback).
- `microsoft-365-docs` public tree moved Copilot docs to `copilot/`; sparse `microsoft-365/copilot` yielded 0 git files. Get-ready page restored from Learn seed.
- Entra: `MicrosoftDocs/entra-docs` exists (HTTP 200). Not ingested.
- No dedicated one-way-audio Microsoft section in this corpus.
- Parent split creates `See also` / `Feedback` / `Next steps` parents that rank.
- Cmdlet pages are whole-file parents (~27k chars) and still lose to AA conceptual pages on Q14.
- Process RSS not captured.
- Python 3.14 win_amd64 on Snapdragon X (emulated x64). Latency is still well under target.

---

## Files

- `eval/runs/retrieval-r0/RETRIEVAL_R0_REPORT.md` (this file)
- `eval/runs/retrieval-r0/results.json`
- `eval/runs/retrieval-r0/raw_results.json` (full hits, YAML fields, timings)
- Engine changes live only under `C:\Users\joegc\projects\learn-rag\learn-rag`

**B. CONDITIONAL**

---

# PHASE R0.1 — Mechanical Retrieval Corrections (full final response)

Date: 2026-08-17. Work was confined to the separate `learn-rag` project. Relay production source, Deepgram, Electron, R1–R4/WB-21, answer synthesis, embeddings, HNSW architecture, and source scope were not modified. YAML rerank was not used. No new sources were ingested. R0 artifacts under `eval/runs/retrieval-r0/` were preserved.

R0 Mode-A baseline was loaded from the preserved `results.json`, not re-tuned: top-1 **6/14**, top-3 **11/14**, COMPLETE 3 / PARTIAL 8 / INSUFFICIENT 3, warm p50 **12.5 ms**, p95 **28.1 ms**.

Three mechanical fixes were applied:

1. **Chrome parent hygiene.** `Feedback`, `See also`, `Related topics`, `References`, and the same-class Related-articles headings are no longer searchable/embedded answer parents. Source articles were not deleted. `Next steps` was audited: one navigation-only SharePoint link-out was excluded; two substantive technical `Next steps` (voice-apps closeout; Rooms policies/bandwidth) were retained. SQLite after rebuild: Feedback 0, See also 0, Related topics 0, References 0. Parents **1553 → 1233**. Children **2575 → 2255**.
2. **Lexical precision.** FTS is no longer a blanket OR of every non-stopword. Cmdlets stay quoted (`Get-CsOnlineUser`). Multi-word technical phrases present in the query survive (`direct routing`, `voice routing policy`, `pstn usage`, `voice route`, `call quality dashboard`, …). Weak conversational unigrams (explain, role, chain, …) are dropped when they are not inside a phrase. Every Priority-14 FTS string is recorded in `eval/runs/retrieval-r0-1/`.
3. **Scope before truncation.** When `service`/`repo` is passed to `SearchEngine.search()`, lexical FTS and vector parent eligibility are restricted to that scope **before** fused-pool truncation. Empty scoped corpora return no hits. There is no silent global fallback. Unscoped behavior is unchanged except for (1) and (2). No query router was added.

Tests: `tests.test_r01` 21 OK; smoke 0 failures; existing blocker tests still OK.

Priority-14 was rerun with the same wording. Hybrid only.

| Q | Result |
|---|---|
| Q01 | `See also` cannot be top-1 (not indexed). New top 3: analog-devices Step 1 (connect SBC); Plan DR Support boundaries; Configure Direct Routing Overview. TOP3 PARTIAL. |
| Q02 | Same pattern as R0 (outbound-call troubleshoot #3). TOP3 PARTIAL. |
| Q03 | Still no one-way-audio Microsoft section. **SOURCE_GAP**. Not counted as retrieval success. |
| Q04 | Canonical `Configure call routing for Direct Routing :: Call routing overview` is vector **1**, lexical **13**, fused **3**. Target met. Analog Step 4 and Example 1 still sit above it. No Q04-specific boost. |
| Q05 | Cert parent now #2 (was R0 #1). Mild regression, still TOP3. |
| Q06 | Dynamic emergency Overview #1. TOP1 PARTIAL. |
| Q07 | AA setup steps now #1 (was #3). TOP1 PARTIAL. |
| Q08 | Resource-account create+license #1. COMPLETE. Next steps no longer in top 3. |
| Q09 | Same sign-in troubleshoot article. COMPLETE. |
| Q10 | Known-issues pages. TOP3 PARTIAL. |
| Q11 | Rooms Pro management Overview #1. COMPLETE. |
| Q12 | CQD + Call Analytics in top 3. TOP1 PARTIAL. |
| Q13 | SAM/Copilot article **improved** without YAML: Step 5 backup is returned #3; governance Overview is fused **14**. Not the Mode B Overview TOP1 win. No Q13-specific boost. |
| Q14 unscoped | Still AA policy pages. `Get-CsOnlineUser` vector/lexical/fused all **None**. MISS. |
| Q14 scoped `msteams-ps` | Voice routing policy cmdlet #1, **`Get-CsOnlineUser` fused 2** (vector 1, lexical 4), voice route cmdlet #3. Target met. |

Answerable questions excluding Q03: unscoped **6/13 top-1**, **12/13 top-3**. STRONG gate needed 10/13 top-1 — **missed**. Q04 overview top 3 and Q14 scoped top 3 both **passed**. Warm latency min 6.8 / p50 **10.8** / p95 **20.2** / max 35.2 ms (embed p50 7.7, HNSW 0.32, lexical 1.9, fusion 0.03, fetch 0.26). Not a regression from R0 ~28 ms.

Remaining bounded defects: intra-article technical H2 ranking (examples/steps vs overviews); unscoped Q14 still needs an explicit scope this slice was forbidden to infer; Q13 Overview still fused 14; Q03 source gap.

Deliverables: `eval/runs/retrieval-r0-1/RETRIEVAL_R0_1_REPORT.md`, `eval/runs/retrieval-r0-1/results.json`, `eval/runs/retrieval-r0-1/raw_results.json`. Stop after this report. Do not integrate into Relay. Do not begin answer generation.

**B. CONDITIONAL**
