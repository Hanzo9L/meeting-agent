# I9 — Real Windows Loopback Validation

**RELAY WRITE STATUS: NONE (validation only)**  
**LEARN-RAG WRITE STATUS: READ ONLY**

No product code changes. No commit. No push. Retrieval, corpus, I6B query shaping, Deepgram completion semantics, and the evidence execution port were not modified.

---

## 1. Machine / audio environment

| Item | Value |
| --- | --- |
| OS | Windows 10.0.26200 |
| Relay cwd | `C:\Users\joegc\projects\meeting-agent` |
| Relay branch / HEAD | `cursor/msteams-docs-knowledge-base` / `e1e4dab31146115df2d722f311b1fd5023a28f37` |
| learn-rag cwd | `C:\Users\joegc\projects\learn-rag\learn-rag` |
| learn-rag branch / HEAD | `master` / `b967fb899eda18f1a5a56bcef2b7f80d717fa1a3` |
| search.py sha256[:16] | `252e9b3ced85b9b0` |
| scope_select.py sha256[:16] | `2a8caaabd00f4b08` |
| corpus.db sha256[:16] | `5697ee158796c34c` |
| hnsw.bin sha256[:16] | `6cb36a85bc36acf3` |

**Audio path used for the proof:** Windows SAPI wrote spoken-question WAV files, then `System.Media.SoundPlayer` played them through the Windows default render device. That is real system output (spec option 3: browser/video/audio playback). No typed input, no `overlayApi.askQuestion`, no injected transcript, no direct `acceptQuestion` / evidence-port invocation.

**Device finding (not a product code defect):** at session start the OS default playback device was **Speaker (Jabra Engage 65 SE)**. Playing H1 into that device left Deepgram at `STT connected. Waiting for speech...` with zero accepted turns. Switching the default render device to **Surface Speakers (Qualcomm Aqstic)** and restarting QA Assist made loopback hear the mix. All H1–H5 / rapid / failure questions below used Surface Speakers.

Teams / Zoom / Meet second-participant audio was not available on this machine.

---

## 2. Startup / readiness

Started the current uncommitted development build (`npx electron-vite dev -- --remote-debugging-port=9222`). Main bundle size `257.08 kB` (current I8-era build, not the stale 12:20 instance).

Confirmed before hardware questions:

- Electron launched; CDP on `127.0.0.1:9222`
- One learn-rag child: `relay_bridge.py` parent plus its python subprocess
- `[Relay evidence] [relay_bridge] ready`
- Overlay label **Evidence ready**
- QA Assist header: `QA Assist · Far Side / System Audio · Microphone Excluded · capturing`
- Capture summary: `system · microphone excluded · capturing`
- STT: `STT connected. Waiting for speech...`
- Production `index.ts` constructs `EvidenceAnswerExecutionPort` only (no `GroundedAnswerExecutionPort`)
- Session `live_53792da1-a146-4f5f-90c1-9bcb0fb46e17` on conversation `conv_e154c912-0f2b-40d0-96f3-a87b5cb8a88d`

First live retrieval after accept was **339 ms** (warm). Prewarm held. First live retrieval was not cold.

---

## 3. H1–H5 full traces

All five were captured `capture_source=system`, `input_origin=live_transcript`. Overlay cards were visible during the live session (not inferred from logs alone).

### H1 — `What does Get-CsOnlineUser return?`

| Field | Value |
| --- | --- |
| Audio source | SAPI WAV → Surface Speakers |
| Capture source | system |
| Deepgram / accepted | `What does Gixonline user return?` |
| Interim / final | Placeholder until final; promotion after playback ended |
| UtteranceEnd / arbitration | accepted, `retainedSource=system`, `single_source_mode`, text `what does gixonline user return` |
| userMessageId | `msg_210bffad-57dd-4e89-abd7-b9125c6c13fe` |
| answerRunId | `run_225bcaab-bdc9-44ad-81fc-1c4a4a416002` |
| assistantMessageId | `msg_39c03d56-4260-4797-9499-1711faa8d072` |
| Retrieval | start `20:32:17.694Z` → complete `20:32:18.030Z` (**339 ms**) |
| Card persisted | yes |
| Overlay visible | yes — Get-CsOnlineUser present (2nd); primary Get-CsOnlineVoiceRoutingPolicy; Linux `ps(1)` also listed |
| Publishers | Microsoft, Linux |
| Accept → visible card | **350 ms** |

STT: **MATERIAL_ERROR** (`Get-CsOnlineUser` → `Gixonline user`). Retrieval still returned the PowerShell cmdlet page. Keyterms were not changed.

### H2 — Teams cannot call external numbers

