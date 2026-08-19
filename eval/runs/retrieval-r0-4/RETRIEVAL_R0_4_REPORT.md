# PHASE R0.4 — Minimal Deterministic Retrieval Scoping

Date: 2026-08-17  
Ranking code untouched. No reranker. No Relay integration. No answer generation. No new sources.

## Recommendation

**A. ROUTING PROVEN**

A 115-line HIGH/NONE selector automatically scopes Q14 to the existing Teams PowerShell corpus. Frozen `Get-CsOnlineUser` moves from absent in the unscoped production pool to fused rank 2. No previously correct Priority question is scoped, and no first-acceptable rank worsens. 13/13 answerable frozen targets are inside top 5.

---

## 1. Safety

| Check | Result |
|---|---|
| learn-rag directory | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| git (learn-rag) | separate repo; still untracked project files; this phase added `service/scope_select.py`, `tests/test_r04_scope.py`, `eval/run_r0_4.py` |
| git (meeting-agent) | dirty I2–I4 `src/` from prior work; **not edited this phase**. Artifacts written only under `eval/runs/retrieval-r0-4/` |
| R0 / R0.1 / R0.2 / R0.3 artifacts | preserved |
| Frozen GT | `eval/ground_truth/priority14_retrieval.json` sha256 `59f6572dc5f3d3d574bb4054199b5c32542d18eedd07dc07d16b228a8562ee40` (unchanged) |
| `service/search.py` | sha256[:16] `8702daf1ee2b2843` (unchanged) |
| `build/transform.py` | `9ebb37b3313c23c0` (unchanged) |
| `eval/run_r0_1.py` | `c514a53628ba899b` (unchanged) |
| Relay production source | unchanged |
| Retrieval ranking | unchanged. Scope is applied through the existing `SearchEngine.search(service=..., repo=..., allow_unscoped_fallback=False)` contract from R0.1 |

Retrieval ranking did not need to change. Work continued.

---

## 2. Files changed

### learn-rag (new)

| File | Role |
|---|---|
| `service/scope_select.py` | HIGH/NONE scope selector (115 lines) |
| `tests/test_r04_scope.py` | cue, fallback, Q14, and false-scope tests |
| `eval/run_r0_4.py` | Priority-14 harness: question → selector → frozen search → R0.2 grader |

### meeting-agent (artifacts only)

| File | Role |
|---|---|
| `eval/runs/retrieval-r0-4/RETRIEVAL_R0_4_REPORT.md` | this report |
| `eval/runs/retrieval-r0-4/results.json` | machine results |
| `eval/runs/retrieval-r0-4/raw_results.json` | same payload dump |

Not changed: `service/search.py`, embeddings, HNSW, FTS construction, technical phrases, parent hygiene, YAML ranking, Deepgram, Relay, Electron, R1–R4/WB-21, answer generation, frozen ground truth.

---

## 3. Router contract

Input: normalized user question (existing `service.asr_normalize.normalize`).

Output: `ScopeDecision`

| Field | Values |
|---|---|
| `service` | optional string |
| `repo` | optional string |
| `subservice` | optional string |
| `confidence` | `HIGH` or `NONE` only |
| `reason` | human-readable cue |

Rules:

- If confidence is not clearly HIGH → no service/repo/subservice → caller runs global retrieval.
- No MEDIUM.
- No guess.
- HIGH searches pass `allow_unscoped_fallback=False`. Empty scoped corpus returns empty hits, never silent global.

Call path:

```
question → select_scope(question) → engine.search(question, top_k=5, **decision.search_kwargs())
```

---

## 4. Router code size

`service/scope_select.py`: **115 lines** (under the ~150-line target).

Core logic is `select_scope` plus two cue helpers. The PowerShell approved-verb list is included so ASR product hyphenations such as `Direct-Routing` are not treated as cmdlets. That list is the published `about_Approved_Verbs` set, not a Priority-14 lookup table and not an aspect/intent ontology.

---

## 5. Every routing cue

Implemented HIGH cues (only these):

| Cue | Evidence | Scope |
|---|---|---|
| Explicit PowerShell | token `powershell` after ASR + punctuation fold | `service=msteams-ps`, `repo=teams-ps` |
| Cmdlet-shaped token | approved-verb + hyphen + noun (`Get-CsOnlineUser`, `Set-CsPhoneNumberAssignment`), including ASR-recovered canonical cmdlets | same |
| Explicit SharePoint / OneDrive | token `sharepoint` or `onedrive`, and **no** `copilot` | `repo=sharepoint` |

