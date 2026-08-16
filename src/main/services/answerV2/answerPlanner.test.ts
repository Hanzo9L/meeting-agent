import assert from "node:assert/strict";
import test from "node:test";
import type { QueryIntent } from "../retrievalV2";
import {
  hashSourceSpanContent,
  validateAnswerPlanIntegrity
} from "./answerPlanIntegrity";
import { buildAnswerPlan } from "./answerPlanner";
import { assembleDeterministicAnswer } from "./deterministicAnswerAssembler";
import {
  bindEvidenceBundleSnapshot,
  type EvidenceBundleDecisionState,
  validateGroundingDecisionBoundary
} from "./groundingDecisionSnapshot";
import {
  makeTestAspect,
  makeTestSubject
} from "./testAspectFixtures";
import type {
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
  sourceDomain?: EvidenceItem["source"]["sourceDomain"];
  headingPath?: string[];
  routePriority?: "primary" | "supporting";
  fusionRank?: number;
}): EvidenceItem {
  const sourceId = params.sourceId ?? "ms-teams-admin";
  const powershell = sourceId === "ms-teams-powershell";
  return {
    evidenceId: params.id,
    chunkId: `${params.id}-chunk`,
    documentId: `${params.id}-doc`,
    source: {
      sourceId,
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain:
        params.sourceDomain ??
        (powershell ? "teams_powershell" : "teams_admin"),
      authorityTier: "tier1",
      authorityRoles: powershell
        ? ["teams_powershell_cmdlet_primary"]
        : ["teams_admin_primary"],
      routePriority: params.routePriority ?? "primary",
      title: params.title,
      canonicalUrl: `https://learn.microsoft.com/docs/${params.id}`,
      sourcePath: `docs/${params.id}.md`,
      sourceRevision: { transport: "github", commitSha: "r3-fixture" }
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
      fusionRank: params.fusionRank ?? 1,
      fusionScore: 100,
      methodSignals: {
        methods: ["lexical"],
        exact: { matched: powershell, score: powershell ? 1 : null, rank: 1 },
        lexical: { score: 1, rank: params.fusionRank ?? 1 },
        semantic: { similarity: null, rank: null }
      },
      exactMatch: null,
      retrievalReasons: ["fixture"]
    },
    selectionReason: "selected:aspect:fixture:direct"
  };
}

function makeCoverage(params: {
  aspects: EvidenceAspect[];
  evidenceByAspect: Record<string, string[]>;
  supportedAspectIds?: string[];
  unsupportedAspectIds?: string[];
  authorityLimitedAspectIds?: string[];
}): EvidenceAspectCoverage {
  const supported =
    params.supportedAspectIds ??
    params.aspects
      .filter((aspect) => aspect.requirement === "mandatory")
      .map((aspect) => aspect.aspectId);
  const supportByAspect: EvidenceAspectCoverage["supportByAspect"] = {};
  for (const aspect of params.aspects) supportByAspect[aspect.aspectId] = [];
  return {
    aspects: params.aspects,
    evidenceByAspect: params.evidenceByAspect,
    supportByAspect,
    supportedMandatoryAspectIds: supported,
    unsupportedMandatoryAspectIds: params.unsupportedAspectIds ?? [],
    authorityLimitedAspectIds: params.authorityLimitedAspectIds ?? [],
    supportingOnlyAspectIds: [],
    contextualOnlyAspectIds: [],
    supportedOptionalAspectIds: []
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

function makeBundle(params: {
  intent?: QueryIntent;
  aspects?: EvidenceAspect[];
  evidence?: EvidenceItem[];
  evidenceByAspect?: Record<string, string[]>;
  supportedAspectIds?: string[];
  unsupportedAspectIds?: string[];
  authorityLimitedAspectIds?: string[];
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
      id: "ev-overview",
      title: "Direct Routing overview",
      text:
        "Direct Routing lets organizations connect their telephony infrastructure to Teams Phone. Voice routing maps calls through configured routes and policies."
    })
  ];
  const evidenceByAspect =
    params.evidenceByAspect ??
    Object.fromEntries(
      aspects.map((aspect) => [
        aspect.aspectId,
        evidence.map((item) => item.evidenceId)
      ])
    );
  const decisionState: EvidenceBundleDecisionState = {
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
    freshness: {
      state: "current",
      requiresVerification: false,
      reasons: []
    },
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
      supportedAspectIds: params.supportedAspectIds,
      unsupportedAspectIds: params.unsupportedAspectIds,
      authorityLimitedAspectIds: params.authorityLimitedAspectIds
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
    decisionState,
    "2026-08-09T00:00:00.000Z"
  );
}

