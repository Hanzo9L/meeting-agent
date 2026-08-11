import assert from "node:assert/strict";
import test from "node:test";
import type { HybridRetrievalResult, FusedRetrievalCandidate } from "../retrievalV2";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { buildAnswerPlan } from "./answerPlanner";
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
import { makeTestAspect } from "./testAspectFixtures";
import type { EvidenceItem } from "./types";

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
