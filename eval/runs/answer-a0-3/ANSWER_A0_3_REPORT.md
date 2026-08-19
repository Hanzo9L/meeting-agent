# PHASE A0.3 — Preflight Decision Policy Kill Test

26 frozen packets. Deterministic fail-closed policy over a minimally refined preflight. No Relay integration. No Approach B. No retrieval, router, ground-truth, or A0-prompt changes.

This is not statistical proof. It tests whether preflight output can drive a safe generate/block decision before the answer call.

---

## 1. Frozen-state verification

All required hashes matched. The harness would have stopped otherwise.

| Artifact | sha256[:16] | Status |
|---|---|---|
| `service/search.py` | `8702daf1ee2b2843` | unchanged |
| `service/scope_select.py` | `2a8caaabd00f4b08` | unchanged |
| `eval/ground_truth/priority14_retrieval.json` | `59f6572dc5f3d3d5` | unchanged |
| `eval/run_r0_1.py` | `c514a53628ba899b` | unchanged |
| `service/answer.py` (original A0 prompt) | `1d3bab096a33403a` | unchanged |
| `service/support_preflight.py` (A0.2 schema) | `bce0cc06b1bfc051` | unchanged |

Relay production source was not modified. R0–R0.5 and A0–A0.2 artifacts were left in place. Approach B was not imported or invoked.

---

## 2. Current A0.2 preflight schema inspection

A0.2 schema (frozen, not used for the live A0.3 decisions):

```
{
  "support": "SUPPORTED" | "PARTIAL" | "UNSUPPORTED",
  "supporting_evidence_ids": ["E2"],
  "missing": ["short description of unsupported requested part"],
  "reason": "one concise sentence"
}
```

Actual A0.2 Approach A outputs:

### Q03

- support: `PARTIAL`
- supporting_evidence_ids: `E2`, `E3`
- missing: `specific troubleshooting steps for one-way audio issues`
- reason: licensing / general Direct Routing issues, no one-way-audio steps

The missing string **is** the requested task. A reader can tell this is core. A machine cannot safely tell that from `missing` text alone, because answerable packets look the same.

### Q05

- support: `SUPPORTED`
- supporting_evidence_ids: `E2`
- missing: `[]`
- reason: evidence has instructions on requesting/renewing SBC certificates

No gap is declared. The Microsoft-vs-vendor split is not in the output, so a policy cannot treat this as PARTIAL.

### Q07

- support: `SUPPORTED`
- supporting_evidence_ids: `E1`, `E2`
- missing: `[]`
- reason: detailed AA → CQ setup

Empty `missing`. Nothing for a core/peripheral test to do.

### Q14

- support: `SUPPORTED`
- supporting_evidence_ids: `E2`
- missing: `[]`
- reason: evidence retrieves Teams user / voice configuration details

Empty `missing`. A0.2 would have allowed generation.

### N11

- support: `PARTIAL`
- supporting_evidence_ids: `E2`, `E4`
- missing: `specific steps for migrating PSTN onto a Webex-native local gateway`
- reason: Teams LMO / Direct Routing, not a Webex migration

Again the missing string **is** the requested task.

### Can existing `missing` drive a safe decision?

No. A0.2 also returned PARTIAL with “the whole question is missing” wording on useful packets:

- Q01 missing: `detailed explanation of Direct Routing and specific role of the SBC`
- Q02 missing: `specific troubleshooting steps for internal users unable to call external PSTN numbers`

A deterministic overlap between question text and `missing` would BLOCK Q03 and N11 **and** Q01/Q02. That is not a safe production rule, and it would be a question-shaped heuristic. Schema refinement was required.

---

## 3. Schema refinement required?

**Yes.** One bounded addition to a new A0.3 preflight module. The A0.2 prompt file was not overwritten.

Added fields:

- `missing_importance`: `CORE` | `PERIPHERAL` | `NONE`
- `answerable_scope`

No other fields. No benchmark examples in the prompt.

---

## 4. Exact final preflight schema