test("evidence count does not determine claim count", () => {
  const evidence = [
    makeEvidence({
      id: "ev-purpose",
      title: "Routing overview",
      text: "Direct Routing lets organizations connect telephony to Teams Phone."
    }),
    makeEvidence({
      id: "ev-mechanism",
      title: "Routing mechanism",
      text: "Direct Routing maps calls through configured routes and policies."
    }),
    makeEvidence({
      id: "ev-detail",
      title: "Routing detail",
      text: "Direct Routing can use tenant configuration."
    }),
    makeEvidence({
      id: "ev-example",
      title: "Routing example",
      text: "Direct Routing examples use sample tenants."
    })
  ];
  const plan = buildAnswerPlan(makeBundle({ evidence }));
  assert.equal(evidence.length, 4);
  assert.equal(plan.plannedClaims.length, 2);
  assert.notEqual(plan.plannedClaims.length, evidence.length);
  assert.ok(plan.diagnostics.evidenceWithoutIndependentClaims.length > 0);
});

test("broad conceptual aspect produces a minimal facet-covering claim set", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  assert.ok(plan.plannedClaims.length >= 1);
  assert.ok(plan.plannedClaims.length <= 2);
  assert.deepEqual(
    new Set(plan.plannedClaims.flatMap((claim) => claim.coveredFacets)),
    new Set(["purpose", "mechanism"])
  );
  const validation = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
});

test("duplicate evidence does not create duplicate claims", () => {
  const sentence =
    "Direct Routing lets organizations connect telephony to Teams Phone.";
  const mechanism =
    "Direct Routing maps calls through configured routes and policies.";
  const evidence = [
    makeEvidence({
      id: "ev-a",
      title: "Direct Routing A",
      text: `${sentence} ${mechanism}`
    }),
    makeEvidence({
      id: "ev-b",
      title: "Direct Routing B",
      text: `${sentence} ${mechanism}`
    })
  ];
  const plan = buildAnswerPlan(makeBundle({ evidence }));
  assert.equal(
    new Set(plan.plannedClaims.map((claim) => claim.proposition)).size,
    plan.plannedClaims.length
  );
  assert.ok(plan.plannedClaims.length <= 2);
});

test("one claim may reference multiple corroborating source spans", () => {
  const sentence =
    "Direct Routing lets organizations connect telephony to Teams Phone.";
  const evidence = [
    makeEvidence({
      id: "ev-a",
      title: "Direct Routing A",
      text: `${sentence} Direct Routing maps calls through routes.`
    }),
    makeEvidence({
      id: "ev-b",
      title: "Direct Routing B",
      text: `${sentence} Direct Routing maps calls through routes.`
    })
  ];
  const plan = buildAnswerPlan(makeBundle({ evidence }));
  const purpose = plan.plannedClaims.find((claim) =>
    claim.coveredFacets.includes("purpose")
  );
  assert.ok(purpose);
  assert.equal(purpose.sourceSpans.length, 2);
  assert.deepEqual(new Set(purpose.evidenceIds), new Set(["ev-a", "ev-b"]));
});

