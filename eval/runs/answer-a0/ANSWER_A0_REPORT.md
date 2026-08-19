# PHASE A0 — Grounded Answer-Layer Kill Test

Date: 2026-08-17  
Frozen retriever, R0.4 router, and R0.2 ground truth were not modified. No reranker. No new sources. No Relay integration. No follow-up handling. No STT work.

## Recommendation

**B. CONDITIONAL** — answer quality is promising but one bounded issue must be solved first

A single constrained `gpt-4o-mini` call over frozen top-5 parents produces glanceable, speakable interview cards for most Priority questions, combines multiple parents, and is dramatically cleaner than I4 deterministic Interview Quick on Q04/Q14. The kill-test failure is Q03: the model **did not fail honestly**. It assembled a fake one-way-audio procedure from unrelated Direct Routing / Audio Conferencing parents instead of saying the retrieved Microsoft material does not contain that runbook.

Do not integrate into Relay until source-gap honesty is bounded.

---

## 1. Safety

| Check | Result |
|---|---|
| learn-rag directory | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| `service/search.py` | sha256[:16] `8702daf1ee2b2843` |
| `service/scope_select.py` | `2a8caaabd00f4b08` |
| Frozen GT | `59f6572dc5f3d3d5…` |
| Reranker used | **No** |
| Relay `src/` | not edited |
| R0–R0.5 artifacts | preserved; this run wrote only `eval/runs/answer-a0/` |

---

## 2. Files changed

| File | Role |
|---|---|
| `learn-rag/service/answer.py` | prompt, evidence payload, OpenAI SSE call, claim audit |
| `learn-rag/eval/run_a0.py` | Priority-14 harness: router → frozen top-5 → one answer call |
| `learn-rag/tests/test_a0_answer.py` | prompt contract, audit, no-rerank, Q14 router, Q03 SOURCE_GAP |
| `eval/runs/answer-a0/ANSWER_A0_REPORT.md` | this report |
| `eval/runs/answer-a0/results.json` | machine + review package |

---

## 3. Model / provider (reported before paid calls)

| | |
|---|---|
| Provider | OpenAI (existing meeting-agent `.env` `OPENAI_API_KEY`; Relay default chat model) |
| Exact model | **`gpt-4o-mini`** |
| Other configured providers | None in learn-rag. meeting-agent also uses this key for embeddings/grounded synthesis. One model only. |
| Calls | **14** (one per Priority-14 question). No prompt-tuning sweeps. |
| Timeout | 60 s |
| Streaming | **Yes** (`chat.completions` SSE, `stream_options.include_usage`) |
| Pricing used | $0.15 / 1M input, $0.60 / 1M output |
| Expected cost (pre-run) | ~$0.02–$0.10 |
| Actual cost | **$0.013162** (75,062 in + 3,171 out) |

No new paid dependency was added. `httpx` was already in learn-rag requirements.

---

## 4. Exact prompt

Stable system instruction for every question (also in `results.json`):

```
You are the answer layer for a live technical assistant.

Use ONLY the supplied authoritative evidence.

Do not use outside knowledge to add Microsoft technical facts.

Answer the user's actual question, not merely summarize the documents.

If multiple evidence sections are relevant, combine them.

If retrieved evidence conflicts, prefer the more directly applicable/current authoritative evidence and mention uncertainty.

If the evidence does not support an important part of the requested answer, say what is not established rather than inventing it.

Output JSON with this shape:
{
  "direct_answer": "one direct answer sentence with no evidence IDs",
  "talking_points": [
    {"text": "concise useful talking point", "evidence_ids": ["E1"]}
  ],
  "caveat": null
}

Rules for the JSON:
- direct_answer: one sentence that answers the question.
- talking_points: 3 to 6 bullets. Each bullet must list the evidence IDs that support it.
- caveat: optional short caveat only when needed, otherwise null.
- Prefer enough detail that a technical professional can speak naturally from the card.
- Approximately 80-180 words of user-visible prose (direct sentence plus bullets plus caveat).
- Do not dump document prose.
- Do not give citation homework.
- Do not mention evidence IDs in direct_answer, talking_points text, or caveat.
- Do not claim you performed actions you did not perform.
- Commands or cmdlets only when materially useful and present in the evidence.
- Every technical bullet must have at least one supporting evidence ID from the supplied set.
```

User payload per question: `Question:` plus `[E1]–[E5]` with title, section, canonical URL, and full parent body. No retrieval scores, no ground truth, no rubric concepts, no `TOP1_CORRECT`.

Sources are recorded in machine mapping, not in spoken prose.

---

## 5. Totals

| | |
|---|---|
| Calls | 14 |
| Input tokens | 75,062 |
| Output tokens | 3,171 |
| Total tokens | 78,233 |
| Cost | **$0.013** |

### Latency (ms)

