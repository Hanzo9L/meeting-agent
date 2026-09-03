# meeting-agent — session context

Live interview-assist tool. Deepgram STT captures the interviewer's question,
a local SQLite knowledge store is searched, and an answer is displayed on screen
during the call.

## ARCHITECTURE — two answer systems, only one is live

`src/main/index.ts` line ~825 wires the LIVE path:

    LearnRagChild -> createEvidenceSearchClient -> EvidenceAnswerExecutionPort
      -> MultiSearchEvidenceOrchestrator -> openAiInterviewAnswerSynthesisPort

`answerV2` is NEVER imported by index.ts. The whole aspect / facet / claim
planner system — and the `inspect:grounded-answer`, `inspect:answer-plan`,
`eval:r4` harnesses — is reachable only from eval harnesses.

Consequence: fixes to `retrievalV2/queryIntentRules.ts` and to the answerV2
planner do NOT affect what the app displays. The chunker fix and corpus
expansion DO, because both systems share the same SQLite store.

Live path caps, all in code, all responsible for reported product complaints:

    MAX_RETRIEVAL_QUERIES  = 4   multiSearchEvidenceOrchestrator.ts:11
    MAX_AGGREGATED_RESULTS = 5   multiSearchEvidenceOrchestrator.ts:12   <- "five cards"
    maxItems: 4                  openAiInterviewAnswerSynthesisPort.ts:377  <- bullet cap

`maxItems: 4` makes complete procedures structurally impossible on the live
path. The user requires full start-to-finish steps.

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

### 3. Chunk classifier mislabels procedures as conceptual [FIXED 2026-09-02]
Before the fix, only 169 of 3,228 active chunks were classified as procedures.
The resource-account pages produced no procedure chunks despite containing
numbered instructions.

Fixed 2026-09-02 in semanticChunker.ts `inferGenericChunkKind`: an
`ordered_list` block alone now returns `"procedure"`; previously it also required
the heading to contain `"step"`, `"steps"`, `"how to"`, or `"procedure"`. Re-indexed
with `--chunker-version cg01a-v2` (2,502 embeddings regenerated, 0 reused).

Result: `microsoftteams/manage-resource-accounts` went from 0 to 5 procedure
chunks; `microsoftteams/aa-cq-manage-resource-accounts` went from 0 to 5.
Verified content is genuine numbered admin-center steps. Procedural questions
now produce realized claims for the first time (for example, "How do I create a
resource account for an auto attendant" returns a "Steps:" answer with 2 bound
claims).

Duplicate-claim defect fixed 2026-09-02 in deterministicAnswerAssembler.ts:
identical rendered claim text is now suppressed across aspects (P-004 went from
24 claims to 12). Cause was `deriveProcedureClaims` deduping per-aspect only.

### 4. Retrieval drops secondary-entity documents [CURRENT BLOCKER]
Retrieval scopes the evidence bundle to the question's dominant entity and
excludes documents matching a secondary entity, even when those documents hold
the only procedural content.

Evidence, 2026-09-02:
- "How do I create a resource account for an auto attendant" -> bundle contains
  ONLY `aa-cq-setup-auto-attendant` and
  `create-a-phone-system-auto-attendant`.
  `microsoftteams/manage-resource-accounts` (5 procedure chunks, contains
  "Create a resource account / Teams admin center / 1. Sign into the Teams admin
  center...") is absent.
- "Tell me how you implemented Teams in a large conference room environment..."
  -> bundle is entirely Teams Rooms documents. Both manage-resource-accounts
  documents are absent.

Consequence: answerPlanner.ts `deriveProcedureClaims` (~line 940) filters on
`candidate.procedureStep !== null || facetScore(...) > 60`. With no numbered-step
span in the bundle, it falls through to weaker spans and produces cross-references
instead of steps—for example, it returned "To learn how to create resource
accounts for use with auto attendants, refer to the section on managing Teams
resource accounts."

Investigate in retrievalV2 routing/scoping, not in the chunker or the planner.

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

## DIRECTION: extractive over synthesis

Measured 2026-09-02 with `npm run eval:r4`:

    extractive   0.747ms p50, 0 API calls, no step cap, cannot hallucinate
    synthesis    9,060ms p50, 1 API call, hard 4-bullet cap

The extractive path (`deterministicAnswerAssembler.ts`, `eval:r4`) is roughly
12,000x faster, produces multi-step output, and refuses with specific reasons
when evidence is missing. It is NOT wired to the live app.

Decision: fix output quality on the instant extractive path rather than
optimize the 9-second synthesis call. Do NOT propose migrating to Azure AI
Search, Supabase, or another vector store — retrieval is already milliseconds
and local; 100% of the 9 seconds is one OpenAI call. Changing the store adds
network latency and fixes none of the product complaints, which are turn
detection, presentation, a schema cap, and session state.

Regression dataset: eval/datasets/procedural-probe.jsonl (6 procedural
questions). The default eval/datasets/evidence-wb18.jsonl contains only
conceptual questions and never exercised deriveProcedureClaims.

### Live capture 2026-09-02 — synthesis was failing validation, not generating badly
Full log: eval/runs/live-capture/2026-09-02-live-synthesis-failure.md

Two live runs of "Walk me through how you create a resource account for an auto
attendant" both produced CORRECT, complete, ordered answers and both were
discarded by the validator:

    fallbackReason: interview_synthesis_duplicate_facet   (one bullet per facet rule)
    fallbackReason: interview_synthesis_text_invalid      (bullet truncated mid-word)

The app then displayed raw evidence cards. Cards are not a fallback mode — they
render regardless. Fixed by removing the uniqueness check and raising the bullet
cap in three places (schema maxItems, parseOutput, benchmark harness).

After the fix, live capture confirmed status "succeeded", fallbackReason null,
inputTokens 2175, outputTokens 437, synthesis 5,777ms.

### Synthesis latency ceiling
With 12-bullet procedural answers: median 14,870ms against a fixed 15,000ms
timeout in both the OpenAI client and the port. 3 of 6 benchmark runs time out.
No timeout CLI flag exists. Output token count is the driver — generation is
sequential.

Extractive path for comparison: 0.747ms, zero API calls, no bullet cap.

Retrieval is 132ms and local. STT is clean and needs no keyterms — verified
against live audio, all domain terms transcribed correctly.

## Diagnostics

    npm run inspect:query-intent -- "<question>"
    npm run inspect:answer-plan -- "<question>"
    npm run inspect:grounded-answer -- "<question>"
    npm run inspect:knowledge-store
    npm run discover:v2-teams-admin

Append `2>/dev/null` to suppress hot-path console.info spam.

## Known defects, not yet fixed

- RULED OUT 2026-09-02: the apparent space-dropping bug ("Microsoftservice",
  "exchange androom") was a terminal line-wrapping artifact in pasted output,
  not a real defect. Verified with
  `npm run inspect:query-intent -- "how exchange and room resource accounts fit" | grep normalizedQuestion | cat -A`
  which returns "how exchange and room resource accounts fit" with spaces
  intact. `normalizeQuestion` in queryIntentRules.ts only collapses whitespace
  and never deletes it. Do not re-open this.
- Extractive assembler truncates ordered-list step bodies. P-004 renders
  "- - Step 1." / "- - Step 2." as bare markers with the instruction text split
  into separate claims ("Enable users for Direct Routing" appears on its own
  line after "- Step 2."). Sentence splitting is treating the period in
  "Step 1." as a sentence boundary. This is the next defect to fix.
- Probe cases P-002 and P-003 fail with requiredFacets [procedure, operation];
  the `operation` facet is a separate gate that resource-account content does
  not satisfy.
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
