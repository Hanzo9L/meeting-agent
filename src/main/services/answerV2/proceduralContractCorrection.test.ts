import assert from "node:assert/strict";
import test from "node:test";
import type { HybridRetrievalResult, FusedRetrievalCandidate } from "../retrievalV2";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { buildAnswerPlan, applyHeadingOperationCorroboration } from "./answerPlanner";
import { validateAnswerPlanIntegrity } from "./answerPlanIntegrity";
import { assembleDeterministicAnswer } from "./deterministicAnswerAssembler";
import { buildEvidenceBundle } from "./evidenceBundleBuilder";
import {
  deriveEvidenceAspects,
  detectMethodConstraints,
  evaluateCandidateAspectSupport
} from "./evidenceAspectPolicy";
import { operationMatchesText } from "./operationMatching";
import { aspectMethodConstraintsSatisfied } from "./methodConstraintPolicy";
import { makeTestAspect, makeTestSubject } from "./testAspectFixtures";
import type { ClaimSourceSpan, EvidenceItem } from "./types";

type CorroborationParams = Parameters<typeof applyHeadingOperationCorroboration>[0];
type TestSpanCandidate = CorroborationParams["candidates"][number];
type TestDraftClaim = CorroborationParams["claims"][number];

function makeUnitSpan(overrides: {
  evidenceId: string;
  sourceField: "text" | "title" | "heading";
  text: string;
  fieldIndex?: number | null;
  sentenceIndex?: number | null;
  sourceId?: string;
  authorityRole?: ClaimSourceSpan["authorityRole"];
}): ClaimSourceSpan {
  const spanId = `span:${overrides.evidenceId}:${overrides.sourceField}:${overrides.fieldIndex ?? overrides.sentenceIndex ?? 0}`;
  return {
    spanId,
    evidenceId: overrides.evidenceId,
    chunkId: `chunk-${overrides.evidenceId}`,
    documentId: `doc-${overrides.evidenceId}`,
    sourceId: overrides.sourceId ?? "ms-teams-admin",
    sourcePath: "path/to/doc.md",
    sectionId: "section-a",
    headingPath: [],
    sourceField: overrides.sourceField,
    fieldIndex: overrides.fieldIndex ?? null,
    sentenceIndex: overrides.sentenceIndex ?? null,
    startOffset: 0,
    endOffset: overrides.text.length,
    text: overrides.text,
    contentHash: `hash-${overrides.evidenceId}-${overrides.sourceField}-${overrides.text}`,
    authorityRole: overrides.authorityRole ?? "teams_admin_primary",
    sourceOrder: 0
  };
}

function makeUnitEvidenceItem(params: {
  evidenceId: string;
  title: string;
  headingPath: string[];
}): EvidenceItem {
  return {
    evidenceId: params.evidenceId,
    chunkId: `chunk-${params.evidenceId}`,
    documentId: `doc-${params.evidenceId}`,
    source: {
      sourceId: "ms-teams-admin",
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain: "teams_admin",
      authorityTier: "tier1",
      authorityRoles: ["teams_admin_primary"],
      routePriority: "primary",
      title: params.title,
      canonicalUrl: "https://learn.microsoft.com/example",
      sourcePath: "path/to/doc.md",
      sourceRevision: {}
    },
    location: {
      sectionId: "section-a",
      headingPath: params.headingPath
    },
    text: "",
    supportTypes: ["configuration_behavior"],
    retrieval: {
      methods: ["semantic"],
      fusionRank: 1,
      fusionScore: 10,
      methodSignals: {
        methods: ["semantic"],
        exact: { matched: false, score: null, rank: null },
        lexical: { score: 0, rank: null },
        semantic: { similarity: 0.8, rank: 1 }
      },
      exactMatch: null,
      retrievalReasons: []
    },
    selectionReason: "test"
  };
}

function makeUnitCandidate(params: {
  evidence: EvidenceItem;
  span: ClaimSourceSpan;
}): TestSpanCandidate {
  return {
    span: params.span,
    evidence: params.evidence,
    normalized: params.span.text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    procedureStep: null
  };
}

