# Architecture Decisions (Phase 2.5)

All decisions in this document are **Accepted**.

| ID | Decision | Recommendation | Human Approval Required |
| -- | -------- | -------------- | ----------------------- |
| AD-01 | Microsoft source authority hierarchy | Deterministic authority + specificity + freshness conflict policy with Teams admin/PowerShell priority for admin intents | Yes |
| AD-02 | Beta/preview policy | Index beta, exclude by default from answer evidence unless explicitly requested or only available path with warning | Yes |
| AD-03 | Local search/vector architecture | SQLite canonical structured/document/embedding store + FTS5 lexical retrieval + bounded brute-force semantic scoring only after domain/source/metadata filtering; vector adapter preserved for future ANN | Yes |
| AD-04 | Embedding strategy | Hosted embeddings behind adapter abstraction; model is configurable and validated against evaluation corpus; re-embedding supports version changes without reparsing unchanged documents | Yes |
| AD-05 | Reranking strategy | Stage 1 deterministic weighted fusion only; defer dedicated reranker to later gate | Yes |
| AD-06 | Learn MCP verification policy | Selective MCP verification where local corpus exists; MCP may be primary acquisition for domains lacking stable public Git corpus, with local caching and transport-aware provenance | Yes |
| AD-07 | Confidence/answerability policy | Rule-based answerability classes from interpretable evidence conditions, not guessed global numeric thresholds | Yes |
| AD-08 | Citation granularity | Internal claim→evidence mapping (chunk-level provenance), user-facing section-level citations | Yes |
| AD-09 | Runtime isolation | Renderer for UI/capture only; indexing/sync/embedding/search orchestration outside renderer, heavy work in workers | No |
| AD-10 | Quality gates and rollback | Mandatory, measured quality gates derived from baseline/evaluation data; cutover + rollback by domain/intent (not only global switch) | Yes |

---

## AD-01 — Microsoft Source Authority Hierarchy

**Decision**  
Define deterministic precedence and conflict rules across Microsoft sources.

**Status**: Accepted

### Context

Current system is msteams-docs-centric and fails on many admin questions. Future system must reconcile overlapping Microsoft sources without unstable behavior.

### Options Considered

1. Flat authority (all Tier 1 equal, relevance decides)
2. Hard global source precedence list
3. Domain-aware precedence with freshness and GA/beta guardrails

### Recommendation

Adopt **domain-aware precedence**:

1. Determine question domain(s) first (teams_admin, teams_powershell, graph, entra, m365, teams_dev).
2. Apply domain-specific source priority:
   - `teams_admin` intent: Teams admin docs > Teams PowerShell > M365 > Entra > Graph > Teams dev
   - `teams_powershell` intent: Teams PowerShell > Teams admin > M365 > Entra > Graph > Teams dev
   - `graph` intent: Graph v1.0 > Entra/M365 contextual docs > Teams admin > Teams dev
   - `entra` intent: Entra > M365 > Teams admin > Graph > Teams dev
   - `teams_dev` intent: Teams dev > Graph/Entra contextual docs > admin docs
3. Within same authority tier:
   - prefer product specificity over broad guidance
   - prefer fresher/verified source when substantive conflict exists
4. GA beats beta/preview unless user requested preview or no GA exists.

Conflict handling rules:

- Teams admin vs M365 conflict on Teams admin intent -> Teams admin preferred, M365 as caveat if policy-scope broader.
- Teams admin vs PowerShell conflict:
  - behavioral concept -> Teams admin preferred
  - cmdlet semantics/parameters -> PowerShell preferred
- Learn MCP current content vs local indexed GitHub:
  - if MCP confirms update/new status, mark local evidence stale and caveat; prefer MCP-verified current guidance.
- Graph v1.0 vs Graph beta:
  - v1.0 default; beta only if explicitly requested/necessary and clearly labeled.
- Entra broad guidance vs Teams-specific guidance:
  - Teams-specific operational behavior wins for Teams operation claims; Entra retained for identity/security caveats.
- Developer-platform vs administrator overlap:
  - admin intents never default to teams_dev evidence unless no Tier 1 admin evidence exists.

### Rationale

This preserves authoritative behavior for a Teams administration assistant while allowing cross-domain enrichment.

### Consequences

