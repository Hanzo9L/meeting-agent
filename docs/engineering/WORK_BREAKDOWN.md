# Engineering Work Breakdown

This work breakdown is locked to approved `AD-01` through `AD-10` and mapped directly to `docs/architecture/MIGRATION_PLAN.md`.

## Scope lock

- In scope: `Stage 0` through `Stage 7` from `docs/architecture/MIGRATION_PLAN.md`.
- Out of scope until vertical slice proves pipeline: Graph, Entra, broad M365, Defender, Intune, and broad corpus expansion.
- No production implementation code in this document set.
- Architecture changes are not allowed here; contradictions must be raised as an Architecture Exception.

## Ordered epics

1. Epic A: Baseline, controls, and evaluation harness
2. Epic B: Source registry, ingestion, and canonical knowledge store
3. Epic C: Retrieval V2 (intent routing + hybrid candidate generation)
4. Epic D: Evidence planning, grounded answer, and citation validation
5. Epic E: Microsoft Learn MCP selective verification and resilience
6. Epic F: Controlled cutover, rollback, and production readiness

## Work items

### WB-01

- Epic: Epic A
- Capability: Architecture lock and migration scaffolding
- Implementation task: Mark `AD-01..AD-10` Accepted with approved amendments and add engineering docs scaffold under `docs/engineering/`
- Migration stage: Stage 0
- Architecture decisions satisfied: AD-01, AD-02, AD-03, AD-04, AD-05, AD-06, AD-07, AD-08, AD-09, AD-10
- Architecture/contract documents satisfied: `ARCHITECTURE_DECISIONS.md`, `MIGRATION_PLAN.md`
- Expected files/modules created or modified: `docs/architecture/ARCHITECTURE_DECISIONS.md`, `docs/engineering/*.md`
- Dependencies: None
- Blocking relationships: Blocks all downstream implementation planning
- Acceptance criteria: ADR statuses show Accepted; amendments for AD-03/04/06/10 are explicit and unambiguous
- Tests required: Documentation consistency check against architecture docs
- Observability/debug requirements: N/A (planning artifact)

### WB-02

- Epic: Epic A
- Capability: Domain/intent cutover control plane
- Implementation task: Define feature-flag matrix for `domain x intent x pipeline-version` with rollback controls (legacy vs V2)
- Migration stage: Stage 0 -> Stage 1
- Architecture decisions satisfied: AD-09, AD-10
- Architecture/contract documents satisfied: `TARGET_STATE.md`, `MIGRATION_PLAN.md`
- Expected files/modules created or modified: `src/main/config/featureFlags.ts`, `src/main/services/routing/cutoverPolicy.ts`, `src/shared/types.ts`
- Dependencies: WB-01
- Blocking relationships: Blocks WB-17, WB-25, WB-26
- Acceptance criteria: Flags can route by domain/intent; emergency rollback path validated in tests
- Tests required: Unit tests for routing matrix; integration test for live toggle rollback
- Observability/debug requirements: Log active flag set with domain/intent and selected pipeline

### WB-03

- Epic: Epic A
- Capability: Evaluation dataset and baseline scoring harness
- Implementation task: Create evaluation corpus format, seed Teams Admin + Teams PowerShell scenarios, and baseline scorer for legacy path
- Migration stage: Stage 0
- Architecture decisions satisfied: AD-07, AD-10
- Architecture/contract documents satisfied: `MIGRATION_PLAN.md`, `ANSWER_CONTRACT.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `docs/engineering/eval/EVAL_DATASET_SPEC.md`, `eval/datasets/teams-admin-powershell.seed.jsonl`, `eval/harness/legacyScorer.ts`
- Dependencies: WB-01
- Blocking relationships: Blocks WB-11, WB-17, WB-26, WB-27
- Acceptance criteria: Baseline run produces reproducible quality + latency report for seed dataset
- Tests required: Golden-file tests for scorer outputs; deterministic replay test
- Observability/debug requirements: Persist per-question metrics artifact with run id and commit sha

### WB-04

- Epic: Epic A
- Capability: End-to-end debug trace schema
- Implementation task: Define structured developer/debug trace contract spanning QueryIntent through citation validation
- Migration stage: Stage 1
- Architecture decisions satisfied: AD-07, AD-08, AD-09, AD-10
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`, `ANSWER_CONTRACT.md`, `TARGET_STATE.md`
- Expected files/modules created or modified: `src/main/telemetry/debugTraceTypes.ts`, `src/main/telemetry/debugTraceSink.ts`, `docs/engineering/TRACE_SCHEMA.md`
- Dependencies: WB-03
- Blocking relationships: Blocks WB-17, WB-20, WB-23, WB-27
- Acceptance criteria: One serialized trace captures all required pipeline stages for a replayed question
- Tests required: Schema validation unit tests; integration test asserting required fields are present
- Observability/debug requirements: Trace includes stage latency, evidence ids, citation map, and fallback reasons