function makeUnitClaim(params: {
  aspectId: string;
  coveredFacets: TestDraftClaim["coveredFacets"];
  spans: ClaimSourceSpan[];
}): TestDraftClaim {
  return {
    requiredAspectId: params.aspectId,
    coveredFacets: params.coveredFacets,
    claimType: "configuration",
    sectionId: "configuration",
    proposition: params.spans.find((span) => span.sourceField === "text")?.text ?? "",
    evidenceIds: [...new Set(params.spans.map((span) => span.evidenceId))],
    sourceSpans: params.spans,
    supportStrength: "direct",
    status: "mandatory",
    mandatory: true,
    requiresCaveat: false,
    caveatCodes: [],
    unsupportedAspectIds: [],
    procedureStep: null,
    sourceOrder: 0,
    spanOrder: 0,
    authorityContext: {
      sourceIds: [...new Set(params.spans.map((span) => span.sourceId))],
      routePriorities: ["primary"],
      authorityRoles: [...new Set(params.spans.map((span) => span.authorityRole))]
    }
  };
}

function makeCandidate(params: {
  rank: number;
  sourceId: string;
  title: string;
  text: string;
  url?: string;
  headingPath?: string[];
}): FusedRetrievalCandidate {
  const chunkId = `chunk-${params.rank}-${params.sourceId}`;
  return {
    candidateId: `cand-${chunkId}`,
    method: "semantic",
    documentId: `doc-${params.sourceId}-${params.rank}`,
    chunkId,
    sectionId: "section-a",
    headingPath: params.headingPath ?? ["Overview"],
    title: params.title,
    text: params.text,
    authority: {
      sourceId: params.sourceId,
      trackId: "ga",
      sourceStatus: "ga",
      authorityTier: "tier1",
      authorityRoles:
        params.sourceId === "ms-teams-powershell"
          ? ["teams_powershell_cmdlet_primary"]
          : params.sourceId === "ms-graph-docs"
            ? ["graph_api_primary"]
            : ["teams_admin_primary"],
      routePriority: "primary"
    },
    provenance: {
      sourcePath: "path/to/doc.md",
      canonicalUrl: params.url ?? "https://learn.microsoft.com/example",
      sourceRevision: { transport: "github", commitSha: "abc" },
      headingPath: params.headingPath ?? ["Overview"],
      sectionId: "section-a"
    },
    scores: {
      lexical: 0.2,
      exactMatch: null,
      semanticSimilarity: 0.8
    },
    retrievalReasons: ["semantic_match_signal"],
    methods: ["semantic"],
    methodSignals: {
      methods: ["semantic"],
      exact: { matched: false, score: null, rank: null },
      lexical: { score: 0.2, rank: params.rank },
      semantic: { similarity: 0.8, rank: params.rank }
    },
    fusion: {
      rank: params.rank,
      score: 100 - params.rank,
      contributions: {
        exactScore: 0,
        lexicalRank: 2,
        semanticRank: 3,
        methodAgreement: 0,
        routePriority: 7,
        authorityRole: 6,
        betaPolicy: 0,
        implicitCmdletSpecificity: 0,
        total: 100 - params.rank
      },
      rationale: ["test"]
    },
    sourceDedup: { mergedFromCandidateIds: [] }
  };
}

