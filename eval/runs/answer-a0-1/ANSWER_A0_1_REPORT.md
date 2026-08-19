# PHASE A0.1 — Evidence Sufficiency Gate Forensic

Date: 2026-08-17  
Retrieval-only. No answer-model calls. No A0 prompt change. No gate wired into the answer path. No Relay integration.

## Recommendation

**C. DETERMINISTIC GATE REJECTED**

Retrieval scores and FTS-term coverage cannot safely distinguish a usable top-5 packet from the Q03 failure mode.

Q03 is not a weak retrieval packet. It is a **high-confidence, dual-path, in-domain near miss**: fused score among the highest in Priority-14, vector rank 1, lexical rank 2, all five parents dual-matched, `direct routing` phrase fully covered. The only uncovered FTS unigram is `way`. The requested symptom (**one-way audio** / audio troubleshooting of that symptom) is **absent** from every parent body.

A coverage threshold strict enough to reject Q03 also rejects several currently answerable questions, including **Q14**. A threshold loose enough to keep Q07/Q14 **accepts Q03**.

Out-of-corpus negative controls *are* mostly separable on the same features. That does not solve A0: the dangerous case is neighboring Microsoft Teams content, not Intune/AVD/SAP.

---

## 1. Frozen systems unchanged

| Check | Result |
|---|---|
| learn-rag | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| `service/search.py` | `8702daf1ee2b2843` |
| `service/scope_select.py` | `2a8caaabd00f4b08` |
| Frozen GT | `59f6572dc5f3d3d5…` |
| `service/answer.py` (A0 prompt) | `1d3bab096a33403a` unchanged |
| Answer-model calls | **0** |
| Reranker | not used |
| Relay `src/` | not edited |
| R0–R0.5 and A0 artifacts | preserved; this run wrote `eval/runs/answer-a0-1/` only |

---

## 2. Packet-level feature definitions

Eval-only (`eval/sufficiency.py`). Terms come from frozen `build_fts_query` (R0.1 lexical builder): quoted phrases, cmdlets, remaining non-filler unigrams.

| Feature | Definition |
|---|---|
| `coverage_topk` | Fraction of FTS terms found in title+section+body of fused top-k |
| `title_section_coverage_topk` | Same, title+section only |
| `phrase_coverage_top5` | Coverage of multi-word / hyphenated FTS clauses only |
| `top_fused_score` | Hybrid RRF score of rank 1 |
| `top_vector_rank` / `top_lexical_rank` | Position of fused #1 in each list |
| `top_dual_match` | Rank 1 matched by both vector and lexical |
| `dual_match_n` | How many of fused top-5 are dual-matched |
| `vector_lex_overlap_k` | \|vector[:k] ∩ lexical[:k]\| parent ids |
| `unique_articles` | Distinct canonical URL paths in top-5 |
| `family` | First two URL path segments |
| `clustered` | Same article appears ≥2 times, or same family ≥3 |

Filler already dropped by `build_fts_query` (stopwords / weak unigrams / function words).

---

## 3. Per-question feature table (Priority-14)

| Q | cov1 | cov3 | cov5 | ts5 | phrase | dual | ov5 | arts | fams | score | vec | lex | missing FTS terms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | 1.00 | 1.00 | **1.00** | 1.00 | 1.00 | 5 | 1 | 5 | 5 | .0263 | 6 | 3 | — |
| Q02 | .73 | 1.00 | **1.00** | .55 | 0 | 5 | 1 | 4 | 3 | .0276 | 2 | 1 | — |
| **Q03** | .83 | .83 | **.83** | .67 | **1.00** | **5** | 2 | 3 | 3 | **.0277** | **1** | **2** | `way` |
| Q04 | .67 | 1.00 | 1.00 | .50 | 1.00 | 5 | 2 | 2 | 2 | .0273 | 3 | 1 | — |
| Q05 | .83 | .83 | .83 | .67 | 1.00 | 5 | 2 | 3 | 3 | .0274 | 2 | 2 | `replace` |
| Q06 | 1.00 | 1.00 | 1.00 | .67 | 1.00 | 5 | 2 | 4 | 4 | .0269 | 5 | 1 | — |
| Q07 | .67 | .67 | **.67** | .17 | 1.00 | 5 | 0 | 3 | 3 | .0263 | 3 | 7 | `building`, `ultimately` |
| Q08 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 5 | 2 | 4 | 2 | .0275 | 1 | 3 | — |
| Q09 | .50 | .83 | .83 | .50 | 1.00 | 5 | 1 | 3 | 2 | .0269 | 2 | 5 | `cannot` |
| Q10 | .60 | .70 | .80 | .30 | 1.00 | 5 | 2 | 4 | 2 | .0272 | 2 | 3 | `far`, `cannot` |
| Q11 | .57 | .86 | .86 | .29 | 1.00 | 5 | 1 | 4 | 1 | .0272 | 3 | 2 | `fleet` |
| Q12 | .67 | 1.00 | 1.00 | .33 | 1.00 | 5 | 0 | 5 | 5 | .0259 | 4 | 8 | — |
| Q13 | .67 | .89 | .89 | .67 | 0 | 5 | 1 | 3 | 3 | .0267 | 5 | 2 | `secure` |
| Q14 | .50 | .50 | **.50** | **.00** | 0 | 5 | 3 | 5 | 1 | .0274 | 2 | 2 | `Teams Voice`, `audit`, `configuration` |

