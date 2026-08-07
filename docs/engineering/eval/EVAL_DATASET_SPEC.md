# Evaluation Dataset Spec (WB-03)

## Purpose

Define a version-controlled, extensible dataset format for baseline evaluation of the current legacy retrieval/answer path.

This dataset is for measurement, not training.

## File format

- Storage format: JSONL
- One question record per line
- UTF-8, newline-delimited JSON objects
- Stable IDs are mandatory and never reused for a different question

## Initial dataset file

- `eval/datasets/teams-admin-powershell.seed.jsonl`

## Record schema (v1)

```json
{
  "schemaVersion": "1.0",
  "questionId": "Q-001",
  "question": "For Teams Direct Routing, what are the required steps and PowerShell checks to assign a voice routing policy to a user?",
  "expectedDomain": "teams_admin",
  "expectedIntent": "procedural",
  "expectedSourceDomains": ["teams_admin", "teams_powershell"],
  "requiredConcepts": ["Direct Routing", "voice routing policy", "PowerShell verification"],
  "prohibitedClaims": ["Invented cmdlets", "Tenant-specific assumptions"],
  "knownSourceHints": [
    "https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing"
  ],
  "evaluationNotes": "Representative vertical-slice baseline question."
}
```

## Field definitions

- `schemaVersion`: dataset schema version string, currently `1.0`
- `questionId`: stable identifier (`Q-###` in initial seed)
- `question`: plain-language question text
- `expectedDomain`: expected primary domain label
- `expectedIntent`: expected intent class
- `expectedSourceDomains`: one or more expected source domains for authoritative retrieval
- `requiredConcepts`: concepts/facts expected to appear in a good answer
- `prohibitedClaims`: claims that should not appear
- `knownSourceHints`: optional URLs/paths that are likely relevant
- `evaluationNotes`: freeform evaluator context

## Validation requirements

- `questionId` must match `^Q-[0-9]{3}$` for seed set
- IDs must be unique
- `question` must be non-empty
- `expectedSourceDomains`, `requiredConcepts`, and `prohibitedClaims` must be arrays
- `schemaVersion` must be `1.0` for this baseline run

## Extension policy

- Additive fields are allowed in future versions.
- Existing fields should remain backward compatible.
- Record IDs must remain stable across revisions.

