# Relay live checkpoint — 2026-08-19

Checkpoint of the proven live Windows evidence assistant. Not a release.

## Proven

- Real Windows system audio → WASAPI loopback → Deepgram → accepted question → `EvidenceAnswerExecutionPort` → overlay card
- QA Assist microphone excluded (system audio only)
- Durable independent live turns (no overwrite/merge of Q1/Q2/Q3)
- Microsoft / AudioCodes / Linux provenance on evidence cards
- Persistent Helpdesk reload/hydration of accepted questions, cards, publishers, and answer-run ownership
- Clean evidence-process failure (`evidence_retrieval_failed`, overlay “Evidence retrieval failed.”, no fallback generator, no hang)
- Warm evidence retrieval after child prewarm (first live accept ~339 ms)
- Scenario coverage: typed Helpdesk evidence, live H1–H5, rapid live Q1–Q3, I8 live overlay integration, I9 hardware loop

## Known pending items

- Final product/user testing
- Jabra Engage loopback captured silence; Surface Speakers proved working
- `Get-CsOnlineUser` STT pronunciation/transcription remains imperfect
- No follow-up context resolver yet
- No final packaged Electron/Python distribution validation yet

## Freeze

- Relay commit: this checkpoint (`checkpoint: live evidence assistant pending final testing` on `cursor/msteams-docs-knowledge-base`; previous HEAD `e1e4dab`)
- learn-rag commit: `762e9b287c7fed4c112501d4beb8df786bf296cd` (`checkpoint: interview retrieval corpus and vendor evidence pending final testing` on `master`; previous HEAD `b967fb8`)
- search.py sha256[:16]: `252e9b3ced85b9b0`
- scope_select.py sha256[:16]: `2a8caaabd00f4b08`
- corpus fingerprint: `5697ee158796c34c`
- HNSW fingerprint: `6cb36a85bc36acf3`
