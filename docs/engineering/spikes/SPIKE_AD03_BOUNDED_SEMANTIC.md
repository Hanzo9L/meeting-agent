# SPIKE AD-03: Bounded Semantic Latency

## Purpose

Validate AD-03 Stage-1 semantic retrieval viability:

- domain/source/metadata scoped candidate pool
- bounded brute-force Float32 similarity
- no ANN dependency in Stage 1

This spike is isolated from production retrieval and meeting-answer runtime wiring.

## Scope

- Deterministic local vector corpus generation (no hosted embeddings)
- SQLite BLOB fetch timing
- Float32 decode timing
- Exact similarity scoring timing
- Top-K selection timing
- Warm vs warm-run observations
- Bounded scenarios and whole-corpus diagnostics

## Tooling

- Benchmark CLI: `npm run spike:retrieval-latency`
- Correctness tests: `npm run test:wb11`
- Artifacts:
  - `eval/runs/wb11-*.json`
  - `eval/runs/wb11-*.md`

## Methodology (implemented)

- Fixed deterministic seed for vector generation.
- Generated normalized Float32 vectors stored as SQLite BLOBs.
- Multiple iterations per scenario with warmup exclusions.
- Per-scenario metrics captured:
  - SQLite candidate fetch
  - vector decode
  - similarity score
  - top-K selection
  - end-to-end semantic stage total
- Candidate counts and dimensions are configurable from CLI.

## Required Interpretation Rule

- Bounded candidate latency is the primary decision signal for AD-03.
- Whole-corpus scans are diagnostic only and must not be treated as intended production behavior.

## Result Summary (latest run)

Artifacts:

- `eval/runs/wb11-2026-08-07T11-28-37-436Z.json`
- `eval/runs/wb11-2026-08-07T11-28-37-436Z.md`

Bounded scenarios (domain/source constrained) using target dimension `1536`:

- `100` candidates: total `p50 2.87ms`, `p95 3.79ms`
- `500` candidates: total `p50 13.42ms`, `p95 19.75ms`
- `1,000` candidates: total `p50 35.36ms`, `p95 36.81ms`
- `2,500` candidates: total `p50 108.33ms`, `p95 122.97ms`
- `5,000` candidates: total `p50 260.58ms`, `p95 282.77ms`
- `10,000` candidates: total `p50 643.67ms`, `p95 667.57ms`

Whole-corpus diagnostics (`1536` dimensions):

- `25,000` candidates: total `p50 773.83ms`, `p95 862.76ms`
- `50,000` candidates: total `p50 1712.59ms`, `p95 1785.79ms`

Observations:

- At realistic bounded sizes up to low-thousands, Stage-1 brute-force remains in interactive territory.
- At 10k bounded candidates, semantic-stage latency rises substantially and becomes sensitive to end-to-end budget composition.
- Whole-corpus brute-force is significantly slower and should remain diagnostic only.

Recommendation:

- Keep AD-03 Stage-1 architecture (bounded brute-force after routing/filtering).
- Treat strong candidate narrowing as mandatory for interactive UX.
- No ANN is required now based on bounded results, but ANN readiness should remain planned if bounded sets routinely approach 10k+ on target hardware.