### WB-05

- Epic: Epic B
- Capability: Tiered source registry for initial cutover domains
- Implementation task: Implement source registry entries for Teams Admin and Teams PowerShell with authority tier, GA/preview status, and domain mapping metadata
- Migration stage: Stage 2
- Architecture decisions satisfied: AD-01, AD-02, AD-03
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`, `TARGET_STATE.md`
- Expected files/modules created or modified: `src/main/services/knowledgeV2/sourceRegistry.ts`, `src/main/services/knowledgeV2/sourceTypes.ts`
- Dependencies: WB-01
- Blocking relationships: Blocks WB-06, WB-12, WB-16
- Acceptance criteria: Registry resolves domain priority order exactly as approved architecture defines
- Tests required: Unit tests for authority ordering and preview gating metadata
- Observability/debug requirements: Debug logs show selected source priority chain per question domain

### WB-06

- Epic: Epic B
- Capability: Repository synchronization adapters
- Implementation task: Implement transport-aware source acquisition adapters (GitHub sync for `office-docs-powershell`; Learn MCP acquisition path for Teams Admin), with path/policy filtering and provenance preservation
- Migration stage: Stage 2
- Architecture decisions satisfied: AD-01, AD-09
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`, `MIGRATION_PLAN.md`
- Expected files/modules created or modified: `src/main/services/knowledgeV2/sync/repoSync.ts`, `src/main/services/knowledgeV2/sync/sourceSyncJobs.ts`, `src/main/services/knowledgeV2/sync/pathPolicies.ts`
- Dependencies: WB-05
- Blocking relationships: Blocks WB-07, WB-08
- Acceptance criteria: Sync job produces deterministic local workspace snapshots for both sources
- Tests required: Integration tests with fixture repos; failure handling tests for git/network errors
- Observability/debug requirements: Sync telemetry includes source id, commit hash, duration, and error category

### WB-07

- Epic: Epic B
- Capability: Canonical document parser
- Implementation task: Parse markdown + frontmatter into canonical document/section/block schema with stable ids
- Migration stage: Stage 2
- Architecture decisions satisfied: AD-01, AD-02, AD-08
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`
- Expected files/modules created or modified: `src/main/services/knowledgeV2/parse/canonicalParser.ts`, `src/main/services/knowledgeV2/parse/idStrategy.ts`
- Dependencies: WB-06
- Blocking relationships: Blocks WB-08, WB-09, WB-15
- Acceptance criteria: Parsed output preserves title, headings, status tags, and source provenance required by contracts
- Tests required: Parser unit tests on representative Teams Admin and PowerShell markdown fixtures
- Observability/debug requirements: Parse diagnostics include skipped files, parse warnings, and schema validation failures

### WB-08

- Epic: Epic B
- Capability: SQLite V2 schema and persistence
- Implementation task: Create normalized SQLite schema for documents, sections, chunks, entities, embeddings, and retrieval metadata
- Migration stage: Stage 2
- Architecture decisions satisfied: AD-03, AD-08, AD-09
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/knowledgeV2/store/schema.sql`, `src/main/services/knowledgeV2/store/sqliteStore.ts`, `src/main/services/knowledgeV2/store/migrations/*`
- Dependencies: WB-07
- Blocking relationships: Blocks WB-09, WB-13, WB-14, WB-15
- Acceptance criteria: Schema supports required provenance and metadata fields, including embedding provider/model/dimensions/version
- Tests required: Migration tests, schema constraints tests, and read/write integration tests
- Observability/debug requirements: Store metrics for row counts, migration version, and write failures

### WB-09

