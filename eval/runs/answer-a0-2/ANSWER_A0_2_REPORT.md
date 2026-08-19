# PHASE A0.2 — Semantic Evidence-Sufficiency Kill Test

26 frozen packets. Two isolated `gpt-4o-mini` approaches. No Relay integration. No retrieval, router, ground-truth, embedding, or A0-prompt changes.

This is not a statistical claim. It is a kill test on the A0 failure mode: related Microsoft material treated as support for a requested procedure.

---

## 1. Frozen-component verification

All required hashes matched before the run. The harness would have stopped otherwise.

| Artifact | sha256[:16] | Status |
|---|---|---|
| `service/search.py` (frozen hybrid retriever) | `8702daf1ee2b2843` | unchanged |
| `service/scope_select.py` (R0.4 HIGH/NONE) | `2a8caaabd00f4b08` | unchanged |
| `eval/ground_truth/priority14_retrieval.json` (R0.2) | `59f6572dc5f3d3d5` | unchanged |
| `eval/run_r0_1.py` (canonical questions) | `c514a53628ba899b` | unchanged |
| `service/answer.py` (A0 prompt + serialization) | `1d3bab096a33403a` | unchanged |

A0 evidence serialization is still `[E#] / Title / Section / URL / full parent body`. Packets contained no ground-truth labels, SOURCE_GAP tags, retrieval scores, or PASS/FAIL labels.

The original A0 `SYSTEM_PROMPT` was not overwritten. Approach B lives in a separate experimental module.

Relay production source was not modified. Previous A0 / A0.1 artifacts were left in place.

---

## 2. Exact Approach A prompt / schema

Isolated classifier. Does not generate an answer.

```
You are an evidence-support classifier for a live technical assistant.

Judge whether the supplied authoritative evidence materially supports answering the ACTUAL user question.

Related topic overlap is not sufficient.
A source that mentions the same product but addresses a different symptom or procedure does not support the requested answer.

SUPPORTED means the important requested answer can be grounded from the packet.
PARTIAL means a materially useful answer is possible but an important requested element is absent.
UNSUPPORTED means the packet does not establish the requested answer.

Do not answer the technical question.
Do not use outside knowledge.
Do not infer missing procedures from neighboring topics.
Return JSON only:

{
  "support": "SUPPORTED" | "PARTIAL" | "UNSUPPORTED",
  "supporting_evidence_ids": ["E2"],
  "missing": ["short description of unsupported requested part"],
  "reason": "one concise sentence"
}
```

User payload: question + the same A0 evidence block + “Return only the support JSON. Do not answer the question.”

Model: `gpt-4o-mini`. Temperature 0. `response_format: json_object`.

Eval-only policy: SUPPORTED or PARTIAL would allow generation; UNSUPPORTED would block. This phase did not call the A0 answer generator for the 26 packets.

---

## 3. Exact Approach B prompt / schema

Experimental self-gating prompt. Original A0 prompt preserved for control.

```
You are the answer layer for a live technical assistant.

Use ONLY the supplied authoritative evidence.
Do not use outside knowledge to add Microsoft technical facts.

First decide whether the packet materially supports answering the ACTUAL question.
Related topic overlap is not sufficient.
A source that mentions the same product but addresses a different symptom or procedure does not support the requested answer.

Then return JSON only:

{
  "support": "SUPPORTED" | "PARTIAL" | "UNSUPPORTED",
  "missing": [],
  "direct_answer": null,
  "talking_points": [],
  "caveat": null
}

If UNSUPPORTED:
- direct_answer MUST be null
- talking_points MUST be empty
- list what is not established in missing
- do not construct a plausible answer from related evidence

If PARTIAL:
- answer only the portion actually established
- explicitly identify what is not established in missing and caveat
- do not fill the gap from outside knowledge
- talking_points: 1 to 6 bullets, each with evidence_ids
- direct_answer: one sentence covering only the established portion

If SUPPORTED:
- direct_answer: one sentence that answers the question
- talking_points: 3 to 6 concise useful points, each with evidence_ids
- caveat: optional short caveat, otherwise null
- Do not mention evidence IDs in prose
- Do not dump document prose
- Do not claim you performed actions you did not perform
```

Neither prompt contains Q03 evaluation criteria (ringback, Audio Conferencing runbook, SOURCE_GAP, Power BI connector / CQD).

---

## 4. All 26 semantic decisions — Approach A

