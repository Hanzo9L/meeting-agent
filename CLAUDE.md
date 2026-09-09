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

### 4. Retrieval drops secondary-entity documents [PARTIALLY FIXED 2026-09-03]
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

Fixed 2026-09-03 in queryIntentRules.ts `detectDomains`: `hasTeams` matched
only "teams", "calling plan", "auto attendant", "call queue", "cqd", and
DIRECT_ROUTING_TERMS. Core voice vocabulary was missing, so questions like
"What are the steps to configure a resource account" resolved `domains: []`,
every source was excluded by the router, and retrieval returned an EMPTY
evidence bundle. The planner then refused with "required facets: procedure,
operation" — which looked like a facet problem but was an empty-bundle problem.

Added 15 terms: resource account, operator connect, direct routing, dial plan,
voice routing, pstn, teams rooms, mtr, phone system, teams phone, session
border controller, sbc, media bypass, emergency calling, voice application.

Probe answerabilityMatch went 4/6 -> 6/6.

DO NOT default empty domains to teams_admin. That was tried and reverted: six
tests in queryIntent.test.ts and domainRouter.test.ts explicitly assert that
unresolved subjects (Exchange mailbox, Set-ExoMailbox) return []. Guessing a
domain is a deliberate non-goal.

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

## EXTRACTIVE PATH STATUS 2026-09-03

Fixed today:
- semanticChunker.ts: ordered_list alone implies "procedure" chunk kind
- deterministicAnswerAssembler.ts: dedupe identical rendered claim text across
  aspects (P-004 24 -> 12 claims)
- answerPlanner.ts stepLine guard: added disjunct
  `/^[-*]\s*(?:step|phase)\s+\d+[.)]\s+\S+/i` so "- Step N. ..." list lines are
  kept whole. Previously sentence splitting cut at the period in "Step 1." and
  orphaned the body.
- queryIntentRules.ts detectDomains: voice vocabulary (see root cause 4)
- operationMatching.ts: bridged create/configure alias families. NOTE this was
  not the P-002 blocker — the bundle was empty. Kept because it is correct on
  its own terms; delete-question negative check still refuses correctly.
- deterministicAnswerAssembler.ts `validateProcedureOrder`: skip exact duplicate
  claims (same normalized proposition AND same sourceSpans contentHash list)
  without updating previousStep. Two mandatory aspects legitimately claim the
  same procedure steps — e.g. "assign a phone number to a resource account"
  yields phone-number:grant and resource-account:grant, each emitting all six
  steps. That is correct; PlannedClaim has a singular requiredAspectId and
  cannot express one claim satisfying two aspects. Genuine ordering violations
  (1, 5, 2) still fail.
- answerPlanner.ts `deriveProcedureClaims`: two-tier selection. When candidates
  with `procedureStep !== null` exist, use ONLY those. Fall back to
  `facetScore > 60` prose only when no real numbered steps are present. The old
  `||` admitted topically-relevant article prose alongside genuine steps.

Probe results (eval/datasets/procedural-probe.jsonl):
    total 6, successful 6, answerabilityMatch 6, provenanceAuditPass 6
    assemblyLatencyP50Ms ~1.4, providerRequestCount 0

All six probe cases now assemble and render. P-003 now renders exactly six
numbered steps with no connective tissue.