- Epic: Epic B
- Capability: Embedding provider abstraction and persistence
- Implementation task: Implement hosted `EmbeddingProvider` adapter with configurable model selection and binary embedding serialization
- Migration stage: Stage 2
- Architecture decisions satisfied: AD-03, AD-04
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/knowledgeV2/embeddings/embeddingProvider.ts`, `src/main/services/knowledgeV2/embeddings/hostedEmbeddingProvider.ts`, `src/main/services/knowledgeV2/store/embeddingCodec.ts`
- Dependencies: WB-08
- Blocking relationships: Blocks WB-10, WB-15
- Acceptance criteria: Embeddings persisted as compact binary with complete metadata and adapter-level model configurability
- Tests required: Unit tests for serialization/deserialization and provider contract tests
- Observability/debug requirements: Log embedding provider, model, dimensions, version, token usage, and request latency

### WB-10

- Epic: Epic B
- Capability: Re-embedding without reparsing unchanged docs
- Implementation task: Build incremental embedding refresh pipeline keyed by document/chunk hash + embedding version
- Migration stage: Stage 2
- Architecture decisions satisfied: AD-04, AD-09
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`, `MIGRATION_PLAN.md`
- Expected files/modules created or modified: `src/main/services/knowledgeV2/index/reembedPlanner.ts`, `src/main/services/knowledgeV2/index/indexRefreshJob.ts`
- Dependencies: WB-09
- Blocking relationships: Blocks WB-26 quality gate execution
- Acceptance criteria: Changing embedding version triggers re-embedding only; unchanged parsed docs are not reparsed
- Tests required: Incremental indexing integration tests with unchanged vs changed source fixtures
- Observability/debug requirements: Reindex run report with counts: reused parse, re-embedded chunks, total duration

### WB-11

- Epic: Epic B
- Capability: Stage-1 retrieval latency spike
- Implementation task: Execute bounded brute-force semantic latency spike over candidate pools (post-filtered only) and publish decision memo
- Migration stage: Technical spike before Stage 3 productionization
- Architecture decisions satisfied: AD-03, AD-10
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`, `MIGRATION_PLAN.md`
- Expected files/modules created or modified: `docs/engineering/spikes/SPIKE_AD03_BOUNDED_SEMANTIC.md`, `eval/spikes/semanticLatencySpike.ts`
- Dependencies: WB-03, WB-09
- Blocking relationships: Blocks WB-15 release readiness
- Acceptance criteria: Measured p95 latency curve is produced for candidate bounds and corpus sizes
- Tests required: Repeatability tests for spike harness
- Observability/debug requirements: Publish stage timing breakdown and candidate counts for each run

### WB-12

- Epic: Epic C
- Capability: Query intent extraction
- Implementation task: Implement `QueryIntent` extractor for domain, freshness sensitivity, cmdlet specificity, and preview intent
- Migration stage: Stage 1 -> Stage 3
- Architecture decisions satisfied: AD-01, AD-02, AD-06, AD-07
- Architecture/contract documents satisfied: `KNOWLEDGE_MODEL.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/retrievalV2/queryIntent.ts`, `src/main/services/retrievalV2/queryIntentRules.ts`
- Dependencies: WB-05
- Blocking relationships: Blocks WB-13, WB-16, WB-22
- Acceptance criteria: Intent classification matches labeled eval set for Teams Admin/PowerShell seed questions
- Tests required: Unit tests per intent feature and confusion-matrix test on seed corpus
- Observability/debug requirements: Trace includes intent fields and confidence/rule matches

### WB-13

- Epic: Epic C
- Capability: Domain router
- Implementation task: Route questions to Teams Admin, Teams PowerShell, or mixed policy path based on `QueryIntent`
- Migration stage: Stage 3
- Architecture decisions satisfied: AD-01, AD-09, AD-10
- Architecture/contract documents satisfied: `TARGET_STATE.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/retrievalV2/domainRouter.ts`, `src/main/services/retrievalV2/domainPolicies.ts`
- Dependencies: WB-12
- Blocking relationships: Blocks WB-14, WB-15, WB-16
- Acceptance criteria: Router selects expected domain path for curated routing test set
- Tests required: Router unit tests with intent fixtures; integration test for mixed-domain queries
- Observability/debug requirements: Emit selected domain path, rejected domains, and reasons

### WB-14

- Epic: Epic C
- Capability: Lexical and exact-match retrieval
- Implementation task: Implement SQLite FTS5 retrieval and exact cmdlet/entity match retrieval over routed domain corpus
- Migration stage: Stage 3
- Architecture decisions satisfied: AD-03, AD-05
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/retrievalV2/lexicalRetriever.ts`, `src/main/services/retrievalV2/exactMatchRetriever.ts`
- Dependencies: WB-08, WB-13
- Blocking relationships: Blocks WB-15, WB-16
- Acceptance criteria: Deterministic top candidate set for seeded lexical and cmdlet queries
- Tests required: Retrieval fixture tests and deterministic ranking tests
- Observability/debug requirements: Capture candidate count, lexical scores, and exact-match hits