function hybridFromQuestion(
  question: string,
  candidates: FusedRetrievalCandidate[]
): HybridRetrievalResult {
  const extraction = extractQueryIntent(question);
  const route = routeQueryIntent(extraction.intent);
  const intent = extraction.intent;
  const scope = route.scope;
  return {
    intent,
    scope,
    candidates,
    exact: {
      candidates: [],
      diagnostics: {
        eligiblePopulation: 0,
        matchedPopulation: 0,
        returnedPopulation: 0,
        attempted: [],
        missedRequired: []
      },
      latencyMs: 1
    },
    lexical: {
      candidates: [],
      diagnostics: {
        eligiblePopulation: 0,
        matchedPopulation: 0,
        returnedPopulation: 0,
        lexicalQuery: "",
        queryTerms: []
      },
      latencyMs: 1
    },
    semantic: {
      candidates: [],
      diagnostics: {
        eligiblePopulation: 0,
        preselectedPopulation: 0,
        compatibleEmbeddingPopulation: 0,
        missingEmbeddingCount: 0,
        staleOrIncompatibleEmbeddingCount: 0,
        corruptEmbeddingCount: 0,
        scoredPopulation: 0,
        returnedPopulation: 0,
        configuredSemanticBudget: 1300,
        prefilteredByBudget: false,
        latencyMs: {
          queryEmbedding: 0,
          sqlPreselection: 0,
          sqlEmbeddingMetadata: 0,
          sqlEmbeddingBlobFetch: 0,
          compatibilityCheck: 0,
          sqliteFetch: 0,
          decode: 0,
          scoring: 0,
          topK: 0,
          total: 0
        },
        embeddingIdentity: {
          providerId: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          embeddingSchemaVersion: "v1"
        },
        preselectionReasonCounts: {
          entity_title_shortlist: 0,
          powershell_cmdlet_specificity_shortlist: 0,
          lexical_shortlist: 0,
          powershell_operation_shortlist: 0,
          scope_reserve: 0
        },
        warnings: []
      }
    },
    fusionDiagnostics: {
      exactCandidateCount: 0,
      lexicalCandidateCount: 0,
      semanticCandidateCount: candidates.length,
      uniqueCandidatesBeforeDedup: candidates.length,
      uniqueCandidatesAfterDedup: candidates.length,
      returnedCandidateCount: candidates.length,
      methodOverlapCounts: {
        exactOnly: 0,
        lexicalOnly: 0,
        semanticOnly: candidates.length,
        exactAndLexical: 0,
        exactAndSemantic: 0,
        lexicalAndSemantic: 0,
        allThree: 0
      },
      sourceDistribution: {},
      authorityDistribution: {},
      cap: { finalCandidateCap: 24, maxPerDocument: 4, truncated: false },
      requiredExactMisses: [],
      warnings: []
    },
    diagnostics: {
      exactLatencyMs: 1,
      lexicalLatencyMs: 1,
      semanticLatencyMs: 1,
      fusionLatencyMs: 1,
      totalLatencyMs: 2,
      orchestrationMode: "overlap_semantic_with_exact_lexical"
    },
    warnings: []
  };
}

test("PowerShell as method does not become a peer mandatory aspect", () => {
  const result = hybridFromQuestion(
    "How do I enable a Teams user for voice using PowerShell?",
    []
  );
  const aspects = deriveEvidenceAspects(result);
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1);
  assert.ok(!/powershell/i.test(mandatory[0]!.aspectId));
  assert.ok(
    mandatory[0]!.methodConstraints.some(
      (constraint) => constraint.kind === "powershell" && constraint.required
    )
  );
});

test("Graph as method does not become a peer mandatory aspect", () => {
  const result = hybridFromQuestion("Check this user with Graph.", []);
  const aspects = deriveEvidenceAspects(result);
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1);
  assert.ok(
    !mandatory.some(
      (aspect) =>
        normalizeSubject(aspect.subject) === "microsoft graph" ||
        normalizeSubject(aspect.subject) === "graph"
    )
  );
  assert.ok(
    mandatory[0]!.methodConstraints.some(
      (constraint) => constraint.kind === "graph" && constraint.required
    )
  );
});

function normalizeSubject(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

test("tool-as-subject can still become an aspect", () => {
  const result = hybridFromQuestion("What is PowerShell?", []);
  const aspects = deriveEvidenceAspects(result);
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory.some((aspect) => /powershell/i.test(aspect.subject)));
  assert.equal(
    detectMethodConstraints(result.intent).filter((c) => c.kind === "powershell")
      .length,
    0
  );
});