### Open defects on the extractive path
- P-006 `rendered_claim_not_source_bound` — pre-existing, predates today.
- "resource account" is ambiguous between Exchange resource MAILBOXES and Teams
  voice resource ACCOUNTS. P-002 answers from the Exchange doc ("Account
  settings and Mailbox settings panes") rather than
  microsoftteams/manage-resource-accounts. Correct against its source, wrong
  topic. Retrieval ranking issue.
- P-004 still renders 9 claims, only 4 of which are steps. `procedureStepFrom`
  does not recognise "- Step 1. ..." (list marker followed by the word Step) as
  carrying a step number, so the steps tier is empty and selection falls back to
  prose. Fix is a regex disjunct in `procedureStepFrom`, mirroring the one added
  to `stepLine` on 2026-09-03. NEXT TASK.
- Assembler still renders "- - Step 2. ..." — source dash plus bullet prefix.
  Cosmetic, one line in the presenter.
- P-007 ("all the steps to configure Direct Routing from start to finish")
  returns zero claims. Root cause traced to evidenceAspectPolicy.ts
  evaluateCandidateAspectSupport: a procedure aspect with an operation requires
  BOTH the procedure and operation facets for "direct" strength. Multi-phase
  procedures use different verbs per phase ("Enable users...", "Connect your
  SBC...") that don't match the question's single verb family, so those
  candidates are demoted to "supporting" and rejected as
  insufficient_direct_support. A proposed fix — don't demote a procedure
  candidate for a missing operation facet when it already carries the
  procedure facet — was reasoned through but NOT implemented. Aspect
  construction binds subject+operation into one aspectId (e.g.
  mandatory:entity:resource-account:remove), so this fix would not bridge
  across different operations like remove vs create. Deferred, not started.

### Long procedures — verified 2026-09-04
There is NO cap on procedure claims in the extractive path. Line 1243's
slice(0,24) is a hash truncation; line 1727's maxExtras limits supplementary
claims only. A twelve- or twenty-step procedure emits every step.

The risk is chunk boundaries, not caps: if a long procedure spans two chunks and
retrieval returns only one, the answer silently stops mid-procedure with no
continuation signal. This is why corpus markup matters — one heading with a
numbered list beneath keeps a sequence in one chunk, while `### 1.` style
headings fragment it.

UNTESTED. Probe cases P-007 and P-008 were drafted to exercise long procedures
(full Direct Routing configuration, auto attendant with call queues and business
hours) but have not been run.

## NETWORKING CORPUS — added 2026-09-03, NOT YET INDEXED

Location: data/corpus/networking/ (41 files, committed a4ee200)
License: CC-BY-4.0, derived from "Computer Networks: A Systems Approach" 7th ed
(Peterson & Davie), https://github.com/SystemsApproach/7E. Text is rewritten,
not copied. Attribution in data/corpus/networking/ATTRIBUTION.md.

Covers the gap Microsoft Learn cannot fill: NAT/PAT, firewalls, subnetting,
TCP/UDP, DNS, DHCP, VLANs, QoS, plus a UC bridge layer (SIP, RTP/SRTP,
NAT traversal STUN/TURN/ICE, SBC fundamentals) and three troubleshooting
playbooks (one-way audio, SIP vs RTP, phone has IP but will not register).

Files carry YAML frontmatter with sourceId, documentId, license, and
retrievalIntents. INTEGRATION/source-definition.json is provided but
`intendedDomains` still contains REPLACE_WITH_... placeholders.

### Markup constraint discovered 2026-09-03
The parser is remark-parse. `### 1. Confirm the symptom` is a HEADING, never an
ordered_list node, so inferGenericChunkKind cannot return "procedure" and each
`###` starts a NEW section — a seven-step sequence fragments into seven
unrelated chunks.

Fix is in the corpus, NOT the chunker: one `##` heading with a numbered list
beneath, matching how Microsoft Learn pages that work are structured. Do not
change semanticChunker to treat numbered headings as procedures — that would
reclassify the 1,500 Microsoft documents and would not fix the fragmentation.

Troubleshooting_Playbooks/00_One_Way_Audio.md has been converted as a pilot.
Verified: one `list ordered=true items=7` under `## Troubleshooting sequence`,
code fences indented so the list does not split, all prose preserved verbatim.

Chunked result: 7 chunks — 5 troubleshooting, 1 code, 1 table. NOT "procedure".
The troubleshooting branch is checked first in inferGenericChunkKind and this
content is full of troubleshooting vocabulary. That is probably correct, since
queryIntentRules routes "call connects but audio is one-way" to
expectedAnswerType "troubleshooting".

### Next steps, in order
1. Check what requiredFacets a "troubleshooting" aspect demands in
   evidenceAspectPolicy.ts. If it requires a "procedure" facet, these chunks hit
   the same gate that blocked P-002/P-003. If it wants a "troubleshooting"
   facet, they work as-is.
2. Map the domain. `intendedDomains` placeholders must become real taxonomy.ts
   values and a routing eligibility rule must be added, or the router excludes
   this source from every query as not_applicable_to_selected_domains — the same
   empty-bundle failure as root cause 4.
3. Index a small slice and ask "Why does NAT cause one-way audio".
4. Convert the remaining playbooks only after step 3 confirms the shape works.

### Chunk inspection recipe
inspectSemanticChunks.ts takes `--fixture <path>` expecting an
AcquiredDocumentInput JSON, not raw markdown. Build one with:
sourceId, trackId, transport, canonicalUrl, rawMarkdown, revision.
Write the fixture INSIDE the repo — Git Bash /tmp and Windows %TEMP% differ and
the resolver will not find /tmp paths.

## DOMAIN ROUTING — investigated 2026-09-06, not started

Attempted to scope adding a "networking" QueryDomain to unblock the networking
corpus. Findings:

QueryDomain (retrievalV2/queryIntent.ts) has 8 values: teams_admin,
teams_powershell, graph, entra, m365, teams_dev, sharepoint, powershell_core.
No networking domain exists.

Three files reference QueryDomain: queryIntent.ts (type), queryIntentRules.ts
(detection via keyword regex, same pattern as hasTeams), domainRouter.ts (type
interfaces only, no logic).

The actual eligibility rules (m365_source_requires_m365_domain,
not_applicable_to_selected_domains, etc.) live in domainPolicies.ts (786 lines),
specifically routeQueryIntent() at approx. line 691. This is where a new
domain's source-eligibility rule would go, following the pattern of the
existing per-domain checks.

Also confirmed: chunk_kind "troubleshooting" has NO corresponding
answerObject in evidenceAspectPolicy.ts. The answerObject values are
cmdlet_identifier, cmdlet_semantics, procedure, configuration_behavior,
configuration_state, comparison, status, relationship, mechanism. A
troubleshooting-labeled chunk gets no special facet treatment or penalty — it
is judged by the same rules as any other chunk_kind once retrieved. This
resolves the open question from 2026-09-03: the one-way-audio pilot playbook is
NOT blocked by a troubleshooting-specific gate.

NOT STARTED: adding the domain enum value, detection vocabulary, eligibility
rule in domainPolicies.ts, a corpus job that reads local markdown (every
existing corpus job fetches from GitHub or Learn, none read from disk), and
indexing.

### Two options considered for reducing future domain-vocabulary work

This week required THREE separate keyword-vocabulary fixes across different
files: hasTeams missing "resource account" and 14 other terms (2026-09-03),
enable/disable collapsing to one operation intent (2026-09-05), and now a
missing networking domain entirely. Same root pattern each time: hand-maintained
keyword lists with holes, scattered across queryIntentRules.ts and
domainPolicies.ts.

**Option A — config consolidation (light, near-term).** Move domain and
operation keyword lists out of scattered regex arrays into one structured
config file, grouped by domain. No new dependency, no latency change, no new
failure mode — a data move, not a logic change. Should be verifiable against
the existing test:wb12 (129/0) with no behavior change expected. Makes future
vocabulary gaps a one-line add instead of a find-the-right-file search.

**Option B — semantic domain classifier (heavier, strategic).** Research
2026-09-06 confirms the current keyword-router-with-fallback shape matches
current production RAG practice (domain-scoped retrieval + fast rule-based
router, per arxiv 2606.11350 and the CRAG KDD Cup 2024 winning approach, which
used a small classification model for exactly this domain-routing step instead
of keyword regex). Replacing hasTeams/hasEntra/etc. keyword matching with a
lightweight classifier would make new domains a documents-only addition rather
than a code change, at the cost of new latency, a new failure mode
(misclassification), and needing its own eval harness. Not started. Estimate:
a focused, separate effort, not a same-day task.

RECOMMENDATION for next session: do Option A first regardless of whether B is
pursued — it is required scaffolding either way and is low-risk.

## LOCAL MARKDOWN CORPUS ADAPTER — scoped, not started

Current `SourceSyncAdapter` / `SyncTrackResult` appears Git-shaped.

`SyncTrackResult` requires:

* `commitSha`
* `blobSha`
* `repository`
* `branch`

These may be true Git semantics, or they may simply be opaque version/checkpoint identifiers. Do not assume either before tracing their consumers.

Do **not** implement the local networking corpus by fabricating Git metadata merely to satisfy the current type.

### FIRST CHECK NEXT SESSION — do this before writing adapter code

Read:

```text
sourceSyncJobs.ts
```

and trace **every consumer of `SyncTrackResult`**.

Produce a short field-flow map showing where each of these values goes:

```text
commitSha
blobSha
repository
branch
documents / acquired document inputs
checkpoint state
```

Specifically determine:

1. Which fields flow into `DocumentIndexingJob`
2. Which fields are used only for checkpoint persistence, logging, or provenance
3. Whether `commitSha` or `blobSha` are ever used for real Git operations such as:

   * resolving refs
   * fetching blobs
   * diffing trees
   * incremental Git synchronization
4. Whether they are instead treated only as opaque change/version identifiers
5. Whether an existing lower-level indexing entrypoint accepts `AcquiredDocumentInput[]` directly

Do not write adapter code until this trace is complete.

### Preferred path — check this first

Determine whether `DocumentIndexingJob`, or another existing lower-level indexing entrypoint, can be called directly with a list of:

```text
AcquiredDocumentInput
```

This is the preferred outcome.

We already successfully constructed an `AcquiredDocumentInput` manually when testing the one-way-audio Markdown document against the chunker.

If the production indexing pipeline accepts that same input shape directly, then local Markdown ingestion may not need `SourceSyncAdapter` or `SyncTrackResult` at all.

The desired flow would simply be:

```text
data/corpus/networking/*.md
        ↓
read Markdown
        ↓
parse frontmatter
        ↓
build AcquiredDocumentInput[]
        ↓
DocumentIndexingJob
        ↓
existing chunking/indexing pipeline
```

If this path exists and preserves the normal indexing/checkpoint guarantees needed by the application, use it rather than forcing local files through a Git-shaped abstraction.

### If direct indexing is not available, resolve the SyncTrackResult semantics

Before choosing an adapter design, determine whether the Git-named fields are operationally Git-specific or merely generic version metadata.

#### Case A — fields are opaque checkpoint/version identifiers

If `commitSha` / `blobSha` are only:

```text
persisted
compared on the next sync
used to determine whether content changed
used for logging/provenance
```

then a deterministic local content hash may satisfy the contract legitimately.

For example:

```text
commitSha → aggregate corpus/version hash
blobSha   → individual file content hash
repository → local corpus identifier
branch     → local/static identifier
```

Only use this approach if downstream consumers treat those fields as opaque strings and never perform Git operations with them.

A content hash in an opaque version slot is acceptable.

A fake Git SHA in a field whose semantics are actually Git-specific is not.

### If the fields are truly Git-specific

If any downstream consumer expects real Git semantics, choose between:

#### Option 1 — generalize the sync contract

Refactor Git-specific version fields into source-agnostic metadata.

Conceptually:

```text
sourceVersion
documentVersion
sourceIdentity
revisionContext
```

Git-backed adapters can continue to populate commit/blob/ref data.

Local adapters can populate deterministic file/content hashes.

This is architecturally cleaner, but larger in scope and requires careful regression testing of every existing source adapter.

#### Option 2 — add a separate local-source ingestion interface

Leave existing Git-backed `SourceSyncAdapter` behavior unchanged.

Create a local Markdown path that:

```text
reads local files
parses frontmatter
builds AcquiredDocumentInput
uses deterministic local change detection
feeds the existing downstream indexing pipeline
```

Prefer this over weakening the meaning of existing Git-specific fields if the current interface is intentionally Git-oriented.

### Required evidence before selecting an option

Next session must answer:

* Does `DocumentIndexingJob` accept `AcquiredDocumentInput[]` directly?
* Are `commitSha` and `blobSha` operationally required or provenance/checkpoint-only?
* Do any consumers perform actual Git operations from those values?
* How is successful sync state persisted?
* How are partial or failed syncs represented?
* What currently prevents duplicate indexing?
* What determines whether an unchanged document is skipped?
* Can a deterministic file-content hash satisfy those same guarantees?
* Does bypassing `SourceSyncAdapter` skip any required cleanup, deletion, or stale-document handling?

### Local identity requirements

If a local adapter/path is needed, define deterministic identity before implementation.

Suggested document identity:

```text
sourceId + normalized relative file path
```

Suggested document revision:

```text
SHA-256 of normalized file contents
```

Suggested corpus revision, only if needed:

```text
deterministic hash of ordered document identities + document revisions
```

Do not use timestamps as the primary identity/change signal.

If this investigation surfaces a real parser or indexing defect in how the existing corpus files are structured, fix it in its own commit with its own message — do not fold a corpus content change into the same commit as adapter/trace work.

### Existing networking state

The networking query domain is already wired and tested.

The corpus remains committed locally under:

```text
data/corpus/networking/
```

Do not duplicate it into another repository.

Do not modify the corpus while investigating ingestion unless a real parser/indexing defect requires it.

### Stop condition

The next session is successful even if no adapter code is written.

Stop after producing the field-flow trace if the correct ingestion boundary is still ambiguous.

The goal is to understand the contract first, then implement the smallest path that preserves existing indexing semantics.

Do not bend `SourceSyncAdapter` until it compiles merely because it is the first visible abstraction.

## NETWORKING DOMAIN — WORKING, 2026-09-08

Full chain now proven end to end on real questions:
QueryDomain type -> word-boundary detection (hasNetworking) -> SourceTransport
"local" -> SourceRevision "local" branch -> migration 003 (schema CHECK
constraint) -> LocalMarkdownCorpusJob (bypasses SourceSyncAdapter entirely,
calls DocumentIndexingJob.run() directly with AcquiredDocumentInput[]) ->
KnowledgeSourceDefinition for networking_beginner -> domainAuthorityRoles ->
sourceDomainFromSourceId.

27/27 documents indexed successfully (migration 003 applied to the live
database; verified 1,496 -> 1,496 documents, zero data loss,
foreign_key_check clean).

### Confirmed working — real answers, real citations
- "Why does NAT cause one-way audio?" -> answered, cited to
  Troubleshooting_Playbooks/00_One_Way_Audio.md, chunk_kind troubleshooting.
- "What does DHCP give a device, and how do DNS and the default gateway fit
  into what happens next?" -> answered (labeled "partial" only due to an
  unsupported:freshness caveat, NOT a coverage gap — the DHCP claim itself was
  correct and fully cited).

Both are CONCEPTUAL/EXPLAIN questions. This works today, no further action
needed for this question type.

### Confirmed BLOCKED — procedural questions against troubleshooting-kind chunks
- "Walk me through the troubleshooting steps for one-way audio" ->
  insufficient_evidence, required facets: procedure.
- "What are all the steps to configure Direct Routing from start to finish"
  (Teams corpus, same underlying mechanism) -> answered with zero claims,
  required_facet_unplanned.

## ROOT CAUSE — confirmed by direct database query, not inferred

The procedure-facet match in evidenceAspectPolicy.ts (~line 2205-2210):

    chunkKind === "procedure" ||
    /step|procedure|how to/.test(heading) ||
    /step|procedure|how to/.test(allContext)

Verified against the actual "Troubleshooting sequence" chunk in
00_One_Way_Audio.md (2,055 characters, a genuine 7-item numbered procedure:
"1. Confirm the symptom precisely...", "2. Separate signaling from media...",
etc.):

    /step|procedure|how to/i.test(fullChunkText) === false

The words "step", "procedure", and "how to" literally never appear in this
well-written chunk. Its heading is "Troubleshooting sequence" ("sequence", not
"step"). Each numbered item opens with an imperative verb instead. The
chunk_kind is "troubleshooting", which also fails the first clause. This is a
real, confirmed content gap in the facet detector, not a retrieval or
indexing bug — the chunk itself is correctly formed (list ordered=true
items=7, verified 2026-09-08 morning) and correctly retrieved (fusionRank: 1,
the top match).

## ATTEMPTED FIX — tried, correctly reverted, DO NOT RETRY AS-IS

Added a 4th OR clause detecting markdown numbered-list structure directly
(`/(?:^|\n)\s*\d+\.\s+\S/` matched 2+ times in candidate.text) as a
structural signal independent of keywords.

RESULT: fixed the one-way-audio case (7 claims, real sourced multi-step
answer) but caused "How do I delete a resource account" to return
license-assignment/configure steps as if they answered the DELETE question —
a real create/configure content leak on the safety-critical negative check.
Reverted immediately, same session, before any further changes.

### Why it failed — the actual mechanism
matched.add("procedure") only asserts "this candidate has procedural
content." It carries no information about WHICH operation that procedure is
for. The existing keyword check ("step"/"procedure"/"how to") was accidentally
narrow enough to rarely fire on unrelated content. Numbered lists are far more
common across every operation type (assign, create, remove, configure) than
those three specific words, so loosening procedure-detection to "any numbered
list" let candidates from unrelated operations satisfy the procedure facet
for the wrong aspect. The procedure-facet check and the operation-facet check
are only loosely coupled today; a real fix needs the numbered-list signal
COMBINED WITH verification that the list's content is actually about the
aspect's specific operation/subject, not just "contains a numbered list
somewhere."

### Next attempt should consider
- Requiring the numbered-list match to occur within a heading/section whose
  text also relates to the aspect's subject (not just anywhere in
  candidate.text)
