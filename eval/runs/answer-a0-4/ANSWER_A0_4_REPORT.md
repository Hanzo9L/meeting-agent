# PHASE A0.4 — Post-Generation Claim Entailment Kill Test

10 bounded cases. Original A0 generation, then a separate `gpt-4o-mini` claim verifier. No Relay integration. No retrieval, router, ground-truth, A0-prompt, A0.3 CORE/PERIPHERAL, or Approach B changes.

This is a kill test of whether after generation we can tell legitimate synthesis from neighboring-document invention. It is not statistical proof. The set was not expanded to 26.

---

## 1. Frozen-state verification

All required hashes matched. The harness would have stopped otherwise.

| Artifact | sha256[:16] | Status |
|---|---|---|
| `service/search.py` | `8702daf1ee2b2843` | unchanged |
| `service/scope_select.py` | `2a8caaabd00f4b08` | unchanged |
| `eval/ground_truth/priority14_retrieval.json` | `59f6572dc5f3d3d5` | unchanged |
| `eval/run_r0_1.py` | `c514a53628ba899b` | unchanged |
| `service/answer.py` (A0 prompt + serialization) | `1d3bab096a33403a` | unchanged |

Relay production source was not modified. R0–R0.5 and A0–A0.3 artifacts were left in place. Approach B was not invoked. A0.3 CORE/PERIPHERAL policy was not used. Generation was not blocked before the verifier.

---

## 2. Exact verifier prompt / schema

Stable system prompt (no Q03 examples):

```
You are a claim-entailment verifier for a live technical assistant.

Judge whether the supplied authoritative evidence actually supports the generated claim as stated, given the original user question.

Use only the supplied evidence.
Do not answer the technical question.
Do not repair the claim.
Do not introduce outside Microsoft knowledge.
Do not treat shared product names or neighboring terminology as support.
The exact wording does not need to appear in the evidence. Paraphrase and reasonable synthesis of operations, properties, and relationships that the evidence actually establishes are allowed.
The evidence must establish the factual or operational relationship the claim asserts. Related topic overlap is not enough. A source that addresses a different symptom, procedure, or product capability does not support the claimed relationship.

Verdicts:
ENTAILED — the supplied evidence materially supports the claim as stated.
PARTIAL — part of the claim is supported, but the claim adds a material unsupported step, relationship, procedure, condition, or conclusion.
NOT_ENTAILED — the evidence does not establish the claim.

Return JSON only.
```

Per claim:

```
{
  "verdict": "ENTAILED" | "PARTIAL" | "NOT_ENTAILED",
  "supporting_evidence_ids": ["E1"],
  "unsupported_portion": "...",
  "reason": "one concise sentence"
}
```

Direct-answer units receive E1–E5. The verifier assigns supporting IDs. Talking-point units receive only their cited parents. Talking-point citations are not inherited by the direct sentence.

---

## 3. Selected 5 negative controls

Locked **before** any verifier call:

| ID | Question | Why selected |
|---|---|---|
| N05 | Power BI on-premises data gateway | required; CQD Power BI connector neighbor |
| N11 | Webex-native local gateway PSTN migration | required; Teams LMO / Direct Routing neighbor |
| N01 | Intune iOS / Apple Business Manager | Teams Rooms Intune neighbor |
| N02 | Azure AD B2C custom policies | identity wording vs Teams voice-app policies |
| N08 | Copilot Studio agent → Dataverse service principal | Copilot neighbor in-corpus |

No questions were added after execution began.

---

## 4. Original generated answers

All 10 used the original A0 path. Negatives were allowed to generate so the verifier could judge them.

Summaries:

- **Q03** — invented a one-way-audio procedure from SIP 18x, licenses, Audio Conferencing routing, Allow Private Calling.
- **Q04** — voice-routing policy → PSTN usage → voice route → SBC.
- **Q07** — AA in TAC, routing to CQ, operator, hours.
- **Q13** — sharing / SAM plus backup-and-restore plus pilot.
- **Q14** — Get-CsOnlineUser + voice-routing/voice-route cmdlets as an audit.
- **N01** — invented ABM–Intune enrollment from Teams Rooms Intune text.
- **N02** — invented B2C custom-policy setup from Teams voice-app policies.
- **N05** — treated CQD Power BI connector install as on-prem gateway setup.
- **N08** — treated Copilot Studio *voice agent resource account* as Dataverse SP auth.
- **N11** — treated Teams LMO / `Set-CsOnlinePSTNGateway` as Webex local-gateway migration.

Full prose is in `results.json`.

---

## 5–8. Claim units, primitive audit, semantic verdicts, direct-answer verdicts

Claim units = direct sentence (C0) + each talking point (C1…). Caveats were not scored as claim units.

| ID | Claims | Primitive | Semantic (batched) | Direct semantic |
|---|---|---|---|---|
| Q03 | 6 | all SUPPORTED | 5 ENTAILED, 1 PARTIAL (C0) | PARTIAL |
| Q04 | 6 | all SUPPORTED | 6 ENTAILED | ENTAILED |
| Q07 | 6 | all SUPPORTED | 5 ENTAILED, 1 PARTIAL (C3) | ENTAILED |
| Q13 | 6 | all SUPPORTED | 5 ENTAILED, 1 PARTIAL (C0) | PARTIAL |
| Q14 | 6 | all SUPPORTED | 6 ENTAILED | ENTAILED |
| N01 | 4 | all SUPPORTED | 4 NOT_ENTAILED | NOT_ENTAILED |
| N02 | 6 | all SUPPORTED | 6 NOT_ENTAILED | NOT_ENTAILED |
| N05 | 6 | all SUPPORTED | 1 NOT_ENTAILED (C0), 5 ENTAILED | NOT_ENTAILED |
| N08 | 5 | all SUPPORTED | 1 PARTIAL (C0), 4 ENTAILED | PARTIAL |
| N11 | 6 | all SUPPORTED | 1 PARTIAL (C0), 5 ENTAILED | PARTIAL |

Direct answer never inherited the union of bullet citations as proof. C0 always saw E1–E5 and picked IDs itself.

---

## 9. Q03 full trace

Packet unchanged: Audio Conferencing GCC (E1/E5), DR licensing (E2), **inbound ringback / SIP 18x** (E3), DR overview (E4).

Direct (C0), primitive SUPPORTED, semantic **PARTIAL**:
> To troubleshoot one-way audio … ensure that the SBC is properly configured to handle SIP messages and that the necessary licenses are assigned.

Unsupported portion: SBC SIP handling is not established as a one-way-audio step. Licensing is treated as supported.

Talking points, all primitive SUPPORTED, all semantic **ENTAILED**:

| ID | Claim as stated | Cited | Semantic |
|---|---|---|---|
| C1 | Verify SBC allows multiple SIP 18x messages | E3 ringback | ENTAILED |
| C2 | Required Teams Phone / Audio Conferencing licenses | E2 | ENTAILED |
| C3 | Global voice routing policy for outbound calls from meetings | E1 Audio Conferencing | ENTAILED |
| C4 | Dial-in numbers associated with the AC bridge | E1 | ENTAILED |
| C5 | Enable Allow Private Calling | E2 | ENTAILED |

C1 is the evaluation example: SIP 18x for inbound ringback treated as a one-way-audio troubleshooting step. The claim text does not mention one-way audio, so the verifier scored it as a locally true sentence about E3.

Per-claim mode: **6/6 identical** to batched.

Answer-level: **DEGRADED**, projection still marked useful and **retains the invented procedure**. Required Q03 outcome was REJECTED / insufficient. That failed.

The A0 failure mode survives at talking-point granularity: neighbor-document facts are true, therefore ENTAILED, even though they are not the asked procedure.