Q03 does **not** look uniquely weak. Q14 looks *weaker* on coverage and title/section alignment, yet A0 answered it well after HIGH PowerShell scope.

Every Priority-14 packet has `dual_match_n = 5`. Dual agreement does not separate Q03.

---

## 4. Q03 forensic

Question: *How would you troubleshoot one-way audio on a Teams Direct Routing call?*

FTS (frozen builder): `"direct routing" OR "one" OR "way" OR "audio" OR "Teams" OR "call"`

`one-way` is split on the hyphen. `troubleshoot` is a weak unigram and is dropped. There is no technical phrase for the symptom.

| Rank | Title :: section | fused | vec | lex | matched_by |
|---|---|---|---|---|---|
| 1 | Audio Conferencing with Direct Routing, GCC High :: Deploy… | .0277 | 1 | 2 | vector+lexical |
| 2 | Plan Direct Routing :: Licensing and other requirements | .0271 | 4 | 1 | vector+lexical |
| 3 | Issues that affect inbound Direct Routing calls :: No ringback tone… | .0265 | 3 | 6 | vector+lexical |
| 4 | Plan Direct Routing :: Overview | .0258 | 5 | 7 | vector+lexical |
| 5 | Audio Conferencing GCC :: capabilities not supported | .0253 | 9 | 5 | vector+lexical |

Why the packet is **misleading, not empty**:

- Hybrid is *more* confident than Q01/Q07.
- Phrase `direct routing` is fully present → `phrase_coverage_top5 = 1.0`.
- `audio`, `Teams`, `call`, and even `one` occur in Audio Conferencing / DR text.
- Only FTS term missing in the packet: **`way`**.

Diagnostic symptom strings (**not** used as gates):

| Needle | Present in any top-5 body |
|---|---|
| one-way audio | **No** |
| one way audio | **No** |
| one-way | **No** |
| one way | **No** |
| audio troubleshooting | **No** |

Absent requested concepts: a one-way / unidirectional media symptom, and any troubleshooting procedure for that symptom. Present instead: DR overview, licensing, inbound **ringback**, Audio Conferencing GCC. That is exactly the packet A0 turned into a fake runbook.

Do not infer a Microsoft one-way-audio procedure from this evidence.

---

## 5. Positive-control results

All 13 answerable Priority questions used as positives.

| Gate | Accepted | Falsely rejected |
|---|---|---|
| G_cov85 | 8/13 | Q05, Q07, Q09, Q10, Q14 |
| G_cov95 | 6/13 | Q05, Q07, Q09, Q10, Q11, Q13, Q14 |
| G_title50 | 8/13 | Q07, Q10, Q11, Q12, Q14 |
| G_and | 8/13 | Q07, Q10, Q11, Q12, Q14 |
| G_phrase_cov | 11/13 | Q07, Q14 |

No generic rule accepted “nearly all” answerable packets **and** rejected Q03. The two coverage gates that catch Q03 each reject five or more answerable questions, including Q14 (A0’s PowerShell win).

---

## 6. Negative-control questions

Labeled `NEGATIVE_CONTROL`. Not added to frozen GT. Written **before** their retrieval was inspected; gates were **not** retuned afterward.

| ID | Question |
|---|---|
| N01 | How do you enroll iOS devices in Microsoft Intune using Apple Business Manager? |
| N02 | How would you configure Azure AD B2C custom policies for a multi-step signup journey? |
| N03 | Walk through setting up an Azure Virtual Desktop host pool with FSLogix profile containers. |
| N04 | How do you create a Microsoft Defender for Endpoint attack-surface-reduction rule for Office macros? |
| N05 | How would you configure a Power BI on-premises data gateway in standard mode? |
| N06 | Explain how to set up Dynamics 365 Field Service work-order scheduling. |
| N07 | How do you configure Windows Autopilot for pre-provisioned deployment? |
| N08 | How would you authenticate a Copilot Studio agent to Dataverse using a service principal? |
| N09 | How do you configure Mimecast Secure Email Gateway for Microsoft 365? |
| N10 | How would you set up Okta as the SAML identity provider for a third-party SaaS app? |
| N11 | Walk through migrating Cisco Webex Calling PSTN onto a Webex-native local gateway. |
| N12 | How do you configure SAP HANA Large Instances on Azure for high availability? |