- Requires robust domain classification and policy metadata.
- Adds deterministic but more complex conflict logic.

### Revisit When

- High conflict rate observed in evaluation logs.
- New Microsoft source family added that changes precedence assumptions.

---

## AD-02 — Beta / Preview Policy

**Decision**  
How beta/preview content is indexed, retrieved, and shown.

**Status**: Accepted

### Context

Admin users need safe defaults. Beta content can be useful but risky if blended silently.

### Options Considered

1. Exclude beta entirely
2. Include and use by default
3. Index beta but gate its participation by policy

### Recommendation

Use **index-but-gated** policy:

- Beta/preview docs are indexed with explicit `sourceStatus`.
- Default retrieval excludes beta from selected evidence.
- Beta may appear only when:
  - user explicitly asks preview/beta
  - no GA evidence exists and answerability would otherwise be insufficient
- If only beta supports answer:
  - status must be `partial` or `answer_with_caveat`
  - answer must explicitly label preview dependency
  - citations marked `[Preview]`

### Rationale

Retains discoverability while protecting meeting-time reliability.

### Consequences

- Requires answer UI and citation model to carry preview labels.
- Slightly more policy complexity in retrieval/evidence stages.

### Revisit When

- Product shifts to preview-heavy audiences.
- Beta false-negative rate blocks practical usage.

---

## AD-03 — Local Search and Vector Architecture

**Decision**  
Choose concrete local retrieval architecture for V2 Stage 1.

**Status**: Accepted

### Context

Need local-first, Windows-friendly architecture with low packaging complexity and clean migration path.

### Options Considered

1. **A** SQLite + FTS5 + SQLite vector extension
2. **B** SQLite + FTS5 + separate embedded ANN index
3. **C** SQLite + FTS5 + brute-force embedding similarity
4. **D** Local vector DB/service

### Tradeoffs summary

- **A**: elegant single-store design but extension loading/build portability in Electron/Windows can be fragile.
- **B**: best query-scale profile, but adds native dependency/packaging and index lifecycle complexity early.
- **C**: lowest operational burden and highest determinism; latency acceptable if semantic scoring is bounded to candidate pool.
- **D**: unnecessary operational overhead for current product scope.

### Recommendation

For **V2 Stage 1**, adopt **Option C** with explicit storage and adapter constraints:

- SQLite is the canonical structured/document/embedding store
- SQLite FTS5 provides lexical retrieval
- Embeddings are stored in compact binary form, keyed by chunk id
- Embedding metadata is required per stored vector: provider, model, dimensions, and embedding-version
- Semantic scoring uses bounded brute-force cosine only after domain/source/metadata filtering, never whole-corpus vector scans
- Candidate fusion and policy selection remain above this layer
- Vector search remains behind an adapter so ANN can replace brute-force later without changing the knowledge model

Required small technical spike before production implementation:

- validate p95 semantic stage latency on representative corpus sizes with this bounded approach in Electron main+worker runtime.

### Why it fits this app

- Avoids native vector extension risks during early migration
- Keeps packaging simple for Windows desktop users
- Maintains local determinism and easy rebuild/backup
- Preserves future migration to ANN index without contract changes

### Consequences

- Semantic quality/latency bound to lexical prefilter quality.
- Full-corpus semantic recall limited until ANN stage is introduced.

### Revisit When

- Candidate-bounded brute-force exceeds latency budget
- Recall quality against regression set is insufficient

---

## AD-04 — Embedding Strategy

**Decision**  
Initial embedding provider and operating mode.

**Status**: Accepted

### Context

Need quality on technical Microsoft docs with minimal local model ops complexity.

### Options Considered

1. Remote OpenAI embeddings
2. Local embedding model
3. Alternative hosted provider (adapter)

### Recommendation

Use **hosted embeddings** initially for both:

- document indexing embeddings
- query-time embeddings

via a strict `EmbeddingProvider` adapter.

Do not hard-code a permanent first model choice. The selected hosted model must be validated against the evaluation corpus before cutover.

Store embeddings locally in SQLite for deterministic retrieval; no recompute on every app start.

Embedding version changes must support re-embedding without reparsing unchanged documents.

### Rationale

- Best quality-to-complexity ratio for initial migration
- Avoids shipping local model runtime in Electron package
- Keeps local retrieval execution while using remote embedding generation