Q03 did **not** produce the hoped primitive-SUPPORTED / semantic-NOT_ENTAILED pair on the procedural bullets. Only C0 moved, and only to PARTIAL.

---

## 10. Q04 result

**VERIFIED.** Direct ENTAILED. Policy → PSTN usage → voice route → SBC/gateway all ENTAILED against the routing overview. Clean positive control. Projection remains the full card.

---

## 11. Q07 result

**VERIFIED.** Direct ENTAILED. AA → CQ synthesis allowed. One PARTIAL on menu-options wording (C3). Zero NOT_ENTAILED. Legitimate synthesis survived.

---

## 12. Q13 result

**DEGRADED.** Direct PARTIAL because it bundled backup/restore with Copilot oversharing. That is the useful half of the Q13 test.

The backup talking point itself (C2, cited E3 Step 5) was **ENTAILED**. E3 really is backup documentation, so a locally true bullet about backup passed. The verifier did not treat “irrelevant to the Copilot-security question” as NOT_ENTAILED when the cited parent is about backup.

Oversharing / DAG / RAC claims (C1, C5) were ENTAILED, correctly.

---

## 13. Q14 result

**VERIFIED.** Direct ENTAILED. “Audit Teams Voice users” was allowed as synthesis over Get-CsOnlineUser / voice-routing / voice-route cmdlets. Not rejected for missing the verbatim phrase. Per-claim mode 6/6 agree.

This protection case passed.

---

## 14. Negative-control results

| ID | Answer-level | What happened |
|---|---|---|
| N01 | REJECTED | All claims NOT_ENTAILED. Primitive still SUPPORTED. |
| N02 | REJECTED | All claims NOT_ENTAILED. Voice-app “custom policy” ≠ B2C. |
| N05 | REJECTED | Direct NOT_ENTAILED (CQD connector ≠ on-prem gateway). Five CQD-install bullets ENTAILED as local facts. |
| N08 | DEGRADED | Direct only PARTIAL. Voice-agent resource-account bullets ENTAILED. Projection still “useful.” |
| N11 | DEGRADED | Direct only PARTIAL. LMO / `New-CsOnlinePSTNGateway` bullets ENTAILED as if they were a Webex migration. Projection still “useful.” |

N05’s **direct sentence** is the intended catch. Its talking points and N08/N11 show the same Q03 pattern: neighbor-document operations are locally true, so ENTAILED, and the wrong procedure remains after filtering.

---

## 15. Answer-level verdicts

| ID | Status |
|---|---|
| Q03 | DEGRADED (should have been REJECTED) |
| Q04 | VERIFIED |
| Q07 | VERIFIED |
| Q13 | DEGRADED |
| Q14 | VERIFIED |
| N01 | REJECTED |
| N02 | REJECTED |
| N05 | REJECTED |
| N08 | DEGRADED |
| N11 | DEGRADED |

Priority: 30 claims, 27 ENTAILED, 3 PARTIAL, **0 NOT_ENTAILED**.

Negatives: 27 claims, 14 ENTAILED, 2 PARTIAL, 11 NOT_ENTAILED.

---

## 16. Verified projections

- **Q03** — still a one-way-audio card (PARTIAL direct + five ENTAILED neighbor steps). Not insufficient.
- **Q04 / Q07 / Q14** — remain useful full cards.
- **Q13** — still includes the backup bullet.
- **N01 / N02** — empty / not useful. Correct.
- **N05** — direct dropped; CQD connector steps kept. Mapping marks the *answer* REJECTED, but the retained bullets are still the wrong procedure.
- **N08 / N11** — retained as useful Copilot-voice / Teams-LMO cards for questions they do not answer.

No automatic rewrite of missing transitions.

---

## 17. Batched vs per-claim (Q03, Q14)

| | Q03 | Q14 |
|---|---|---|
| Agreement | 6/6 (100%) | 6/6 (100%) |
| Batched wall | 7.3 s | 14.5 s |
| Per-claim wall | 13.8 s | 14.4 s |

