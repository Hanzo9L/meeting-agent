# I8 — Live Evidence Assistant Integration

**RELAY WRITE STATUS: LIVE PRODUCT INTEGRATION ONLY**  
**LEARN-RAG WRITE STATUS: READ ONLY**

No commit. No push. Retrieval, corpus, I6B, Deepgram completion semantics, and answer generation were not changed.

---

## 1. Workspace / freeze verification

### Relay
- cwd: `C:\Users\joegc\projects\meeting-agent`
- branch: `cursor/msteams-docs-knowledge-base`
- HEAD: `e1e4dab31146115df2d722f311b1fd5023a28f37`
- Working tree remains intentionally dirty.

### learn-rag
- cwd: `C:\Users\joegc\projects\learn-rag\learn-rag`
- branch: `master`
- HEAD: `b967fb899eda18f1a5a56bcef2b7f80d717fa1a3`
- I8 did not edit this repo.

| File | sha256[:16] | I8 |
| --- | --- | --- |
| `service/search.py` | `252e9b3ced85b9b0` | unchanged |
| `service/scope_select.py` | `2a8caaabd00f4b08` | unchanged |
| corpus | `5697ee158796c34c` | unchanged |
| HNSW | `6cb36a85bc36acf3` | unchanged |

---

## 2. Live path before changes

Verified current source, not guessed:

Deepgram `UtteranceEnd` → `DeepgramUtteranceProcessor` → `PipelineManager.handleCompletedUtterance` → `CrossSourceUtteranceArbiter` → `isCompleteEnoughForPromotion` → `onAcceptedQuestion` → `LiveAssistService.acceptQuestion` → `HelpdeskService.beginLiveQuestion` → durable user message + answer run → `executeStartedTurn` → shared `EvidenceAnswerExecutionPort`.

`PipelineManager` has no retrieval. Typed Helpdesk already used the same port. I8 reused that seam.

---

## 3. Files changed

Relay only:

- `src/main/index.ts` — surface child readiness to overlay
- `src/main/services/evidence/learnRagChild.ts` — `starting` / `warming` / `ready` / `failed`; coalesced `start()`
- `src/shared/types.ts`, `src/shared/constants.ts`, `src/preload/overlayPreload.ts`
- `src/renderer/overlay/App.tsx`, `src/renderer/overlay/styles.css`
- `src/shared/evidenceCard.ts` — overlay compact excerpt
- `src/main/services/conversations/liveAssistService.ts` — publisher on live projection sources
- `src/main/services/conversations/helpdeskService.ts` — open citation allowlist
- `src/main/services/conversations/sqliteConversationStore.ts` + `migrations.ts` v7 — persist AudioCodes/Linux URLs
- tests + `eval/runs/live-i8/`

Not modified: `pipelineManager.ts`, Deepgram provider, utterance assembler, arbiter, completeness guard, learn-rag.

---

## 4. Child prewarm behavior

Already spawned once in `initializeRelay` (`void evidenceChild.start()`). I8 did not add a second child.

`LearnRagChild.start()` coalesces in-flight spawns. `request()` waits on that same start. Overlay hydration includes `evidenceStatus`.

Measured Python/index warm: **2034 ms** (`notes.coldStartMs`).

---

## 5. Readiness behavior

**Chosen: A.** QA Assist capture may start while the child is warming. Accepted questions still become durable turns immediately. Execution waits on the in-flight child start with the existing search timeout. Failed start / crash / timeout fail the answer run; the overlay shows `Evidence retrieval failed.` Questions are not silently dropped.

Overlay labels: `Preparing evidence...` / `Evidence ready` / `Evidence unavailable`.

---

## 6. Shared execution seam

typed question and accepted STT question both go through `HelpdeskService` / one `EvidenceAnswerExecutionPort`. Production `index.ts` does not construct `GroundedAnswerExecutionPort`. PipelineManager still has no knowledge path.

---

## 7. Overlay evidence presentation

Helpdesk remains the product reference. Overlay now renders per-source:

- title, section, compact exact preview (~220 chars / 2 lines)
- publisher (`Microsoft` / `AudioCodes · vendor implementation` / `Linux · upstream reference`)
- URL, expand/collapse to the existing card preview
- heading: all Microsoft → `Microsoft Evidence`; all AudioCodes → `AudioCodes Evidence`; mixed → `Evidence`

Default overlay does not dump full sections. Retrieval order is unchanged.

---

## 8. Provenance behavior

Live projection copies `publisher` from the persisted evidence card. SQLite CHECK previously required `learn.microsoft.com`; migration 7 allows `https://` URLs, with host allowlisting still enforced in JS (`isAuthoritativeEvidenceUrl`). AudioCodes is not labeled Microsoft. Linux is not rejected for not being Learn.

---

## 9–14. L1–L6 (live execution seam, accepted-question API, not Windows loopback)

All six ran through `LiveAssistService.acceptQuestion(..., "system")` + real learn-rag child.

| Case | Result | Heading / publishers |
| --- | --- | --- |
| L1 external calling | PASS — Direct Routing / PSTN / SBC language | Microsoft Evidence (5× Microsoft) |
| L2 DR + SBC | PASS — Microsoft DR/SBC. AudioCodes not in this top 5 | Microsoft Evidence |
| L3 AudioCodes Mediant | PASS — vendor provenance visible | AudioCodes Evidence (5× AudioCodes) |
| L4 poor audio | PASS — quality / analytics language | Microsoft Evidence |
| L5 Get-CsOnlineUser | PASS | Microsoft Evidence |
| L6 Linux intermittency | PASS — Linux sources present and not Microsoft-labeled | Evidence (Linux + Microsoft mix) |

---

## 15. Rapid Q1/Q2/Q3 isolation

PASS. Three user message IDs, three answerRunIds, three assistant IDs, three independent cards, chronological order preserved. Q2 (`What does the certificate do?`) was treated independently; any weak standalone certificate context remains a future follow-up issue, not solved here.

---

## 16. Failure-path behavior

Scripted child failure: durable user turn kept, answer run `failed`, overlay copy `Evidence retrieval failed.`, no interview-generator fallback, no invented answer. Child crash / timeout / missing corpus still fail closed at `LearnRagChild`.

---

## 17. Reload / hydration

SQLite reload preserves user questions, encoded evidence cards, run IDs, citations, and publisher fields. Overlay in-session hydration uses `latestProjections`. Full app restart still recovers an active live session as interrupted (existing behavior); Helpdesk conversation history remains.

---

## 18. Real Windows system-audio result

`REAL_WINDOWS_LOOP_UNPROVEN`

This session did not drive Teams/Zoom/browser loopback through Deepgram on hardware. STT → completeness → accept remains covered by existing assembler/pipeline tests. The audio-output → overlay-card loop was not proven on Windows.

---

## 19. Latency

STT finalization was not mixed in. These are accepted-question → persisted card times after the child was already ready:

| | ms |
| --- | --- |
| Child cold start (prewarm) | 2034 |
| First live accept after warm | 142 |
| Subsequent live accepts | 16, 22, 22, 24, 25 |
| Warm p50 (ex-first) | ~23 |
| Warm p95 (ex-first) | ~25 |
| Including first-question penalty p95 | ~142 |

---

## 20. Tests

Passed: I8 unit + live L1–L6; liveAssist; Helpdesk; sqlite store incl. v7; overlay; evidence card/client/builder; pipelineManager; completeness guard; utterance assembler; arbiter; evidence port wiring.

learn-rag was not modified; `tests.test_relay_bridge` was not re-run this phase.

---

## 21. Retrieval / query / corpus

Unchanged. Hashes above.

---

## 22. Deepgram completion semantics

Unchanged. `is_final` still buffers. `UtteranceEnd` remains the completion boundary. Completeness guard unchanged.

---

## 23. Remaining blockers before interview use

One bounded blocker: prove the real Windows system-audio loop (loopback → Deepgram → accepted question → overlay card) on hardware. Software seam, provenance, overlay cards, prewarm, and L1–L6 retrieval through the live port are in place.

### B. CONDITIONAL — ONE BOUNDED LIVE BLOCKER REMAINS