### WB-15

- Epic: Epic C
- Capability: Bounded semantic scoring adapter
- Implementation task: Implement semantic scorer over post-filter candidate pool only, with adapter boundary for ANN replacement
- Migration stage: Stage 3
- Architecture decisions satisfied: AD-03, AD-04, AD-05
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`, `KNOWLEDGE_MODEL.md`
- Expected files/modules created or modified: `src/main/services/retrievalV2/semanticScorer.ts`, `src/main/services/retrievalV2/vectorSearchAdapter.ts`
- Dependencies: WB-09, WB-11, WB-14
- Blocking relationships: Blocks WB-16
- Acceptance criteria: Semantic scoring never executes full-corpus scan; adapter contract is stable and test-covered
- Tests required: Candidate-bound guardrail tests; similarity scoring unit tests
- Observability/debug requirements: Trace candidate pool size and semantic stage latency per query

### WB-16

- Epic: Epic C
- Capability: Hybrid candidate generation and authority evaluation
- Implementation task: Fuse lexical/exact/semantic signals and apply authority + GA/preview + conflict policy to select evidence candidates
- Migration stage: Stage 3 -> Stage 4
- Architecture decisions satisfied: AD-01, AD-02, AD-05, AD-07
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`, `KNOWLEDGE_MODEL.md`
- Expected files/modules created or modified: `src/main/services/retrievalV2/hybridFusion.ts`, `src/main/services/retrievalV2/authorityPolicyEngine.ts`
- Dependencies: WB-05, WB-12, WB-14, WB-15
- Blocking relationships: Blocks WB-18, WB-22, WB-27
- Acceptance criteria: Policy engine consistently enforces source hierarchy and preview restrictions on evaluation fixtures
- Tests required: Policy regression tests for authority conflicts and preview scenarios
- Observability/debug requirements: Trace shows dropped candidates and policy reasons

### WB-17

- Epic: Epic C
- Capability: Side-by-side evaluation mode
- Implementation task: Run legacy and V2 retrieval in parallel in developer mode, store comparison artifacts, and report diffs
- Migration stage: Stage 4
- Architecture decisions satisfied: AD-07, AD-10
- Architecture/contract documents satisfied: `MIGRATION_PLAN.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/eval/sideBySideRunner.ts`, `src/main/services/eval/comparisonReporter.ts`
- Dependencies: WB-03, WB-04, WB-16
- Blocking relationships: Blocks WB-26 and Stage 7 cutover approval
- Acceptance criteria: Reproducible report compares legacy vs V2 on same question set with stage latencies
- Tests required: Integration test for dual-run artifact completeness
- Observability/debug requirements: Persist run artifact ids and per-stage timings

### WB-18

- Epic: Epic D
- Capability: Evidence bundle construction
- Implementation task: Build `EvidenceBundle` and answerability classifier (`answered`, `partial`, `insufficient_evidence`) from selected candidates
- Migration stage: Stage 5
- Architecture decisions satisfied: AD-07, AD-08
- Architecture/contract documents satisfied: `ANSWER_CONTRACT.md`, `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/answerV2/evidenceBundleBuilder.ts`, `src/main/services/answerV2/answerabilityPolicy.ts`
- Dependencies: WB-16
- Blocking relationships: Blocks WB-19, WB-21, WB-23, WB-27
- Acceptance criteria: Insufficient evidence is returned when required claims cannot be supported by authoritative evidence
- Tests required: Classification tests with answered/partial/insufficient fixtures
- Observability/debug requirements: Trace answerability decision inputs and outcome

### WB-19

- Epic: Epic D
- Capability: Deterministic answer planning
- Implementation task: Build `AnswerPlan` claim map from `EvidenceBundle` with claim-to-evidence linkage
- Migration stage: Stage 5
- Architecture decisions satisfied: AD-07, AD-08
- Architecture/contract documents satisfied: `ANSWER_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/answerV2/answerPlanner.ts`, `src/main/services/answerV2/claimMap.ts`
- Dependencies: WB-18
- Blocking relationships: Blocks WB-20, WB-21
- Acceptance criteria: Every generated claim is backed by at least one evidence id before LLM generation
- Tests required: Unit tests for claim map coverage and unsupported claim rejection
- Observability/debug requirements: Persist claim count, coverage ratio, and unsupported claim rejections