Batched and per-claim were equivalent on the two diagnostic packets. Batched is enough; per-claim is not required. Q14 batched is slow because `Get-CsOnlineUser` is a large parent, not because of extra round trips.

---

## 18. False accepts

These are the kill-test failures:

- Q03 C1–C5: ringback / licensing / Audio Conferencing facts ENTAILED as a one-way-audio runbook.
- Q13 C2: SAM Step 5 backup ENTAILED as a Copilot-prep action.
- N08: Copilot Studio voice resource-account setup ENTAILED as Dataverse SP authentication.
- N11: Teams LMO cmdlets ENTAILED as Webex-native local-gateway migration.
- N05 C1–C5: CQD connector setup ENTAILED (direct was correctly NOT_ENTAILED).

The verifier rewards locally true sentences. It does not reliably ask whether those sentences establish the **asked** procedure.

---

## 19. False rejects

None on the five Priority cases. Q14 was not punished for “audit.” Q04 and Q07 were not over-literal. That is the one clear success of this design.

---

## 20. Latency

Do not optimize. Generation was never skipped.

| Measure | n | p50 (ms) | p95 (ms) |
|---|---|---|---|
| Router | 10 | 17 | 55 |
| Retrieval | 10 | 148 | 230 |
| Answer TTFT | 10 | 1406 | 1791 |
| Answer complete | 10 | 3490 | 7098 |
| Batched verifier TTFT | 10 | 1654 | 3860 |
| Batched verifier complete | 10 | 6254 | 14484 |
| End-to-end (router+retrieval+answer+batched) | 10 | 9887 | 18972 |

Q03 path ~10.8 s with batched verifier vs ~13.8 s extra if per-claim is stacked. Production-like path is already ~2× A0-only.

---

## 21. Token usage / cost

`gpt-4o-mini` $0.15/1M in, $0.60/1M out.

| | |
|---|---|
| Answer-generation calls | 10 |
| Verifier calls | 22 (10 batched + 12 per-claim on Q03/Q14) |
| Answer tokens | 46,335 in / 2,251 out |
| Batched verifier | 137,155 in / 4,237 out |
| Per-claim extra | 51,484 in / 772 out |
| Answer cost | $0.008301 |
| Batched verifier | $0.023116 |
| Per-claim extra | $0.008186 |
| Total this experiment | **$0.039603** |
| Projected generation + one batched verifier | **~$0.00314 / question** |

Rejected and verified answers cost the same in this design: the answer is always generated first.

---

## 22. Primitive vs semantic

`audit_claims()` was not modified.

The intended Q03 demonstration (primitive SUPPORTED, semantic NOT_ENTAILED on fabricated procedure) **did not occur** on the procedural bullets. Both layers accepted C1–C5.

Where the split *did* appear: N01 (4 claims), N02 (6 claims), N05 C0. Those are out-of-domain inventions with weak lexical overlap, not the in-domain neighbor-term case.

---

## 23. Tests

`python -m unittest tests.test_a04_entailment -v` — 9 tests, OK.

Covered: frozen hashes, A0 prompt unchanged, no A0.3/self-gate imports, verifier prompt has no Q03 examples, direct-answer units get the full packet not bullet-union, VERIFIED/REJECTED/projection mapping, prompt includes question + claim.

---

## Recommendation

The verifier is a competent **local fact checker**. It preserves Q14/Q04/Q07 synthesis and rejects far out-of-domain N01/N02 answers that `audit_claims()` still called SUPPORTED.

It is not a **procedure-entailment** checker. Isolated talking points that are true of a neighboring parent stay ENTAILED even when they are being sold as the asked runbook. That is the A0 failure mode. Batched vs per-claim did not change it (100% agreement). Adding more of the same calls would not fix it.

Do not integrate into Relay. Do not expand to 26 on this design.

---

C. CLAIM VERIFICATION REJECTED
