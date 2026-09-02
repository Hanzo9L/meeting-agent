# meeting-agent — session context

Live interview-assist tool. Deepgram STT captures the interviewer's question,
a local SQLite knowledge store is searched, and an answer is displayed on screen
during the call.

## Root causes identified 2026-09-01 — READ BEFORE PROPOSING FIXES

### 1. Query classifier misroutes interview phrasing
`src/main/services/retrievalV2/queryIntentRules.ts` (~line 218) classifies
`expectedAnswerType` with plain string matching. The procedural branch matches
only three patterns:

    normalized.startsWith("how do i ")
    normalized.startsWith("how to ")
    normalized.includes("steps")

10 of 11 real interview questions fall through to `return "conceptual"`, which
plans a `short_paragraphs` / `key_components` answer instead of ordered steps.
Downstream this produces `claimTaskCount: 1` and a one-sentence answer.

Interviewer phrasings that currently fail: "tell me how you", "walk me through",
"what is your experience with", "how do you approach", "give me an example of how
you've", "talk me through it".

Also suspect in the same function: `startsWith("why ")` forces troubleshooting,
and a bare `includes("error")` or `includes("fail")` anywhere in a sentence
forces troubleshooting.

### 2. Corpus is misweighted for this use case
`npm run inspect:knowledge-store` on 2026-09-02: 1,496 documents total.

    ms-teams-powershell    622   cmdlet reference
    ms-entra-docs          660   identity, mostly off-topic
    ms-teams-admin         157   the actual Teams Voice / MTR content
    ms-sharepoint-*         50   irrelevant
    ms-m365-docs             3   near-empty

Teams Admin active chunks: 3,228.

~87% is PowerShell reference and Entra identity. No networking content at all
(no TCP, DNS, SIP, NAT, packet loss, QoS).

Two sync checkpoints are in `error` state: ms-entra-docs, ms-teams-powershell.

These two causes are independent. Fixing either alone is insufficient.

### 3. Chunk classifier mislabels procedures as conceptual
Corpus-wide chunk_kind distribution after the 2026-09-02 index run
(3,228 active chunks):

    conceptual    1150
    configuration  674
    reference      442
    table          423
    code           235
    procedure      169   <- 5%

Per-document, the resource-account pages produce NO procedure chunks:

    microsoftteams/manage-resource-accounts         conceptual 12, procedure 0
    microsoftteams/aa-cq-manage-resource-accounts   conceptual 12, procedure 0
    microsoftteams/rooms/create-resource-account    conceptual  9, procedure 1

Consequence: `breadthAndFacets` in evidenceAspectPolicy.ts (~line 1219) requires
a `procedure` facet for answerObject === "procedure". answerPlanner.ts ~line 1488
computes missingFacetAspectIds; with no procedure-facet span, claimTaskCount is 0
and the answer is "No exact source span could be planned for all required facets".

This is now the primary blocker. Root causes 1 and 2 are fixed; this one is not.
The fix is in the chunker's chunk_kind classification, not in retrieval or the
query classifier.

Useful query:
    node -e "const D=require('better-sqlite3');const d=new D('.knowledge-v2/knowledge-v2.sqlite',{readonly:true});const r=d.prepare(\"SELECT dc.source_path, kc.chunk_kind, COUNT(*) n FROM knowledge_chunks kc JOIN documents dc ON dc.document_id=kc.document_id WHERE kc.tombstoned_at IS NULL GROUP BY dc.source_path, kc.chunk_kind\").all();console.log(r);"

## Already tested and ruled out — do not re-propose

- **Removing dynamic `enum` arrays from the synthesis JSON schema.** Theory was
  that per-request schemas defeat OpenAI's schema cache. Measured: median
  regressed 9,060ms -> 10,452ms, p95 13,091 -> 14,268, plus one timeout.
  Reverted. The enums were helping.
- **Lowering `V2_REASONING_EFFORT` from medium to low.** Not authorized for
  production. Faster (7,697ms vs 9,060ms) but an earlier benchmark observed an
  83.3% binding pass rate at low effort. Unresolved; do not ship without a
  larger sample.
- Synthesis latency was NOT the primary problem. Do not lead with speed work.

## Benchmark

Reproducible, committed, frozen fixture. Use it before and after any change to
the synthesis path.

    npm run bench:synthesis -- --runs=6 --effort=medium
    npm run bench:synthesis -- --runs=6 --effort=low

Fixture: eval/fixtures/synthesis-bench/frozen-input.json
SHA-256: 3e09a072f76bc8adf916874cf31925d347705bd4a0d24392c1b636a06e4d0a65
The harness verifies this hash and exits nonzero on mismatch. Never regenerate
the fixture without recording a new baseline — a previous ad-hoc benchmark was
lost this way and its results became uncitable.

Baseline 2026-09-01, both arms 6/6 schema-valid and 6/6 binding-valid:

    medium   median 9,060ms   p95 13,091ms
    low      median 7,697ms   p95  8,147ms

## Diagnostics

    npm run inspect:query-intent -- "<question>"
    npm run inspect:answer-plan -- "<question>"
    npm run inspect:grounded-answer -- "<question>"
    npm run inspect:knowledge-store
    npm run discover:v2-teams-admin

Append `2>/dev/null` to suppress hot-path console.info spam.

## Known defects, not yet fixed

- Question normalization drops spaces between words: "Microsoftservice",
  "exchange androom". Observed repeatedly. Likely damages lexical search terms.
- `openAiInterviewAnswerSynthesisPort.ts` ~line 208 checks `facets[0]?.id ===
  "facet-1"` (hyphen) but real ids are `facet_1` (underscore), so
  `fullQuestionEvidence` is permanently false. Diagnostics only.
- ~90 untracked debug artifacts under `eval/runs/indexing/` make `git status`
  hard to read. Needs a .gitignore entry.
- One pre-existing `test:evidence` failure. 91 pass, 1 fail. Unidentified.
- This repo has known pre-existing TypeScript errors. Always capture a baseline
  with `npm run build 2>&1 | tee /tmp/tsc-baseline.txt` before edits and diff
  against it. Only NEW errors matter.

## Product constraints

- The user supplies their own experience stories separately. Do NOT build a
  personal-story or STAR-format corpus. This tool provides technical scaffolding
  only — the correct facts, in order.
- Answers are read on screen while the user is speaking on a live call. Short
  scannable lines, not paragraphs.
- Wrong guidance is worse than no guidance.

## Working agreement

- One change at a time. Measure before and after.
- Stop and report rather than expanding scope.
- Never modify files outside the stated scope of a task