### WB-20

- Epic: Epic D
- Capability: Grounded answer generation adapter
- Implementation task: Implement answer generator input contract that only accepts `AnswerPlan` + `EvidenceBundle` and emits `GroundedAnswer`
- Migration stage: Stage 5
- Architecture decisions satisfied: AD-07, AD-08, AD-09
- Architecture/contract documents satisfied: `ANSWER_CONTRACT.md`, `TARGET_STATE.md`
- Expected files/modules created or modified: `src/main/services/answerV2/groundedAnswerService.ts`, `src/main/services/llm/groundedPromptBuilder.ts`
- Dependencies: WB-19
- Blocking relationships: Blocks WB-21, WB-27
- Acceptance criteria: Output payload includes answer text, citation payload, answerability class, and rationale fields
- Tests required: Contract tests for response schema and refusal behavior
- Observability/debug requirements: Log token usage, generation latency, and refusal reason codes

### WB-21

- Epic: Epic D
- Capability: Citation validator and presentation mapping
- Implementation task: Validate citations against evidence ids and map internal chunk provenance to section-level user citations
- Migration stage: Stage 5
- Architecture decisions satisfied: AD-02, AD-08, AD-10
- Architecture/contract documents satisfied: `ANSWER_CONTRACT.md`, `KNOWLEDGE_MODEL.md`
- Expected files/modules created or modified: `src/main/services/answerV2/citationValidator.ts`, `src/main/services/answerV2/citationPresenter.ts`
- Dependencies: WB-19, WB-20
- Blocking relationships: Blocks WB-26 and Stage 7 cutover approval
- Acceptance criteria: Validator rejects intentional mismatch cases and labels preview citations when applicable
- Tests required: Negative tests for mismatched citation ids; integration tests for section-level citation rendering
- Observability/debug requirements: Emit citation-valid flag, issue codes, and offending claim ids

### WB-22

- Epic: Epic E
- Capability: MCP verification trigger policy engine
- Implementation task: Implement selective Microsoft Learn MCP trigger policy from `QueryIntent` and evidence diagnostics
- Migration stage: Stage 6
- Architecture decisions satisfied: AD-06, AD-07
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`, `ANSWER_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/verification/mcpTriggerPolicy.ts`, `src/main/services/verification/mcpPolicyTypes.ts`
- Dependencies: WB-12, WB-16
- Blocking relationships: Blocks WB-23
- Acceptance criteria: MCP invoked only under approved conditions; skipped when sufficient authoritative local evidence exists
- Tests required: Policy tests for trigger/no-trigger scenarios
- Observability/debug requirements: Trace trigger reason, skip reason, and policy rule id

### WB-23

- Epic: Epic E
- Capability: Concurrent local + MCP orchestration with graceful degradation
- Implementation task: Run MCP verification concurrently with local retrieval when freshness-sensitive; enforce timeout/failure fallback behavior
- Migration stage: Stage 6
- Architecture decisions satisfied: AD-06, AD-09, AD-10
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`, `ANSWER_CONTRACT.md`, `TARGET_STATE.md`
- Expected files/modules created or modified: `src/main/services/verification/mcpOrchestrator.ts`, `src/main/services/verification/freshnessResolver.ts`
- Dependencies: WB-18, WB-22
- Blocking relationships: Blocks WB-24, WB-27
- Acceptance criteria: Timeout/throttle/network failure degrade gracefully; returns `insufficient_evidence` when neither local nor MCP supports required claims
- Tests required: Integration tests for timeout, throttling, network loss, and conflict scenarios
- Observability/debug requirements: Per-call timing, timeout events, fallback path, and failure taxonomy

### WB-24

- Epic: Epic E
- Capability: MCP cache and resilience controls
- Implementation task: Add short-TTL cache for verification responses and retry/throttle guards
- Migration stage: Stage 6
- Architecture decisions satisfied: AD-06, AD-10
- Architecture/contract documents satisfied: `RETRIEVAL_CONTRACT.md`
- Expected files/modules created or modified: `src/main/services/verification/mcpCache.ts`, `src/main/services/verification/mcpClientWrapper.ts`
- Dependencies: WB-23
- Blocking relationships: Blocks WB-26
- Acceptance criteria: Cache keying and TTL behavior are deterministic and tested; retry budget bounded
- Tests required: Cache behavior tests and rate-limit handling tests
- Observability/debug requirements: Cache hit/miss metrics and retry counters

