# Answer Contract

## 1) Evidence boundary before generation

The LLM must not receive uncontrolled retrieval dumps.

```typescript
interface EvidenceBundle {
  question: string;
  intent: QueryIntent;
  evidence: EvidenceItem[];
  conflicts: EvidenceConflict[];
  freshnessStatus: "current" | "possibly_stale" | "stale" | "unknown";
  answerability: "answered" | "partial" | "insufficient_evidence";
}

interface EvidenceItem {
  evidenceId: string;
  source: {
    repository: string;
    branch: string;
    filePath: string;
    commitSha: string;
    learnUrl?: string;
    authorityTier: "tier1" | "secondary";
    sourceDomain: string;
    sourceStatus: "ga" | "beta" | "preview" | "unknown";
  };
  location: {
    headingPath: string[];
    sectionId: string;
  };
  text: string;
  supportLevel: "direct" | "partial" | "contextual";
}
```

---

## Contract reconciliation note

This contract aligns with accepted AD-07 and the approved WB-18 work breakdown:

- `EvidenceBundle.answerability` uses `answered | partial | insufficient_evidence`
- `EvidenceBundle` does not include a global numeric confidence field

Interpretability is provided by explicit evidence conditions (authority, coverage, freshness, conflicts, exact-identifier validation, and provenance completeness) rather than a guessed global threshold.

---

## 2) Deterministic answer planning

Generation should follow an explicit plan.

```typescript
interface AnswerPlan {
  intentType:
    | "conceptual"
    | "procedural"
    | "troubleshooting"
    | "configuration"
    | "comparison"
    | "reference";
  requiredClaims: PlannedClaim[];
  optionalClaims: PlannedClaim[];
  responseStyle: {
    format: "bullets" | "steps" | "short_paragraphs";
    maxSections: number;
  };
  caveats: string[];
}

interface PlannedClaim {
  claimId: string;
  summary: string;
  supportingEvidenceIds: string[];
  mustBeVerifiedFresh: boolean;
}
```

LLM task:

- realize claims in plan
- avoid unsupported claims
- include caveats/refusal when planned

---

## 3) Grounded answer output contract

```typescript
interface GroundedAnswer {
  answer: string;
  citations: Citation[];
  confidence: number;
  caveats: string[];
  sourceDomains: string[];
  freshnessVerified: boolean;
  status: "answered" | "partial" | "insufficient_evidence";
}

interface Citation {
  citationId: string;
  evidenceId: string;
  repository: string;
  branch: string;
  filePath: string;
  sectionPath: string[];
  url: string;
}
```

---

## 4) Citation validation contract

```typescript
interface CitationValidationResult {
  valid: boolean;
  issues: CitationIssue[];
}

interface CitationIssue {
  type:
    | "missing_evidence_reference"
    | "unknown_citation_source"
    | "citation_not_in_bundle"
    | "beta_used_without_permission";
  citationId?: string;
  message: string;
}
```

Hard rule:

- citation validation fails if a cited source is not present in `EvidenceBundle`

---

## 5) Refusal / insufficient-evidence policy

The system should refuse or caveat when:

- no authoritative source evidence found
- material source conflict unresolved
- requested detail unsupported by available evidence
- tenant-specific data is required but unavailable
- command/parameter not found in authoritative sources
- freshness cannot be verified when required

Refusal should be calibrated:

- avoid hallucination
- avoid blanket refusal when partial evidence supports a caveated answer

---

## 6) Session context policy

For this phase, only minimal live-session context is used:

- current question
- prior answer
- nearby transcript referents
- active topic/domain hints

Context usage constraints:

- transcript context can disambiguate intent
- transcript context cannot serve as technical evidence
- authoritative evidence always wins over conversational assumptions

---

## 7) LLM adapter boundary

Model choice is adapter-level, not architecture-defining.

```typescript
interface LlmAdapter {
  generateGroundedAnswer(
    bundle: EvidenceBundle,
    plan: AnswerPlan,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<GroundedAnswerDraft>;
}

interface GroundedAnswerDraft {
  answer: string;
  citations: Citation[];
  caveats: string[];
}
```

This permits model swaps without changing retrieval/evidence architecture.

---

## 8) Human approvals required before implementation

1. Final refusal-language policy for user-facing UX
2. Confidence calculation method for `GroundedAnswer.confidence`
3. Citation granularity requirement (section-level vs chunk-level)
4. Required claim coverage threshold before `status=answered`