test("null operation does not require operation facet", () => {
  const result = hybridFromQuestion("How do Teams calling policies work?", []);
  // Force a procedural-like aspect with null op via configuration without ops if needed.
  const aspects = deriveEvidenceAspects(result);
  for (const aspect of aspects) {
    if (aspect.operation === null) {
      assert.ok(!aspect.requiredFacets.includes("operation"));
    }
  }
  const procedureNullOp = makeTestAspect({
    answerObject: "procedure",
    operation: null,
    requiredFacets: ["procedure"]
  });
  assert.ok(!procedureNullOp.requiredFacets.includes("operation"));
});

test("no vacuous R2 operation coverage when operation is null", () => {
  const aspect = makeTestAspect({
    answerObject: "procedure",
    operation: null,
    requiredFacets: ["procedure"],
    subject: "Microsoft Teams",
    subjectTerms: ["teams"],
    subjects: [
      {
        kind: "technology",
        value: "Microsoft Teams",
        terms: ["teams"],
        aliases: ["microsoft teams", "teams"],
        questionSpans: ["teams"]
      }
    ]
  });
  const candidate = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    title: "Enable users for voice",
    text: "To enable voice for your users, use PowerShell."
  });
  const support = evaluateCandidateAspectSupport(
    hybridFromQuestion("How do I enable voice?", [candidate]),
    candidate,
    aspect
  );
  assert.ok(!support.matchedFacets.includes("operation"));
});

test("alias-aware operation binding works for Teams surface form", () => {
  const result = hybridFromQuestion(
    "How do I enable a Teams user for voice using PowerShell?",
    []
  );
  const aspects = deriveEvidenceAspects(result);
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1);
  assert.equal(mandatory[0]!.operation, "enable");
  assert.ok(mandatory[0]!.subjects[0]!.aliases.includes("teams"));
  assert.ok(mandatory[0]!.requiredFacets.includes("operation"));
});

test("true multi-action questions remain multi-aspect", () => {
  const result = hybridFromQuestion(
    "How do I enable voice for users and configure dial plans?",
    []
  );
  const aspects = deriveEvidenceAspects(result);
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.ok(
    mandatory.length >= 2,
    `expected >=2 mandatory aspects, got ${mandatory.map((a) => a.aspectId).join(", ")}`
  );
});

test("method gap produces partial answerability", () => {
  const adminOnly = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    title: "Enable users for voice",
    headingPath: ["Enable users for voice", "Steps"],
    text:
      "Before you can enable voice for your users, assign a license. " +
      "In the Teams admin center, turn Enterprise Voice to On."
  });
  const result = hybridFromQuestion(
    "How do I enable a Teams user for voice using PowerShell?",
    [adminOnly]
  );
  const { bundle } = buildEvidenceBundle(result);
  assert.equal(bundle.answerability, "partial");
  const aspect = bundle.aspectCoverage.aspects.find(
    (entry) => entry.requirement === "mandatory"
  );
  assert.ok(aspect);
  assert.ok(
    !aspectMethodConstraintsSatisfied(
      aspect!,
      bundle.evidence.filter((item) =>
        (bundle.aspectCoverage.evidenceByAspect[aspect!.aspectId] ?? []).includes(
          item.evidenceId
        )
      )
    )
  );
});

test("R3 does not duplicate claims across tool pseudo-subjects", () => {
  const powershell = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-powershell",
    title: "Enable Microsoft Teams users for voice",
    headingPath: ["Microsoft Teams voice", "How to enable users procedure"],
    text:
      "How to enable Microsoft Teams users for voice with PowerShell. " +
      "Use the Set-CsPhoneNumberAssignment procedure steps below.\n" +
      "1. Assign a Teams Phone license first.\n" +
      "2. Run Set-CsPhoneNumberAssignment -Identity user@contoso.com -EnterpriseVoiceEnabled $true."
  });
  const result = hybridFromQuestion(
    "How do I enable a Teams user for voice using PowerShell?",
    [powershell]
  );
  const { bundle } = buildEvidenceBundle(result);
  const plan = buildAnswerPlan(bundle);
  const mandatoryAspectIds = bundle.aspectCoverage.aspects
    .filter((aspect) => aspect.requirement === "mandatory")
    .map((aspect) => aspect.aspectId);
  assert.equal(mandatoryAspectIds.length, 1);
  assert.ok(plan.plannedClaims.length > 0);
  const aspectIds = new Set(
    plan.plannedClaims.map((claim) => claim.requiredAspectId)
  );
  assert.equal(aspectIds.size, 1);
  assert.ok(![...aspectIds].some((id) => /powershell/i.test(id)));
});

