# I7.1 — Vendor Provenance / Evidence Labeling

Presentation + data-contract only. Retrieval, I6B query-shaping, corpus, ranking, STT, and answer generation were not changed. No commit.

**RELAY WRITE STATUS: EVIDENCE CONTRACT + CARD LABELING ONLY**  
**LEARN-RAG WRITE STATUS: `relay_bridge.py` CONTRACT FIELDS ONLY**

---

## 0. Workspace / freeze verification

### Relay

- cwd: `C:\Users\joegc\projects\meeting-agent`
- branch: `cursor/msteams-docs-knowledge-base`
- HEAD: `e1e4dab31146115df2d722f311b1fd5023a28f37`
- Working tree remains intentionally dirty. No commit / push.

### learn-rag

- cwd: `C:\Users\joegc\projects\learn-rag\learn-rag`
- branch: `master`
- HEAD: `b967fb899eda18f1a5a56bcef2b7f80d717fa1a3`

| File | sha256[:16] | I7.1 action |
| --- | --- | --- |
| `service/search.py` (I6B query shape) | `252e9b3ced85b9b0` | **not modified** |
| `service/scope_select.py` | `2a8caaabd00f4b08` | **not modified** |
| `service/relay_bridge.py` | `124824039405de5e` → `8486dd8e09c7aa04` | emit `repo` / `publisher` / `sourceRole`; pin freeze allowlist to current I6B hash |

The freeze allowlist in `relay_bridge.py` still expected pre-I6B `search.py` `8702daf1ee2b2843`. I7.1 updated that expected prefix to `252e9b3ced85b9b0` so the child can start. That does **not** change I6B query shaping.

---

## 1. Where provenance was lost

`Hit` already had `repo`, `url`, `ms_service`, `ms_collection`, `ms_topic`, `description`. It did **not** have `publisher` or `sourceRole`. Those are derived.

Drop points:

1. **`relay_bridge.search_evidence`** serialized only `parentId, title, section, url, body, score, matchedBy`. `repo` / `ms_service` / `ms_collection` were discarded here.
2. **`evidenceSearchClient.parseResult`** rejected any non-`learn.microsoft.com` URL. AudioCodes (and Linux) hits would fail the whole top-5 as `"invalid source"`.
3. **`evidenceCard.ts` / `evidenceCardBuilder.ts`** hardcoded `kind: "microsoft_evidence"` and citation `sourceId: "microsoft-learn"` / `authorityRole: "microsoft_learn"`.
4. **Helpdesk / overlay** rendered a `"Microsoft Evidence"` badge with no publisher line.

---

## 2. Contract

Each evidence result now includes:

```json
{
  "parentId": "...",
  "title": "...",
  "section": "...",
  "url": "...",
  "body": "...",
  "score": 0.0,
  "matchedBy": ["vector", "lexical"],
  "repo": "...",
  "publisher": "Microsoft | AudioCodes | Linux",
  "sourceRole": "microsoft_authority | vendor_implementation_reference | upstream_reference"
}
```

Derivation is mechanical (no classifier):

| Condition | publisher | sourceRole |
| --- | --- | --- |
| `repo=audiocodes` or host `*.audiocodes.com` or `ms.service=audiocodes-sbc` or `ms.collection=certified_sbc_vendor` | AudioCodes | `vendor_implementation_reference` |
| `repo=linux` or `ms.service=linux-upstream` or man7 / freedesktop / tcpdump / docs.python.org | Linux | `upstream_reference` |
| otherwise (Learn Microsoft hosts in corpus) | Microsoft | `microsoft_authority` |

Relay re-derives if the bridge omits the fields. Old persisted `kind: "microsoft_evidence"` cards still parse.

New cards use `kind: "evidence"`. Card heading:

- all Microsoft → `Microsoft Evidence`
- all AudioCodes → `AudioCodes Evidence`
- all Linux → `Linux Evidence`
- mixed / empty → `Evidence` / `No evidence found for this question.`

URL allowlist: `learn.microsoft.com`, `*.audiocodes.com`, plus the existing Linux pack hosts. Arbitrary domains still rejected.

Citations: AudioCodes uses `sourceId: "audiocodes"` and `authorityRole: "vendor_implementation_reference"`. Microsoft remains `microsoft-learn` / `microsoft_learn`.

---

## 3. Verification

- learn-rag: `python -m unittest tests.test_relay_bridge -v` — 3 passed
- Relay unit: evidence card / client / builder / execution port — 25 passed
- Live child start: `typedEvidenceIntegration` T1–T5 passed with `searchHash=252e9b3ced85b9b0`. The Helpdesk persist/reload case then hit a Windows `EBUSY` unlink on a temp sqlite file in `finally`; assertions before cleanup had already passed.

`service/search.py` and `service/scope_select.py` hashes are unchanged from I7.
