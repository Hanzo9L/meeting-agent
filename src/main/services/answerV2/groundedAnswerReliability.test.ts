import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerPlan } from "./answerPlanner";
import type { ClaimRealizationProvider } from "./answerGenerator";
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
    evidence: [makeEvidence("ev-direct", "Direct Routing routes voice via policies.", ["concept_definition"])],
    rejectedCandidates: [],
    conflicts: [],
    freshness: { state: "unknown", requiresVerification: false, reasons: [] },
    exactIdentifierValidation: { required: false, verified: true, requiredDirectives: [], missingRequiredDirectives: [] },
    aspectCoverage: makeTestAspectCoverage({
      evidenceIds: ["ev-direct"]
    }),
    authorityCoverage: { requestedDomains: ["teams_admin"], coveredDomains: ["teams_admin"], missingDomains: [] },
    answerability: "answered",
    diagnostics: {
      latencyMs: { total: 1, selection: 1, conflictDetection: 0, answerability: 0 },
      populations: { candidates: 1, selectedEvidence: 1, rejectedCandidates: 0 },
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

class SequenceGenerator implements ClaimRealizationProvider {
  readonly providerId = "sequence";
  readonly calls: Array<{ task: ClaimRealizationTask; correction?: unknown }> = [];
  private readonly attempts = new Map<string, number>();
  constructor(
    private readonly impl: (task: ClaimRealizationTask, attempt: number) => Promise<{ claimId: string; text: string }>
  ) {}
  async realizeClaim(task: ClaimRealizationTask, _context: unknown, options?: { correction?: unknown }) {
    const attempt = (this.attempts.get(task.claimId) ?? 0) + 1;
    this.attempts.set(task.claimId, attempt);
    this.calls.push({ task, correction: options?.correction });
    const realization = await this.impl(task, attempt);
    return { realization, usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

function requireSuccess(result: GroundedAnswerResult): GroundedAnswer {
  if (!result.ok) throw new Error(result.failure.message);
  assert.equal(result.ok, true);
  return result.answer;
}

test("missing mandatory claim triggers invalidation", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const skip = plan.plannedClaims[0]?.claimId ?? "";
  const generator = new SequenceGenerator(async (task) => {
    if (task.claimId === skip) return { claimId: task.claimId, text: "" };
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = await generateGroundedAnswer({ plan, bundle, generator, options: { claimRetryLimit: 0 } });
  assert.equal(grounded.ok, false);
  if (grounded.ok) throw new Error("Expected grounded-answer failure");
  assert.ok(grounded.failure.groundingIssues.some((issue) => issue.code === "claim_generation_failed"));
});

test("corrective retry receives validator issues and can restore claim coverage", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const target = plan.plannedClaims[0]?.claimId ?? "";
  const generator = new SequenceGenerator(async (task, attempt) => {
    if (task.claimId === target && attempt === 1) return { claimId: "wrong", text: task.proposition };
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = requireSuccess(
    await generateGroundedAnswer({ plan, bundle, generator, options: { claimRetryLimit: 1 } })
  );
  assert.equal(grounded.validation.valid, true);
  const correctionCall = generator.calls.find((call) => call.task.claimId === target && call.correction);
  assert.ok(correctionCall);
  const correction = correctionCall?.correction as { issues?: Array<{ code: string }> } | undefined;
  assert.ok(correction);
  assert.ok(correction?.issues?.some((issue) => issue.code === "wrong_claim_id"));
});

test("only one retry is allowed and invalid second attempt fails closed", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const target = plan.plannedClaims[0]?.claimId ?? "";
  const generator = new SequenceGenerator(async (task) => {
    if (task.claimId === target) return { claimId: "wrong", text: task.proposition };
    return { claimId: task.claimId, text: task.proposition };
  });
  const grounded = await generateGroundedAnswer({ plan, bundle, generator, options: { claimRetryLimit: 1 } });
  const attemptsForTarget = generator.calls.filter((call) => call.task.claimId === target).length;
  assert.equal(attemptsForTarget, 2);
  assert.equal(grounded.ok, false);
});

test("missing caveat can trigger corrective retry", async () => {
  const bundle = makeBundle({
    answerability: "partial",
    authorityCoverage: {
      requestedDomains: ["teams_admin", "entra"],
      coveredDomains: ["teams_admin"],
      missingDomains: ["entra"]
    }
  });
  const plan = buildAnswerPlan(bundle);
  const generator = new SequenceGenerator(async (task) => ({ claimId: task.claimId, text: task.proposition }));
  const grounded = requireSuccess(
    await generateGroundedAnswer({ plan, bundle, generator, options: { claimRetryLimit: 1 } })
  );
  assert.equal(grounded.validation.valid, true);
  assert.ok(grounded.caveats.some((caveat) => caveat.code === "partial_coverage"));
});

test("unknown claim cannot pass", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const generator = new SequenceGenerator(async (task) => ({ claimId: `${task.claimId}-wrong`, text: "x" }));
  const grounded = await generateGroundedAnswer({ plan, bundle, generator, options: { claimRetryLimit: 0 } });
  assert.equal(grounded.ok, false);
  if (grounded.ok) throw new Error("Expected grounded-answer failure");
  assert.ok(grounded.failure.groundingIssues.some((issue) => issue.code === "claim_generation_failed"));
});

test("insufficient-evidence output cannot gain technical claims on retry", async () => {
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
  const generator = new SequenceGenerator(async (task) => ({ claimId: task.claimId, text: task.proposition }));
  const grounded = requireSuccess(
    await generateGroundedAnswer({ plan, bundle, generator, options: { claimRetryLimit: 1 } })
  );
  assert.equal(grounded.validation.valid, true);
  assert.equal(grounded.diagnostics.requestCount, 0);
});

test("partial-answer caveat remains mandatory", async () => {
  const bundle = makeBundle({
    answerability: "partial",
    authorityCoverage: {
      requestedDomains: ["teams_admin", "entra"],
      coveredDomains: ["teams_admin"],
      missingDomains: ["entra"]
    }
  });
  const plan = buildAnswerPlan(bundle);
  const generator = new SequenceGenerator(async (task) => ({ claimId: task.claimId, text: task.proposition }));
  const grounded = requireSuccess(await generateGroundedAnswer({ plan, bundle, generator }));
  const required = new Set(plan.requiredCaveats.map((caveat) => caveat.code));
  for (const code of required) {
    assert.ok(grounded.caveats.some((c) => c.code === code));
  }
});

test("no plan/bundle mutation, canonicalUrl unchanged, and service remains isolated", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const beforeBundle = JSON.stringify(bundle);
  const beforePlan = JSON.stringify(plan);
  const beforeUrl = bundle.evidence[0]?.source.canonicalUrl;
  const generator = new SequenceGenerator(async (task) => ({ claimId: task.claimId, text: task.proposition }));
  const grounded = requireSuccess(await generateGroundedAnswer({ plan, bundle, generator }));
  assert.equal(JSON.stringify(bundle), beforeBundle);
  assert.equal(JSON.stringify(plan), beforePlan);
  assert.equal(bundle.evidence[0]?.source.canonicalUrl, beforeUrl);
  assert.equal(grounded.diagnostics.generatorProviderId, "sequence");
});