- Checking operation-relevant terms appear near the numbered items themselves,
  not just presence of numbers
- Whether authoritySatisfied / domainOk should be tightened rather than
  procedure-detection loosened
- Testing against BOTH confirmed cases (one-way-audio troubleshooting AND
  Direct Routing full-procedure) plus the delete/remove negative check, every
  single iteration — this is now a required 3-question regression set for any
  future attempt at this specific fix

### Do NOT do next
- Do not re-add the plain numbered-list regex as committed and reverted
  tonight without the subject/operation coupling described above
- Do not weaken or remove the delete/remove negative check to make a fix
  "pass" — that check is protecting a real safety property (wrong guidance is
  worse than no guidance)

## STATUS
Section closed for this session. Conceptual networking questions work and are
shippable today. Procedural networking questions (and the parallel Teams
Direct Routing case) remain blocked on a real, well-understood, not-yet-solved
facet-detection gap. This is the first task for whoever picks up networking
next.

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
- `openAiInterviewAnswerSynthesisPort.ts` ~line 208 checks `facets[0]?.id ===
  "facet-1"` (hyphen) but real ids are `facet_1` (underscore), so
  `fullQuestionEvidence` is permanently false. Diagnostics only.
- RESOLVED 2026-09-08: removed 171 pre-2026-09-01 tracked debug artifacts
  from eval/runs/indexing/ (35.4MB). gitignore changed from
  `eval/runs/indexing/_*` to `eval/runs/indexing/*` so no future run
  artifacts are tracked. 28 files from 2026-09-02 onward were kept tracked
  as recent session evidence. Corpus jobs still write here for local
  debugging; output is just no longer committed.
