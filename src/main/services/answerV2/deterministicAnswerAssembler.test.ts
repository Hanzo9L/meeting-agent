import assert from "node:assert/strict";
import test from "node:test";
import type { QueryIntent } from "../retrievalV2";
import {
  ANSWER_PLANNER_POLICY_VERSION,
  bindAnswerPlanIdentity,
  type AnswerPlanState
} from "./answerPlanIntegrity";
import { buildAnswerPlan } from "./answerPlanner";
import {
  assembleDeterministicAnswer,
  EXTRACTIVE_ASSEMBLER_POLICY_VERSION
} from "./deterministicAnswerAssembler";
import {
  bindEvidenceBundleSnapshot,
  GROUNDING_RESOLVER_POLICY_VERSION,
  type EvidenceBundleDecisionState
} from "./groundingDecisionSnapshot";
import { makeTestAspect } from "./testAspectFixtures";
import type {
  AnswerPlan,
  EvidenceAspect,
  EvidenceAspectCoverage,
  EvidenceBundle,
  EvidenceItem
} from "./types";

function makeEvidence(params: {
  id: string;
  title: string;
  text: string;
  sourceId?: string;
  headingPath?: string[];
  rank?: number;
}): EvidenceItem {
  const powershell = params.sourceId === "ms-teams-powershell";
  return {
    evidenceId: params.id,
    chunkId: `${params.id}-chunk`,
    documentId: `${params.id}-document`,
    source: {
      sourceId: params.sourceId ?? "ms-teams-admin",
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain: powershell ? "teams_powershell" : "teams_admin",
      authorityTier: "tier1",
      authorityRoles: powershell
        ? ["teams_powershell_cmdlet_primary"]
        : ["teams_admin_primary"],
      routePriority: "primary",
      title: params.title,
      canonicalUrl: `https://learn.microsoft.com/${params.id}`,
      sourcePath: `docs/${params.id}.md`,
      sourceRevision: { commitSha: "r4-fixture" }
    },
    location: {
      sectionId: `section-${params.id}`,
      headingPath: params.headingPath ?? [params.title]
    },
    text: params.text,
    supportTypes: powershell
      ? ["cmdlet_semantics"]
      : ["concept_definition"],
    retrieval: {
      methods: ["lexical"],
      fusionRank: params.rank ?? 1,
      fusionScore: 1,
      methodSignals: {
        methods: ["lexical"],
        exact: { matched: false, score: null, rank: null },
        lexical: { score: 1, rank: params.rank ?? 1 },
        semantic: { similarity: null, rank: null }
      },
      exactMatch: null,
      retrievalReasons: ["fixture"]
    },
    selectionReason: "selected:fixture:direct"
  };
}

function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    originalQuestion: "How does Direct Routing work?",
    normalizedQuestion: "how does direct routing work",
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
    unresolvedAmbiguity: [],
    ...overrides
  };
}

function makeCoverage(params: {
  aspects: EvidenceAspect[];
  evidenceByAspect: Record<string, string[]>;
  supported: string[];
  unsupported?: string[];
  authorityLimited?: string[];
}): EvidenceAspectCoverage {
  return {
    aspects: params.aspects,
    evidenceByAspect: params.evidenceByAspect,
    supportByAspect: Object.fromEntries(
      params.aspects.map((aspect) => [aspect.aspectId, []])
    ),
    supportedMandatoryAspectIds: params.supported,
    unsupportedMandatoryAspectIds: params.unsupported ?? [],
    authorityLimitedAspectIds: params.authorityLimited ?? [],
    supportingOnlyAspectIds: [],
    contextualOnlyAspectIds: [],
    supportedOptionalAspectIds: []
  };
}