test("one evidence item may support multiple structurally justified claims", () => {
  const plan = buildAnswerPlan(makeBundle());
  assert.equal(plan.evidenceReferences.usedEvidenceIds.length, 1);
  assert.equal(plan.plannedClaims.length, 2);
  assert.ok(
    plan.plannedClaims.every((claim) =>
      claim.evidenceIds.includes("ev-overview")
    )
  );
});

test("implicit cmdlet produces one canonical identifier and operation claim", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:cmdlet-identifier:voice-policy:assign",
    subject: "voice routing policy",
    subjectTerms: ["voice", "routing", "policy"],
    subjects: [
      {
        kind: "policy",
        value: "voice routing policy",
        terms: ["voice", "routing", "policy"], aliases: [String("voice routing policy").toLowerCase()], questionSpans: ["voice routing policy"]
      }
    ],
    operation: "assign",
    answerObject: "cmdlet_identifier",
    breadth: "narrow",
    requiredFacets: ["identifier", "operation"],
    authorityRequirement: {
      requiredRoles: ["teams_powershell_cmdlet_primary"],
      requiredDomains: ["teams_powershell"],
      requireCanonicalIdentity: true,
      identityType: "cmdlet"
    },
    supportType: "cmdlet_semantics"
  });
  const evidence = makeEvidence({
    id: "ev-grant",
    sourceId: "ms-teams-powershell",
    title: "Grant-CsOnlineVoiceRoutingPolicy",
    text:
      "Grant-CsOnlineVoiceRoutingPolicy assigns an online voice routing policy to a user."
  });
  const bundle = makeBundle({
    intent: makeIntent({
      originalQuestion:
        "Which cmdlet assigns a Teams voice routing policy to a user?",
      normalizedQuestion:
        "which cmdlet assigns a teams voice routing policy to a user",
      domains: ["teams_powershell"],
      expectedAnswerType: "reference",
      entities: ["voice routing policy"],
      operationIntents: ["assign"]
    }),
    aspects: [aspect],
    evidence: [evidence]
  });
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.plannedClaims.length, 1);
  assert.deepEqual(
    new Set(plan.plannedClaims[0]?.coveredFacets),
    new Set(["identifier", "operation"])
  );
  assert.match(
    plan.plannedClaims[0]?.proposition ?? "",
    /Grant-CsOnlineVoiceRoutingPolicy/
  );
});

test("explicit cmdlet semantics remains exact-span source-bound", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:cmdlet:set-csonlinevoiceroutingpolicy:general",
    subject: "Set-CsOnlineVoiceRoutingPolicy",
    subjectTerms: ["set-csonlinevoiceroutingpolicy"],
    subjects: [
      {
        kind: "cmdlet",
        value: "Set-CsOnlineVoiceRoutingPolicy",
        terms: ["set-csonlinevoiceroutingpolicy"], aliases: [String("Set-CsOnlineVoiceRoutingPolicy").toLowerCase()], questionSpans: ["Set-CsOnlineVoiceRoutingPolicy"]
      }
    ],
    answerObject: "cmdlet_semantics",
    breadth: "bounded",
    requiredFacets: ["identifier", "behavior"],
    canonicalIdentifier: {
      type: "cmdlet",
      value: "Set-CsOnlineVoiceRoutingPolicy"
    },
    authorityRequirement: {
      requiredRoles: ["teams_powershell_cmdlet_primary"],
      requiredDomains: ["teams_powershell"],
      requireCanonicalIdentity: true,
      identityType: "cmdlet"
    },
    supportType: "cmdlet_semantics"
  });
  const evidence = makeEvidence({
    id: "ev-set",
    sourceId: "ms-teams-powershell",
    title: "Set-CsOnlineVoiceRoutingPolicy",
    text:
      "Set-CsOnlineVoiceRoutingPolicy modifies an online voice routing policy."
  });
  const bundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "What does Set-CsOnlineVoiceRoutingPolicy do?",
      normalizedQuestion: "what does set-csonlinevoiceroutingpolicy do",
      domains: ["teams_powershell"],
      expectedAnswerType: "reference",
      commandNames: ["Set-CsOnlineVoiceRoutingPolicy"]
    }),
    aspects: [aspect],
    evidence: [evidence],
    exactIdentifierValidation: {
      required: true,
      verified: true,
      requiredDirectives: [
        { type: "cmdlet", value: "Set-CsOnlineVoiceRoutingPolicy" }
      ],
      missingRequiredDirectives: []
    }
  });
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.plannedClaims.length, 1);
  assert.ok(plan.plannedClaims[0]?.sourceSpans.length);
  const validation = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
});