### Consequences

- Requires network availability for first index generation and query embedding
- Has per-token cost profile
- Introduces privacy/compliance considerations for query text sent to embedding API

### Revisit When

- Offline requirement becomes hard requirement
- Cost/latency of remote embeddings becomes unacceptable
- Equivalent local model quality proven in spike

---

## AD-05 — Reranking Strategy

**Decision**  
Whether to introduce dedicated reranking in initial cutover.

**Status**: Accepted

### Context

Live-meeting latency is critical; premature reranking can degrade UX.

### Options Considered

1. No reranker (weighted fusion only)
2. LLM-based reranking
3. Cross-encoder reranker (local/hosted)

### Recommendation

- **Initial Teams Admin/PowerShell cutover**: deterministic weighted fusion only (no dedicated reranker)
- **Later optimization stage**: evaluate cross-encoder reranker only if retrieval quality metrics justify added latency
- Do not use LLM reranking in initial production migration

### Rationale

Keeps latency and complexity low while enabling measurement-first upgrades.

### Consequences

- Some nuanced relevance ordering may lag until later stage.
- Requires robust evaluation dataset early.

### Revisit When

- Weighted fusion misses exceed agreed quality gate
- Cross-encoder spike shows significant gains within latency budget

---

## AD-06 — Microsoft Learn MCP Verification Policy

**Decision**  
Operationalize selective MCP verification.

**Status**: Accepted

### Context

Need freshness/conflict checks without making MCP a runtime SPOF, while supporting authoritative domains where official public acquisition is available via Learn MCP rather than stable public Git.

### Options Considered

1. MCP on every query
2. MCP never in answer path
3. Selective MCP by policy triggers

### Recommendation

Adopt **selective MCP policy** with transport-aware exception handling:

MCP is never a hard dependency when sufficient authoritative local evidence exists.

For authoritative domains where no stable public Git synchronization path exists, Learn MCP may serve as **primary acquisition transport**, with fetched documents cached locally for reuse.

Trigger MCP when any holds:

- query asks latest/current/supported/deprecated
- licensing/availability intent
- local evidence confidence below threshold
- unresolved source conflicts
- GA/beta ambiguity
- explicit freshness verification requested

Operational policy:

- when freshness is flagged by `QueryIntent`, local retrieval and MCP verification should run concurrently where practical
- max MCP calls per question: 1 primary + 1 targeted follow-up (hard cap 2)
- timeout budget: bounded and measurable per latency budget, with values tuned from baseline measurements
- fallback: on timeout/throttling/network error, continue with local evidence and caveat freshness uncertainty
- MCP failure does not block answer unless answerability depends on freshness verification and local evidence is insufficient
- MCP can augment/override stale local evidence status, but cannot replace required domain relevance checks
- cache MCP verification results by normalized query + domain for short TTL (for example 10-30 minutes)
- during network loss: skip MCP and mark freshness as unknown
- if neither local evidence nor MCP can sufficiently support required claims, return `insufficient_evidence`
- preserve transport-aware provenance (do not fabricate Git commit/blob metadata for Learn-acquired documents)

### Rationale

Balances authoritative verification with live usability while enabling authoritative acquisition continuity when Microsoft publishing transport differs by source family.

### Consequences

- Requires cache invalidation and robust timeout handling.
- Requires explicit caveat language paths.

### Revisit When

- MCP reliability characteristics change materially
- Verification misses or latency penalties exceed targets

---

## AD-07 — Confidence and Answerability

**Decision**  
Define answerability classes without arbitrary fixed numeric thresholds.

**Status**: Accepted

### Context

Need calibrated confidence behavior and refusal policy for enterprise trust.

### Options Considered

1. Single numeric confidence threshold
2. Rule-based answerability only
3. Rule-based answerability with optional calibrated numeric score

### Recommendation

Use **rule-first answerability**:

- `answered` when:
  - at least one authoritative domain-matched source directly supports required claims
  - citation coverage complete for required claims
  - no unresolved high-severity conflict
- `partial` when:
  - only partial claim coverage
  - or only secondary/beta evidence available with caveat
  - or freshness uncertain on non-critical claims
- `insufficient_evidence` when:
  - no authoritative evidence
  - unresolved critical conflict
  - exact entity/cmdlet requested but not found