| ID | Kind | Support | Grade | Missing / reason (abridged) |
|---|---|---|---|---|
| Q01 | answerable | PARTIAL | ACCEPT | detailed DR / SBC role explanation |
| Q02 | answerable | PARTIAL | ACCEPT | specific PSTN-outbound troubleshooting steps |
| Q03 | source gap | PARTIAL | ACCEPTABLE_PARTIAL (human) | specific one-way-audio troubleshooting steps |
| Q04 | answerable | SUPPORTED | ACCEPT | — |
| Q05 | answerable | SUPPORTED | ACCEPT | — |
| Q06 | answerable | SUPPORTED | ACCEPT | — |
| Q07 | answerable | SUPPORTED | ACCEPT | — |
| Q08 | answerable | SUPPORTED | ACCEPT | — |
| Q09 | answerable | SUPPORTED | ACCEPT | — |
| Q10 | answerable | SUPPORTED | ACCEPT | — |
| Q11 | answerable | SUPPORTED | ACCEPT | — |
| Q12 | answerable | SUPPORTED | ACCEPT | — |
| Q13 | answerable | SUPPORTED | ACCEPT | — |
| Q14 | answerable | SUPPORTED | ACCEPT | — |
| N01 | negative | UNSUPPORTED | CORRECT_REJECT | Intune / ABM enrollment |
| N02 | negative | UNSUPPORTED | CORRECT_REJECT | Azure AD B2C custom policies |
| N03 | negative | UNSUPPORTED | CORRECT_REJECT | AVD + FSLogix |
| N04 | negative | UNSUPPORTED | CORRECT_REJECT | MDE ASR Office macros |
| N05 | negative | UNSUPPORTED | CORRECT_REJECT | Power BI on-prem gateway |
| N06 | negative | UNSUPPORTED | CORRECT_REJECT | D365 Field Service |
| N07 | negative | UNSUPPORTED | CORRECT_REJECT | Windows Autopilot |
| N08 | negative | UNSUPPORTED | CORRECT_REJECT | Copilot Studio / Dataverse SP |
| N09 | negative | UNSUPPORTED | CORRECT_REJECT | Mimecast SEG |
| N10 | negative | UNSUPPORTED | CORRECT_REJECT | Okta SAML IdP |
| N11 | negative | PARTIAL | SOFT_NEAR_MISS | Webex-native local-gateway migration |
| N12 | negative | UNSUPPORTED | CORRECT_REJECT | SAP HANA Large Instances |

Machine grade for Q03 A was `PARTIAL_REVIEW` because the explicit-gap needle list missed “does not provide”. Human review accepts the PARTIAL label.

---

## 5. All 26 semantic decisions — Approach B

| ID | Kind | Support | Grade | Notes |
|---|---|---|---|---|
| Q01 | answerable | SUPPORTED | ACCEPT | |
| Q02 | answerable | PARTIAL | ACCEPT | |
| Q03 | source gap | PARTIAL | label OK, answer fabricated | see §7 / §12 |
| Q04 | answerable | SUPPORTED | ACCEPT | useful card |
| Q05 | answerable | SUPPORTED | ACCEPT | |
| Q06 | answerable | SUPPORTED | ACCEPT | |
| Q07 | answerable | SUPPORTED | ACCEPT | |
| Q08 | answerable | SUPPORTED | ACCEPT | |
| Q09 | answerable | SUPPORTED | ACCEPT | |
| Q10 | answerable | SUPPORTED | ACCEPT | |
| Q11 | answerable | SUPPORTED | ACCEPT | |
| Q12 | answerable | SUPPORTED | ACCEPT | |
| Q13 | answerable | SUPPORTED | ACCEPT | still mixes SAM Step 5 backup |
| Q14 | answerable | SUPPORTED | ACCEPT | useful PowerShell card |
| N01–N10 | negative | UNSUPPORTED | CORRECT_REJECT | empty answers |
| N11 | negative | UNSUPPORTED | CORRECT_REJECT | better than A |
| N12 | negative | UNSUPPORTED | CORRECT_REJECT | empty answer |

---

## 6. Positive-control false rejects

**None for either approach.**

13/13 answerable packets were SUPPORTED or appropriately PARTIAL.

Q01 A PARTIAL is conservative, not a false reject. Q02 PARTIAL on both sides is reasonable: the packet discusses PSTN connectivity more than a complete outbound-failure runbook.

---

## 7. Q03 result

Question: “How would you troubleshoot one-way audio on a Teams Direct Routing call?”