Explicitly **not** HIGH (leave GLOBAL):

| Cue considered | Why unscoped |
|---|---|
| `script` / `automate` alone | not a product/corpus identifier |
| Teams Rooms / MTR / “Microsoft Teams Room” | `ms.subservice=itpro-rooms` is missing on canonical Rooms troubleshoot parents (Q09/Q10). Do not invent metadata |
| Direct Routing / SBC / PSTN | no exclusive service distinct from `msteams`; unscoped already returns those targets in top 5 |
| Copilot, including Copilot + SharePoint/OneDrive | Copilot parents live on `microsoft-365-copilot` / repo `m365`, not `sharepoint-online`. Forcing SharePoint would drop Q13 |

No per-question routes. No Priority-14 table.

---

## 6. Every Priority-14 routing decision

Frozen R0.2 ground truth. Same 14 canonical questions. No manual overrides.

| Q | Scope | Confidence | Reason | Top 3 titles | Machine grade | First acceptable |
|---|---|---|---|---|---|---|
| Q01 | GLOBAL | NONE | no high-confidence corpus cue | Analog SBC step 1; Plan support boundaries; Configure DR Overview | TOP3_CORRECT | 3 (unchanged) |
| Q02 | GLOBAL | NONE | no high-confidence corpus cue | AA transfer; PSTN options; outbound calls | TOP3_CORRECT | 3 (unchanged) |
| Q03 | GLOBAL | NONE | no high-confidence corpus cue | (unscored) | SOURCE_GAP | — |
| Q04 | GLOBAL | NONE | no high-confidence corpus cue | Analog voice route; call-routing example; Call routing overview | TOP3_CORRECT | 3 (unchanged) |
| Q05 | GLOBAL | NONE | no high-confidence corpus cue | SIP options; Plan SBC cert; What’s New cert | TOP3_CORRECT | 2 (unchanged) |
| Q06 | GLOBAL | NONE | no high-confidence corpus cue | Dynamic emergency Overview; … | TOP1_CORRECT | 1 (unchanged) |
| Q07 | GLOBAL | NONE | no high-confidence corpus cue | AA setup steps; … | TOP1_CORRECT | 1 (unchanged) |
| Q08 | GLOBAL | NONE | no high-confidence corpus cue | Create resource account; … | TOP1_CORRECT | 1 (unchanged) |
| Q09 | GLOBAL | NONE | no high-confidence corpus cue | Rooms sign-in Overview; … | TOP1_CORRECT | 1 (unchanged) |
| Q10 | GLOBAL | NONE | no high-confidence corpus cue | Rooms known issues software; … | TOP1_CORRECT | 1 (unchanged) |
| Q11 | GLOBAL | NONE | no high-confidence corpus cue | Rooms Pro management Overview; … | TOP1_CORRECT | 1 (unchanged) |
| Q12 | GLOBAL | NONE | no high-confidence corpus cue | Monitor call quality; … | TOP1_CORRECT | 1 (unchanged) |
| Q13 | GLOBAL | NONE | Copilot spans SharePoint and microsoft-365; leave global | SP/OD rollout; SP/OD plan; SAM Step 5 (not acceptable) | TOP5_CORRECT | 5 (unchanged; Step 3) |
| Q14 | SCOPED `msteams-ps`/`teams-ps` | HIGH | explicit PowerShell token | Get-CsOnlineVoiceRoutingPolicy; **Get-CsOnlineUser**; Get-CsOnlineVoiceRoute | TOP3_CORRECT | **2** (was absent) |

Q03 remains SOURCE_GAP.

---

## 7. Machine top-1 / top-3 / top-5

Denominator = 13 answerable. Q03 excluded.

### Before automatic routing (frozen R0.3 unscoped)

- top-1 **7/13**
- top-3 **11/13**
- top-5 **12/13**

### After automatic high-confidence routing

- top-1 **7/13**
- top-3 **12/13**
- top-5 **13/13**

Primary target met: Q14 is machine TOP3. Ideal met: 13/13 answerable have a correct frozen target inside top 5. Top-1 is unchanged and was not required to move.

---

## 8. Q14 detailed result

Question: `How would you use PowerShell to audit Teams Voice users and their voice configuration?`