Numeric confidence may be computed internally, but calibrated from evaluation data, not hard-coded guessed thresholds.

### Rationale

Interpretable and auditable policy better than opaque score gates.

### Consequences

- Requires claim extraction/planning quality to be strong.
- Requires evaluation harness for calibration.

### Revisit When

- Rule complexity becomes unwieldy
- calibrated scoring improves decision quality demonstrably

---

## AD-08 — Citation Granularity

**Decision**  
Choose provenance unit for storage, validation, and UI.

**Status**: Accepted

### Context

Need both readable user citations and precise debug provenance.

### Options Considered

1. Document-level only
2. Section-level only
3. Chunk-level only
4. Claim-to-evidence mapping + section-level display

### Recommendation

Use **claim-to-evidence mapping internally** with chunk-level provenance, and **section-level citations in UI**.

Guidance by answer type:

- conceptual: cite section(s) supporting each major claim
- PowerShell cmdlet/reference: cite cmdlet page + parameter/example subsection
- procedures: cite step-bearing section(s)
- multi-source synthesis: at least one citation per source-derived claim
- conflicting sources: cite both and present caveat

### Rationale

Gives precision for validation/debug while preserving readability in overlay.

### Consequences

- More metadata storage and planning complexity.
- Requires citation validator aware of claim map.

### Revisit When

- User feedback demands more/less citation detail in overlay
- claim mapping overhead impacts latency materially

---

## AD-09 — Runtime Isolation

**Decision**  
Concrete boundary for renderer/preload/main/worker responsibilities.

**Status**: Accepted

### Context

Overlay must stay responsive while ingestion/retrieval evolves.

### Options Considered

1. Keep most logic in main process
2. Move heavy data pipeline work to workers
3. Introduce local companion service immediately

### Recommendation

Use main+worker topology now:

- **Renderer**
  - UI rendering, user interactions, media capture only
  - no indexing, no retrieval, no embedding compute
- **Preload**
  - typed IPC bridge only
  - no business logic
- **Main process**
  - session orchestration, intent routing, retrieval orchestration, answer orchestration, feature flags
- **Worker threads/process**
  - repository sync jobs, markdown parsing, chunking, embedding generation, index build/refresh, heavy rerank stages

Hard constraint:

- no sync/blocking retrieval/indexing tasks on renderer thread.

### Rationale

Matches local-first Electron model and keeps UI responsiveness without service sprawl.

### Consequences

- Requires robust worker lifecycle and error propagation design.
- Slightly more complex IPC-internal messaging.

### Revisit When

- Worker orchestration causes reliability issues
- resource contention in main process remains high despite worker isolation

---

## AD-10 — Quality Gates and Rollback

**Decision**  
Define practical cutover gates and rollback behavior.

**Status**: Accepted

### Context

Need safe incremental migration from legacy to V2 by intent/domain.

### Options Considered

1. Big-bang cutover
2. Manual qualitative review only
3. Quantitative gates + feature-flag rollout

### Recommendation

Use **quantitative gates + feature-flag rollback** per intent/domain.

Before cutover for a domain:

- Numerical thresholds are derived from measured legacy and V2 baselines plus the evaluation dataset; no invented planning-time thresholds
- Retrieval relevance on evaluation set meets measured improvement target vs legacy
- Citation correctness passes measured target from evaluation runbooks
- Unsupported-claim rate below measured target
- Answerability classification behavior acceptable (few false `answered` on insufficient evidence)
- p95 latency within measured budget
- no material crash/error regression

Rollback:

- per-domain and per-intent feature flag switches return traffic to legacy path immediately
- preserve dual logging for post-incident comparison

### Rationale

Gives realistic safety without requiring unrealistic “perfect” metrics.

### Consequences

- Requires evaluation harness and curated regression set before major cutovers.
- Requires instrumentation investment early.

### Revisit When

- evaluation set no longer representative
- production telemetry reveals gate blind spots

---

## Small technical spikes required before implementation planning

1. Validate bounded brute-force semantic scoring latency on representative corpus sizes in Electron main+worker runtime.
2. Validate Windows packaging compatibility for chosen SQLite stack and any optional vector-related native dependency.
3. Validate short-TTL MCP cache behavior under intermittent network conditions.

These spikes should remain isolated and non-production-integrated.