function makeBundle(params: {
  intent?: QueryIntent;
  aspects?: EvidenceAspect[];
  evidence?: EvidenceItem[];
  evidenceByAspect?: Record<string, string[]>;
  supported?: string[];
  unsupported?: string[];
  authorityLimited?: string[];
  answerability?: EvidenceBundle["answerability"];
  exactIdentifierValidation?: EvidenceBundle["exactIdentifierValidation"];
  authorityCoverage?: EvidenceBundle["authorityCoverage"];
} = {}): EvidenceBundle {
  const intent = params.intent ?? makeIntent();
  const aspects = params.aspects ?? [
    makeTestAspect({
      aspectId: "mandatory:entity:direct-routing:general",
      subject: "direct routing",
      subjectTerms: ["direct", "routing"],
      requiredFacets: ["purpose", "mechanism"]
    })
  ];
  const evidence = params.evidence ?? [
    makeEvidence({
      id: "ev-routing",
      title: "Direct Routing",
      text:
        "Direct Routing lets organizations connect telephony to Teams Phone. Direct Routing maps calls through configured voice routes."
    })
  ];
  const mandatoryIds = aspects
    .filter((aspect) => aspect.requirement === "mandatory")
    .map((aspect) => aspect.aspectId);
  const supported = params.supported ?? mandatoryIds;
  const evidenceByAspect =
    params.evidenceByAspect ??
    Object.fromEntries(
      aspects.map((aspect) => [
        aspect.aspectId,
        supported.includes(aspect.aspectId)
          ? evidence.map((item) => item.evidenceId)
          : []
      ])
    );
  const state: EvidenceBundleDecisionState = {
    question: intent.originalQuestion,
    intent,
    scope: {
      intent,
      selectedDomains: [...intent.domains],
      focusSubdomains: [],
      eligibleSources: [],
      excludedSources: [],
      sourcePriorityChain: [],
      strategy: {
        exact: true,
        lexical: true,
        semantic: true,
        semanticPreference: "primary"
      },
      exactMatchDirectives: [],
      candidateBudget: {
        maxLexicalCandidates: 64,
        maxSemanticCandidates: 1300,
        broadScopeWarningThreshold: 10000
      },
      scopeMode: "narrow",
      freshnessVerification: { required: false, reasons: [] },
      betaPolicy: { allowsBeta: false, excludedBetaTracks: [] },
      estimatedCandidatePopulation: evidence.length,
      routingWarnings: [],
      routingRationale: []
    },
    evidence,
    rejectedCandidates: [],
    conflicts: [],
    freshness: { state: "current", requiresVerification: false, reasons: [] },
    exactIdentifierValidation:
      params.exactIdentifierValidation ?? {
        required: false,
        verified: true,
        requiredDirectives: [],
        missingRequiredDirectives: []
      },
    aspectCoverage: makeCoverage({
      aspects,
      evidenceByAspect,
      supported,
      unsupported: params.unsupported,
      authorityLimited: params.authorityLimited
    }),
    authorityCoverage:
      params.authorityCoverage ?? {
        requestedDomains: [...intent.domains],
        coveredDomains: [...intent.domains],
        missingDomains: []
      },
    answerability: params.answerability ?? "answered",
    diagnostics: {
      latencyMs: {
        total: 1,
        selection: 1,
        conflictDetection: 0,
        answerability: 0
      },
      populations: {
        candidates: evidence.length,
        selectedEvidence: evidence.length,
        rejectedCandidates: 0
      },
      policySignals: {
        authoritativeEvidencePresent: evidence.length > 0,
        exactIdentifierVerified: true,
        requiredConceptCoverage: true,
        conflictFree: true,
        freshnessOk: true,
        authorityCoverageOk: true,
        provenanceComplete: true
      }
    }
  };
  return bindEvidenceBundleSnapshot(
    state,
    "2026-08-09T00:00:00.000Z"
  );
}

function rebindPlan(
  plan: AnswerPlan,
  mutate: (state: AnswerPlanState) => void
): AnswerPlan {
  const cloned = structuredClone(plan);
  const { planIdentity: _identity, ...state } = cloned;
  mutate(state);
  return bindAnswerPlanIdentity(state);
}