Frozen packet (same as A0):

| ID | Title / section |
|---|---|
| E1 | Audio Conferencing with Direct Routing, GCC High and DoD — deploy |
| E2 | Plan Direct Routing — licensing and other requirements |
| E3 | Issues that affect inbound Direct Routing calls — **no ringback tone** / SIP 18x |
| E4 | Plan Direct Routing — overview |
| E5 | Audio Conferencing GCC — unsupported capabilities |

### Approach A

```
support: PARTIAL
supporting_evidence_ids: ["E2", "E3"]
missing: ["specific troubleshooting steps for one-way audio issues"]
reason: "The evidence discusses licensing and general issues related to Direct Routing but does not provide specific troubleshooting steps for one-way audio."
```

Not a confident SUPPORTED. Explicitly states the one-way-audio procedure is absent. That meets the acceptable-PARTIAL rule.

It does **not** fully pass the evaluation audit:

- It still lists E3 (ringback) and E2 (licensing) as supporting.
- It does not name E3 as ringback-not-one-way-media.
- It does not name E1 as Audio Conferencing, not a one-way-audio runbook.
- Shared “Direct Routing” overlap is only partly resisted.

### Approach B

```
support: PARTIAL
missing: ["Specific troubleshooting steps for one-way audio on Teams Direct Routing calls."]
direct_answer: "To troubleshoot one-way audio on a Teams Direct Routing call, ensure that the global voice routing policy allows outbound calls to the PSTN and that the necessary licenses are assigned to users."
```

The support label is the same acceptable PARTIAL. The generated answer is the A0 failure mode: a confident procedure built from Audio Conferencing routing (E1), licensing (E2), and ringback/SIP (E3), plus a caveat that the procedure is “not detailed.”

B is not viable under “Q03 produces no fabricated answer.”

---

## 8. Negative-control false accepts

**No SUPPORTED false accepts on either side.**

| Approach | CORRECT_REJECT | PARTIAL review | FALSE_ACCEPT (SUPPORTED) |
|---|---|---|---|
| A | 11/12 | 1 (N11) | 0 |
| B | 12/12 | 0 | 0 |

N11 A is the residual near-miss: Teams Direct Routing Local Media Optimization retrieved for a Webex-native local-gateway migration. A called that PARTIAL and cited E2/E4. B correctly returned UNSUPPORTED and no answer.

---

## 9. N05 result

Question: “How would you configure a Power BI on-premises data gateway in standard mode?”

Retrieved packet is the Teams CQD Power BI connector (plus a voice-apps historical-report install). Same neighbor-token trap as A0.1.

Both approaches: **UNSUPPORTED / CORRECT_REJECT**.

A: “The evidence provided does not contain any information on configuring a Power BI on-premises data gateway in standard mode.”

B: `direct_answer` null, empty talking points.

The CQD connector was not treated as an on-premises gateway runbook.

---

## 10. Q14 result

Question: “How would you use PowerShell to audit Teams Voice users and their voice configuration?”

Scoped `msteams-ps` packet. E2 is `Get-CsOnlineUser`.

| Approach | Support | Grade |
|---|---|---|
| A | SUPPORTED (E2) | ACCEPT |
| B | SUPPORTED | ACCEPT |

Neither rejected Q14 for missing the exact phrase “audit Teams Voice configuration.” B produced a useful Get-CsOnlineUser / filter / policy card.

---

## 11. Q05 PARTIAL behavior

Both approaches returned **SUPPORTED**, citing certificate request/renewal evidence.

The intended semantic nuance was: useful certificate evidence is not necessarily a full vendor-specific renewal procedure. PARTIAL would have been the more precise label. This is over-completeness, not a false reject, and not the A0 near-miss failure.

---

## 12. Q04 / Q13 / Q14 self-gated answer samples

### Q04 — useful

Direct: the DR chain is voice-routing policy → PSTN usages → voice routes / number patterns → SBCs.

Points cover policy-as-container, PSTN usages, routes, active/backup SBCs, and admin-center vs PowerShell. Support decision SUPPORTED matches a genuinely grounded packet.

### Q13 — useful but still mixed

Direct: review sharing, backup/restore, restrict sensitive content.

Points correctly use SAM Step 3 oversharing / RAC / DAG (E5) and still include Step 5 backup/restore (E3). Same residual A0 mix. Self-gating did not fix that.

### Q14 — useful

