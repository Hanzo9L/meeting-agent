# Relay pre-STT checkpoint

Local known-good freeze before the final live STT pass. Not a release.

## Proven / implemented

- typed + live EvidenceAnswerExecutionPort path
- persistent independent turns
- question stays anchored while evidence grows below
- prior turns remain intact
- authority-aware evidence presentation
- architecture / configuration / troubleshooting presentation hints
- troubleshooting symptom matching
- natural troubleshooting verbs such as investigate / diagnose / isolate / determine root cause
- Microsoft / AudioCodes / Linux provenance
- personal vs technical response modes
- QA Assist system-audio-only behavior
- explicit Windows render endpoint capture
- Jabra Engage 65 SE supported as meeting output
- evidence child prewarm/readiness
- retrieval failure behavior
- real Windows loopback previously proven
- current typed QA spot tests

## Known pending validation

- final live STT pass using Jabra Engage 65 SE
- real Google Meet audio test
- verify selected meeting output == Relay capture endpoint
- verify STT question remains anchored at top
- verify result #1 stays visible while #2–#5 render below
- verify follow-up question becomes new anchor
- optional STT vocabulary tuning only if real speech proves necessary

## Current known device

Speaker: Jabra Engage 65 SE

Stable Windows render endpoint ID:

`{0.0.0.00000000}.{a5d7138f-ae3e-4e94-9d58-21e0cdac7c44}`

Display name observed: `Speaker (Jabra Engage 65 SE)`.

## Current knowledge-layer fingerprints

Frozen R0.4 learn-rag lineage (unchanged; no rebuild):

- search.py sha256[:16]: `252e9b3ced85b9b0`
- scope_select.py sha256[:16]: `2a8caaabd00f4b08`
- corpus fingerprint (`data/corpus.db`): `5697ee158796c34c`
- HNSW fingerprint (`data/hnsw.bin`): `6cb36a85bc36acf3`

## Checkpoint commits

- Relay: `ce572c7d997e125bc8f4a988ca9a18a86a509a5f` (`checkpoint: Relay interview assistant before final STT testing` on `cursor/msteams-docs-knowledge-base`; previous HEAD `fdf2e0915a1746379125cb2fd5ae9a024fa84328`)
- learn-rag: `762e9b287c7fed4c112501d4beb8df786bf296cd` (`checkpoint: interview retrieval corpus and vendor evidence pending final testing` on `master`; working tree already clean, no new commit)