- RESOLVED (cause unknown) 2026-09-08: test:evidence now passes 92/0,
  verified on a standalone run. Previously tracked as "91 pass, 1 fail,
  unidentified." The failure no longer reproduces and was never diagnosed
  before it stopped occurring — likely a side effect of an unrelated fix
  earlier in the project. If it recurs, investigate rather than assume it
  is the same issue.
- With 12-bullet procedural answers the synthesis path medians 14,870ms against a
  fixed 15,000ms timeout; 3 of 6 benchmark runs time out. No timeout CLI flag.
  Extractive is 0.787ms with zero API calls. Direction stands: extractive primary,
  synthesis fallback only for questions no single document answers.
- ITEN NOC scenarios and other second-source corpora were proposed. Do not add a
  second source until the networking corpus is indexed and retrievable end to end.
- This repo has known pre-existing TypeScript errors. Always capture a baseline
  with `npm run build 2>&1 | tee /tmp/tsc-baseline.txt` before edits and diff
  against it. Only NEW errors matter.

## OPEN — entity extraction hallucination on ungrounded questions [ESCALATED 2026-09-08]

"How do I remove a Teams user" reproduces exactly as before: entities: [],
domains: ["teams_admin"], operationIntents: ["remove"],
expectedAnswerType: "procedural". Only the entity is missing — everything
else about the question is classified correctly.