test("R3/R4 integrity remains strict for required facets", () => {
  const powershell = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-powershell",
    title: "Enable Microsoft Teams users for voice",
    headingPath: ["Microsoft Teams voice", "How to enable users procedure"],
    text:
      "How to enable Microsoft Teams voice with Set-CsPhoneNumberAssignment -EnterpriseVoiceEnabled $true.\n" +
      "1. Assign Teams licenses.\n2. Enable Enterprise Voice for the Teams user."
  });
  const result = hybridFromQuestion(
    "How do I enable a Teams user for voice using PowerShell?",
    [powershell]
  );
  const { bundle } = buildEvidenceBundle(result);
  assert.ok(bundle.aspectCoverage.supportedMandatoryAspectIds.length > 0);
  const plan = buildAnswerPlan(bundle);
  assert.ok(plan.plannedClaims.length > 0);
  const integrity = validateAnswerPlanIntegrity({ plan, bundle });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, true);
});

test("shared operation matching rejects null and accepts aliases", () => {
  assert.equal(operationMatchesText("enable voice for users", null), false);
  assert.equal(operationMatchesText("enable voice for users", "enable"), true);
  assert.equal(operationMatchesText("assign a phone number", "grant"), true);
  assert.equal(operationMatchesText("list the policies", "get"), true);
});

test("admin-center method constraint attaches without peer aspect", () => {
  const result = hybridFromQuestion(
    "Configure external access in Teams Admin Center.",
    []
  );
  const aspects = deriveEvidenceAspects(result);
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1);
  assert.ok(
    mandatory[0]!.methodConstraints.some(
      (constraint) => constraint.kind === "teams_admin_center"
    )
  );
});

// ---------------------------------------------------------------------------
// P2 — Heading-Corroborated Operation Facet Closure
// ---------------------------------------------------------------------------

test("P2: Conditional-Access-style configuration question — heading-only operation + substantive body configuration yields a valid plan", () => {
  const candidate = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    title: "Configure meeting policies for external users",
    headingPath: ["Meeting policies", "Configure lobby settings"],
    text:
      "External users stay in the meeting lobby according to policy until an organizer admits them."
  });
  const result = hybridFromQuestion(
    "How would I configure a Teams meeting policy to require a lobby for external users?",
    [candidate]
  );
  const { bundle } = buildEvidenceBundle(result);
  assert.equal(bundle.answerability, "answered");
  const aspect = bundle.aspectCoverage.aspects.find(
    (entry) => entry.requirement === "mandatory"
  );
  assert.ok(aspect);
  assert.deepEqual([...aspect!.requiredFacets].sort(), ["configuration", "operation"]);

  const plan = buildAnswerPlan(bundle);
  const coverage = plan.diagnostics.facetCoverage.find(
    (entry) => entry.aspectId === aspect!.aspectId
  );
  assert.ok(coverage);
  assert.deepEqual(coverage!.missingFacets, []);

  const operationClaim = plan.plannedClaims.find((claim) =>
    claim.coveredFacets.includes("operation")
  );
  assert.ok(operationClaim, "expected a claim covering the operation facet");
  assert.ok(
    operationClaim!.sourceSpans.some(
      (span) => span.sourceField === "heading" && /configure/i.test(span.text)
    ),
    "operation facet must be corroborated by the heading span"
  );
  assert.ok(
    operationClaim!.sourceSpans.some((span) => span.sourceField === "text"),
    "the claim must retain its substantive body evidence, not just the heading"
  );
  // No synthetic prose: proposition remains the original body sentence.
  assert.equal(
    operationClaim!.proposition,
    "External users stay in the meeting lobby according to policy until an organizer admits them."
  );

  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, true);
});