| | min | p50 | p95 | max |
|---|---|---|---|---|
| router | 4.2 | 14.4 | 30.9 | 52.6 |
| retrieval | 52.6 | 184.7 | 240.7 | 374.8 |
| first token | 1466 | **1824** | **2111** | 2194 |
| direct-answer field complete | 1837 | **2265** | **2635** | 2872 |
| answer complete | 3296 | **4086** | **5007** | 5041 |
| total (router+retrieval+answer) | 3489 | **4314** | **5188** | 5446 |

Exploratory only. TTFT ~1.8 s; full card ~4–5 s. No Deepgram/endpointing simulation.

---

## 6. Quality scoreboard (human review; not an LLM grader)

Automated checks: evidence IDs, cmdlets, `-Parameters`, numeric thresholds vs supplied bodies. Quality dimensions reviewed against the retrieved E1–E5 and the question.

| Q | words | Directness | Grounding | Coverage | Usefulness | Brevity |
|---|---|---|---|---|---|---|
| Q01 | 117 | PASS | PASS | PARTIAL | PASS | PASS |
| Q02 | 123 | PASS | PASS | PARTIAL | PASS | PASS |
| Q03 | 115 | **FAIL** | **FAIL** | **FAIL** | **FAIL** | PASS |
| Q04 | 115 | PASS | PASS | PASS | PASS | PASS |
| Q05 | 125 | PASS | PASS | PASS | PASS | PASS |
| Q06 | 123 | PASS | PASS | PASS | PASS | PASS |
| Q07 | 136 | PASS | PASS | PASS | PASS | PASS |
| Q08 | 125 | PASS | PASS | PASS | PASS | PASS |
| Q09 | 106 | PASS | PASS | PASS | PASS | PASS |
| Q10 | 89 | PARTIAL | PASS | PARTIAL | PARTIAL | PASS |
| Q11 | 137 | PASS | PASS | PASS | PASS | PASS |
| Q12 | 81 | PASS | PASS | PASS | PASS | PASS |
| Q13 | 89 | PARTIAL | PASS | PARTIAL | PARTIAL | PASS |
| Q14 | 104 | PASS | PASS | PASS | PASS | PASS |

Most answerable questions: glanceable 80–140 words, 4–6 bullets, multiple parents.

---

## 7. Unsupported technical claims

After correcting a false-positive auditor match on Microsoft 365 SKU **E3/E5** (not evidence slot E3), **no remaining automated UNSUPPORTED cmdlet/parameter/threshold claims**.

Human unsupported / contract failures:

| Q | Fragment | Why |
|---|---|---|
| Q03 | “To troubleshoot one-way audio … ensure that the SBC is properly configured to handle SIP messages…” | Retrieved parents are Audio Conferencing GCC, Plan DR licensing, inbound **ringback**, not a one-way-audio media runbook. The model filled the gap. |
| Q03 | “Verify that the SBC configuration allows for multiple SIP 18x messages…” | Supported by inbound ringback evidence, **not** by a one-way-audio procedure. |
| Q13 | “Implement backup and restore solutions…” | Present in E3 (SAM Step 5), which is **not** an acceptable Copilot-governance parent in frozen GT. Grounded in retrieved text, wrong sibling for the question. |

Q02 first bullet (“E3 with Phone System or E5”) is a license SKU, not an evidence-ID leak.

---

## 8. Q03 source-gap behavior

Question: *How would you troubleshoot one-way audio on a Teams Direct Routing call?*

Corpus remains SOURCE_GAP. Top 5 were Audio Conferencing GCC, Plan DR licensing, inbound ringback, Plan DR overview — none is a one-way-audio runbook.

**Required:** say what is not established.

**Observed:** a confident five-bullet troubleshooting card. It did **not** state that the retrieved Microsoft material lacks a complete one-way-audio procedure.

This is the bounded blocker for Relay integration.

---

## 9. Q04 — routing chain

Top 5 included analog Step 4, Example 1, **Call routing overview (E3)**, Example 2, analog Step 3.

Answer (abridged): voice routing policy contains PSTN usages; usages define call types; voice routes with number patterns associate to usages; routes specify SBCs including backup.

That **is** policy → PSTN usage → voice route → gateway/SBC. It used the overview (E3) and was not trapped on Example 1/2 alone. Multiple parents. **PASS.**

---

## 10. Q13 — SharePoint / Copilot

Top 5: SP/OD rollout Overview, plan Overview, **SAM Step 5 backup (wrong sibling)**, pilot rollout, **SAM Step 3 oversharing (acceptable)**.

The model **did** use Step 3 (sharing / DAG reports) and **also** promoted Step 5 backup as Copilot prep. It did not ignore the wrong sibling. Grounded in supplied E3, misaligned with the interview intent. **PARTIAL.**

---

## 11. Q14 — PowerShell audit

R0.4 router: HIGH `msteams-ps` / `teams-ps`. Top 5: VoiceRoutingPolicy, **Get-CsOnlineUser**, VoiceRoute, TeamsCallingPolicy, AutoAttendant.

Answer leads with Get-CsOnlineUser (Enterprise Voice), then routing policy and voice routes, plus `-Filter`. It synthesized an audit process across cmdlets rather than describing only rank 1. **PASS.** Prior G2.2 script was not in the prompt.