### Confirmed root cause
detectEntities() in queryIntentRules.ts (~line 435) has no vocabulary for
generic Teams object types. It matches specific compound nouns from
MULTIWORD_TECHNICAL_CONCEPTS (auto attendant, resource account, call queue,
etc.) plus a few hardcoded singles (cqd, one-way audio, conditional access)
and a *policy/dial plan regex — but nothing for "user", "account", "device"
as bare nouns. "Teams user" matches none of these.

When entities is empty, evidenceAspectPolicy.ts's fallbackSubject() (~line
1120) builds a SYNTHETIC subject from the first 4 non-stopword tokens of the
raw question instead of a real recognized entity. This synthetic subject is
not a known concept with authority mappings — it's just leftover question
words.

### Actual observed impact — worse than the original entry suggested
On the answerV2 harness (npm run inspect:grounded-answer), this produces
claimTaskCount: 25, requestCount: 25 — confirmed 25 REAL separate OpenAI API
calls (~543 input tokens each, not cheap local operations). The resulting
answerText is a HALLUCINATED, INCOHERENT MIX of unrelated device-management
procedures:

    - Removing a Teams user (correct topic, 2-3 claims)
    - Resetting a Surface Hub device
    - Managing device tags
    - Deleting a provisioning package
    - Applying a configuration profile
    - Restarting a Surface Hub (twice, as separate claims)

