import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerPlan } from "./answerPlanner";
import type { ClaimRealizationProvider } from "./answerGenerator";
import { FakeAnswerGenerator } from "./fakeAnswerGenerator";
import { generateGroundedAnswer } from "./groundedAnswerService";
import type {
  ClaimRealizationTask,
  EvidenceBundle,
  EvidenceItem,
  GroundedAnswer,
  GroundedAnswerResult
} from "./types";
import type { QueryIntent } from "../retrievalV2";
import {
  bindEvidenceBundleSnapshot,
  type EvidenceBundleDecisionState
} from "./groundingDecisionSnapshot";
import { makeTestAspectCoverage } from "./testAspectFixtures";

function makeEvidence(id: string, text: string, supportTypes: EvidenceItem["supportTypes"]): EvidenceItem {
  return {
    evidenceId: id,
    chunkId: `${id}-chunk`,
    documentId: `${id}-doc`,
    source: {
      sourceId: id,
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain: "teams_admin",
      authorityTier: "tier1",
      authorityRoles: [],
      routePriority: "primary",
      title: id,
      canonicalUrl: `https://learn.microsoft.com/${id}`,
      sourcePath: `docs/${id}.md`,
      sourceRevision: { commitSha: "abc" }
    },
    location: { sectionId: "s", headingPath: [id] },
    text,
    supportTypes,
    retrieval: {
      methods: ["semantic"],
      fusionRank: 1,
      fusionScore: 1,
      methodSignals: {
        methods: ["semantic"],
        exact: { matched: false, score: null, rank: null },
        lexical: { score: 0.1, rank: 1 },
        semantic: { similarity: 0.9, rank: 1 }
      },
      exactMatch: null,
      retrievalReasons: ["semantic"]
    },
    selectionReason: "selected"
  };
}

function makeBundle(overrides: Partial<EvidenceBundleDecisionState> = {}): EvidenceBundle {
  const intent: QueryIntent = {
    originalQuestion: "How does Teams Direct Routing voice routing work?",
    normalizedQuestion: "how does teams direct routing voice routing work",
    domains: ["teams_admin"],
    products: ["Microsoft Teams"],
    technologies: ["Direct Routing"],
    entities: ["direct routing"],
    operationIntents: [],
    commandNames: [],
    policyNames: [],
    requiresFreshnessCheck: false,
    allowsBetaSources: false,
    expectedAnswerType: "conceptual",
    retrievalHints: [],
    unresolvedAmbiguity: []
  };
  return bindEvidenceBundleSnapshot({
    question: intent.originalQuestion,
    intent,
    scope: {
      intent,
      selectedDomains: ["teams_admin"],
      focusSubdomains: [],
      eligibleSources: [],
      excludedSources: [],
      sourcePriorityChain: [],
      strategy: { exact: true, lexical: true, semantic: true, semanticPreference: "primary" },
      exactMatchDirectives: [],
      candidateBudget: { maxLexicalCandidates: 64, maxSemanticCandidates: 1300, broadScopeWarningThreshold: 10000 },
      scopeMode: "narrow",
      freshnessVerification: { required: false, reasons: [] },
      betaPolicy: { allowsBeta: false, excludedBetaTracks: [] },
      estimatedCandidatePopulation: 1,
      routingWarnings: [],
      routingRationale: []
    },
    evidence: [
      makeEvidence("ev1", "Direct Routing maps users to routing policies.", ["concept_definition"]),
      makeEvidence("ev2", "Voice routing policy controls PSTN path selection.", ["configuration_behavior"])
    ],
    rejectedCandidates: [],
    conflicts: [],
    freshness: { state: "unknown", requiresVerification: false, reasons: [] },
    exactIdentifierValidation: { required: false, verified: true, requiredDirectives: [], missingRequiredDirectives: [] },
    aspectCoverage: makeTestAspectCoverage({
      evidenceIds: ["ev1", "ev2"]
    }),
    authorityCoverage: { requestedDomains: ["teams_admin"], coveredDomains: ["teams_admin"], missingDomains: [] },
    answerability: "answered",
    diagnostics: {
      latencyMs: { total: 1, selection: 1, conflictDetection: 0, answerability: 0 },
      populations: { candidates: 1, selectedEvidence: 2, rejectedCandidates: 0 },
      policySignals: {
        authoritativeEvidencePresent: true,
        exactIdentifierVerified: true,
        requiredConceptCoverage: true,
        conflictFree: true,
        freshnessOk: true,
        authorityCoverageOk: true,
        provenanceComplete: true
      }
    },
    ...overrides
  });
}

class RecordingProvider implements ClaimRealizationProvider {
  readonly providerId = "recording";
  readonly seen: ClaimRealizationTask[] = [];
  active = 0;
  maxActive = 0;
  constructor(
    private readonly impl: (task: ClaimRealizationTask, attempt: number) => Promise<{ claimId: string; text: string }>
  ) {}
  private readonly attempts = new Map<string, number>();
  async realizeClaim(task: ClaimRealizationTask) {
    this.seen.push(task);
    const next = (this.attempts.get(task.claimId) ?? 0) + 1;
    this.attempts.set(task.claimId, next);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const realization = await this.impl(task, next);
      return { realization, usage: { inputTokens: 1, outputTokens: 1 } };
    } finally {
      this.active -= 1;
    }
  }
}