### WB-25

- Epic: Epic F
- Capability: Domain/intent cutover controller
- Implementation task: Implement runtime cutover controller that can enable V2 for selected Teams Admin/PowerShell intents and rollback instantly
- Migration stage: Stage 7
- Architecture decisions satisfied: AD-09, AD-10
- Architecture/contract documents satisfied: `TARGET_STATE.md`, `MIGRATION_PLAN.md`
- Expected files/modules created or modified: `src/main/services/routing/cutoverController.ts`, `src/main/services/routing/intentRolloutConfig.ts`
- Dependencies: WB-02, WB-17, WB-21, WB-24
- Blocking relationships: Blocks WB-27, WB-28
- Acceptance criteria: Operators can switch specific intents between legacy and V2 without app restart
- Tests required: Integration tests for per-intent cutover and rollback
- Observability/debug requirements: Emit rollout state changes and effective pipeline per request

### WB-26

- Epic: Epic F
- Capability: Quality gate executor from measured baselines
- Implementation task: Implement gate runner that computes pass/fail from measured legacy + V2 baseline metrics and evaluation dataset runs
- Migration stage: Stage 7
- Architecture decisions satisfied: AD-07, AD-10
- Architecture/contract documents satisfied: `MIGRATION_PLAN.md`, `QUALITY_GATES.md`
- Expected files/modules created or modified: `eval/gates/gateRunner.ts`, `eval/gates/gateDefinitions.ts`, `docs/engineering/QUALITY_GATES.md`
- Dependencies: WB-03, WB-10, WB-17, WB-21, WB-24
- Blocking relationships: Blocks WB-27 and cutover approval
- Acceptance criteria: Gate outputs are data-driven from measured baselines; no hard-coded planning-only thresholds
- Tests required: Gate calculation unit tests and end-to-end gate report test
- Observability/debug requirements: Persist gate inputs, computed thresholds, pass/fail rationale, and trend deltas

### WB-27

- Epic: Epic F
- Capability: First end-to-end vertical slice rehearsal
- Implementation task: Execute Direct Routing / voice-routing representative question through full V2 chain and produce acceptance report
- Migration stage: Stage 7
- Architecture decisions satisfied: AD-01, AD-03, AD-04, AD-05, AD-06, AD-07, AD-08, AD-09, AD-10
- Architecture/contract documents satisfied: `VERTICAL_SLICE.md`, `RETRIEVAL_CONTRACT.md`, `ANSWER_CONTRACT.md`
- Expected files/modules created or modified: `eval/vertical-slice/direct-routing.runbook.md`, `eval/reports/vertical-slice-direct-routing.json`
- Dependencies: WB-18, WB-20, WB-23, WB-25, WB-26
- Blocking relationships: Blocks WB-28 and initial production cutover
- Acceptance criteria: Full pipeline trace exists from QueryIntent to citation validation with no architecture-contract violations
- Tests required: End-to-end integration test for vertical slice with deterministic artifact assertions
- Observability/debug requirements: Complete debug trace artifact with stage timings and evidence/citation mapping

### WB-28

- Epic: Epic F
- Capability: Initial Teams Admin + Teams PowerShell cutover definition of done package
- Implementation task: Publish cutover decision packet with gates, rollback drill results, known risks, and sign-off checklist
- Migration stage: Stage 7 exit
- Architecture decisions satisfied: AD-01 through AD-10
- Architecture/contract documents satisfied: `MIGRATION_PLAN.md`, `QUALITY_GATES.md`, `VERTICAL_SLICE.md`
- Expected files/modules created or modified: `docs/engineering/CUTOVER_DOD.md`, `eval/reports/teams-admin-powershell-cutover-summary.md`
- Dependencies: WB-25, WB-26, WB-27
- Blocking relationships: Final blocker before initial in-scope production enablement
- Acceptance criteria: Decision packet includes pass/fail on each mandatory gate and rollback readiness proof by domain/intent
- Tests required: Rollback drill verification test and gate report consistency check
- Observability/debug requirements: Production telemetry dashboard spec included for post-cutover monitoring

## Traceability rule

Each implementation PR must include a traceability footer:

- Architecture Decision(s): `AD-xx`
- Contract(s): file paths under `docs/architecture/`
- Work item id(s): `WB-xx`
- Test ids and result artifact link
- Gate impact: which quality gate metric(s) this change can influence