| Field | Value |
| --- | --- |
| Accepted | `A user can use Teams but cannot call external numbers. How do you troubleshoot?` |
| IDs | user `msg_f6e34256-785d-4f2e-bd60-3ccdd0b18886` / run `run_e79a8728-170c-4d10-856e-d78cd25c481c` / asst `msg_dc3ba123-5799-4eb5-bcb8-fabbd1b72a1d` |
| Retrieval | **131 ms** |
| Overlay | **Microsoft Evidence** — Issues with outbound calls; Call Analytics; Set up Teams Phone |

STT: **EXACT**.

### H3 — AudioCodes Mediant SBC

| Field | Value |
| --- | --- |
| Accepted | `How would you configure an audio codes media and SBC for Teams direct routing?` |
| IDs | user `msg_5bde1c5f-8f96-40b0-b558-61d3ff1b93f3` / run `run_72e671ce-5e6c-4221-91d4-7e9942afe00e` / asst `msg_ae4fc7df-d9b1-44e0-bb40-929ec038e2a3` |
| Retrieval | **118 ms** |
| Overlay | **AudioCodes Evidence** — Mediant SBC Direct Routing configuration notes, labeled `AudioCodes · vendor implementation` |

STT: **MINOR_ERROR** (AudioCodes/SBC retained; Mediant → “media and”). Retrieval still clearly AudioCodes.

### H4 — Poor audio / where is the problem

| Field | Value |
| --- | --- |
| Accepted | `A user is complaining of poor audio. How would you determine where the problem is?` |
| IDs | user `msg_51ffac17-46e3-445f-bd8d-447f987350af` / run `run_43e2e788-088b-4a21-8609-f565b246cd8b` / asst `msg_c6606d58-cd2d-4f7d-a12a-2f0d6584d139` |
| Retrieval | **132 ms** |
| Overlay | Call Analytics; CQD dimensions/measurements; Use CQD to manage call and meeting quality |

STT: **EXACT**.

### H5 — Linux service intermittent

| Field | Value |
| --- | --- |
| Accepted | `A Linux service is failing intermittently. How would you investigate it?` |
| IDs | user `msg_5cabfe71-e46a-4998-8abb-9000bf0c3e9b` / run `run_ff406332-48ec-486d-8c57-610f4dd0b5e9` / asst `msg_0bf90b89-813c-4980-86a4-9e721961f25f` |
| Retrieval | **71 ms** |
| Overlay | **systemctl** (`Linux · upstream reference`) primary |

STT: **EXACT**.

---

## 4. Transcript accuracy

| Q | Spoken vs accepted | Class |
| --- | --- | --- |
| H1 | `Get-CsOnlineUser` → `Gixonline user` | MATERIAL_ERROR |
| H2 | exact | EXACT |
| H3 | `AudioCodes Mediant SBC` → `audio codes media and SBC` | MINOR_ERROR |
| H4 | exact | EXACT |
| H5 | exact | EXACT |
| Rapid Q1 | `Direct Routing` casing only | MINOR_ERROR |
| Rapid Q2 | exact | EXACT |
| Rapid Q3 | exact | EXACT |

No keyterms/aliases were added. H1 is the only material STT miss; retrieval still found `Get-CsOnlineUser`.

---

## 5. UtteranceEnd / completeness

Five H questions produced **five** accepted arbitration events, all `retainedSource=system`, `single_source_mode`, one utterance id each.

- No early promotion before playback finished (accept timestamps are after `PLAY_END`)
- No duplicate accepted turn from one spoken question
- No lost final clause on H2–H5
- No two cards from one utterance
- No Q2 appended into Q1

Not a completion blocker.

---

## 6. Rapid Q1 / Q2 / Q3

Played from real system audio. Q2 started immediately after Q1 was accepted; Q3 immediately after Q2 was accepted.

| | Accepted | userMessageId | answerRunId | assistantMessageId |
| --- | --- | --- | --- | --- |
| Q1 | Explain direct routing and the role of the SBC. | `msg_28b73c6e-…` | `run_d106fd19-…` | `msg_79d8fa31-…` |
| Q2 | What happens if the SBC fails? | `msg_cba0ee5e-…` | `run_a991edde-…` | `msg_1ee1d7fc-…` |
| Q3 | What would geographic redundancy look like? | `msg_7f5dd85d-…` | `run_febc420f-…` | `msg_03b0f2d6-…` |

Result: **3 accepted questions, 3 userMessageIds, 3 answerRunIds, 3 assistantMessageIds, 3 cards**, chronological, no overwrite/merge. Helpdesk liveTurns went 5 → 8.

---

## 7. Microphone exclusion

QA Assist remained `system · microphone excluded · capturing`.

Probe: spoken WAV (`This microphone probe should not become a QA Assist question.`) played **only** on Jabra Engage 65 SE while loopback was bound to Surface Speakers. The Qualcomm microphone array remained the default recording device and could have heard room audio. Headset speech was not in the captured system mix.