test("procedure claims preserve documented step order", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:entity:routing:configure",
    subject: "routing",
    subjectTerms: ["routing"],
    operation: "configure",
    answerObject: "procedure",
    breadth: "bounded",
    requiredFacets: ["procedure", "operation"],
    supportType: "procedure"
  });
  const evidence = [
    makeEvidence({
      id: "ev-step-2",
      title: "Configure routing",
      headingPath: ["Configure routing", "Step 2"],
      text: "Step 2. Configure routing policy assignments.",
      fusionRank: 1
    }),
    makeEvidence({
      id: "ev-step-1",
      title: "Configure routing",
      headingPath: ["Configure routing", "Step 1"],
      text: "Step 1. Open the routing configuration.",
      fusionRank: 2
    }),
    makeEvidence({
      id: "ev-step-3",
      title: "Configure routing",
      headingPath: ["Configure routing", "Step 3"],
      text: "Step 3. Validate routing behavior.",
      fusionRank: 3
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
  const plan = buildAnswerPlan(bundle);
  assert.deepEqual(
    plan.plannedClaims
      .filter((claim) => claim.claimType === "procedure_step")
      .map((claim) => claim.ordering.procedureStep),
    [1, 2, 3]
  );
});

test("partial answer plans claims only for directly supported aspects", () => {
  const supported = makeTestAspect({
    aspectId: "mandatory:entity:external-access:general",
    subject: "external access",
    subjectTerms: ["external", "access"],
    subjects: [
      {
        kind: "entity",
        value: "external access",
        terms: ["external", "access"], aliases: [String("external access").toLowerCase()], questionSpans: ["external access"]
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
        terms: ["guest", "access"], aliases: [String("guest access").toLowerCase()], questionSpans: ["guest access"]
      }
    ]
  });
  const evidence = makeEvidence({
    id: "ev-external",
    title: "External access overview",
    text:
      "External access lets users communicate across organizations. Federation routes chats between allowed domains."
  });
  const bundle = makeBundle({
    aspects: [supported, unsupported],
    evidence: [evidence],
    evidenceByAspect: {
      [supported.aspectId]: [evidence.evidenceId],
      [unsupported.aspectId]: []
    },
    supportedAspectIds: [supported.aspectId],
    unsupportedAspectIds: [unsupported.aspectId],
    authorityLimitedAspectIds: [unsupported.aspectId],
    answerability: "partial",
    authorityCoverage: {
      requestedDomains: ["teams_admin", "entra"],
      coveredDomains: ["teams_admin"],
      missingDomains: ["entra"]
    }
  });
  const plan = buildAnswerPlan(bundle);
  assert.ok(
    plan.plannedClaims.every(
      (claim) => claim.requiredAspectId === supported.aspectId
    )
  );
  assert.ok(
    plan.unsupportedAspects.some(
      (aspect) =>
        aspect.aspectId === unsupported.aspectId &&
        aspect.reason === "missing_authority"
    )
  );
});

test("insufficient evidence produces zero normal factual claims", () => {
  const aspect = makeTestAspect();
  const bundle = makeBundle({
    aspects: [aspect],
    evidence: [],
    evidenceByAspect: { [aspect.aspectId]: [] },
    supportedAspectIds: [],
    unsupportedAspectIds: [aspect.aspectId],
    answerability: "insufficient_evidence"
  });
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.plannedClaims.length, 0);
  assert.ok(plan.unsupportedAspects.length > 0);
});