---

## 7. Negative-control results

| Gate | Correctly rejected | Falsely accepted |
|---|---|---|
| G_cov85 | **12/12** | 0 |
| G_cov95 | 12/12 | 0 |
| G_title50 | 12/12 | 0 |
| G_and | 12/12 | 0 |
| G_phrase_cov | 11/12 | **N05** |

N05 retrieved Teams **CQD Power BI connector** documentation (`phrase_coverage` of `Power BI` = 1.0, `coverage_top5` = 0.83). Same shape as Q03: an in-corpus neighbor that shares a product token, not the requested procedure.

Coverage **does** flag far out-of-domain questions. It does **not** uniquely flag in-domain SOURCE_GAP.

---

## 8. Candidate gate rules tested

All generic. No question IDs, no “one-way audio”, no Direct Routing special case, no page names.

1. **G_cov85** — `coverage_top5 >= 0.85`
2. **G_cov95** — `coverage_top5 >= 0.95`
3. **G_title50** — `title_section_coverage_top5 >= 0.50`
4. **G_and** — coverage ≥ 0.80 AND title/section ≥ 0.40 AND `dual_match_n` ≥ 4
5. **G_phrase_cov** — every FTS phrase present (if any) AND coverage ≥ 0.75

Five rules, not a large search.

---

## 9. False accept / false reject (Priority-14)

| Gate | Answerable accepted | Answerable rejected | Q03 rejected | Q03 accepted |
|---|---|---|---|---|
| G_cov85 | 8 | **5** | yes | no |
| G_cov95 | 6 | **7** | yes | no |
| G_title50 | 8 | 5 | no | **yes** |
| G_and | 8 | 5 | no | **yes** |
| G_phrase_cov | 11 | 2 | no | **yes** |

A gate that catches Q03 is unacceptable under the stated constraint (must not reject several currently answerable questions). A gate that keeps Q07/Q14 lets Q03 through.

This is a feasibility set with **one** frozen SOURCE_GAP. Not statistical proof. The pattern is still clear.

---

## 10. Is one simple deterministic gate viable?

**No.**

Useful secondary observation: out-of-domain packets look different from answerable Teams/SharePoint packets. The A0 failure is **not** out-of-domain. It is a high-RRF Direct Routing neighborhood that lacks the symptom.

---

## 11. Gate latency

Feature extraction on top-5 parents (string/term checks only):

| | |
|---|---|
| p50 | **19.3 ms** |
| max | 104.5 ms (first packets; later ones are cheaper) |

Negligible vs A0’s ~4 s generation. Cost is not the issue. **Separability** is.

---

## 12. Cases that defeat the gate

| Case | Why it defeats a simple rule |
|---|---|
| **Q03** | Strong dual retrieval + `direct routing` phrase; symptom strings absent; only FTS miss is `way` |
| **Q14** | Answerable after HIGH PowerShell scope, but coverage 0.50 and title/section 0.00 (`audit` / `Teams Voice` / `configuration` not in cmdlet pages) |
| **Q07** | Answerable AA→CQ card; coverage 0.67 because `building`/`ultimately` never appear |
| **Q05** | Answerable cert renew; coverage 0.83, identical to Q03; missing `replace` |
| **N05** | Out-of-scope Power BI gateway, but CQD’s Power BI connector satisfies phrase coverage |

---

## Files

| File | Role |
|---|---|
| `learn-rag/eval/sufficiency.py` | Feature + candidate-gate predicates (eval-only) |
| `learn-rag/eval/run_a0_1.py` | Retrieval-only harness |
| `learn-rag/tests/test_a01_sufficiency.py` | Generic-gate / no-answer-import tests |
| `eval/runs/answer-a0-1/results.json` | Full packets and scores |

Not changed: retriever, R0.4 router, A0 prompt, answer generation, Relay.

Tests: `python -m unittest tests.test_a01_sufficiency -v` → 5 OK.

---

## Acceptance

**C. DETERMINISTIC GATE REJECTED** — retrieval scores/coverage cannot safely distinguish evidence sufficiency for in-domain SOURCE_GAP; another mechanism is required (explicitly not chosen in this phase).

Do not implement the gate in the answer path. Do not modify A0. Do not integrate Relay.