```
{
  "support": "SUPPORTED" | "PARTIAL" | "UNSUPPORTED",
  "missing_importance": "CORE" | "PERIPHERAL" | "NONE",
  "supporting_evidence_ids": ["E2"],
  "answerable_scope": "short description of what the packet can establish",
  "missing": ["short description of unsupported requested part"],
  "reason": "one concise sentence"
}
```

CORE / PERIPHERAL / NONE definitions match the phase contract. Prompt still forbids answering the technical question, using outside knowledge, or inferring neighboring procedures.

---

## 5. Decision-policy contract

Separate experimental module. Input: original question + preflight JSON only. No question IDs, ground-truth labels, expected answers, or acceptable-source lists. No second model.

| Preflight | Decision |
|---|---|
| SUPPORTED + NONE | ALLOW_FULL |
| PARTIAL + PERIPHERAL | ALLOW_PARTIAL |
| PARTIAL + CORE | BLOCK |
| UNSUPPORTED (any importance) | BLOCK |
| any other / invalid combination | BLOCK |

Fail closed.

`supported_scope` and `missing_scope` are copied from `answerable_scope` / `missing`. Question text is used only as a fallback `supported_scope` when ALLOW_FULL and the field is empty.

---

## 6. Decision-policy code size

`service/decision_policy.py`: **83 lines** total, **~70** of logic. Four-row map plus fail-closed default. No keyword lists, no embeddings, no topic table.

---

## 7. All 26 decisions

| ID | Kind | Support | Importance | Decision | Grade |
|---|---|---|---|---|---|
| Q01 | answerable | PARTIAL | CORE | BLOCK | FALSE_BLOCK |
| Q02 | answerable | PARTIAL | CORE | BLOCK | FALSE_BLOCK |
| Q03 | source gap | PARTIAL | CORE | BLOCK | EXPECTED_BLOCK |
| Q04 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q05 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q06 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q07 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q08 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q09 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q10 | answerable | PARTIAL | CORE | BLOCK | FALSE_BLOCK |
| Q11 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q12 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q13 | answerable | SUPPORTED | NONE | ALLOW_FULL | ALLOW_FULL |
| Q14 | answerable | PARTIAL | CORE | BLOCK | FALSE_BLOCK |
| N01–N12 | negative | UNSUPPORTED | CORE | BLOCK | BLOCK |

`PERIPHERAL` was **never** emitted. `ALLOW_PARTIAL` count: **0**.

---

## 8. Q03 full trace

Question: “How would you troubleshoot one-way audio on a Teams Direct Routing call?”

Frozen packet unchanged from A0/A0.2: Audio Conferencing GCC (E1/E5), DR licensing (E2), **inbound ringback / SIP 18x** (E3), DR overview (E4).

**Preflight ran.** Output:

```
support: PARTIAL
missing_importance: CORE
supporting_evidence_ids: ["E3"]
answerable_scope: "issues affecting inbound Direct Routing calls"
missing: ["specific troubleshooting steps for one-way audio on Teams Direct Routing calls"]
reason: inbound-call issues are discussed; one-way-audio troubleshooting steps are not.
```

**Decision = BLOCK.** Reason: missing material is the core requested task.

**Answer-model call count = 0.**

Returned experimental payload only:

```
status: INSUFFICIENT_EVIDENCE
message: "I don't have enough authoritative evidence to answer this reliably."
missing: ["specific troubleshooting steps for one-way audio on Teams Direct Routing calls"]
```

No technical troubleshooting procedure was generated.

Latency: router 6.6 ms + retrieval 27.7 ms + preflight 2399 ms + policy 0.04 ms + gate 0.33 ms = **2434 ms** total. No answer call.

This is the central acceptance case, and it passed.

---

## 9. Q05 result

ALLOW_FULL. Preflight: SUPPORTED / NONE. Scope: “Instructions for renewing or replacing an SBC certificate.”

