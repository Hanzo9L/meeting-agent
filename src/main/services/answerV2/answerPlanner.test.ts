import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceBundle, EvidenceItem } from "./types";
import type { QueryIntent } from "../retrievalV2";
import { buildAnswerPlan } from "./answerPlanner";

function makeEvidence(params: {
  id: string;
  sourceId: string;
  sourceDomain: EvidenceItem["source"]["sourceDomain"];
  routePriority: "primary" | "supporting";
  title: string;
  text: string;
  supportTypes: EvidenceItem["supportTypes"];
  sourceStatus?: EvidenceItem["source"]["sourceStatus"];
}): EvidenceItem {
  return {
    evidenceId: params.id,
    chunkId: `${params.id}-chunk`,
    documentId: `${params.id}-doc`,
    source: {
      sourceId: params.sourceId,
      trackId: "ga",
      sourceStatus: params.sourceStatus ?? "ga",
      sourceDomain: params.sourceDomain,
      authorityTier: "tier1",
      authorityRoles: [],
      routePriority: params.routePriority,
      title: params.title,
      canonicalUrl: `https://learn.microsoft.com/${params.id}`,
      sourcePath: `docs/${params.id}.md`,
      sourceRevision: { transport: "github", commitSha: "abc" }
    },
    location: {
      sectionId: "section",
      headingPath: [params.title]
    },
    text: params.text,
    supportTypes: params.supportTypes,
    retrieval: {
      methods: ["semantic"],
      fusionRank: 1,
      fusionScore: 100,
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

function makeBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const intent: QueryIntent = {
    originalQuestion: "How does Teams Direct Routing voice routing work?",
    normalizedQuestion: "how does teams direct routing voice routing work",
    domains: ["teams_admin", "teams_powershell"],
    products: ["Microsoft Teams"],
    technologies: ["Direct Routing"],
    entities: ["direct routing", "voice routing"],
    operationIntents: [],
    commandNames: [],
    policyNames: [],
    requiresFreshnessCheck: false,
    allowsBetaSources: false,
    expectedAnswerType: "conceptual" as const,
    retrievalHints: [],
    unresolvedAmbiguity: []
  };
  return {
    question: intent.originalQuestion,
    intent,
    scope: {
      intent,
      selectedDomains: ["teams_admin", "teams_powershell"],
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
      estimatedCandidatePopulation: 10,
      routingWarnings: [],
      routingRationale: []
    },
    evidence: [
      makeEvidence({
        id: "ev-direct-routing",
        sourceId: "ms-teams-admin",
        sourceDomain: "teams_admin",
        routePriority: "primary",
        title: "Plan Direct Routing",
        text: "Direct Routing voice routing policies map users to PSTN usages.",
        supportTypes: ["concept_definition", "configuration_behavior"]
      }),
      makeEvidence({
        id: "ev-grant-cmdlet",
        sourceId: "ms-teams-powershell",
        sourceDomain: "teams_powershell",
        routePriority: "supporting",
        title: "Grant-CsOnlineVoiceRoutingPolicy",
        text: "Grant-CsOnlineVoiceRoutingPolicy assigns a voice routing policy to a user.",
        supportTypes: ["cmdlet_semantics", "procedure"]
      })
    ],
    rejectedCandidates: [],
    conflicts: [],
    freshness: { state: "unknown", requiresVerification: false, reasons: [] },
    exactIdentifierValidation: {
      required: false,
      verified: true,
      requiredDirectives: [],
      missingRequiredDirectives: []
    },
    authorityCoverage: {
      requestedDomains: ["teams_admin", "teams_powershell"],
      coveredDomains: ["teams_admin", "teams_powershell"],
      missingDomains: []
    },
    answerability: "answered",
    diagnostics: {
      latencyMs: { total: 1, selection: 1, conflictDetection: 0, answerability: 0 },
      populations: { candidates: 10, selectedEvidence: 2, rejectedCandidates: 0 },
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
  };
}

test("EvidenceBundle produces AnswerPlan and every claim has evidence", () => {
  const plan = buildAnswerPlan(makeBundle());
  assert.equal(plan.answerability, "answered");
  assert.ok(plan.plannedClaims.length > 0);
  for (const claim of plan.plannedClaims) {
    assert.ok(claim.evidenceIds.length > 0);
  }
});

test("unsupported claims do not enter plan and duplicate claims collapse", () => {
  const duplicateEvidence = makeEvidence({
    id: "ev-duplicate",
    sourceId: "ms-teams-admin",
    sourceDomain: "teams_admin",
    routePriority: "primary",
    title: "Plan Direct Routing",
    text: "Direct Routing voice routing policies map users to PSTN usages.",
    supportTypes: ["concept_definition"]
  });
  const bundle = makeBundle({ evidence: [...makeBundle().evidence, duplicateEvidence] });
  const plan = buildAnswerPlan(bundle);
  assert.ok(plan.diagnostics.duplicateClaimsCollapsed >= 1);
  const propositions = new Set(plan.plannedClaims.map((claim) => claim.proposition));
  assert.equal(propositions.size, plan.plannedClaims.length);
});

test("partial bundle creates caveats and unsupported aspects", () => {
  const bundle = makeBundle({
    answerability: "partial",
    authorityCoverage: {
      requestedDomains: ["teams_admin", "entra"],
      coveredDomains: ["teams_admin"],
      missingDomains: ["entra"]
    }
  });
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.answerability, "partial");
  assert.ok(plan.requiredCaveats.some((caveat) => caveat.code === "partial_coverage"));
  assert.ok(plan.unsupportedAspects.some((aspect) => aspect.reason === "missing_authority"));
});

test("insufficient bundle does not create normal technical claims", () => {
  const bundle = makeBundle({
    answerability: "insufficient_evidence",
    evidence: []
  });
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.answerability, "insufficient_evidence");
  assert.equal(plan.plannedClaims.length, 0);
  assert.ok(plan.unsupportedAspects.length > 0);
});

test("explicit cmdlet preserves verified identifier and nonexistent cmdlet is not substituted", () => {
  const explicit = makeBundle({
    intent: {
      ...makeBundle().intent,
      originalQuestion: "What does Set-CsOnlineVoiceRoutingPolicy do?",
      normalizedQuestion: "what does set-csonlinevoiceroutingpolicy do",
      expectedAnswerType: "reference",
      commandNames: ["Set-CsOnlineVoiceRoutingPolicy"],
      domains: ["teams_powershell"]
    },
    exactIdentifierValidation: {
      required: true,
      verified: true,
      requiredDirectives: [{ type: "cmdlet", value: "Set-CsOnlineVoiceRoutingPolicy" }],
      missingRequiredDirectives: []
    },
    evidence: [
      makeEvidence({
        id: "ev-set-cmdlet",
        sourceId: "ms-teams-powershell",
        sourceDomain: "teams_powershell",
        routePriority: "primary",
        title: "Set-CsOnlineVoiceRoutingPolicy",
        text: "Set-CsOnlineVoiceRoutingPolicy sets the Online Voice Routing Policy.",
        supportTypes: ["cmdlet_semantics", "parameter_semantics"]
      })
    ]
  });
  const explicitPlan = buildAnswerPlan(explicit);
  assert.ok(explicitPlan.plannedClaims.some((claim) => /set-csonlinevoiceroutingpolicy/i.test(claim.proposition)));

  const nonexistent = makeBundle({
    intent: {
      ...makeBundle().intent,
      originalQuestion: "What does Set-CsDefinitelyNotARealCmdlet do?",
      normalizedQuestion: "what does set-csdefinitelynotarealcmdlet do",
      expectedAnswerType: "reference",
      commandNames: ["Set-CsDefinitelyNotARealCmdlet"],
      domains: ["teams_powershell"]
    },
    answerability: "insufficient_evidence",
    exactIdentifierValidation: {
      required: true,
      verified: false,
      requiredDirectives: [{ type: "cmdlet", value: "Set-CsDefinitelyNotARealCmdlet" }],
      missingRequiredDirectives: [{ type: "cmdlet", value: "Set-CsDefinitelyNotARealCmdlet" }]
    },
    evidence: []
  });
  const nonexistentPlan = buildAnswerPlan(nonexistent);
  assert.equal(nonexistentPlan.plannedClaims.length, 0);
  assert.ok(
    nonexistentPlan.unsupportedAspects.some((aspect) => aspect.reason === "exact_identifier_unverified")
  );
});

test("implicit cmdlet maps to authoritative powershell evidence", () => {
  const bundle = makeBundle({
    intent: {
      ...makeBundle().intent,
      originalQuestion: "Which cmdlet assigns a Teams voice routing policy to a user?",
      normalizedQuestion: "which cmdlet assigns a teams voice routing policy to a user",
      expectedAnswerType: "reference",
      domains: ["teams_powershell"]
    }
  });
  const plan = buildAnswerPlan(bundle);
  assert.ok(
    plan.plannedClaims.some(
      (claim) =>
        claim.authorityContext.sourceIds.includes("ms-teams-powershell") &&
        /grant-csonlinevoiceroutingpolicy/i.test(claim.proposition)
    )
  );
});

test("calling plans does not assume SBC and preserves specific meeting/external coverage", () => {
  const calling = makeBundle({
    question: "How do Microsoft Teams Calling Plans work?",
    intent: {
      ...makeBundle().intent,
      originalQuestion: "How do Microsoft Teams Calling Plans work?",
      normalizedQuestion: "how do microsoft teams calling plans work",
      expectedAnswerType: "conceptual",
      entities: ["calling plans", "pstn"]
    },
    evidence: [
      makeEvidence({
        id: "ev-cp",
        sourceId: "ms-teams-admin",
        sourceDomain: "teams_admin",
        routePriority: "primary",
        title: "Microsoft Teams Calling Plans",
        text: "Calling Plans provide Microsoft-managed PSTN connectivity.",
        supportTypes: ["concept_definition"]
      })
    ]
  });
  const plan = buildAnswerPlan(calling);
  assert.ok(!plan.plannedClaims.some((claim) => /sbc|session border controller/i.test(claim.proposition)));

  const meeting = makeBundle({
    question: "How do Teams meeting policies work?",
    intent: {
      ...makeBundle().intent,
      originalQuestion: "How do Teams meeting policies work?",
      normalizedQuestion: "how do teams meeting policies work",
      entities: ["meeting policies"]
    },
    evidence: [
      makeEvidence({
        id: "ev-meeting",
        sourceId: "ms-teams-admin",
        sourceDomain: "teams_admin",
        routePriority: "primary",
        title: "Meeting policies overview",
        text: "Meeting policies control in-meeting behaviors and assignment.",
        supportTypes: ["concept_definition"]
      })
    ]
  });
  const meetingPlan = buildAnswerPlan(meeting);
  assert.ok(meetingPlan.plannedClaims.some((claim) => /meeting polic/i.test(claim.proposition)));

  const external = makeBundle({
    question: "How does external access work in Teams?",
    intent: {
      ...makeBundle().intent,
      originalQuestion: "How does external access work in Teams?",
      normalizedQuestion: "how does external access work in teams",
      entities: ["external access"]
    },
    evidence: [
      makeEvidence({
        id: "ev-external",
        sourceId: "ms-teams-admin",
        sourceDomain: "teams_admin",
        routePriority: "primary",
        title: "Manage external access",
        text: "External access enables federated communication with trusted domains.",
        supportTypes: ["concept_definition"]
      })
    ]
  });
  const externalPlan = buildAnswerPlan(external);
  assert.ok(externalPlan.plannedClaims.some((claim) => /external access/i.test(claim.proposition)));
});

test("freshness, preview, conflicts, and evidence-id validity propagate", () => {
  const bundle = makeBundle({
    freshness: {
      state: "verification_required",
      requiresVerification: true,
      reasons: ["latest requested"]
    },
    conflicts: [
      {
        conflictId: "c1",
        conflictType: "contradiction",
        topic: "status",
        evidenceIds: ["ev-direct-routing"],
        notes: "conflict"
      }
    ],
    evidence: [
      ...makeBundle().evidence,
      makeEvidence({
        id: "ev-preview",
        sourceId: "ms-teams-admin",
        sourceDomain: "teams_admin",
        routePriority: "supporting",
        title: "Preview feature note",
        text: "Preview feature behavior.",
        supportTypes: ["concept_definition"],
        sourceStatus: "preview"
      })
    ]
  });
  const plan = buildAnswerPlan(bundle);
  assert.ok(plan.requiredCaveats.some((c) => c.code === "freshness_verification_required"));
  assert.ok(plan.requiredCaveats.some((c) => c.code === "preview_evidence_used"));
  assert.ok(plan.requiredCaveats.some((c) => c.code === "unresolved_conflict"));
  const validIds = new Set(bundle.evidence.map((e) => e.evidenceId));
  for (const claim of plan.plannedClaims) {
    for (const id of claim.evidenceIds) {
      assert.ok(validIds.has(id));
    }
  }
});
