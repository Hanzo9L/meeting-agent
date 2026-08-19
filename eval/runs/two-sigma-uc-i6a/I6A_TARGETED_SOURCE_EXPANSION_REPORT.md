# I6A — Targeted Source Expansion Report

Corpus-coverage only. Frozen R0.4 retrieval was not modified. No phrase rules, ranking, UI, STT, generation, reranker, or vendor SBC docs. No commit.

RELAY WRITE STATUS: EVAL ARTIFACTS ONLY  
LEARN-RAG WRITE STATUS: TARGETED SOURCE/CORPUS ARTIFACTS ONLY

---

## 1. Workspace / freeze verification

### Relay

- cwd: `C:\Users\joegc\projects\meeting-agent`
- branch: `cursor/msteams-docs-knowledge-base`
- HEAD: `e1e4dab`
- git status: dirty from prior I1–I5 work; this phase added only `eval/runs/two-sigma-uc-i6a/**` (plus the I5 folder already present). No production Relay edits.

### learn-rag

- cwd: `C:\Users\joegc\projects\learn-rag\learn-rag`
- branch: `master`
- HEAD: `b967fb8`
- Source-registry edits only: `build/config.py` (linux repo + m365 enterprise sparse file), `build/seed_learn.py` (I6A allowlist URLs). Corpus/index rebuilt. `service/search.py` and `service/scope_select.py` untouched.

### Frozen hashes

| File | Required | Before ingest | After ingest |
| --- | --- | --- | --- |
| `service/search.py` | `8702daf1ee2b2843` | `8702daf1ee2b2843` | `8702daf1ee2b2843` |
| `service/scope_select.py` | `2a8caaabd00f4b08` | `2a8caaabd00f4b08` | `2a8caaabd00f4b08` |

Also confirmed: no query-shape changes, no phrase-list changes, no reranker, no LLM, no Microsoft runtime rescue, no AudioCodes/vendor ingest.

---

## 2. Approved I5 candidates used

From `eval/runs/two-sigma-uc-i5/source_candidates.json`:

- Family A: URLs/IP ranges, Teams online call flows, Set up Teams Phone
- Family B: 12 Linux/Python upstream pages
- Family C: upgrade framework, evaluate environment, prepare service, prepare-network, network-planner, cloud-voice-landing-page
- Already local, not re-ingested: PSTN connectivity options
- Not ingested: AudioCodes vendor catalog; TSUC25 methodology prose

No candidate URL was dead. Python tutorial used the approved URL with a Sphinx `role=main` HTML extract (same source, not a substitution).

---

## 3. Exact sources ingested

21 documents, 56 new parents. Full record: `source_manifest.json`.

Family A (Microsoft): 3 pages, 22 parents  
Family C (Microsoft): 6 pages, 22 parents  
Family B (Linux): 12 pages, 12 parents  

---

## 4. Source-family rationale

- **A** — give TSUC13 component evidence (media path, ICE, firewall/IP) without writing a one-way-audio runbook.
- **B** — close the genuine Linux absence for TSUC20/TSUC22.
- **C** — give TSUC27 planning/upgrade/network pages so broad rollout is not forced onto AA/CQ.

TSUC25 unchanged (interview context). TSUC26 unchanged on purpose (query-shape control).

---

## 5. Before / after corpus metrics

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| documents | 241 | 262 | +21 |
| parents | 1233 | 1289 | +56 |
| children / vectors | 2255 | 2679 | +424 |
| SQLite bytes | 13,336,576 | 15,568,896 | +2,232,320 |
| HNSW bytes | 4,088,356 | 4,857,588 | +769,232 |
| corpus fingerprint | `7e6b69cb0ab95823` | `62ea6dac06dbc4a2` | changed |
| index fingerprint | `87a6960b9ebc6701` | `fdafc1789c490573` | changed |

Pipeline: `python -m build.run --skip-sync` (incremental, not `--full`). 21 changed files, 424 new embeddings, existing chunker/embed model/HNSW params.

Linux repo uses existing `whole_file_parent=True` (same flag as cmdlet pages). Chunking algorithm was not rewritten.

---

## 6. Source-quality inspection

Inspected sample parents per new URL.

**Acceptable**

- Canonical URLs are correct for all 21 documents (Linux `.html` mapping works).
- Teams call-flows keep H2/H3 (Background, topologies, ICE-relevant network segments).
- Upgrade framework / evaluate-environment / prepare-network are real planning prose, not marketing chrome.
- Linux man pages retain SYNOPSIS/options/examples. 12 parents exactly.

**Defects (chunker not rewritten)**

- Microsoft 365 URLs/IP **tables flatten** to `IDCategoryERAddressesPorts`. The Teams UDP 3478–3481 row is still present and readable.
- `systemctl` is one 106,943-character parent by design. Usable, but a large card if retrieved whole.
- Linux HTML still carries some man-page SEE ALSO / href noise inside the whole-file parent.
- Python docs required `role=main` extraction; Learn `<main>` path produced empty body.

---

## 7. TSUC04 before / after — PARTIAL, unchanged

I4 top 5: Plan Direct Routing, LMO, Connect SBC, multi-tenant SBC.  
I6A top 5: **identical**.

| Needle | I6A rank |
| --- | ---: |
| Plan Direct Routing | 1 |
| voice routing | 18 |
| Set up Teams Phone (new) | 22 |
| trunk failover (already local) | not in top 40 |
| SBA | not in top 40 |

