# Critical Path

This file maps ordered execution and dependencies for `WB-01..WB-28` in `WORK_BREAKDOWN.md`.

## Critical path sequence

1. `WB-01` Architecture lock and engineering scaffold
2. `WB-03` Evaluation dataset + legacy baseline harness
3. `WB-05` Source registry
4. `WB-06` Repo sync adapters
5. `WB-07` Canonical parser
6. `WB-08` SQLite schema/store
7. `WB-09` Embedding provider + binary persistence metadata
8. `WB-11` AD-03 bounded semantic latency spike
9. `WB-12` QueryIntent extractor
10. `WB-13` Domain router
11. `WB-14` Lexical/exact retrieval
12. `WB-15` Bounded semantic scorer adapter
13. `WB-16` Hybrid fusion + authority policy
14. `WB-18` EvidenceBundle + answerability
15. `WB-19` AnswerPlan claim mapping
16. `WB-20` Grounded answer generation adapter
17. `WB-21` Citation validator
18. `WB-22` MCP trigger policy
19. `WB-23` Concurrent local+MCP orchestration with graceful fallback
20. `WB-24` MCP cache/resilience controls
21. `WB-17` Side-by-side eval report (must include V2 path maturity)
22. `WB-25` Domain/intent cutover controller
23. `WB-26` Quality gate executor from measured baselines
24. `WB-27` Vertical slice rehearsal report
25. `WB-28` Cutover DoD packet and approval

## Work that can run safely in parallel

- Parallel set P1 (after `WB-01`): `WB-02`, `WB-03`, `WB-05`
- Parallel set P2 (after `WB-06`): `WB-07` and sync hardening branch of `WB-06`
- Parallel set P3 (after `WB-08`): `WB-09` and schema migration test hardening
- Parallel set P4 (after `WB-12`): `WB-13` and MCP trigger policy skeleton in `WB-22`
- Parallel set P5 (after `WB-16`): `WB-17` and `WB-18`
- Parallel set P6 (after `WB-19`): `WB-20` and partial `WB-21` validator scaffolding
- Parallel set P7 (after `WB-23`): `WB-24` and cutover-controller scaffolding in `WB-25`

## Technical spikes required before production implementation

1. `WB-11` AD-03 bounded semantic latency spike
   - Must prove candidate-bounded brute-force viability without full-corpus scans.
2. Packaging spike (part of `WB-08` + `WB-09`)
   - Must prove SQLite/FTS5/embedding persistence behavior in Electron Windows packaging path.
3. MCP resilience spike (part of `WB-23` + `WB-24`)
   - Must prove timeout/throttle/network-loss fallback and cache behavior.

## First implementation milestone

Milestone M1: "Architecture-Proving Vertical Slice Ready"

- Required completion: `WB-01` through `WB-21`
- Outcome: Local retrieval + evidence + answer + citation contracts are implemented and testable for Teams Admin + Teams PowerShell, before production cutover.
- Why this is first: It proves architecture and contract integrity before broad corpus expansion.

## First end-to-end vertical slice

- Work item: `WB-27`
- Representative question: "For Teams Direct Routing, what are the required steps and PowerShell checks to assign a voice routing policy to a user?"
- Required exercised chain:
  - QueryIntent
  - Domain Router
  - Teams Admin + Teams PowerShell retrieval
  - Hybrid candidate generation
  - Authority evaluation
  - EvidenceBundle
  - AnswerPlan
  - Grounded LLM response
  - Citation validation
  - Developer/debug trace

## Architecture exceptions

- None identified at planning time.
- If a contradiction appears during implementation, stop that task and raise an "Architecture Exception" record before design changes.