test("P2: app-registration-style procedure question — heading-only 'grant' operation + substantive body procedure yields a valid plan", () => {
  const candidate = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    title: "Register and configure a custom Teams app",
    headingPath: ["Register a Teams app", "Grant API access to your app"],
    text:
      "In this step, open the Teams admin center and select App management. " +
      "Select Actions, and then choose Upload a custom app. " +
      "Browse to your app package and select Open to upload it."
  });
  const result = hybridFromQuestion(
    "How do I register a Teams app and grant it API access?",
    [candidate]
  );
  const { bundle } = buildEvidenceBundle(result);
  assert.equal(bundle.answerability, "answered");
  const plan = buildAnswerPlan(bundle);
  const aspect = bundle.aspectCoverage.aspects.find(
    (entry) => entry.requirement === "mandatory"
  );
  assert.ok(aspect);
  const coverage = plan.diagnostics.facetCoverage.find(
    (entry) => entry.aspectId === aspect!.aspectId
  );
  assert.ok(coverage);
  assert.deepEqual(coverage!.missingFacets, []);

  const procedureClaims = plan.plannedClaims.filter(
    (claim) => claim.requiredAspectId === aspect!.aspectId
  );
  assert.ok(procedureClaims.length > 0);
  // Ordered procedure body remains intact — no fabricated operation sentence inserted.
  assert.ok(
    procedureClaims.every(
      (claim) => !/grant/i.test(claim.proposition) || claim.proposition.includes("Grant")
    )
  );
  const operationClaim = procedureClaims.find((claim) =>
    claim.coveredFacets.includes("operation")
  );
  assert.ok(operationClaim, "expected a claim covering the operation facet");
  assert.ok(
    operationClaim!.sourceSpans.some(
      (span) => span.sourceField === "heading" && /grant/i.test(span.text)
    )
  );
  assert.ok(operationClaim!.sourceSpans.some((span) => span.sourceField === "text"));

  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, true);
});

test("P2: heading-only operation with zero substantive body evidence still fails closed", () => {
  const candidate = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    title: "Configure meeting policies for external users",
    headingPath: ["Meeting policies", "Configure lobby settings"],
    text: "Meetings help teams communicate every day across the organization."
  });
  const result = hybridFromQuestion(
    "How would I configure a Teams meeting policy to require a lobby for external users?",
    [candidate]
  );
  const { bundle } = buildEvidenceBundle(result);
  // R2's own aggregated-context matching may still call this "answered" (both
  // facets are heading-derived); R3 must not fabricate a plan from that alone.
  assert.equal(bundle.answerability, "answered");
  const plan = buildAnswerPlan(bundle);
  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, false);
  assert.ok(
    integrity.issues.some((issue) => issue.code === "required_facet_unplanned")
  );
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, false);
});

test("P2: title-only operation signal does not receive the heading exception", () => {
  const aspect = makeTestAspect({
    operation: "set",
    requiredFacets: ["configuration", "operation"],
    answerObject: "configuration_behavior",
    subject: "meeting policy",
    subjectTerms: ["meeting", "policy"],
    subjects: [makeTestSubject("policy", "meeting policy", ["meeting", "policy"])]
  });
  const evidence = makeUnitEvidenceItem({
    evidenceId: "evidence:a",
    title: "Configure meeting policy settings",
    headingPath: ["Meeting policies", "External participant settings"]
  });
  const bodySpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "text",
    sentenceIndex: 0,
    text: "External users remain subject to the meeting policy at all times."
  });
  const titleSpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "title",
    text: "Configure meeting policy settings"
  });
  const claims: TestDraftClaim[] = [
    makeUnitClaim({
      aspectId: aspect.aspectId,
      coveredFacets: ["configuration"],
      spans: [bodySpan]
    })
  ];
  const candidates = [
    makeUnitCandidate({ evidence, span: bodySpan }),
    makeUnitCandidate({ evidence, span: titleSpan })
  ];
  const result = applyHeadingOperationCorroboration({ aspect, candidates, claims });
  assert.deepEqual(result, claims);
  assert.ok(!result[0]!.coveredFacets.includes("operation"));
});