None of these device-management claims answer "how do I remove a Teams
user." They were pulled in because they loosely keyword-match the synthetic
fallback subject (likely something like "remove teams user" built from raw
question tokens) with no real entity anchor to filter against, and no
coherence check across the 25 independently-generated claims before
assembly.

This DIRECTLY VIOLATES the project's own stated invariant: "wrong guidance is
worse than no guidance." A real user asking this question would receive a
confident, well-formatted, fully-cited-looking answer that is substantively
about the wrong topic.

### LIVE PATH CONFIRMED SAFE — 2026-09-08

Typed "How do I remove a Teams user?" into Relay (Live Assist mode,
correcting the earlier wrong-mode attempt). Full trace captured:

    synthesis_completed, status: "succeeded", fallbackReason: null
    4 evidence documents retrieved, all under ONE facet ("facet-1"):
      - "Manage phone numbers for users" / remove a phone number
      - "Manage emergency locations" / remove an emergency location
      - "Manage resource accounts for voice applications" / change license
      - "Manage voice applications policies" / overview

None of these documents actually describe removing a Teams USER account —
same underlying weak-entity-match problem seen on the answerV2 harness.
BUT the live synthesis path's answer was:

    "The supplied evidence does not explain how to remove a user from
    Microsoft Teams; it only covers removing a user's assigned phone
    number, an emergency location, a resource account, or a voice
    applications policy. Unsupported: No supplied source provides a
    procedure for removing a Microsoft Teams user."