test("claims retain exact source offsets and content hashes", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  for (const claim of plan.plannedClaims) {
    for (const span of claim.sourceSpans) {
      const evidence = bundle.evidence.find(
        (item) => item.evidenceId === span.evidenceId
      );
      assert.ok(evidence);
      assert.equal(
        evidence.text.slice(span.startOffset, span.endOffset),
        span.text
      );
      assert.equal(hashSourceSpanContent(span.text), span.contentHash);
    }
  }
  const validation = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
});

test("authority role remains attached to claims and spans", () => {
  const plan = buildAnswerPlan(makeBundle());
  assert.ok(
    plan.plannedClaims.every((claim) =>
      claim.authorityContext.authorityRoles.includes("teams_admin_primary")
    )
  );
  assert.ok(
    plan.plannedClaims.every((claim) =>
      claim.sourceSpans.every(
        (span) => span.authorityRole === "teams_admin_primary"
      )
    )
  );
});

test("snapshot mismatch and plan span mutation both fail closed", () => {
  const bundle = makeBundle();
  const plan = buildAnswerPlan(bundle);
  const staleBundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "How does another feature work?",
      normalizedQuestion: "how does another feature work"
    })
  });
  assert.equal(
    validateGroundingDecisionBoundary({ bundle: staleBundle, plan }).valid,
    false
  );

  const mutated = structuredClone(plan);
  mutated.plannedClaims[0]!.sourceSpans[0]!.text = "mutated span";
  const integrity = validateAnswerPlanIntegrity({ bundle, plan: mutated });
  assert.equal(integrity.valid, false);
  assert.ok(
    integrity.issues.some(
      (issue) =>
        issue.code === "plan_hash_mismatch" ||
        issue.code === "claim_span_text_mismatch"
    )
  );
});

test("planner selects facet-bearing spans rather than the first chunk sentence", () => {
  const evidence = makeEvidence({
    id: "ev-not-first",
    title: "Direct Routing overview",
    text:
      "This document contains administrative guidance. Direct Routing lets organizations connect telephony to Teams Phone. Voice routing maps calls through configured routes."
  });
  const plan = buildAnswerPlan(makeBundle({ evidence: [evidence] }));
  assert.ok(
    plan.plannedClaims.every(
      (claim) => !claim.proposition.startsWith("This document")
    )
  );
  assert.ok(
    plan.plannedClaims.some((claim) =>
      claim.proposition.startsWith("Direct Routing lets")
    )
  );
});

test("generic compound subject planning has no scenario-specific URL or title rule", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:entity:packet-media-path:general",
    subject: "packet mediation media path",
    subjectTerms: ["packet", "mediation", "media", "path"],
    subjects: [
      {
        kind: "entity",
        value: "packet mediation",
        terms: ["packet", "mediation"], aliases: [String("packet mediation").toLowerCase()], questionSpans: ["packet mediation"]
      },
      {
        kind: "entity",
        value: "media path",
        terms: ["media", "path"], aliases: [String("media path").toLowerCase()], questionSpans: ["media path"]
      }
    ],
    requiredFacets: ["purpose", "mechanism"]
  });
  const evidence = makeEvidence({
    id: "opaque-a",
    title: "Arbitrary technical overview",
    text:
      "Packet mediation allows approved media traversal. The media path routes packets through the selected relay."
  });
  const bundle = makeBundle({
    aspects: [aspect],
    evidence: [evidence],
    evidenceByAspect: { [aspect.aspectId]: [evidence.evidenceId] }
  });
  const plan = buildAnswerPlan(bundle);
  const validation = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.deepEqual(
    new Set(plan.plannedClaims.flatMap((claim) => claim.coveredFacets)),
    new Set(["purpose", "mechanism"])
  );
});