Direct: use `Get-CsOnlineUser` to audit Teams Voice users and voice configuration.

Points include Enterprise Voice filter, voice-routing policy, and voice routes. This is the card A0.1 coverage gates would have killed.

### Q03 — fabricated despite PARTIAL

See §7. Direct answer starts “To troubleshoot one-way audio…” and then lists voice-routing policy, licenses, SBC/SIP, and Audio Conferencing routing. Caveat admits the procedure is missing. That is not a refused answer.

---

## 13. Primitive-audit vs semantic-support

These are different checks. `audit_claims()` was not used as proof of semantic support.

| Packet | Lexical / primitive audit | Semantic support |
|---|---|---|
| A0 Q03 (original answer) | all claims SUPPORTED (cmdlets/IDs exist in cited text) | human FAIL — invented one-way-audio procedure |
| A0.2 A Q03 | no answer generated | PARTIAL, explicit missing procedure |
| A0.2 B Q03 | `HAS_UNSUPPORTED_PRIMITIVE` | PARTIAL label + fabricated procedure |
| A0.2 B Q04/Q13/Q14 | also `HAS_UNSUPPORTED_PRIMITIVE` | semantically accepted |

B’s primitive failures are mostly schema: the model put `(E1)` in bullet text and left `evidence_ids` empty. That is not a semantic-support signal. A0 Q03 shows the opposite error: primitives pass while the answer is semantically unsupported.

Do not ship `audit_claims()` as a sufficiency gate.

---

## 14. Latency

No latency optimization in this phase.

| Measure | n | min | p50 | p95 | max |
|---|---|---|---|---|---|
| A support TTFT (ms) | 26 | 938 | 1174 | 2532 | 3012 |
| A support complete (ms) | 26 | 1474 | 1748 | 3477 | 3639 |
| A projected combined (ms) | 26 | 1555 | 5786 | 7430 | 7633 |
| B TTFT (ms) | 26 | 936 | 1163 | 2668 | 3285 |
| B direct-answer available (ms) | 14 | 1353 | 1724 | 2534 | 2880 |
| B complete (ms) | 26 | 1340 | 2562 | 3642 | 3675 |

Projected A combined = router + retrieval + measured support call + **existing A0 answer-complete** for that question (A0 p50 4085.59 ms). Answer generation was not rerun.

B is materially faster: one network call, complete p50 ~2.6 s vs projected A ~5.8 s when generation is allowed. UNSUPPORTED negatives on A skip the answer call and finish near the support-complete time (~1.7–3.6 s).

The extra A call is the reliability cost. It is justified because B still fabricated Q03.

---

## 15. Token usage

| | Input | Output |
|---|---|---|
| Approach A (26 support calls) | 128,801 | 1,613 |
| Approach B (26 self-gate calls) | 131,921 | 3,605 |
| Total | 260,722 | 5,218 |

52 API calls. No prompt sweep. No extra models.

---

## 16. Cost

Pricing: `gpt-4o-mini` $0.15 / 1M input, $0.60 / 1M output.

| | USD |
|---|---|
| Approach A total | 0.020288 |
| Approach B total | 0.021952 |
| Experiment total | 0.042240 |
| Projected A per allowed question (support + historical A0 answer ~$0.00094) | ~0.00175 |
| B per question | 0.000844 |

A first-attempt crash after Q01 wasted two additional calls (string talking-points). Not included above. Still inexpensive.

Cost is not the selection criterion.

---

## 17. Selected architecture

### Reliability

Dedicated preflight (A) named the Q03 gap and did not emit a procedure. Self-gating (B) named the same gap and then wrote the procedure anyway.

Positive controls survived both, including Q14 and Q07. N05 was rejected by both. B was cleaner on N11; A soft-accepted that Webex/LMO neighbor.

### Simplicity / latency

B is simpler and faster. It is not comparably safe on the A0 failure mode.

### Residual risk if A is used later

A’s Q03 PARTIAL would still allow a caveated A0 answer call. A0 already fabricated on this packet, and A0 primitive audit called that answer SUPPORTED. A production policy should treat a PARTIAL whose `missing` is the core requested procedure as a block, or pair the preflight with a refuse-to-invent answer template. That pairing was not tested here.

A also still assigned E2/E3 as “supporting” on Q03 and PARTIAL’d N11. The classifier is better than self-gating; it is not a perfect semantic judge.

Do not integrate into Relay in this phase.

---

A. PREFLIGHT SUPPORT CHECK