| | |
|---|---|
| Selected scope | `service=msteams-ps`, `repo=teams-ps` |
| Confidence | HIGH |
| Reason | explicit PowerShell token; service=msteams-ps repo=teams-ps |
| Machine grade | TOP3_CORRECT (frozen article match at rank 2) |

Top 3:

1. Get-CsOnlineVoiceRoutingPolicy
2. **Get-CsOnlineUser** (frozen acceptable target)
3. Get-CsOnlineVoiceRoute

Get-CsOnlineUser ranks (scoped, `candidates=30` default):

| Channel | Rank |
|---|---|
| vector | **1** |
| lexical | **4** |
| fused | **2** |

Matches the frozen R0.3 explicit-scope measurement. Unscoped R0.3 had the target absent from both lists.

No silent fallback: all returned hits are `ms_service=msteams-ps` / `repo=teams-ps`.

---

## 9. Routing audit (every scoped question)

Only **Q14** was scoped.

| | |
|---|---|
| Cue | explicit word `PowerShell` |
| Resulting scope | `msteams-ps` + `teams-ps` |
| Effect | **helped** — fused rank 2 vs unscoped miss |

Q13 saw the Copilot token and stayed GLOBAL (reason recorded; not a silent fallback). SharePoint HIGH exists in the selector but did not fire on Priority-14 because every SharePoint mention in the set also contains Copilot (Q13) or is absent.

False-scope regressions: **none**. First-acceptable ranks for Q01–Q13 are identical to R0.3.

Negative questions (not in the 14, covered by tests) stay GLOBAL:

- “How would you troubleshoot one-way audio?”
- “Explain emergency calling with Direct Routing.”
- “How would you secure SharePoint before Copilot?”
- “How would you automate this process?” / generic `script`

---

## 10. Latency

No network. No model in the router. ASR alias table is local regex.

| | n | min | p50 | p95 | max |
|---|---|---|---|---|---|
| router (microbench, 50×14) | 700 | 1.43 ms | **3.86 ms** | **6.28 ms** | 39.37 ms |
| router (scored 14) | 14 | 2.61 ms | 3.56 ms | 6.14 ms | 58.34 ms (first call, alias load) |
| retrieval (scored 14, warm engine) | 14 | 8.94 ms | **12.52 ms** | **46.39 ms** | 63.72 ms |
| total (router + retrieval, scored 14) | 14 | 11.88 ms | **17.06 ms** | **67.66 ms** | 104.73 ms |

Router is small relative to retrieval. First-call max is alias-table load, not a model.

---

## 11. Tests

Command: `python -m unittest tests.test_r04_scope -v`  
Result: **13 OK**

| # | Requirement | Test |
|---|---|---|
| 1 | explicit `PowerShell` routes to PowerShell | `test_explicit_powershell_routes` |
| 2 | cmdlet-shaped token routes | `test_cmdlet_shaped_token_routes` |
| 3 | `Get-CsOnlineUser` routes; ASR-recovered cmdlet also routes | `test_get_csonlineuser_routes`, `test_asr_recovered_cmdlet_routes` |
| 4 | generic `script` does not route | `test_script_alone_does_not_route` |
| 5 | Teams Rooms cue stays GLOBAL (metadata unreliable) | `test_teams_rooms_stays_global_without_reliable_subservice` |
| 6 | SharePoint explicit cue scopes where supported (no Copilot) | `test_sharepoint_explicit_without_copilot_scopes` |
| 7 | ambiguous / Direct Routing / Copilot+SharePoint / automate stay GLOBAL | `test_ambiguous_and_negative_examples_remain_global`, `test_sharepoint_with_copilot_stays_global` |
| 8 | scoped search does not silently fall back to global | `test_high_scope_does_not_imply_global_fallback_flag`, `test_scoped_empty_corpus_does_not_return_global_hit` |
| 9 | Q14 automatic scope produces acceptable top-3 | `test_q14_automatic_scope_top3` |
| 10 | no previously passing frozen Priority question is auto-scoped | `test_no_false_scope_on_previously_global_priority_questions` |

---

## 12. Acceptance

**A. ROUTING PROVEN**

- Q14 is machine TOP3 (fused rank 2).
- No existing correct result regresses because of routing.
- Router is one file, 115 lines, HIGH/NONE only, no ontology, no per-question table.
- 13/13 answerable frozen targets are inside practical candidate depth (top 5).

Not done, per stop conditions: no reranker, no Relay integration, no answer generation.
