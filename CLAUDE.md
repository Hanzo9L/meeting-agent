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
- With 12-bullet procedural answers the synthesis path medians 14,870ms against a
  fixed 15,000ms timeout; 3 of 6 benchmark runs time out. No timeout CLI flag.
  Extractive is 0.787ms with zero API calls. Direction stands: extractive primary,
  synthesis fallback only for questions no single document answers.
- ITEN NOC scenarios and other second-source corpora were proposed. Do not add a
  second source until the networking corpus is indexed and retrievable end to end.
- This repo has known pre-existing TypeScript errors. Always capture a baseline
  with `npm run build 2>&1 | tee /tmp/tsc-baseline.txt` before edits and diff
  against it. Only NEW errors matter.
- "How do I remove a Teams user" extracts entities: [] — no subject captured
  for "Teams user". On the answerV2 harness path this produced claimTaskCount:
  25 and requestCount: 25 (25 OpenAI calls, 18s), suggesting the planner may
  over-generate claims when no specific entity anchors the question. Not
  investigated further. This is a real question the user expects to be asked.
  UNRELATED to the P-007 facet issue above — different failure, entity
  extraction rather than facet matching.
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
