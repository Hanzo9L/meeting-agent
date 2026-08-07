# Quality Gates

This document operationalizes AD-10 using measured baselines and evaluation artifacts.

## Policy lock

- Quality gates are mandatory for cutover.
- Numeric thresholds must come from measured legacy + V2 baseline runs on the evaluation corpus.
- No planning-time invented thresholds are allowed.
- Cutover and rollback must be executable by domain/intent, not only by one global switch.

## Gate dimensions

For each `(domain, intent)` cutover candidate:

1. Retrieval quality gate
2. Citation validity gate
3. Unsupported-claim gate
4. Answerability correctness gate
5. Latency gate
6. Reliability/error gate
7. MCP degradation gate (for freshness-sensitive intents)

## Data sources

- Baseline artifact: legacy pipeline run (`WB-03`)
- V2 artifact: side-by-side evaluation runs (`WB-17`)
- Vertical slice artifact: end-to-end runbook (`WB-27`)
- Production-like drill artifact: rollback rehearsal (`WB-25`, `WB-28`)

## Gate computation model

## 1) Retrieval quality gate

- Metric inputs:
  - top-k relevance judgments on evaluation set
  - authority-policy compliance rate
- Threshold source:
  - derived from baseline and target improvement delta observed in evaluation runs
- Pass condition:
  - V2 meets or exceeds approved measured target for the cutover domain/intent

## 2) Citation validity gate

- Metric inputs:
  - citation-to-evidence mapping validity rate
  - invalid citation count by severity
- Threshold source:
  - derived from baseline and expected reliability for in-scope domain
- Pass condition:
  - citation validity meets measured target with no critical validation failures

## 3) Unsupported-claim gate

- Metric inputs:
  - unsupported claims per answer
  - false `answered` rate on insufficient-evidence cases
- Threshold source:
  - derived from baseline error profile and risk tolerance
- Pass condition:
  - unsupported-claim and false-answered rates are below measured limits

## 4) Answerability correctness gate

- Metric inputs:
  - classification accuracy for `answered` / `partial` / `insufficient_evidence`
- Threshold source:
  - derived from labeled evaluation set outcomes
- Pass condition:
  - classification metrics meet approved measured target

## 5) Latency gate

- Metric inputs:
  - p50/p95 total latency and stage-level latency
- Threshold source:
  - measured legacy latency baseline plus approved budget envelope
- Pass condition:
  - p95 total and key stage latencies are within approved measured budget

## 6) Reliability/error gate

- Metric inputs:
  - error rate by stage
  - crash/regression incidents
- Threshold source:
  - measured legacy stability baseline
- Pass condition:
  - no material reliability regression and bounded failure rates

## 7) MCP degradation gate (freshness-sensitive intents)

- Metric inputs:
  - timeout fallback success rate
  - throttle/network-loss graceful degradation success
  - correctness when MCP unavailable
- Threshold source:
  - measured resilience tests from `WB-23` and `WB-24`
- Pass condition:
  - fallback behavior remains within approved quality/latency envelope

## Evaluation to cutover traceability

Each gate report must include:

- Architecture decisions involved (`AD-xx`)
- Contract clauses validated
- Work items producing the evidence (`WB-xx`)
- Test artifacts and run ids
- Domain/intent cutover recommendation (`pass`, `hold`, `rollback`)

## Cutover and rollback mechanics

- Cutover unit: specific `(domain, intent)` tuple
- Rollback unit: same `(domain, intent)` tuple
- Required controls:
  - immediate runtime switch to legacy path
  - dual logging retained during rollout window
  - post-rollback diff report generated automatically

## Required outputs before initial cutover

1. Baseline report for legacy path
2. Side-by-side V2 comparison report
3. Vertical slice acceptance report
4. Domain/intent gate report with pass/fail rationale
5. Rollback rehearsal report

## Ownership and sign-off

- Engineering owner: produces gate reports and artifacts
- Architecture owner: validates AD/contract compliance
- Product owner: approves domain/intent cutover decision

No initial Teams Admin + Teams PowerShell cutover occurs until all mandatory gates pass and sign-offs are complete.
