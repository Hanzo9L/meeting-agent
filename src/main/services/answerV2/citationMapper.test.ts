import assert from "node:assert/strict";
import test from "node:test";
import type { QueryIntent } from "../retrievalV2";
import {
  bindAnswerPlanIdentity,
  type AnswerPlanState
} from "./answerPlanIntegrity";
import { buildAnswerPlan } from "./answerPlanner";
import { mapAnswerCitations } from "./citationMapper";
import { assembleDeterministicAnswer } from "./deterministicAnswerAssembler";
import {
  bindEvidenceBundleSnapshot,
  type EvidenceBundleDecisionState
} from "./groundingDecisionSnapshot";
import { makeTestAspect } from "./testAspectFixtures";
import type {
  AnswerPlan,
  EvidenceAspect,
  EvidenceBundle,
  EvidenceItem,
  GroundedAnswer
} from "./types";

function makeEvidence(params: {
  id: string;
  title?: string;
  text?: string;
  canonicalUrl?: string;
  revisionCanonicalUrl?: string | null;
  sourceId?: string;
  sourcePath?: string;
  authorityRoles?: EvidenceItem["source"]["authorityRoles"];
  sourceStatus?: EvidenceItem["source"]["sourceStatus"];
  supportTypes?: EvidenceItem["supportTypes"];
  revision?: Record<string, unknown>;
}): EvidenceItem {
  const sourceId = params.sourceId ?? "ms-teams-admin";
  const powershell = sourceId === "ms-teams-powershell";
  const title =
    params.title ??
    (powershell ? "Set-CsPolicy" : "Direct Routing");
  const sourcePath =
    params.sourcePath ??
    (powershell
      ? `teams/teams-ps/MicrosoftTeams/${title}.md`
      : "microsoftteams/direct-routing");
  const canonicalUrl =
    params.canonicalUrl ??
    (powershell
      ? `https://github.com/MicrosoftDocs/office-docs-powershell/blob/abc/${sourcePath}`
      : "https://learn.microsoft.com/en-us/microsoftteams/direct-routing");
  const revision =
    params.revision ??
    (powershell
      ? {
          transport: "github",
          repository: "MicrosoftDocs/office-docs-powershell",
          commitSha: "a".repeat(40),
          path: sourcePath
        }
      : {
          transport: "learn_mcp",
          canonicalUrl:
            params.revisionCanonicalUrl === null
              ? undefined
              : params.revisionCanonicalUrl ??
                "https://learn.microsoft.com/en-us/microsoftteams/direct-routing",
          contentHash: "fixture"
        });
  return {
    evidenceId: params.id,
    chunkId: `${params.id}-chunk`,
    documentId: `${params.id}-document`,
    source: {
      sourceId,
      trackId: "ga",
      sourceStatus: params.sourceStatus ?? "ga",
      sourceDomain: powershell ? "teams_powershell" : "teams_admin",
      authorityTier: "tier1",
      authorityRoles:
        params.authorityRoles ??
        (powershell
          ? ["teams_powershell_cmdlet_primary"]
          : ["teams_admin_primary"]),
      routePriority: "primary",
      title,
      canonicalUrl,
      sourcePath,
      sourceRevision: revision
    },
    location: {
      sectionId: `section-${params.id}`,
      headingPath: [title]
    },
    text:
      params.text ??
      "Direct Routing lets organizations connect telephony to Teams Phone. Direct Routing maps calls through voice routes.",
    supportTypes: params.supportTypes ?? ["concept_definition"],
    retrieval: {
      methods: ["lexical"],
      fusionRank: 1,
      fusionScore: 1,
      methodSignals: {
        methods: ["lexical"],
        exact: { matched: false, score: null, rank: null },
        lexical: { score: 1, rank: 1 },
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

function makeBundle(params: {
  intent?: QueryIntent;
  aspects?: EvidenceAspect[];
  evidence?: EvidenceItem[];
  supported?: string[];
  unsupported?: string[];
  evidenceByAspect?: Record<string, string[]>;
  answerability?: EvidenceBundle["answerability"];
  rejectedChunkIds?: string[];
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
  const evidence = params.evidence ?? [makeEvidence({ id: "ev-default" })];
  const supported =
    params.supported ??
    aspects
      .filter((aspect) => aspect.requirement === "mandatory")
      .map((aspect) => aspect.aspectId);
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
    rejectedCandidates: (params.rejectedChunkIds ?? []).map(
      (chunkId, index) => ({
        candidateId: `rejected-${index}`,
        chunkId,
        documentId: `rejected-doc-${index}`,
        title: "Rejected",
        sourceId: "ms-teams-admin",
        fusionRank: index + 1,
        reasons: ["insufficient_direct_support"]
      })
    ),
    conflicts: [],
    freshness: { state: "current", requiresVerification: false, reasons: [] },
    exactIdentifierValidation: {
      required: false,
      verified: true,
      requiredDirectives: [],
      missingRequiredDirectives: []
    },
    aspectCoverage: {
      aspects,
      evidenceByAspect,
      supportByAspect: Object.fromEntries(
        aspects.map((aspect) => [aspect.aspectId, []])
      ),
      supportedMandatoryAspectIds: supported,
      unsupportedMandatoryAspectIds: params.unsupported ?? [],
      authorityLimitedAspectIds: [],
      supportingOnlyAspectIds: [],
      contextualOnlyAspectIds: [],
      supportedOptionalAspectIds: []
    },
    authorityCoverage: {
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
        rejectedCandidates: params.rejectedChunkIds?.length ?? 0
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

function pipeline(bundle: EvidenceBundle): {
  plan: AnswerPlan;
  answer: GroundedAnswer;
} {
  const plan = buildAnswerPlan(bundle);
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  if (!assembled.ok) {
    throw new Error(
      `${assembled.failure.message} ${JSON.stringify(
        assembled.failure.planIntegrityIssues ??
          assembled.failure.assemblyIssues ??
          []
      )}`
    );
  }
  assert.equal(assembled.ok, true);
  return { plan, answer: assembled.answer };
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

test("valid source-bound span produces a valid Microsoft citation", () => {
  const aspect = makeTestAspect({
    aspectId: "mandatory:cmdlet:set-cspolicy:general",
    subject: "Set-CsPolicy",
    subjectTerms: ["set-cspolicy"],
    subjects: [
      {
        kind: "cmdlet",
        value: "Set-CsPolicy",
        terms: ["set-cspolicy"], aliases: [String("Set-CsPolicy").toLowerCase()], questionSpans: ["Set-CsPolicy"]
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
    id: "ev-powershell",
    sourceId: "ms-teams-powershell",
    title: "Set-CsPolicy",
    text: "Set-CsPolicy updates a documented policy."
  });
  const bundle = makeBundle({
    intent: makeIntent({
      domains: ["teams_powershell"],
      commandNames: ["Set-CsPolicy"],
      expectedAnswerType: "reference"
    }),
    aspects: [aspect],
    evidence: [evidence]
  });
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.validation.valid, true);
  assert.equal(mapped.citations.length, 1);
  assert.equal(mapped.citations[0]?.validation.state, "valid");
  assert.equal(
    mapped.citations[0]?.canonicalUrl,
    "https://learn.microsoft.com/powershell/module/microsoftteams/set-cspolicy"
  );
  assert.equal(
    mapped.citations[0]?.canonicalUrlSource,
    "powershell_document_identity"
  );
});

test("snapshot mismatch invalidates every citation without changing answer text", () => {
  const bundle = makeBundle();
  const { plan, answer } = pipeline(bundle);
  const otherBundle = makeBundle({
    intent: makeIntent({
      originalQuestion: "How does another feature work?",
      normalizedQuestion: "how does another feature work"
    })
  });
  const mapped = mapAnswerCitations({
    bundle: otherBundle,
    plan,
    answer
  });
  assert.equal(mapped.validation.valid, false);
  assert.ok(
    mapped.citations.every((citation) =>
      citation.validation.failureReasons.includes("snapshot_mismatch")
    )
  );
  assert.equal(mapped.answerText, answer.answerText);
});

test("span hash mismatch invalidates citation", () => {
  const bundle = makeBundle();
  const { plan, answer } = pipeline(bundle);
  const mutated = structuredClone(answer);
  mutated.extractiveAssembly!.renderedClaims[0]!.sourceSpans[0]!.contentHash =
    "0".repeat(64);
  const mapped = mapAnswerCitations({
    bundle,
    plan,
    answer: mutated
  });
  assert.equal(mapped.validation.valid, false);
  assert.ok(
    mapped.citations.some((citation) =>
      citation.validation.failureReasons.includes("span_hash_mismatch")
    )
  );
});

test("rejected evidence cannot become a citation", () => {
  const evidence = makeEvidence({ id: "ev-rejected" });
  const bundle = makeBundle({
    evidence: [evidence],
    rejectedChunkIds: [evidence.chunkId]
  });
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.validation.valid, false);
  assert.ok(
    mapped.citations.some((citation) =>
      citation.validation.failureReasons.includes("rejected_evidence")
    )
  );
});

test("contextual-only evidence cannot become a citation", () => {
  const evidence = makeEvidence({
    id: "ev-context",
    supportTypes: ["contextual"]
  });
  const bundle = makeBundle({ evidence: [evidence] });
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.validation.valid, false);
  assert.ok(
    mapped.citations.some((citation) =>
      citation.validation.failureReasons.includes("contextual_evidence")
    )
  );
});

test("guessed canonical URL is not accepted without trusted provenance", () => {
  const evidence = makeEvidence({
    id: "ev-guessed",
    canonicalUrl:
      "https://learn.microsoft.com/en-us/microsoftteams/direct-routing",
    revisionCanonicalUrl: null,
    revision: { transport: "learn_mcp" }
  });
  const bundle = makeBundle({ evidence: [evidence] });
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.citations[0]?.canonicalUrl, null);
  assert.ok(
    mapped.citations[0]?.validation.failureReasons.includes(
      "canonical_url_untrusted"
    )
  );
});

test("missing canonical URL fails visibly", () => {
  const evidence = makeEvidence({
    id: "ev-missing-url",
    canonicalUrl: "",
    revision: { transport: "learn_mcp" }
  });
  const bundle = makeBundle({ evidence: [evidence] });
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.factualRanges[0]?.coverage, "zero");
  assert.ok(
    mapped.citations[0]?.validation.failureReasons.includes(
      "canonical_url_missing"
    )
  );
});

test("wrong authority role is rejected", () => {
  const bundle = makeBundle();
  const { plan, answer } = pipeline(bundle);
  const mutated = structuredClone(answer);
  mutated.extractiveAssembly!.renderedClaims[0]!.sourceSpans[0]!.authorityRole =
    "teams_powershell_cmdlet_primary";
  const mapped = mapAnswerCitations({
    bundle,
    plan,
    answer: mutated
  });
  assert.ok(
    mapped.citations.some((citation) =>
      citation.validation.failureReasons.includes(
        "authority_role_mismatch"
      )
    )
  );
});

test("preview source status and pending freshness are preserved", () => {
  const evidence = makeEvidence({
    id: "ev-preview",
    sourceStatus: "preview"
  });
  const stateBundle = makeBundle({ evidence: [evidence] });
  const { decisionSnapshot: _snapshot, ...state } = stateBundle;
  state.freshness = {
    state: "verification_required",
    requiresVerification: true,
    reasons: ["preview source requires verification"]
  };
  const bundle = bindEvidenceBundleSnapshot(
    state,
    "2026-08-09T00:00:00.000Z"
  );
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.citations[0]?.sourceStatus, "preview");
  assert.equal(
    mapped.citations[0]?.freshnessState.mustVerifyBeforeFinalAnswer,
    true
  );
  assert.equal(mapped.previewState.previewEvidenceUsed, true);
});

test("redundant corroborating spans collapse to one citation", () => {
  const bundle = makeBundle();
  const { plan, answer } = pipeline(bundle);
  const duplicated = structuredClone(answer);
  for (const rendered of duplicated.extractiveAssembly!.renderedClaims) {
    rendered.sourceSpans.push(
      structuredClone(rendered.sourceSpans[0]!)
    );
  }
  const mapped = mapAnswerCitations({
    bundle,
    plan,
    answer: duplicated
  });
  assert.ok(mapped.factualRanges.length > 0);
  assert.ok(
    mapped.factualRanges.every(
      (range) => range.citationIds.length === 1
    )
  );
});

test("genuinely multi-source claim retains multiple citations", () => {
  const evidence = [
    makeEvidence({
      id: "ev-purpose",
      text:
        "Direct Routing lets organizations connect telephony to Teams Phone.",
      revisionCanonicalUrl:
        "https://learn.microsoft.com/en-us/microsoftteams/direct-routing"
    }),
    makeEvidence({
      id: "ev-mechanism",
      text: "Direct Routing maps calls through voice routes.",
      canonicalUrl:
        "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      revisionCanonicalUrl:
        "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      sourcePath: "microsoftteams/direct-routing-plan"
    })
  ];
  const bundle = makeBundle({ evidence });
  const initial = buildAnswerPlan(bundle);
  assert.equal(initial.plannedClaims.length, 2);
  const plan = rebindPlan(initial, (state) => {
    const first = state.plannedClaims[0]!;
    const second = state.plannedClaims[1]!;
    first.proposition = `${first.proposition} — ${second.proposition}`;
    first.coveredFacets = [
      ...new Set([...first.coveredFacets, ...second.coveredFacets])
    ];
    first.sourceSpans = [
      ...first.sourceSpans,
      ...second.sourceSpans
    ];
    first.evidenceIds = [
      ...new Set([...first.evidenceIds, ...second.evidenceIds])
    ];
    state.plannedClaims = [first];
    state.plannedClaims[0]!.ordering.sequence = 1;
  });
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;
  const mapped = mapAnswerCitations({
    bundle,
    plan,
    answer: assembled.answer
  });
  assert.equal(mapped.factualRanges[0]?.coverage, "multiple");
  assert.equal(mapped.factualRanges[0]?.citationIds.length, 2);
});

test("partial answer cites only supported factual ranges", () => {
  const supported = makeTestAspect({
    aspectId: "mandatory:entity:direct-routing:general"
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
  const evidence = makeEvidence({ id: "ev-supported" });
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
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.ok(mapped.citations.length > 0);
  assert.ok(
    mapped.citations.every(
      (citation) => citation.claimId !== unsupported.aspectId
    )
  );
  assert.equal(
    mapped.factualRanges.length,
    answer.extractiveAssembly?.renderedClaims.length
  );
});

test("insufficient-evidence answer fabricates no technical citation", () => {
  const aspect = makeTestAspect();
  const bundle = makeBundle({
    aspects: [aspect],
    evidence: [],
    supported: [],
    unsupported: [aspect.aspectId],
    evidenceByAspect: { [aspect.aspectId]: [] },
    answerability: "insufficient_evidence"
  });
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.citations.length, 0);
  assert.equal(mapped.factualRanges.length, 0);
  assert.equal(mapped.validation.valid, true);
});

test("citation mapping leaves R4 answer text byte-for-byte unchanged", () => {
  const bundle = makeBundle();
  const { plan, answer } = pipeline(bundle);
  const before = Buffer.from(answer.answerText, "utf8");
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.deepEqual(
    Buffer.from(mapped.answerText, "utf8"),
    before
  );
  assert.equal(answer.answerText, mapped.answerText);
});

test("citation mapping performs no retrieval, provider, or model calls", () => {
  const bundle = makeBundle();
  const { plan, answer } = pipeline(bundle);
  const mapped = mapAnswerCitations({ bundle, plan, answer });
  assert.equal(mapped.diagnostics.providerRequestCount, 0);
  assert.equal(mapped.validation.valid, true);
});