| Before | After |
| --- | --- |
| 8 live turns / 8 assistants | 8 live turns / 8 assistants |

No new durable turn. No new evidence card. Last overlay transcript stayed `What would geographic redundancy look like?`

This was an automated acoustic probe, not a human speaking into the laptop mic. Combined with QA Assist’s system-only capture it still showed microphone-path audio did not create a QA Assist question.

---

## 8. Failure-path result

**Attempt 1 — kill learn-rag child, then speak.**  
`LearnRagChild.request()` calls `start()` and respawned the child. The spoken question was accepted and completed after **2085 ms** (cold respawn). Overlay went `Evidence unavailable` then `Evidence ready`. No fallback generator. No hang.

**Attempt 2 — suppress respawn while speaking** (kill `relay_bridge.py` on a 250 ms loop).

| Field | Value |
| --- | --- |
| Accepted | `What does direct routing require?` |
| userMessageId | `msg_c20540cb-5aca-40a9-9d8c-56228fa3735a` |
| answerRunId | `run_cad1a674-32b3-475c-ab9f-5191b1f071c3` |
| assistantMessageId | **null** |
| Run state | `failed` / `evidence_retrieval_failed` in **307 ms** |
| Overlay | **Evidence retrieval failed.** + `Evidence unavailable` |
| Fallback generator | no |
| Hanging spinner | no |

Durable turn existed. Failed run did not create an assistant card. Helpdesk counts: 10 live user turns, 9 assistant cards.

---

## 9. Reload result

Relay was fully restarted. Conversation `conv_e154c912-…` reloaded in Helpdesk:

- 10 live_transcript user turns with original accepted text
- 9 evidence cards restored
- Publishers restored: **Microsoft / Linux / AudioCodes**
- Answer-run ownership unchanged (each completed run still points at the same user + assistant ids)
- Failed run `run_cad1a674-…` still `failed` / `evidence_retrieval_failed`

Overlay after restart is **Stopped** (live session interrupted). The overlay feed does not replay Helpdesk history; it is live-session scoped. Cards are visible in Helpdesk after reload. Overlay historical empty-feed after restart is existing session-lifecycle behavior, not a sqlite persistence break.

---

## 10. Latency

Accepted-question → visible-card (run completed_at − created_at), live session:

| Q | ms |
| --- | --- |
| H1 (first live, warm) | 350 |
| H2 | 132 |
| H3 | 118 |
| H4 | 132 |
| H5 | 71 |
| Rapid Q1 | 82 |
| Rapid Q2 | 86 |
| Rapid Q3 | 187 |

UtteranceEnd delay after playback is ~0.2–0.8 s of trailing silence, then promotion. That is expected Deepgram completion, not a hang.

---

## 11. Exact blockers

None of the §12 hardware blockers occurred on the Surface Speakers path:

- Loopback captured real system audio
- Microphone path did not create a QA Assist turn
- No early promotion / duplicate turns / merged questions
- Material H1 STT miss did **not** make retrieval unusable
- Every accepted H/rapid question reached `EvidenceAnswerExecutionPort`
- Overlay cards were visible during the live session
- Persistence survived restart
- First live retrieval was warm (339 ms)
- Evidence-process failure failed the run cleanly (307 ms) with overlay failure text

Recorded (not blockers): Jabra DECT loopback silence until default render was switched; H1 cmdlet mistranscription; overlay does not hydrate Helpdesk history after app restart.

---

## 12. Confirmation no code changed

I9 did not modify Relay product source or learn-rag. Working-tree dirtiness is the pre-existing I8-era dirty tree (`src/main/index.ts` already modified before this phase). New files are eval artifacts only under `eval/runs/live-windows-i9/`. No commit. No push.

---

## 13. Confirmation retrieval / corpus / query shaping unchanged

| File | sha256[:16] | I9 |
| --- | --- | --- |
| `service/search.py` | `252e9b3ced85b9b0` | unchanged |
| `service/scope_select.py` | `2a8caaabd00f4b08` | unchanged |
| corpus | `5697ee158796c34c` | unchanged |
| HNSW | `6cb36a85bc36acf3` | unchanged |

---

## Classification (H1–H5)

| | STT | Utterance | Isolation | Retrieval | Overlay | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | PARTIAL | PASS | PASS | PASS | PASS | PARTIAL |
| H2 | PASS | PASS | PASS | PASS | PASS | PASS |
| H3 | PARTIAL | PASS | PASS | PASS | PASS | PASS |
| H4 | PASS | PASS | PASS | PASS | PASS | PASS |
| H5 | PASS | PASS | PASS | PASS | PASS | PASS |

## A. REAL WINDOWS LOOP PROVEN — READY FOR INTERVIEW PRODUCT REVIEW