CORRECT, HONEST REFUSAL. No hallucination. The live path's grounding
prompt constraints ("mark every unsupported requested facet as
unsupported") correctly caught that the retrieved evidence didn't answer
the question, even though retrieval itself found the wrong documents.

CONCLUSION: the severe 25-claim hallucination (Surface Hub resets, device
tags, provisioning packages) is CONFIRMED ISOLATED to the answerV2 harness
path (runInspectGroundedAnswer.ts / inspectGroundedAnswer.ts), which
apparently lacks an equivalent grounding/refusal safeguard or generates
far more independent claim tasks (25 vs synthesis's 1 facet) with no
cross-claim coherence check. This is NOT a live production safety issue
today — Relay's actual users would see an honest "I can't answer that,"
not a hallucinated wrong answer.

REPRIORITIZED: this is now a RETRIEVAL QUALITY gap (weak entity match
causes the wrong 4 documents to be retrieved) with a SAFE failure mode
on the live path, not an active hallucination risk in the shipped
product. Still worth fixing — a real user would get "no answer" instead
of real help — but no longer the most urgent item on this list.

Remaining open questions for next session, in priority order:
1. Should answerV2's harness path get the same grounding safeguard the
   live synthesis path has, given both apparently share the same weak
   entity extraction? (lower urgency now that live is confirmed safe,
   but answerV2 IS the extractive path we've invested in getting to 6/6
   — this gap matters for that investment even if not for today's live
   product)
2. Adding "user"/"account"/"device" to detectEntities' vocabulary would
   likely improve retrieval quality for this whole question class on
   BOTH paths, addressing the root cause rather than just the symptom
3. Whether other generic-noun questions (not just "user") share this
   weak-retrieval-but-safe-refusal pattern on live, and whether that
   refusal rate is itself worth reducing by better entity coverage
4. UNCHECKED: does answerV2's synthesis path (used by
   runInspectGroundedAnswer.ts) use the SAME model and SAME grounding-prompt
   constraints as the live synthesis path
   (openAiInterviewAnswerSynthesisPort.ts, confirmed using "gpt-5.6-sol" with
   explicit prompt instructions like "mark every unsupported requested facet
   as unsupported")? A quick grep for a hardcoded model string or
   OPENAI_MODEL env var in src/main/services/answerV2/ turned up nothing
   2026-09-08 late session — model resolution for this path was not located.
   If answerV2 uses a different model, OR the same model without an
   equivalent grounding/refusal instruction in its system prompt, that alone
   could fully explain why it hallucinated while live safely refused on
   IDENTICAL retrieved evidence. Find groundedAnswerSynthesis.ts or wherever
   answerV2 actually calls OpenAI and read its system prompt in full before
   proposing any entity-extraction fix — the prompt gap may be the more
   important and simpler fix than vocabulary.
5. UNCHECKED: Deepgram/STT configuration was never audited during tonight's
   live test. The first live-path attempt (QA Assist mode) produced only
   transcriptLength: 0 events for the full session with no question ever
   transcribed. The second attempt (Live Assist mode) transcribed
   "How do I remove a Teams user?" cleanly. This discrepancy was NOT
   diagnosed — it may be purely a mode-selection issue (QA Assist vs Live
   Assist routing to different capture paths) unrelated to Deepgram settings
   at all, or it may indicate a real intermittent capture issue worth a
   separate investigation. Do not conflate this with the entity-extraction
   bug — track it as a distinct, lower-priority item unless it recurs.

### Test After Session Ended — 2026-09-08 STT

Spoken question (Deepgram, speaker playback into mic, QA Assist UI):
"How do we delete a Teams user?"

STT captured the question correctly. This is not an ASR failure.

Live synthesis returned a mixed procedure, not a refusal:

    A standard Teams user is deleted from the organization through the
    Microsoft 365 admin center, PowerShell, or Microsoft Graph API; Teams
    voice resource accounts require extra preparation before deletion.
    Then: retain data; remove via admin center / PowerShell / Graph;
    OneDrive recycle bin 93 days; then a full resource-account teardown
    (unassign number, Teams admin center Voice → Resource accounts,
    Assign/unassign, remove AA/CQ, Save, delete under Users in M365).
    Unsupported: no exact admin-center clicks or PowerShell/Graph
    commands for deleting a standard user.

Same weak-entity class as typed "How do I remove a Teams user?" earlier
the same evening (entities empty; "user" not in detectEntities). Last
night's typed Live Assist run refused because retrieval returned phone
numbers / emergency locations / policies. This STT run found enough
delete-user language plus manage-resource-accounts that synthesis
answered by stitching org-user deletion and resource-account deletion
into one list. The Unsupported line only covers missing standard-user
clicks; it does not flag that resource-account steps do not answer
"delete a Teams user."

LIVE PATH CONFIRMED SAFE above is therefore too strong for this
question class: refusal vs mixed-steps depends on which Learn-RAG
hits land (delete vs remove wording, and/or STT facet split), not on
a hard missing-entity refusal. Evidence titles and [Relay V2 semantic]
facets for this STT turn were not pulled from the log before the
session ended.

- FIXED 2026-09-05: OPERATION_PATTERNS in queryIntentRules.ts previously
  collapsed "enable" and "disable" into one operation intent. Split into
  separate patterns checked in order (disable before enable).

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