The packet is Microsoft certificate requirements, SIP/TLS certificate troubleshooting, and CA-change notices — not a vendor SBC UI/command runbook. The intended PARTIAL test did not fire because the classifier treated Microsoft-side cert instructions as the whole requested answer.

ALLOW_FULL is acceptable under the letter of this phase **if** the evidence genuinely supports the whole answer. It does not, in the vendor-mechanics sense, but the preflight did not surface that split. Original A0 then generated a full renewal-sounding card (request CA cert, install on SBC, drop old TLS sessions).

Q05 therefore did not exercise ALLOW_PARTIAL.

---

## 10. Q07 result

ALLOW_FULL. Not a false block.

Preflight: SUPPORTED / NONE. E1/E2/E4. Original A0 answer ran. Direct sentence: set up the Auto Attendant in Teams admin center, route to a Call Queue, define menu options. Useful and on-packet.

---

## 11. Q14 result

**FALSE_BLOCK.** Required survival failed.

```
support: PARTIAL
missing_importance: CORE
answerable_scope: "Information about online users and their voice configuration"
missing: ["Specific procedures for auditing Teams Voice users"]
```

The packet includes `Get-CsOnlineUser` and related voice cmdlets. A0.2 had called this SUPPORTED. A0.3 blocked it because the docs do not spell a procedure named “audit Teams Voice users.” That is exactly the failure mode this phase was forbidden to produce.

Generation gate returned INSUFFICIENT_EVIDENCE with **0 answer calls**. Safer than fabricating; still a false reject of a useful packet.

---

## 12. N11 result

BLOCK, correctly, as **UNSUPPORTED / CORE** (stricter than A0.2’s soft PARTIAL).

Missing: Webex-native local-gateway PSTN migration. Retrieved evidence is Teams Direct Routing Local Media Optimization. Neighboring “local gateway” vocabulary was not treated as support. No answer generated.

---

## 13. False blocks

4 of 13 answerable controls:

| ID | Classifier rationale | Why it is a false block |
|---|---|---|
| Q01 | missing “detailed explanation of DR and SBC role” | packet has usable DR/SBC material |
| Q02 | missing “specific troubleshooting steps” for internal-ok / PSTN-fail | packet has PSTN connectivity / licensing / routing material |
| Q10 | missing “specific checks for microphone settings” | packet has Teams Rooms far-end audio quality material |
| Q14 | missing “specific procedures for auditing Teams Voice users” | `Get-CsOnlineUser` is the useful answer |

Pattern: whenever the model wants to be conservative, it emits PARTIAL+CORE. The policy then must BLOCK. There is no calibrated PERIPHERAL middle.

---

## 14. Unsafe allows

**None.**

- Q03: BLOCK
- 12/12 negatives: BLOCK (no ALLOW_PARTIAL, no ALLOW_FULL)
- N05 CQD connector: UNSUPPORTED / BLOCK

The policy is fail-closed and did not leak a full or partial answer on negatives. The failure is over-blocking, not unsafe allowing.

---

## 15. Five-case generation spot check

| ID | Decision | Answer calls | What was returned |
|---|---|---|---|
| Q03 | BLOCK | **0** | INSUFFICIENT_EVIDENCE only |
| Q05 | ALLOW_FULL | 1 | original A0 card |
| Q07 | ALLOW_FULL | 1 | original A0 card |
| Q14 | BLOCK | **0** | INSUFFICIENT_EVIDENCE (false block) |
| N11 | BLOCK | **0** | INSUFFICIENT_EVIDENCE |

ALLOW_PARTIAL was not hit, so the experimental partial-answer mode was not live-exercised. Unit tests still prove that mode’s prompt is scoped to `answerable_scope` / `missing` and forbids filling the gap.

Total answer calls in the experiment: **2**. Blocked answer calls avoided on the 26-packet set: **17**.

---

## 16. Direct-answer support diagnostic

Not `audit_claims()`. Not union of talking-point E-IDs. Per-parent lexical/cmdlet containment on the **direct sentence only**.