test("broad conceptual planning does not substitute a trailing procedure list for the core proposition", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:entity:external-access:general",
    subject: "external access",
    subjectTerms: ["external", "access"],
    subjects: [
      {
        kind: "entity",
        value: "external access",
        terms: ["external", "access"], aliases: [String("external access").toLowerCase()], questionSpans: ["external access"]
      }
    ],
    requiredFacets: ["purpose", "mechanism"]
  });
  const evidence = makeEvidence({
    id: "ev-external-list",
    title: "External access",
    text:
      "External access allows communication using federated identities. Configure external access with:\n\n- trusted organizations\n- approved accounts"
  });
  const bundle = makeBundle({
    aspects: [aspect],
    evidence: [evidence],
    evidenceByAspect: { [aspect.aspectId]: [evidence.evidenceId] }
  });
  const plan = buildAnswerPlan(bundle);
  assert.equal(plan.plannedClaims.length, 1);
  assert.equal(
    plan.plannedClaims[0]?.proposition,
    "External access allows communication using federated identities."
  );
  assert.deepEqual(
    new Set(plan.plannedClaims[0]?.coveredFacets),
    new Set(["purpose", "mechanism"])
  );
});

test("R3 plans the exact plural calling-policy DESCRIPTION state span accepted by R2", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:policy:calling-policy:general",
    subject: "calling policy",
    subjectTerms: ["calling", "policy"],
    subjects: [
      makeTestSubject(
        "policy",
        "calling policy",
        ["calling", "policy"]
      )
    ],
    answerObject: "configuration_state",
    breadth: "narrow",
    requiredFacets: ["state"],
    methodConstraints: [
      {
        kind: "powershell",
        label: "PowerShell",
        required: true,
        domains: ["teams_powershell"],
        authorityRoles: ["teams_powershell_cmdlet_primary"]
      }
    ],
    authorityRequirement: {
      requiredRoles: ["teams_powershell_cmdlet_primary"],
      requiredDomains: ["teams_powershell"],
      requireCanonicalIdentity: false,
      identityType: null
    },
    supportType: "licensing_or_status"
  });
  const exactText =
    "Returns information about the teams calling policies configured for use in your organization.";
  const evidence = makeEvidence({
    id: "calling-policy-description",
    sourceId: "ms-teams-powershell",
    title: "Get-CsTeamsCallingPolicy",
    headingPath: ["Get-CsTeamsCallingPolicy", "DESCRIPTION"],
    text: exactText
  });
  const bundle = makeBundle({
    intent: makeIntent({
      originalQuestion:
        "Determine the calling policy with PowerShell.",
      normalizedQuestion:
        "determine the calling policy with powershell",
      domains: ["teams_powershell"],
      technologies: ["PowerShell"],
      entities: ["calling policy"],
      policyNames: ["calling policy"],
      expectedAnswerType: "configuration"
    }),
    aspects: [aspect],
    evidence: [evidence],
    evidenceByAspect: {
      [aspect.aspectId]: [evidence.evidenceId]
    },
    answerability: "answered",
    authorityCoverage: {
      requestedDomains: ["teams_powershell"],
      coveredDomains: ["teams_powershell"],
      missingDomains: []
    }
  });

  const plan = buildAnswerPlan(bundle);
  const claim = plan.plannedClaims.find(
    (item) => item.requiredAspectId === aspect.aspectId
  );
  assert.ok(claim);
  assert.deepEqual(claim.coveredFacets, ["state"]);
  assert.equal(claim.proposition, exactText);
  assert.equal(claim.sourceSpans[0]?.text, exactText);
  assert.ok(
    !plan.unsupportedAspects.some(
      (item) => item.aspectId === aspect.aspectId
    )
  );
  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;
  assert.ok(assembled.answer.answerText.includes(exactText));
  assert.equal(assembled.answer.diagnostics.requestCount, 0);
});