Source expansion did not surface the already-local failover article. Expected. Do not force PASS.

---

## 8. TSUC13 before / after — PARTIAL, unchanged

I4/I6A top 5: GCC High Audio Conferencing, Plan Direct Routing licensing, inbound ringback, Plan DR overview. **Unchanged.**

| Needle | I6A rank |
| --- | ---: |
| media bypass (already local) | 14 |
| prepare-network (new) | 25 |
| DR media protocols | 29 |
| Teams call flows (new) | not in top 50 |
| URLs/IP (new) | not in top 50 |
| Call Analytics (already local) | not in top 50 |

The new component pages are in the corpus and still lose to GCC High / licensing on “one-way audio”. Success criterion (media/firewall/Call Analytics in top 5) **not met**. Coverage improved; ranking did not.

---

## 9. TSUC20 before / after — GOOD (was PARTIAL)

I4 top 5: SharePoint Copilot file-processing + DR SBC logs.  
I6A top 5: **systemctl**, **ps(1)**, SharePoint (noise), **ss(8)**, CQD (noise).

journalctl rank 15. A senior engineer can speak from systemctl/ps. Residual Microsoft lexical noise remains but is no longer the whole answer.

---

## 10. TSUC22 before / after — GOOD (was MISS / corpus_gap)

I4 top 5: Teams admin call-quality + CQD (false well_served).  
I6A top 5: **ss(8)**, Teams admin quality (noise), systemctl, **tcpdump**, CQD.

Corpus gap closed. Top evidence is now actual Linux primary documentation.

---

## 11. TSUC26 control — PARTIAL, unchanged

HIGH `msteams-ps` still correct.

| Cmdlet | Rank |
| --- | ---: |
| Get-CsAutoAttendant | 1 |
| Get-CsCallQueue | 6 |
| Get-CsOnlineApplicationInstance | not in pool |

Identical to I4. Source expansion did not fix query shape. **Control held.**

---

## 12. TSUC27 before / after — PARTIAL, top 5 unchanged

I6A top 5 still AA/CQ voice-applications policies / authorized users / business decisions / GCC High / voice-routing policy.

New planning pages **did enter the pool**, not the top 5:

| Page | Rank |
| --- | ---: |
| Prepare service for upgrade | 8 |
| prepare-network | 13 |
| Evaluate environment | 22 |
| Upgrade framework | 28 |
| network-planner / cloud-voice-landing | not in top 50 |

Coverage yes. Top-5 architecture/planning orientation **not** achieved. Query-shape issue remains.

---

## 13. Full 30-scenario regression

| | BEFORE I6A | AFTER I6A |
| --- | ---: | ---: |
| GOOD | 21 | **23** |
| PARTIAL | 6 | **5** |
| MISS | 1 | **0** |
| PERSONAL | 2 | **2** |

Moved: TSUC20 PARTIAL→GOOD, TSUC22 MISS→GOOD.

Previously GOOD technical cases remain GOOD. No Linux pollution on non-Linux questions.

TSUC02 top 1 shifted from PSTN connectivity overview to **Set up Teams Phone / choose a PSTN connectivity option**. That is still valid PSTN-failure evidence, not a regression.

TSUC25 stays PARTIAL (interview context; no corpus change). TSUC29/TSUC30 stay PERSONAL.

---

## 14. Latency

I4 runner `elapsedMs` (includes first-query child warmup): p50 **17 ms**, p95 **21 ms**, max **118 ms**.

I6A frozen `SearchEngine.search` on the 30-scenario bank after warmup: p50 **13.4 ms**, p95 **31.6 ms**, max **44.3 ms**, mean **16.5 ms**.

First post-rebuild query (TSUC04 top_k=50) was 128 ms (model/index warmup), analogous to I4’s 118 ms first hit.

Small corpus additions did not materially harm interview latency. Not optimized.

---

## 15. Frozen retrieval proof

- `search.py` `8702daf1ee2b2843`
- `scope_select.py` `2a8caaabd00f4b08`
- no query-shape / phrase-list edits
- no reranker
- no LLM
- no Microsoft runtime rescue
- no vendor docs

---

## 16. Remaining gaps

1. **TSUC04** — trunk failover / SBA / voice-routing already local, still buried. Vendor HA still catalog-only.
2. **TSUC13** — new call-flows and URLs/IP exist, still not retrieved for “one-way audio”. GCC High dominates.
3. **TSUC26** — proven query-shape control; sources already sufficient.
4. **TSUC27** — planning sources exist, AA/CQ still owns top 5.
5. **TSUC25** — not a corpus problem.

---

## 17. Exact recommendation for I6B

Do **one** bounded R0.4 phrase / FTS technical-phrase adjustment so already-local (and newly ingested) parents enter the candidate pool:

- Direct Routing + fail/failover/carrier → trunk failover, voice route, PSTN usage
- one-way audio → media bypass, call analytics, ICE, call flows
- resource account + Auto Attendant/Call Queue → application instance
- global Voice rollout/migration → upgrade framework / prepare-network / PSTN connectivity (not AA/CQ)

Do not add a reranker, verifier, or new engine. Do not ingest AudioCodes until the live SBC vendor is known. Do not ingest methodology prose for TSUC25.

I6B was not implemented in this phase.

---

## B. SOURCE EXPANSION HELPED — ONE BOUNDED QUERY/PHRASE ADJUSTMENT STILL JUSTIFIED
