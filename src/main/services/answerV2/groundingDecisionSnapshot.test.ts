import assert from "node:assert/strict";
import test from "node:test";
import type { QueryIntent } from "../retrievalV2";
import { buildAnswerPlan } from "./answerPlanner";
import { FakeAnswerGenerator } from "./fakeAnswerGenerator";
import { generateGroundedAnswer } from "./groundedAnswerService";
import {
  bindEvidenceBundleSnapshot,
  type EvidenceBundleDecisionState,
  validateGroundingDecisionBoundary
} from "./groundingDecisionSnapshot";
import type { EvidenceBundle, EvidenceItem } from "./types";

function makeEvidence(text: string): EvidenceItem {
  return {
    evidenceId: "ev-grounding-boundary",
    chunkId: "chunk-grounding-boundary",
    documentId: "doc-grounding-boundary",
    source: {
      sourceId: "ms-teams-admin",
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain: "teams_admin",
      authorityTier: "tier1",
      authorityRoles: [],
      routePriority: "primary",
      title: "Direct Routing",
      canonicalUrl: "https://learn.microsoft.com/microsoftteams/direct-routing-plan",
      sourcePath: "MicrosoftTeams/direct-routing-plan.md",
      sourceRevision: { transport: "github", commitSha: "snapshot-fixture" }
    },
    location: {
      sectionId: "voice-routing",
      headingPath: ["Direct Routing", "Voice routing"]
    },
    text,
    supportTypes: ["concept_definition"],
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

function makeBundle(params?: { question?: string; evidenceText?: string }): EvidenceBundle {
  const question = params?.question ?? "How does Teams Direct Routing work?";
  const intent: QueryIntent = {
    originalQuestion: question,
    normalizedQuestion: question.toLowerCase(),
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
  const decisionState: EvidenceBundleDecisionState = {
    question,
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
      candidateBudget: {
        maxLexicalCandidates: 64,
        maxSemanticCandidates: 1300,
        broadScopeWarningThreshold: 10000
      },
      scopeMode: "narrow",
      freshnessVerification: { required: false, reasons: [] },
      betaPolicy: { allowsBeta: false, excludedBetaTracks: [] },
      estimatedCandidatePopulation: 1,
      routingWarnings: [],
      routingRationale: []
    },
    evidence: [
      makeEvidence(
        params?.evidenceText ?? "Direct Routing connects Teams voice routing to a supported SBC."
      )
    ],
    rejectedCandidates: [],
    conflicts: [],
    freshness: { state: "current", requiresVerification: false, reasons: [] },
    exactIdentifierValidation: {
      required: false,
      verified: true,
      requiredDirectives: [],
      missingRequiredDirectives: []
    },
    authorityCoverage: {
      requestedDomains: ["teams_admin"],
      coveredDomains: ["teams_admin"],
      missingDomains: []
    },
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
    }
  };
  return bindEvidenceBundleSnapshot(decisionState, "2026-08-08T00:00:00.000Z");
}

test("matching EvidenceBundle and AnswerPlan snapshot passes", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);

  const validation = validateGroundingDecisionBoundary({ bundle, plan });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.equal(plan.snapshotBinding.snapshotHash, bundle.decisionSnapshot.snapshotHash);
});

test("mismatched snapshot binding fails", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const mismatchedPlan = {
    ...plan,
    snapshotBinding: {
      ...plan.snapshotBinding,
      snapshotHash: "0".repeat(64)
    }
  };

  const validation = validateGroundingDecisionBoundary({ bundle, plan: mismatchedPlan });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "plan_snapshot_hash_mismatch"));
});

test("stale AnswerPlan and EvidenceBundle pairing fails", () => {
  const originalBundle = makeBundle();
  const stalePlan = buildAnswerPlan(originalBundle);
  const replacementBundle = makeBundle({
    question: "How are Teams voice routing policies assigned?",
    evidenceText: "Voice routing policies are assigned to users."
  });

  const validation = validateGroundingDecisionBoundary({
    bundle: replacementBundle,
    plan: stalePlan
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "plan_snapshot_id_mismatch"));
});

test("mutated EvidenceBundle content fails its immutable snapshot", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  bundle.evidence[0]!.text = "Content changed after the grounding decision.";

  const validation = validateGroundingDecisionBoundary({ bundle, plan });

  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "bundle_snapshot_hash_mismatch"));
});

test("snapshot failure result has no renderable answerText", async () => {
  const bundle = makeBundle();
  const stalePlan = buildAnswerPlan(
    makeBundle({ question: "Which cmdlet assigns a voice routing policy?" })
  );
  let providerCalls = 0;

  const result = await generateGroundedAnswer({
    plan: stalePlan,
    bundle,
    generator: {
      providerId: "snapshot-boundary-recording",
      async realizeClaim(task) {
        providerCalls += 1;
        return {
          realization: { claimId: task.claimId, text: task.proposition },
          usage: { inputTokens: 0, outputTokens: 0 }
        };
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(providerCalls, 0);
  if (result.ok) throw new Error("Expected fail-closed snapshot result");
  assert.equal(result.failure.code, "decision_snapshot_mismatch");
  assert.equal("answerText" in result.failure, false);
  assert.equal("answer" in result, false);
  // @ts-expect-error A failure is intentionally unable to expose renderable answer text.
  assert.equal(result.failure.answerText, undefined);
});

test("current valid pipeline traverses the snapshot boundary", async () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);

  const result = await generateGroundedAnswer({
    plan,
    bundle,
    generator: new FakeAnswerGenerator()
  });

  if (!result.ok) throw new Error(result.failure.message);
  assert.equal(result.ok, true);
  assert.equal(result.answer.validation.valid, true);
  assert.ok(result.answer.answerText.length > 0);
  assert.equal(result.answer.snapshotBinding.snapshotId, bundle.decisionSnapshot.snapshotId);
});
