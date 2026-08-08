# Grounded Generation Reliability (post_hardening)

- Model: `gpt-4o-mini`
- Total cases: 10
- First-attempt valid: 2
- First-attempt invalid: 8
- Final valid after retry policy: 4
- First generation latency p50/p95 (ms): 5054/8578
- Total stage latency p50/p95 (ms): 11115/18511
- Requests: 19; retries: 6
- Tokens (input/output): 44035/7697

## Failure categories

- missing_mandatory_claim: 19
- schema_invalid: 2

## Per case

| Case | First valid | Retry used | Final valid | Missing mandatory | Missing caveats |
|---|---:|---:|---:|---:|---:|
| GA-001 | no | no | no | 0 | 0 |
| GA-002 | no | yes | no | 3 | 0 |
| GA-003 | yes | no | yes | 0 | 0 |
| GA-004 | no | yes | yes | 4 | 0 |
| GA-005 | no | yes | no | 5 | 0 |
| GA-006 | yes | no | yes | 0 | 0 |
| GA-007 | no | yes | yes | 1 | 0 |
| GA-008 | no | yes | no | 1 | 0 |
| GA-009 | no | yes | no | 5 | 0 |
| GA-010 | no | no | no | 0 | 0 |