test("answer factual units originate only from approved claims and exact spans", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const result = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const assembly = result.answer.extractiveAssembly;
  assert.ok(assembly);
  assert.equal(assembly.factualTextAudit.allFactualUnitsAttributed, true);
  assert.equal(assembly.factualTextAudit.unattributedText.length, 0);
  for (const rendered of assembly.renderedClaims) {
    assert.ok(rendered.sourceSpans.length > 0);
    assert.equal(
      result.answer.answerText.slice(
        rendered.answerTextRange.startOffset,
        rendered.answerTextRange.endOffset
      ),
      rendered.renderedText
    );
  }
});

test("snapshot mismatch fails closed with no renderable answer", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const otherBundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "How does another feature work?",
      normalizedQuestion: "how does another feature work"
    })
  });
  const result = assembleDeterministicAnswer({
    bundle: otherBundle,
    plan
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "decision_snapshot_mismatch");
  assert.equal("answerText" in result.failure, false);
});

test("span hash mismatch fails closed", () => {
  const bundle = makeBundle();
  const plan = structuredClone(buildAnswerPlan(bundle));
  plan.plannedClaims[0]!.sourceSpans[0]!.contentHash = "0".repeat(64);
  const result = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "answer_plan_integrity_failed");
  assert.ok(
    result.failure.planIntegrityIssues?.some(
      (issue) => issue.code === "claim_span_hash_mismatch"
    )
  );
});

test("missing mandatory claim fails closed", () => {
  const bundle = makeBundle();
  const original = buildAnswerPlan(bundle);
  const plan = rebindPlan(original, (state) => {
    state.plannedClaims = state.plannedClaims.slice(0, 1);
  });
  const result = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "answer_plan_integrity_failed");
});

test("claim for an unsupported aspect cannot be rendered", () => {
  const supported = makeTestAspect({
    aspectId: "mandatory:entity:external-access:general",
    subject: "external access",
    subjectTerms: ["external", "access"],
    subjects: [
      {
        kind: "entity",
        value: "external access",
        terms: ["external", "access"]
      }
    ]
  });
  const unsupported = makeTestAspect({
    aspectId: "mandatory:entity:guest-access:general",
    subject: "guest access",
    subjectTerms: ["guest", "access"],
    subjects: [
      {
        kind: "entity",
        value: "guest access",
        terms: ["guest", "access"]
      }
    ]
  });
  const evidence = makeEvidence({
    id: "ev-external",
    title: "External access",
    text:
      "External access allows federated communication. External access routes chats through allowed domains."
  });
  const bundle = makeBundle({
    aspects: [supported, unsupported],
    evidence: [evidence],
    supported: [supported.aspectId],
    unsupported: [unsupported.aspectId],
    evidenceByAspect: {
      [supported.aspectId]: [evidence.evidenceId],
      [unsupported.aspectId]: []
    },
    answerability: "partial"
  });
  const original = buildAnswerPlan(bundle);
  const plan = rebindPlan(original, (state) => {
    state.plannedClaims[0]!.requiredAspectId = unsupported.aspectId;
  });
  const result = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.failure.planIntegrityIssues?.some(
      (issue) => issue.code === "claim_unsupported_aspect"
    )
  );
});

