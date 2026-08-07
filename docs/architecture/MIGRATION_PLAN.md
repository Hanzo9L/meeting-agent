# Migration Plan

## Guiding principle

Keep the current Electron product functional while replacing the intelligence layer incrementally.

No big-bang cutover.

---

## Stage 0 — Baseline freeze

- Keep current production behavior as baseline.
- Add architecture docs and acceptance criteria.
- Define feature flag scaffold for V2 routing (no behavior change yet).

Exit criteria:

- baseline regression suite passes
- architecture contracts approved

---

## Stage 1 — Introduce Knowledge Engine V2 interfaces

- Add interface-only ports for:
  - `QueryIntent`
  - `retrieveEvidence()`
  - `EvidenceBundle`
  - `GroundedAnswer`
- Wire no-op adapters behind feature flags.

Exit criteria:

- app behavior unchanged with V2 disabled
- contract-level unit tests compile/pass

---

## Stage 2 — Source registry + ingestion for Teams admin and Teams PowerShell

- Implement source registry for Tier 1 authority model.
- Implement source acquisition for:
  - `learn_mcp` transport for Teams admin authoritative docs
  - GitHub synchronization for `office-docs-powershell` (Teams PowerShell paths)
- Parse markdown into canonical document schema.

Exit criteria:

- structured document store populated
- metadata preservation validated against sample docs

---

## Stage 3 — Local structured retrieval (lexical + exact match)

- Implement lexical retrieval (FTS) and exact entity/cmdlet match.
- Implement domain-filtered candidate generation.
- Keep semantic retrieval optional/stubbed at first if needed for latency.

Exit criteria:

- deterministic retrieval results for seeded admin and cmdlet queries
- latency baseline captured

---

## Stage 4 — Side-by-side evaluation mode

- Developer mode runs:
  - legacy retrieval path
  - V2 retrieval path
- Log evaluation artifacts:
  - legacy result
  - V2 candidates
  - selected evidence
  - latency by stage

Exit criteria:

- reproducible comparison report on seed dataset

---

## Stage 5 — Evidence bundle + citation validator

- Implement evidence selection and answerability decision.
- Implement citation validation (must map to evidence bundle).
- Keep final answer generation behind V2 feature flag.

Exit criteria:

- citation validation catches intentional mismatch cases
- refusal/caveat behavior verified on insufficient evidence tests

---

## Stage 6 — Microsoft Learn MCP verification

- Add selective MCP invocation policy:
  - freshness/conflict/low-confidence conditions only
- Add timeout and fallback behavior for live latency budgets.

Exit criteria:

- MCP path measurable and bounded
- no full-flow dependency on MCP uptime for all questions

---

## Stage 7 — Controlled cutover (Teams admin intents)

- Enable V2 answer path for selected Teams admin intents behind feature flag.
- Keep legacy fallback path for non-covered intents.

Exit criteria:

- acceptance thresholds met (quality + latency + citation validity)
- rollback switch verified

---

## Stage 8 — Expand to Graph and Entra

- Add Tier 1 Graph and Entra sources.
- Update domain router and retrieval policies accordingly.

Exit criteria:

- cross-domain query tests pass
- authority conflict handling validated

---

## Stage 9 — Expand to M365 and refine secondary sources

- Add M365 corpus.
- Keep `msteams-docs` as secondary for developer-specific intents only.
- Tighten domain match policies to prevent developer-doc dominance for admin questions.

Exit criteria:

- domain routing quality threshold met
- reduced false retrieval from secondary corpus

---

## Stage 10 — Decommission legacy msteams-centric retrieval in answer-critical path

- Remove legacy retrieval as default answer path.
- Keep optional debug comparison mode for regression monitoring.

Exit criteria:

- production path exclusively V2 for in-scope domains
- legacy path retained only for controlled diagnostics if desired

---

## Evaluation and quality gates per stage

For each stage, track:

- answerability correctness (`answered` vs `partial` vs `insufficient_evidence`)
- citation validity rate
- authority-policy compliance (GA/beta, source hierarchy)
- p95 latency by stage
- fallback and rollback behavior

---

## Recommended technology selections (initial)

| Area | Recommendation | Rationale |
|---|---|---|
| Markdown parser | `remark`/`unified` pipeline | Rich AST + mature ecosystem |
| Structured store | SQLite + normalized tables/JSON | Local, deterministic, low ops |
| Lexical index | SQLite FTS5 | Embedded, fast, no extra service |
| Semantic index | Local vector index backed by embedded storage | Avoid distributed infra for desktop POC |
| Embeddings | Hosted embedding API initially | Fast path to quality; can be swapped |
| Reranking | Heuristic fusion first, optional reranker later | Latency and simplicity first |
| MCP client | Official MCP client integration | Clear contract and selective verification |

This intentionally avoids cloud vector services and distributed search infrastructure in early phases.

---

## Unresolved risks

1. Authority conflict resolution complexity across Microsoft domains
2. Latency impact of semantic retrieval and MCP on live meeting UX
3. Citation granularity vs implementation complexity
4. False confidence risk if evidence scoring is poorly calibrated
5. Source update churn and metadata drift across repositories

---

## Human approvals required before implementation

1. Final source hierarchy and policy exceptions
2. Beta/preview inclusion policy and UI disclosure requirements
3. Latency budget targets and timeout behavior for MCP
4. Confidence/refusal thresholds
5. Stage cutover quality gates and rollback criteria