test("P2: heading operation must match the bound operation alias", () => {
  const aspect = makeTestAspect({
    operation: "grant",
    requiredFacets: ["procedure", "operation"],
    answerObject: "procedure",
    subject: "Microsoft Teams",
    subjectTerms: ["teams"],
    subjects: [makeTestSubject("technology", "Microsoft Teams", ["teams"])]
  });
  const evidence = makeUnitEvidenceItem({
    evidenceId: "evidence:a",
    title: "Manage Teams voice routing",
    headingPath: ["Voice routing", "Review dial plan settings"]
  });
  const bodySpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "text",
    sentenceIndex: 0,
    text: "Select the Teams admin center to review the current dial plan."
  });
  const unrelatedHeadingSpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "heading",
    fieldIndex: 1,
    text: "Review dial plan settings"
  });
  const claims: TestDraftClaim[] = [
    makeUnitClaim({
      aspectId: aspect.aspectId,
      coveredFacets: ["procedure"],
      spans: [bodySpan]
    })
  ];
  const candidates = [
    makeUnitCandidate({ evidence, span: bodySpan }),
    makeUnitCandidate({ evidence, span: unrelatedHeadingSpan })
  ];
  const result = applyHeadingOperationCorroboration({ aspect, candidates, claims });
  assert.deepEqual(result, claims);
});

test("P2: heading from an unrelated evidence item cannot corroborate another evidence item's claim", () => {
  const aspect = makeTestAspect({
    operation: "set",
    requiredFacets: ["configuration", "operation"],
    answerObject: "configuration_behavior",
    subject: "meeting policy",
    subjectTerms: ["meeting", "policy"],
    subjects: [makeTestSubject("policy", "meeting policy", ["meeting", "policy"])]
  });
  const evidenceA = makeUnitEvidenceItem({
    evidenceId: "evidence:a",
    title: "Meeting policy overview",
    headingPath: ["Meeting policies", "General overview"]
  });
  const evidenceB = makeUnitEvidenceItem({
    evidenceId: "evidence:b",
    title: "Legacy meeting policy settings",
    headingPath: ["Legacy meeting settings", "Configure legacy dial settings"]
  });
  const substantiveBodySpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "text",
    sentenceIndex: 0,
    text: "The meeting policy controls lobby behavior for external participants."
  });
  // evidence:a's own heading has no operation signal.
  const evidenceAHeadingSpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "heading",
    fieldIndex: 1,
    text: "General overview"
  });
  // evidence:b's heading matches the operation, but belongs to a different
  // evidence item and must not be used to corroborate evidence:a's claim.
  const evidenceBHeadingSpan = makeUnitSpan({
    evidenceId: "evidence:b",
    sourceField: "heading",
    fieldIndex: 1,
    text: "Configure legacy dial settings"
  });
  const claims: TestDraftClaim[] = [
    makeUnitClaim({
      aspectId: aspect.aspectId,
      coveredFacets: ["configuration"],
      spans: [substantiveBodySpan]
    })
  ];
  const candidates = [
    makeUnitCandidate({ evidence: evidenceA, span: substantiveBodySpan }),
    makeUnitCandidate({ evidence: evidenceA, span: evidenceAHeadingSpan }),
    makeUnitCandidate({ evidence: evidenceB, span: evidenceBHeadingSpan })
  ];
  const result = applyHeadingOperationCorroboration({ aspect, candidates, claims });
  assert.deepEqual(result, claims);
  assert.ok(!result[0]!.coveredFacets.includes("operation"));
});