test("partial renders supported facts and typed limitations only", () => {
  const supported = makeTestAspect({
    aspectId: "mandatory:entity:external-access:general",
    subject: "external access",
    subjectTerms: ["external", "access"],
    subjects: [
      {
        kind: "entity",
        value: "external access",
        terms: ["external", "access"]
      }
    ]
  });
  const unsupported = makeTestAspect({
    aspectId: "mandatory:entity:guest-access:general",
    subject: "guest access",
    subjectTerms: ["guest", "access"],
    subjects: [
      {
        kind: "entity",
        value: "guest access",
        terms: ["guest", "access"]
      }
    ]
  });
  const evidence = makeEvidence({
    id: "ev-external",
    title: "External access",
    text:
      "External access allows federated communication. External access routes chats through allowed domains."
  });
  const bundle = makeBundle({
    aspects: [supported, unsupported],
    evidence: [evidence],
    supported: [supported.aspectId],
    unsupported: [unsupported.aspectId],
    authorityLimited: [unsupported.aspectId],
    evidenceByAspect: {
      [supported.aspectId]: [evidence.evidenceId],
      [unsupported.aspectId]: []
    },
    answerability: "partial",
    authorityCoverage: {
      requestedDomains: ["teams_admin", "entra"],
      coveredDomains: ["teams_admin"],
      missingDomains: ["entra"]
    }
  });
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.answer.answerText, /External access/);
  assert.match(result.answer.answerText, /Limitations:/);
  assert.match(result.answer.answerText, /guest access/);
  assert.equal(
    result.answer.extractiveAssembly?.renderedClaims.every(
      (claim) => claim.requiredAspectId === supported.aspectId
    ),
    true
  );
});

test("insufficient evidence renders zero factual claims", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:relationship:affects:a:b",
    answerObject: "relationship",
    requiredFacets: ["relationship"]
  });
  const bundle = makeBundle({
    aspects: [aspect],
    evidence: [],
    supported: [],
    unsupported: [aspect.aspectId],
    evidenceByAspect: { [aspect.aspectId]: [] },
    answerability: "insufficient_evidence"
  });
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.answer.realizedClaims.length, 0);
  assert.equal(
    result.answer.extractiveAssembly?.factualTextAudit.factualUnitCount,
    0
  );
  assert.match(result.answer.answerText, /Unable to provide/);
});

test("nonexistent cmdlet remains a typed limitation without substitution", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:cmdlet:set-csnotreal:general",
    subject: "Set-CsNotReal",
    subjectTerms: ["set-csnotreal"],
    answerObject: "cmdlet_semantics",
    requiredFacets: ["identifier", "behavior"]
  });
  const bundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "What does Set-CsNotReal do?",
      normalizedQuestion: "what does set-csnotreal do",
      domains: ["teams_powershell"],
      commandNames: ["Set-CsNotReal"],
      expectedAnswerType: "reference"
    }),
    aspects: [aspect],
    evidence: [],
    supported: [],
    unsupported: [aspect.aspectId],
    evidenceByAspect: { [aspect.aspectId]: [] },
    answerability: "insufficient_evidence",
    exactIdentifierValidation: {
      required: true,
      verified: false,
      requiredDirectives: [{ type: "cmdlet", value: "Set-CsNotReal" }],
      missingRequiredDirectives: [
        { type: "cmdlet", value: "Set-CsNotReal" }
      ]
    }
  });
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.answer.answerText, /Set-CsNotReal/);
  assert.doesNotMatch(
    result.answer.answerText,
    /Grant-Cs|Set-CsOnlineVoiceRoutingPolicy/
  );
  assert.equal(result.answer.realizedClaims.length, 0);
});

test("explicit cmdlet rendering adds no unplanned parameters", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:cmdlet:set-cspolicy:general",
    subject: "Set-CsPolicy",
    subjectTerms: ["set-cspolicy"],
    subjects: [
      {
        kind: "cmdlet",
        value: "Set-CsPolicy",
        terms: ["set-cspolicy"]
      }
    ],
    answerObject: "cmdlet_semantics",
    requiredFacets: ["identifier", "behavior"],
    canonicalIdentifier: { type: "cmdlet", value: "Set-CsPolicy" },
    authorityRequirement: {
      requiredRoles: ["teams_powershell_cmdlet_primary"],
      requiredDomains: ["teams_powershell"],
      requireCanonicalIdentity: true,
      identityType: "cmdlet"
    },
    supportType: "cmdlet_semantics"
  });
  const evidence = makeEvidence({
    id: "ev-cmdlet",
    sourceId: "ms-teams-powershell",
    title: "Set-CsPolicy",
    text: "Set-CsPolicy updates a documented policy."
  });
  const bundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "What does Set-CsPolicy do?",
      normalizedQuestion: "what does set-cspolicy do",
      domains: ["teams_powershell"],
      commandNames: ["Set-CsPolicy"],
      expectedAnswerType: "reference"
    }),
    aspects: [aspect],
    evidence: [evidence]
  });
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.answer.answerText,
    "Set-CsPolicy updates a documented policy."
  );
  assert.doesNotMatch(result.answer.answerText, /-Identity|-PolicyName/);
});