function requireSuccess(result: GroundedAnswerResult): GroundedAnswer {
  if (!result.ok) throw new Error(result.failure.message);
  assert.equal(result.ok, true);
  return result.answer;
}

test("claim-scoped generation assembles deterministic answer from validated units", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const grounded = requireSuccess(
    await generateGroundedAnswer({ plan, bundle, generator: new FakeAnswerGenerator() })
  );
  assert.equal(grounded.validation.valid, true);
  assert.ok(grounded.answerText.includes("- "));
  assert.ok(grounded.realizedClaims.length > 0);
});

test("provider cannot omit mandatory claims silently; missing claim becomes typed failure", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const provider = new RecordingProvider(async (task, attempt) => {
    if (attempt === 1 && task.claimId === plan.plannedClaims[0]?.claimId) {
      return { claimId: task.claimId, text: "" };
    }
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = await generateGroundedAnswer({
    plan,
    bundle,
    generator: provider,
    options: { claimRetryLimit: 0 }
  });
  assert.equal(grounded.ok, false);
  if (grounded.ok) throw new Error("Expected grounded-answer failure");
  assert.ok(grounded.failure.groundingIssues.some((issue) => issue.code === "claim_generation_failed"));
});

test("wrong claim id is rejected and bounded retry can recover per claim", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const target = plan.plannedClaims[0]?.claimId ?? "";
  const provider = new RecordingProvider(async (task, attempt) => {
    if (task.claimId === target && attempt === 1) return { claimId: "wrong-id", text: task.proposition };
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = requireSuccess(
    await generateGroundedAnswer({
      plan,
      bundle,
      generator: provider,
      options: { claimRetryLimit: 1 }
    })
  );
  assert.equal(grounded.validation.valid, true);
  assert.equal(grounded.diagnostics.retryCount, 1);
});

test("failed mandatory claim fails whole answer and valid claims are not regenerated", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const bad = plan.plannedClaims[0]?.claimId ?? "";
  const provider = new RecordingProvider(async (task) => {
    if (task.claimId === bad) throw new Error("schema");
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = await generateGroundedAnswer({
    plan,
    bundle,
    generator: provider,
    options: { claimRetryLimit: 1 }
  });
  assert.equal(grounded.ok, false);
  const counts = provider.seen.reduce<Record<string, number>>((acc, task) => {
    acc[task.claimId] = (acc[task.claimId] ?? 0) + 1;
    return acc;
  }, {});
  for (const claim of plan.plannedClaims.slice(1)) {
    assert.equal(counts[claim.claimId], 1);
  }
});

test("insufficient evidence bypasses provider and remains safe", async () => {
  const bundle = makeBundle({
    answerability: "insufficient_evidence",
    evidence: [],
    exactIdentifierValidation: {
      required: true,
      verified: false,
      requiredDirectives: [{ type: "cmdlet", value: "Set-CsDefinitelyNotARealCmdlet" }],
      missingRequiredDirectives: [{ type: "cmdlet", value: "Set-CsDefinitelyNotARealCmdlet" }]
    }
  });
  const plan = buildAnswerPlan(bundle);
  const provider = new RecordingProvider(async (task) => ({ claimId: task.claimId, text: task.proposition }));
  const grounded = requireSuccess(await generateGroundedAnswer({ plan, bundle, generator: provider }));
  assert.equal(provider.seen.length, 0);
  assert.equal(grounded.validation.valid, true);
  assert.ok(/couldn't verify/i.test(grounded.answerText));
});

test("caveats and unsupported aspects are rendered by construction for partial", async () => {
  const bundle = makeBundle({
    answerability: "partial",
    authorityCoverage: {
      requestedDomains: ["teams_admin", "entra"],
      coveredDomains: ["teams_admin"],
      missingDomains: ["entra"]
    }
  });
  const plan = buildAnswerPlan(bundle);
  const grounded = requireSuccess(
    await generateGroundedAnswer({ plan, bundle, generator: new FakeAnswerGenerator() })
  );
  assert.equal(grounded.validation.valid, true);
  assert.ok(grounded.caveats.length >= plan.requiredCaveats.length);
  assert.ok(grounded.unsupportedAspects.length >= plan.unsupportedAspects.length);
});

test("section ordering follows AnswerPlan and bounded parallelism is enforced", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const provider = new RecordingProvider(async (task) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = requireSuccess(
    await generateGroundedAnswer({
      plan,
      bundle,
      generator: provider,
      options: { claimConcurrency: 2 }
    })
  );
  assert.equal(grounded.validation.valid, true);
  assert.ok(provider.maxActive <= 2);
  const firstSection = plan.recommendedStructure.orderedSections.find((sectionId) =>
    plan.plannedClaims.some((claim) => claim.sectionId === sectionId)
  );
  if (firstSection && firstSection !== "direct_answer") {
    assert.ok(grounded.answerText.includes(":"));
  }
});