test("P2: exact source-bound provenance is preserved on heading corroboration", () => {
  const aspect = makeTestAspect({
    operation: "grant",
    requiredFacets: ["procedure", "operation"],
    answerObject: "procedure",
    subject: "Microsoft Teams",
    subjectTerms: ["teams"],
    subjects: [makeTestSubject("technology", "Microsoft Teams", ["teams"])]
  });
  const evidence = makeUnitEvidenceItem({
    evidenceId: "evidence:a",
    title: "Register a Teams app",
    headingPath: ["Register a Teams app", "Grant API access to your app"]
  });
  const bodySpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "text",
    sentenceIndex: 0,
    text: "Select Add a permission, and then select Microsoft APIs and Microsoft Graph."
  });
  const headingSpan = makeUnitSpan({
    evidenceId: "evidence:a",
    sourceField: "heading",
    fieldIndex: 1,
    text: "Grant API access to your app"
  });
  const claims: TestDraftClaim[] = [
    makeUnitClaim({
      aspectId: aspect.aspectId,
      coveredFacets: ["procedure"],
      spans: [bodySpan]
    })
  ];
  const candidates = [
    makeUnitCandidate({ evidence, span: bodySpan }),
    makeUnitCandidate({ evidence, span: headingSpan })
  ];
  const result = applyHeadingOperationCorroboration({ aspect, candidates, claims });
  assert.equal(result[0]!.coveredFacets.includes("operation"), true);
  const addedSpan = result[0]!.sourceSpans.find(
    (span) => span.sourceField === "heading"
  );
  assert.ok(addedSpan);
  // Exact provenance carried through unmodified — no synthetic prose.
  assert.deepEqual(addedSpan, headingSpan);
  assert.equal(addedSpan!.evidenceId, "evidence:a");
  assert.equal(addedSpan!.text, "Grant API access to your app");
  assert.equal(addedSpan!.contentHash, headingSpan.contentHash);
  assert.equal(addedSpan!.authorityRole, headingSpan.authorityRole);
  // Proposition is untouched — the heading never becomes synthetic prose.
  assert.equal(result[0]!.proposition, bodySpan.text);
});

test("P2 regression: Teams voice/PowerShell operation facet remains body-sourced (heading corroboration not needed)", () => {
  const powershell = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-powershell",
    title: "Enable Microsoft Teams users for voice",
    headingPath: ["Microsoft Teams voice", "How to enable users procedure"],
    text:
      "How to enable Microsoft Teams voice with Set-CsPhoneNumberAssignment -EnterpriseVoiceEnabled $true.\n" +
      "1. Assign Teams licenses.\n2. Enable Enterprise Voice for the Teams user."
  });
  const result = hybridFromQuestion(
    "How do I enable a Teams user for voice using PowerShell?",
    [powershell]
  );
  const { bundle } = buildEvidenceBundle(result);
  const plan = buildAnswerPlan(bundle);
  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const operationClaim = plan.plannedClaims.find((claim) =>
    claim.coveredFacets.includes("operation")
  );
  assert.ok(operationClaim);
  assert.ok(
    operationClaim!.sourceSpans.every((span) => span.sourceField === "text"),
    "P1-era fixture already satisfies the operation facet from body text; P2 must not alter it"
  );
});

test("P2 regression: voice routing policy question remains valid and unaffected", () => {
  const candidate = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    title: "Create a new voice routing policy",
    headingPath: ["Voice routing policies", "Create a policy"],
    text:
      "As the first step, create the voice routing policy cmdlet and specify " +
      "a policy identity value using PowerShell."
  });
  const result = hybridFromQuestion(
    "How do I create a new voice routing policy for Teams?",
    [candidate]
  );
  const { bundle } = buildEvidenceBundle(result);
  assert.equal(bundle.answerability, "answered");
  const plan = buildAnswerPlan(bundle);
  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const operationClaim = plan.plannedClaims.find((claim) =>
    claim.coveredFacets.includes("operation")
  );
  assert.ok(operationClaim);
  assert.ok(
    operationClaim!.sourceSpans.every((span) => span.sourceField === "text"),
    "body text already satisfies the operation facet; heading corroboration must not be needed"
  );
});

test("P2 regression: unresolved-domain question remains fail-closed with no claims planned", () => {
  const result = hybridFromQuestion("How do I configure calling policies?", []);
  const { bundle } = buildEvidenceBundle(result);
  assert.equal(bundle.answerability, "insufficient_evidence");
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.plannedClaims.length, 0);
  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
});