test("procedure order is preserved exactly", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:entity:routing:configure",
    subject: "routing",
    subjectTerms: ["routing"],
    operation: "configure",
    answerObject: "procedure",
    requiredFacets: ["procedure", "operation"],
    supportType: "procedure"
  });
  const evidence = [
    makeEvidence({
      id: "ev-step-2",
      title: "Configure routing",
      headingPath: ["Configure routing", "Step 2"],
      text: "Step 2. Configure routing assignments.",
      rank: 1
    }),
    makeEvidence({
      id: "ev-step-1",
      title: "Configure routing",
      headingPath: ["Configure routing", "Step 1"],
      text: "Step 1. Open the routing settings.",
      rank: 2
    })
  ];
  const bundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "How do I configure routing?",
      normalizedQuestion: "how do i configure routing",
      expectedAnswerType: "procedural",
      operationIntents: ["configure"],
      entities: ["routing"]
    }),
    aspects: [aspect],
    evidence
  });
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(
    result.answer.answerText.indexOf("Open the routing settings") <
      result.answer.answerText.indexOf("Configure routing assignments"),
    result.answer.answerText
  );
});

test("assembler performs zero provider or OpenAI requests", () => {
  const bundle = makeBundle();
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.answer.diagnostics.requestCount, 0);
  assert.equal(result.answer.diagnostics.tokenUsage.inputTokens, null);
  assert.equal(
    result.answer.diagnostics.generatorProviderId,
    EXTRACTIVE_ASSEMBLER_POLICY_VERSION
  );
});

test("deterministic output is stable across repeated runs", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const first = assembleDeterministicAnswer({ bundle, plan });
  const second = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.answer.answerText, second.answer.answerText);
  assert.deepEqual(
    first.answer.extractiveAssembly?.renderedClaims,
    second.answer.extractiveAssembly?.renderedClaims
  );
});

test("source-navigation artifacts may be removed without adding facts", () => {
  const evidence = makeEvidence({
    id: "ev-table",
    title: "Meeting policies",
    text:
      "| Meeting policies | A meeting policy is used to control meeting features."
  });
  const aspect = makeTestAspect({
    aspectId: "mandatory:policy:meeting-policy:general",
    subject: "meeting policy",
    subjectTerms: ["meeting", "policy"],
    requiredFacets: ["purpose", "mechanism"]
  });
  const bundle = makeBundle({
    aspects: [aspect],
    evidence: [evidence]
  });
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.answer.answerText,
    "A meeting policy is used to control meeting features."
  );
  assert.equal(
    result.answer.extractiveAssembly?.renderedClaims[0]?.transformation,
    "source_artifact_removed"
  );
});

test("R2 and R3 policy versions remain frozen", () => {
  assert.equal(
    GROUNDING_RESOLVER_POLICY_VERSION,
    "proposition-aware-evidence-policy/r2.2"
  );
  assert.equal(
    ANSWER_PLANNER_POLICY_VERSION,
    "minimal-atomic-source-bound-planner/r3"
  );
});

test("R4 output contains no citation rendering", () => {
  const bundle = makeBundle();
  const result = assembleDeterministicAnswer({
    bundle,
    plan: buildAnswerPlan(bundle)
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.answer.answerText, /\[\d+\]/);
  assert.doesNotMatch(result.answer.answerText, /https?:\/\//);
});