| ID | Direct sentence individually supported by ≥1 parent? | Notes |
|---|---|---|
| Q03 | N/A | no sentence generated |
| Q14 | N/A | no sentence generated |
| N11 | N/A | no sentence generated |
| Q05 | yes (coarse) | no cmdlets; 50% content-word overlap hit E1–E4. Weak test. E2 is the real cert-requirements parent; “remove old TLS connections” likely comes from E1 SIP/TLS troubleshooting |
| Q07 | yes (coarse) | no cmdlets; E1 AA setup parent contains the sentence’s content words |

Without cmdlets, this diagnostic is too loose to prove semantic support of the direct sentence. It is only a parent-containment check.

---

## 17. Latency

Policy time is ~0.03 ms. It is not the cost. Preflight is.

| Path | n | p50 (ms) | p95 (ms) |
|---|---|---|---|
| Blocked (no answer call) | 17 | 2519 | 5961 |
| Spot BLOCK including Q03 | 3 | 3190 | 3507 |
| Spot ALLOW_FULL (preflight + A0 answer) | 2 | 7528 | 11094 |
| ALLOW_PARTIAL | 0 | — | — |
| Preflight complete (all 26) | 26 | 2440 | 7834 |
| Preflight TTFT | 26 | 1220 | 4651 |
| Router | 26 | 14 | 22 |
| Retrieval | 26 | 69 | 123 |

Q03 blocked path **2.4 s** vs ALLOW_FULL spot checks **7.5–11.1 s**. Blocking before generation is materially faster than calling the answer model.

---

## 18. Token usage / cost

`gpt-4o-mini` $0.15/1M in, $0.60/1M out.

| | |
|---|---|
| Preflight calls | 26 |
| Answer calls | 2 |
| Blocked answer calls avoided | 17 |
| Preflight tokens | 133,221 in / 2,272 out |
| Answer tokens | 13,028 in / 480 out |
| Preflight cost | $0.021347 |
| Answer cost | $0.002242 |
| Total | **$0.023589** |

Fail-closed is cheap. One wasted Q01 preflight from a console encoding crash before the successful run is not included.

---

## 19. Tests

`python -m unittest tests.test_a03_policy -v` — **16 tests, OK**. Coverage of the required cases:

1. SUPPORTED + NONE → ALLOW_FULL
2. PARTIAL + PERIPHERAL → ALLOW_PARTIAL
3. PARTIAL + CORE → BLOCK
4. UNSUPPORTED → BLOCK
5. invalid combination → BLOCK
6. Q03 PARTIAL+CORE → BLOCK
7. Q03 does not call answer generator (mock raises if invoked)
8. Q07 SUPPORTED+NONE is not blocked
9. Q14 SUPPORTED+NONE is not blocked
10. negative UNSUPPORTED is blocked
11. partial prompt cannot declare beyond `answerable_scope` / `missing`
12. router / retriever / A0 prompt / A0.2 preflight hashes frozen
13. harness and gate do not import Approach B

Live Q14 false-block is a preflight labeling failure, not a policy-mapping failure. The unit test correctly shows that **if** the classifier had returned SUPPORTED+NONE, Q14 would be allowed.

---

## 20. Final recommendation

The **mapping** is viable: small, general, fail-closed. Q03 is blocked before generation. All 12 negatives are blocked. No unsafe allows.

The **CORE vs PERIPHERAL label is not viable** as a production signal:

- `PERIPHERAL` never appeared
- PARTIAL collapsed to CORE
- that blocked Q14 and three other answerable controls
- Q05 never surfaced the vendor-specific gap, so ALLOW_PARTIAL was untested on live packets

Fixing that split with this model would mean prompt-tuning, question-shaped rules, or another semantic call — all out of scope, and the last two are what this phase forbade.

The precheck architecture is not rejected: hard UNSUPPORTED and explicit CORE gaps (Q03, N11, N05) are the right fail-closed behavior. The missing piece is a reliable, non-brittle CORE/PERIPHERAL distinction.

Do not integrate into Relay.

---

B. PREFLIGHT OUTPUT INSUFFICIENT