---

## 12. Comparison with I4 deterministic Interview Quick

I4 pack run `eval/runs/interview-i4/interview-i4-priority14.json` was not modified. Closest I4 items:

| A0 | I4 | I4 Quick (excerpt) | I4 grade | A0 vs I4 |
|---|---|---|---|---|
| Q04 routing chain | Q-005 “decision chain from a user to an SBC” | Admin-center Voice routes tab + SBC connect snippets | FAIL | A0 states the policy/usage/route/SBC relationship. **Clear win.** |
| Q13 Copilot/SP | Q-030 | “Adjust sharing settings… Only supported portions should be answered.” (23 words) | FAIL | A0 is a real card and hits oversharing, but still mixes backup. **Better, not clean.** |
| Q14 PowerShell | Q-026 | Garbled `Write-Host (Get-CsPhoneNumberAssignment…` fragments | FAIL | A0 is a coherent Get-CsOnlineUser-centered audit. **Clear win.** |
| Q03 one-way audio | Q-004 | SBC setup excerpt, not one-way audio | FAIL | A0 also fails, by inventing a procedure. **Not a win.** |

The retrieve-top-5 + one constrained call **does** dramatically simplify the I4 pack/ontology/Quick path for questions the corpus actually answers.

---

## 13. Multiple retrieved parents

Yes. Typical answers cite 2–4 evidence IDs. Q04 combined overview + examples. Q14 combined three cmdlet parents. Q01 combined Configure DR Overview with SBC monitoring. The model is doing the allowed job: pick relevant parents from the five, ignore some, combine others.

---

## 14. Is a single constrained answer call viable?

**Yes, for answerable questions with on-topic top-5 parents.** Direct sentence + 3–6 bullets, ~80–140 words, no citation homework, ~$0.001 per question, ~4 s complete.

**Not yet**, when top-5 is off-topic (Q03) or contains a tempting wrong sibling (Q13 Step 5). The model prefers to answer from *something* in the packet rather than say the packet is insufficient.

Bounded issue to solve before Relay prototype:

1. **Insufficiency / source-gap honesty** — if none of E1–E5 actually addresses the asked procedure, the card must say so instead of assembling a neighboring procedure.
2. Optional: sibling-heading discipline (prefer overview/governance steps over backup when the question is Copilot readiness). Do not add a reranker; this is an answer-layer instruction/check.

---

## Per-question package

Full E1–E5, mappings, tokens, and latency are in `results.json`. Summary:

### Q01 — Explain Direct Routing and the SBC
GLOBAL. Direct Routing + certified SBC + SIP options health. Combined E3/E1/E2/E4. Coverage PARTIAL (analog Step 1 in the pool). Quality mostly PASS.

### Q02 — Internal OK, external PSTN fails
GLOBAL. License, number, Online Voice Routing policy, SIP Invite. One auditor false positive on SKU E3/E5 (corrected, no rerun). Coverage PARTIAL (AA-transfer parent in pool).

### Q03 — One-way audio
GLOBAL. SOURCE_GAP. **FAIL honesty.** See §8.

### Q04 — Routing chain
GLOBAL. **PASS.** See §9.

### Q05 — SBC certificate renew
GLOBAL. Trusted CA, FQDN SAN, drop old TLS, intermediate chain. PASS.

### Q06 — Emergency calling + location
GLOBAL. Dynamic emergency calling, PSAP, registered address fallback. PASS.

### Q07 — Auto Attendant into Call Queue
GLOBAL. Teams admin center AA setup, redirect to CQ, operator, hours. PASS.

### Q08 — Teams Room resource account
GLOBAL. Create account, Rooms license, UPN=SMTP, hybrid caveat. PASS.

### Q09 — Room account locked / cannot sign in
GLOBAL. Connectivity test, no MFA, password expiry, license, mailbox. PASS.

### Q10 — Far end cannot hear the room
GLOBAL. Audio device settings / USB enhancements from known-issues parents. PARTIAL vs a full far-end-audio diagnosis.

### Q11 — Fleet of Teams Rooms
GLOBAL. Rooms Pro Management, TAC dashboard, XML. PASS.

### Q12 — CQD vs per-user analytics
GLOBAL. Network-wide vs per-call. PASS. Shortest card (81 words).

### Q13 — SharePoint/OneDrive before Copilot
GLOBAL. PARTIAL. See §10.

### Q14 — PowerShell audit Teams Voice users
SCOPED HIGH `msteams-ps`. **PASS.** See §11.

---

## Tests

`python -m unittest tests.test_a0_answer -v` → **11 OK** (prompt contract, no GT leak, unsupported cmdlet, missing E-id, SKU ≠ evidence ID, Q03 SOURCE_GAP, Q14 router, no rerank import).

---

## Acceptance

**B. CONDITIONAL** — promising retrieve-top-5 + one constrained answer call, but Q03 source-gap honesty must be solved before a Relay integration prototype.

Do not integrate into Relay. Do not implement follow-ups. Do not begin STT/audio work.
