# Vertical Slice Plan

## Objective

Prove the approved architecture end-to-end with one representative Teams Direct Routing / voice-routing question before expanding scope.

## Representative question

"For Teams Direct Routing, what are the required steps and PowerShell checks to assign a voice routing policy to a user?"

## Scope constraints

- Allowed sources: Teams Admin docs + Teams PowerShell docs only.
- No Graph/Entra/M365 broad ingestion in this slice.
- No production expansion beyond this slice until all acceptance checks pass.

## Required pipeline coverage

This vertical slice must exercise each stage with traceable artifacts:

1. `QueryIntent` extraction
2. Domain routing (`teams_admin`, `teams_powershell`, or mixed)
3. Hybrid candidate generation (lexical + exact + bounded semantic)
4. Authority evaluation (AD-01 + AD-02 policy)
5. `EvidenceBundle` assembly
6. `AnswerPlan` claim mapping
7. Grounded answer generation
8. Citation validation
9. Developer/debug trace serialization

## Implementation tasks mapped to this slice

- Retrieval readiness: `WB-12`, `WB-13`, `WB-14`, `WB-15`, `WB-16`
- Answer readiness: `WB-18`, `WB-19`, `WB-20`, `WB-21`
- Verification readiness: `WB-22`, `WB-23`, `WB-24`
- Control and gate readiness: `WB-25`, `WB-26`
- Slice execution and report: `WB-27`

## Acceptance criteria for vertical slice completion

1. Intent and domain correctness
   - `QueryIntent` correctly marks voice-routing/admin intent and freshness sensitivity when asked.
   - Domain router selects Teams Admin + Teams PowerShell retrieval path.
2. Retrieval correctness
   - Candidate set includes relevant policy/procedure docs and cmdlet evidence.
   - Semantic stage proves candidate-bounded behavior (no whole-corpus scan).
3. Evidence and answerability correctness
   - `EvidenceBundle` supports all required claims, or system returns `insufficient_evidence`.
4. Grounded answer correctness
   - Final response content is generated only from evidence-backed claims.
5. Citation correctness
   - Every major claim has valid citation mapping to evidence.
6. Operational resilience
   - MCP timeout/throttle/network-loss tests degrade gracefully.
7. Trace completeness
   - End-to-end trace artifact includes stage timings and decision reasons.

## Tests required

- Unit tests
  - QueryIntent and domain routing policy rules
  - Authority policy and preview gating
  - Citation validator claim mapping checks
- Integration tests
  - End-to-end retrieval + evidence + answer pipeline for representative question
  - MCP fallback scenarios for freshness-required query variant
- Evaluation tests
  - Legacy vs V2 comparison for seed Direct Routing variations
  - Gate-run report generation from measured baselines

## Observability and debugging requirements

- Emit one correlated `requestId` through all stages
- Stage metrics: p50/p95 latency, candidate counts, rejected candidates by rule
- Evidence diagnostics: selected evidence ids, dropped evidence reasons
- Answer diagnostics: answerability class, unsupported claim count
- Citation diagnostics: validity result and issue list
- Verification diagnostics: MCP trigger reason, timeout/fallback outcome

## First implementation milestone definition

Milestone M1 is complete when:

- `WB-01` through `WB-21` are complete and test-passing
- The representative vertical-slice question passes end-to-end in a local developer run
- Debug trace and citation validation artifacts are produced and reviewable
- No architecture exceptions are unresolved

## Initial Teams Admin + Teams PowerShell cutover definition of done

All conditions below must be true:

1. Mandatory quality gates in `QUALITY_GATES.md` pass using measured baselines
2. `WB-25` per-domain/per-intent rollback is verified in a drill
3. `WB-27` vertical slice report is approved
4. Citation validity and unsupported-claim metrics meet cutover gates
5. MCP degradation behavior is verified for freshness-sensitive intents
6. Runbooks exist for incident fallback to legacy path
7. Sign-off packet in `WB-28` is complete and approved

## Architecture exception process for this slice

If any task uncovers a genuine contradiction with accepted AD-01..AD-10:

1. Stop that implementation task
2. Record the contradiction and impacted contracts
3. Open an "Architecture Exception" document for review
4. Resume only after explicit approval
