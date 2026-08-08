# Grounded Generation Reliability (baseline)

- Model: `gpt-4o-mini`
- Total cases: 10
- First-attempt valid: 2
- First-attempt invalid: 8
- Final valid after retry policy: 2
- First generation latency p50/p95 (ms): 6910/11105
- Total stage latency p50/p95 (ms): 6911/11106
- Requests: 10; retries: 0
- Tokens (input/output): 28682/4453

## Failure categories

- missing_mandatory_claim: 30

## Per case

| Case | First valid | Retry used | Final valid | Missing mandatory | Missing caveats |
|---|---:|---:|---:|---:|---:|
| GA-001 | no | no | no | 4 | 0 |
| GA-002 | no | no | no | 3 | 0 |
| GA-003 | no | no | no | 4 | 0 |
| GA-004 | no | no | no | 5 | 0 |
| GA-005 | no | no | no | 5 | 0 |
| GA-006 | yes | no | yes | 0 | 0 |
| GA-007 | no | no | no | 1 | 0 |
| GA-008 | no | no | no | 3 | 0 |
| GA-009 | no | no | no | 5 | 0 |
| GA-010 | yes | no | yes | 0 | 0 |
