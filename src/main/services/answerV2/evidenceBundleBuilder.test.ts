import assert from "node:assert/strict";
import test from "node:test";
import type { HybridRetrievalResult, FusedRetrievalCandidate } from "../retrievalV2";
import { buildEvidenceBundle } from "./evidenceBundleBuilder";

function makeCandidate(params: {
  rank: number;
  sourceId: string;
  routePriority: "primary" | "supporting";
  title: string;
  text: string;
  url: string;
  documentId?: string;
  chunkId?: string;
  sourceStatus?: "ga" | "beta" | "preview" | "unknown";
  exact?: { type: "cmdlet" | "policy" | "entity"; value: string; required: boolean };
  authorityTier?: "tier1" | "secondary" | "unknown";
  sourcePath?: string;
  headingPath?: string[];
}): FusedRetrievalCandidate {
  const chunkId = params.chunkId ?? `chunk-${params.rank}-${params.sourceId}`;
  const documentId = params.documentId ?? `doc-${params.sourceId}-${params.rank}`;
  return {
    candidateId: `cand-${chunkId}`,
    method: "semantic",
    documentId,
    chunkId,
    sectionId: "section-a",
    headingPath: params.headingPath ?? ["h1", "h2"],
    title: params.title,
    text: params.text,
    authority: {
      sourceId: params.sourceId,
      trackId: "ga",
      sourceStatus: params.sourceStatus ?? "ga",
      authorityTier: params.authorityTier ?? "tier1",
      authorityRoles:
        params.sourceId === "ms-teams-powershell"
          ? ["teams_powershell_cmdlet_primary"]
          : params.sourceId === "ms-entra-docs"
            ? ["entra_identity_primary"]
            : params.sourceId === "ms-graph-docs"
              ? ["graph_api_primary"]
              : params.sourceId === "ms-sharepoint-powershell"
                ? ["sharepoint_powershell_cmdlet_primary"]
                : params.sourceId === "ms-sharepoint-docs"
                  ? ["sharepoint_admin_primary"]
                  : ["teams_admin_primary"],
      routePriority: params.routePriority
    },
    provenance: {
      sourcePath: params.sourcePath ?? "path/to/doc.md",
      canonicalUrl: params.url,
      sourceRevision: { transport: "github", commitSha: "abc" },
      headingPath: params.headingPath ?? ["h1", "h2"],
      sectionId: "section-a"
    },
    scores: {
      lexical: 0.2,
      exactMatch: params.exact ? 1 : null,
      semanticSimilarity: 0.8
    },
    exactMatch: params.exact
      ? {
          directiveType: params.exact.type,
          directiveValue: params.exact.value,
          required: params.exact.required,
          matchedField: "title"
        }
      : undefined,
    retrievalReasons: ["semantic_match_signal"],
    methods: params.exact ? ["exact", "semantic"] : ["semantic"],
    methodSignals: {
      methods: params.exact ? ["exact", "semantic"] : ["semantic"],
      exact: {
        matched: Boolean(params.exact),
        score: params.exact ? 1 : null,
        rank: params.exact ? params.rank : null
      },
      lexical: { score: 0.2, rank: params.rank },
      semantic: { similarity: 0.8, rank: params.rank }
    },
    fusion: {
      rank: params.rank,
      score: 100 - params.rank,
      contributions: {
        exactScore: params.exact ? 90 : 0,
        lexicalRank: 2,
        semanticRank: 3,
        methodAgreement: params.exact ? 8 : 0,
        routePriority: params.routePriority === "primary" ? 7 : 2,
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

function makeHybrid(params: {
  question: string;
  candidates: FusedRetrievalCandidate[];
  allowsBeta?: boolean;
  commandNames?: string[];
  domains?: Array<
    "teams_admin" | "teams_powershell" | "graph" | "entra" | "m365" | "teams_dev" | "sharepoint"
  >;
  requiredDirective?: { type: "cmdlet" | "policy" | "entity"; value: string };
  missedRequired?: boolean;
  entities?: string[];
  policyNames?: string[];
  operationIntents?: string[];
  answerType?: "conceptual" | "procedural" | "troubleshooting" | "configuration" | "comparison" | "reference";
  products?: string[];
  technologies?: string[];
  unresolvedAmbiguity?: string[];
}): HybridRetrievalResult {
  const intent = {
    originalQuestion: params.question,
    normalizedQuestion: params.question.toLowerCase(),
    domains: params.domains ?? ["teams_admin"],
    products: params.products ?? ["teams"],
    technologies: params.technologies ?? ["teams"],
    entities: params.entities ?? [],
    operationIntents: params.operationIntents ?? [],
    commandNames: params.commandNames ?? [],
    policyNames: params.policyNames ?? [],
    requiresFreshnessCheck: false,
    allowsBetaSources: params.allowsBeta ?? false,
    expectedAnswerType: params.answerType ?? "conceptual",
    retrievalHints: [],
    unresolvedAmbiguity: params.unresolvedAmbiguity ?? []
  };
  return {
    intent,
    scope: {
      intent,
      selectedDomains: params.domains ?? ["teams_admin"],
      focusSubdomains: [],
      eligibleSources: [],
      excludedSources: [],
      sourcePriorityChain: [],
      strategy: { exact: true, lexical: true, semantic: true, semanticPreference: "primary" },
      exactMatchDirectives: params.requiredDirective
        ? [{ type: params.requiredDirective.type, value: params.requiredDirective.value, required: true }]
        : [],
      candidateBudget: {
        maxLexicalCandidates: 64,
        maxSemanticCandidates: 1300,
        broadScopeWarningThreshold: 10000
      },
      scopeMode: "narrow",
      freshnessVerification: { required: false, reasons: [] },
      betaPolicy: { allowsBeta: params.allowsBeta ?? false, excludedBetaTracks: [] },
      estimatedCandidatePopulation: params.candidates.length,
      routingWarnings: [],
      routingRationale: []
    },
    candidates: params.candidates,
    exact: { candidates: [], diagnostics: { eligiblePopulation: 0, matchedPopulation: 0, returnedPopulation: 0, attempted: [], missedRequired: [] }, latencyMs: 1 },
    lexical: { candidates: [], diagnostics: { eligiblePopulation: 0, matchedPopulation: 0, returnedPopulation: 0, lexicalQuery: "", queryTerms: [] }, latencyMs: 1 },
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
      semanticCandidateCount: params.candidates.length,
      uniqueCandidatesBeforeDedup: params.candidates.length,
      uniqueCandidatesAfterDedup: params.candidates.length,
      returnedCandidateCount: params.candidates.length,
      methodOverlapCounts: {
        exactOnly: 0,
        lexicalOnly: 0,
        semanticOnly: params.candidates.length,
        exactAndLexical: 0,
        exactAndSemantic: 0,
        lexicalAndSemantic: 0,
        allThree: 0
      },
      sourceDistribution: {},
      authorityDistribution: {},
      cap: { finalCandidateCap: 24, maxPerDocument: 4, truncated: false },
      requiredExactMisses: params.requiredDirective && params.missedRequired
        ? [{ directiveType: params.requiredDirective.type, directiveValue: params.requiredDirective.value, required: true }]
        : [],
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

test("HybridRetrievalResult converts to compact EvidenceBundle", () => {
  const hybrid = makeHybrid({
    question: "How does Teams Direct Routing voice routing work?",
    entities: ["direct routing", "voice routing"],
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-teams-admin",
        routePriority: "primary",
        title: "Direct Routing voice routing overview",
        text: "Direct Routing voice routing enables PSTN connectivity and routes calls by policy.",
        url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
      })
    ]
  });
  const bundle = buildEvidenceBundle(hybrid).bundle;
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.evidence.length, 1);
  assert.ok(bundle.diagnostics.populations.selectedEvidence < 24);
});

test("candidates are not blindly copied and redundant evidence is rejected", () => {
  const repeated = makeCandidate({
    rank: 2,
    sourceId: "ms-teams-admin",
    routePriority: "primary",
    title: "Direct Routing voice routing overview copy",
    text: "Direct Routing voice routing enables PSTN connectivity and routes calls by policy.",
    url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
  });
  const hybrid = makeHybrid({
    question: "How does Teams Direct Routing voice routing work?",
    entities: ["direct routing", "voice routing"],
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-teams-admin",
        routePriority: "primary",
        title: "Direct Routing voice routing overview",
        text: "Direct Routing voice routing enables PSTN connectivity and routes calls by policy.",
        url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
      }),
      repeated
    ]
  });
  const bundle = buildEvidenceBundle(hybrid).bundle;
  assert.equal(bundle.evidence.length, 1);
  assert.ok(bundle.rejectedCandidates.some((candidate) => candidate.reasons.includes("redundant")));
});

test("provenance and exact cmdlet validation are preserved", () => {
  const hybrid = makeHybrid({
    question: "What does Set-CsOnlineVoiceRoutingPolicy do?",
    commandNames: ["Set-CsOnlineVoiceRoutingPolicy"],
    domains: ["teams_powershell"],
    requiredDirective: { type: "cmdlet", value: "Set-CsOnlineVoiceRoutingPolicy" },
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-teams-powershell",
        routePriority: "primary",
        title: "Set-CsOnlineVoiceRoutingPolicy",
        text: "Set-CsOnlineVoiceRoutingPolicy sets the Online Voice Routing Policy.",
        url: "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
        exact: { type: "cmdlet", value: "Set-CsOnlineVoiceRoutingPolicy", required: true }
      })
    ]
  });
  const bundle = buildEvidenceBundle(hybrid).bundle;
  assert.equal(bundle.exactIdentifierValidation.verified, true);
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.evidence[0]?.source.sourceId, "ms-teams-powershell");
});

test("K2: SharePoint SPO* cmdlet exact-identifier validation is authoritative, not hardcoded to ms-teams-powershell", () => {
  const hybrid = makeHybrid({
    question: "What does Set-SPOSite do?",
    commandNames: ["Set-SPOSite"],
    domains: ["sharepoint"],
    requiredDirective: { type: "cmdlet", value: "Set-SPOSite" },
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-sharepoint-powershell",
        routePriority: "primary",
        title: "Set-SPOSite",
        text: "Set-SPOSite sets properties on a site.",
        url: "https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/set-sposite",
        exact: { type: "cmdlet", value: "Set-SPOSite", required: true }
      })
    ]
  });
  const bundle = buildEvidenceBundle(hybrid).bundle;
  assert.equal(bundle.exactIdentifierValidation.verified, true);
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.evidence[0]?.source.sourceId, "ms-sharepoint-powershell");
});

test("nonexistent required exact cmdlet is insufficient evidence", () => {
  const hybrid = makeHybrid({
    question: "What does Set-CsDefinitelyNotARealCmdlet do?",
    commandNames: ["Set-CsDefinitelyNotARealCmdlet"],
    domains: ["teams_powershell"],
    requiredDirective: { type: "cmdlet", value: "Set-CsDefinitelyNotARealCmdlet" },
    missedRequired: true,
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-teams-powershell",
        routePriority: "primary",
        title: "MicrosoftTeams module",
        text: "General Teams cmdlet guidance.",
        url: "https://learn.microsoft.com/powershell/module/microsoftteams/microsoftteams"
      })
    ]
  });
  const bundle = buildEvidenceBundle(hybrid).bundle;
  assert.equal(bundle.exactIdentifierValidation.verified, false);
  assert.equal(bundle.answerability, "insufficient_evidence");
});

test("beta is excluded by default and preserved when allowed", () => {
  const betaCandidate = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    routePriority: "primary",
    sourceStatus: "beta",
    title: "Meeting policies",
    text: "Meeting policies control meeting capabilities for users.",
    headingPath: ["Meeting policies", "Overview"],
    url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-preview"
  });
  const gaCandidate = makeCandidate({
    rank: 2,
    sourceId: "ms-teams-admin",
    routePriority: "primary",
    title: "Meeting policies",
    text: "Meeting policies control meeting capabilities for users.",
    headingPath: ["Meeting policies", "Overview"],
    url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview"
  });

  const blocked = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work?",
      entities: ["meeting policies"],
      allowsBeta: false,
      candidates: [betaCandidate, gaCandidate]
    })
  ).bundle;
  assert.equal(blocked.evidence.some((item) => item.source.sourceStatus === "beta"), false);

  const allowed = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work in preview?",
      entities: ["meeting policies"],
      allowsBeta: true,
      candidates: [betaCandidate]
    })
  ).bundle;
  assert.equal(allowed.evidence.some((item) => item.source.sourceStatus === "beta"), true);
});

test("high-authority but irrelevant evidence is rejected before ranking bonuses", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does federation work?",
      entities: ["federation"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Authoritative meeting deployment",
          text: "Configure meeting organizers and lobby settings.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/federation"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.evidence.length, 0);
  assert.equal(bundle.answerability, "insufficient_evidence");
  assert.ok(
    bundle.rejectedCandidates[0]?.reasons.includes("low_topical_relevance")
  );
});

test("two-part question with one supported aspect is partial", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Explain federation and tenant restrictions.",
      entities: ["federation", "tenant restrictions"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Federation behavior",
          text: "Federation lets organizations communicate across tenants.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-a"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.answerability, "partial");
  assert.equal(bundle.aspectCoverage.supportedMandatoryAspectIds.length, 1);
  assert.equal(bundle.aspectCoverage.unsupportedMandatoryAspectIds.length, 1);
});

test("multi-part operations remain separate and clause-bound", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How do I assign a routing policy and remove a dial plan?",
      entities: ["routing policy", "dial plan"],
      operationIntents: ["assign", "remove"],
      answerType: "procedural",
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Assign a routing policy",
          text: "Use these steps to assign a routing policy.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-i"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Remove a dial plan",
          text: "Use these steps to remove a dial plan.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-j"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 2);
  assert.deepEqual(
    mandatory.map((aspect) => `${aspect.subject}:${aspect.operation}`).sort(),
    ["dial plan:remove", "routing policy:assign"]
  );
  assert.equal(bundle.answerability, "answered");
});

test("no supported required aspects is insufficient evidence", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Explain federation and tenant restrictions.",
      entities: ["federation", "tenant restrictions"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Meeting lobby settings",
          text: "Meeting organizers can configure lobby behavior.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-b"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.answerability, "insufficient_evidence");
  assert.equal(bundle.aspectCoverage.supportedMandatoryAspectIds.length, 0);
});

test("all mandatory aspects supported is answered and distractors stay out", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Explain federation and tenant restrictions.",
      entities: ["federation", "tenant restrictions"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Unrelated authoritative landing page",
          text: "General deployment navigation.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/index"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Federation behavior",
          text: "Federation lets organizations communicate across tenants.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-c"
        }),
        makeCandidate({
          rank: 3,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Tenant restrictions",
          text: "Tenant restrictions constrain cross-tenant access.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-d"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.aspectCoverage.supportedMandatoryAspectIds.length, 2);
  assert.equal(bundle.evidence.length, 2);
  assert.equal(
    bundle.evidence.some((item) =>
      item.source.title.includes("Unrelated authoritative")
    ),
    false
  );
});

test("question phrases in URLs do not create topical eligibility", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does packet mediation work?",
      entities: ["packet mediation"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Generic landing page",
          text: "Navigation for deployment guidance.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/packet-mediation"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "supporting",
          title: "Packet mediation",
          text: "Packet mediation controls the approved media path.",
          headingPath: ["Packet mediation", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/opaque-article"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.evidence.length, 1);
  assert.equal(bundle.evidence[0]?.source.title, "Packet mediation");
});

test("generic policy wording does not imply parameter semantics", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "What is a retention policy?",
      entities: ["retention policy"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Retention policy overview",
          text: "A retention policy controls lifecycle behavior.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/retention"
        })
      ]
    })
  ).bundle;
  assert.deepEqual(bundle.evidence[0]?.supportTypes, ["concept_definition"]);
});

test("unrelated GA and preview evidence do not create a conflict", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Explain federation and tenant restrictions.",
      entities: ["federation", "tenant restrictions"],
      allowsBeta: true,
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          sourceStatus: "ga",
          title: "Federation behavior",
          text: "Federation enables cross-organization communication.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-e"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          sourceStatus: "preview",
          title: "Tenant restrictions preview",
          text: "Tenant restrictions constrain cross-tenant access.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-f"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.conflicts.length, 0);
});

test("only incompatible evidence for the same aspect creates a conflict", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Is federation supported?",
      entities: ["federation"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Federation status",
          text: "Federation is currently supported.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-g"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Federation status notice",
          text: "Federation is deprecated.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/topic-h"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.conflicts.length, 1);
  assert.equal(bundle.conflicts[0]?.topic.includes("federation"), true);
  assert.equal(bundle.answerability, "insufficient_evidence");
});

test("retrieval exact-match metadata cannot spoof canonical identifier identity", () => {
  const command = "Set-CsDefinitelyNotARealCmdlet";
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: `What does ${command} do?`,
      commandNames: [command],
      domains: ["teams_powershell"],
      requiredDirective: { type: "cmdlet", value: command },
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-powershell",
          routePriority: "primary",
          title: "Set-CsOnlineVoiceRoutingPolicy",
          text: `${command} was reported as an exact retrieval match.`,
          sourcePath: "module/set-csonlinevoiceroutingpolicy.md",
          url: "https://learn.microsoft.com/powershell/module/microsoftteams/set-csonlinevoiceroutingpolicy",
          exact: { type: "cmdlet", value: command, required: true }
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.exactIdentifierValidation.verified, false);
  assert.equal(bundle.evidence.length, 0);
  assert.equal(bundle.answerability, "insufficient_evidence");
});

test("existing admin and cmdlet scenarios remain resolver regressions", () => {
  const scenarios = [
    {
      question: "How do Microsoft Teams Calling Plans work?",
      entities: ["calling plans"],
      operationIntents: [] as string[],
      domains: ["teams_admin"] as const,
      sourceId: "ms-teams-admin",
      title: "Calling plans",
      text: "Calling plans provide PSTN calling through Microsoft.",
      headingPath: ["Calling plans", "Overview"],
      url: "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365"
    },
    {
      question: "How do Teams meeting policies work?",
      entities: ["meeting policies"],
      operationIntents: [] as string[],
      domains: ["teams_admin"] as const,
      sourceId: "ms-teams-admin",
      title: "Meeting policies",
      text: "Meeting policies control meeting capabilities for users.",
      headingPath: ["Meeting policies", "Overview"],
      url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview"
    },
    {
      question: "How does external access work in Teams?",
      entities: ["external access"],
      operationIntents: [] as string[],
      domains: ["teams_admin"] as const,
      sourceId: "ms-teams-admin",
      title: "External access",
      text: "External access lets Teams users communicate with other organizations.",
      headingPath: ["External access", "Overview"],
      url: "https://learn.microsoft.com/en-us/microsoftteams/manage-external-access"
    },
    {
      question: "Which cmdlet assigns a Teams voice routing policy to a user?",
      entities: ["voice routing policy"],
      operationIntents: ["assign"],
      domains: ["teams_powershell"] as const,
      sourceId: "ms-teams-powershell",
      title: "Grant-CsOnlineVoiceRoutingPolicy",
      text: "Grant-CsOnlineVoiceRoutingPolicy assigns a voice routing policy to a user.",
      headingPath: ["Grant-CsOnlineVoiceRoutingPolicy", "DESCRIPTION"],
      url: "https://learn.microsoft.com/powershell/module/microsoftteams/grant-csonlinevoiceroutingpolicy"
    }
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const bundle = buildEvidenceBundle(
      makeHybrid({
        question: scenario.question,
        entities: scenario.entities,
        operationIntents: scenario.operationIntents,
        domains: [...scenario.domains],
        answerType:
          scenario.operationIntents.length > 0 ? "configuration" : "conceptual",
        candidates: [
          makeCandidate({
            rank: index + 1,
            sourceId: scenario.sourceId,
            routePriority: "primary",
            title: scenario.title,
            text: scenario.text,
            headingPath: scenario.headingPath,
            url: scenario.url
          })
        ]
      })
    ).bundle;
    assert.equal(
      bundle.answerability,
      "answered",
      `${scenario.question} should remain answerable`
    );
  }
});

test("implicit cmdlet requires authoritative cmdlet identity not admin procedure", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Which cmdlet assigns a Teams voice routing policy to a user?",
      entities: ["voice routing policy"],
      operationIntents: ["assign"],
      domains: ["teams_powershell", "teams_admin"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Configure call routing for Direct Routing",
          text: "Assign the voice routing policy to user1@contoso.com.",
          headingPath: [
            "Configure call routing for Direct Routing",
            "Using PowerShell",
            "Step 4: Assign the voice routing policy"
          ],
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-powershell",
          routePriority: "primary",
          title: "Grant-CsOnlineVoiceRoutingPolicy",
          text: "Grant-CsOnlineVoiceRoutingPolicy assigns a voice routing policy to a user.",
          headingPath: ["Grant-CsOnlineVoiceRoutingPolicy", "DESCRIPTION"],
          url: "https://learn.microsoft.com/powershell/module/microsoftteams/grant-csonlinevoiceroutingpolicy"
        })
      ]
    })
  ).bundle;
  const aspect = bundle.aspectCoverage.aspects[0];
  assert.equal(aspect?.answerObject, "cmdlet_identifier");
  assert.equal(aspect?.operation, "assign");
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.evidence[0]?.source.title, "Grant-CsOnlineVoiceRoutingPolicy");
  assert.equal(
    bundle.rejectedCandidates.some(
      (candidate) =>
        candidate.title.includes("Configure call routing") &&
        candidate.reasons.includes("insufficient_direct_support")
    ),
    true
  );
});

test("broad meeting-policy question is not satisfied by a narrow settings subsection", () => {
  const narrowOnly = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work?",
      entities: ["meeting policies"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Meeting policy settings for audio & video",
          text: "For a user, the most restrictive policy setting for video takes precedence.",
          headingPath: [
            "Meeting policy settings for audio & video",
            "Video conferencing",
            "Which video policy setting takes precedence?"
          ],
          url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-audio-and-video"
        })
      ]
    })
  ).bundle;
  assert.equal(narrowOnly.answerability, "insufficient_evidence");
  assert.ok(
    narrowOnly.aspectCoverage.supportingOnlyAspectIds.length > 0 ||
      narrowOnly.aspectCoverage.unsupportedMandatoryAspectIds.length > 0
  );

  const withOverview = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work?",
      entities: ["meeting policies"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Meeting policy settings for audio & video",
          text: "For a user, the most restrictive policy setting for video takes precedence.",
          headingPath: [
            "Meeting policy settings for audio & video",
            "Video conferencing",
            "Which video policy setting takes precedence?"
          ],
          url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-audio-and-video"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Meeting policies",
          text: "Meeting policies determine the features available to users in meetings.",
          headingPath: ["Meeting policies", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview"
        })
      ]
    })
  ).bundle;
  assert.equal(withOverview.answerability, "answered");
  assert.equal(withOverview.evidence[0]?.source.title, "Meeting policies");
});

test("relational Conditional Access question stays one relationship aspect", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Conditional Access affect Teams on unmanaged devices?",
      entities: ["conditional access", "unmanaged devices"],
      domains: ["entra", "teams_admin"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Chat, teams, channels, & apps in Microsoft Teams",
          text: "Will I need to configure conditional access for Teams?",
          headingPath: [
            "Chat, teams, channels, & apps in Microsoft Teams",
            "Additional deployment decisions",
            "Conditional access"
          ],
          url: "https://learn.microsoft.com/en-us/microsoftteams/deploy-chat-teams-channels-microsoft-teams-landing-page"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-entra-docs",
          routePriority: "primary",
          title: "Conditional Access and unmanaged devices",
          text: "Conditional Access affects Teams access on unmanaged devices by requiring compliant controls.",
          headingPath: ["Conditional Access", "Unmanaged devices"],
          url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/unmanaged"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 1);
  assert.equal(mandatory[0]?.answerObject, "relationship");
  assert.equal(mandatory[0]?.relationship?.predicate, "affects");
  assert.equal(bundle.answerability, "answered");
  assert.equal(
    bundle.evidence[0]?.source.title,
    "Conditional Access and unmanaged devices"
  );
  assert.equal(
    bundle.rejectedCandidates.some(
      (candidate) =>
        candidate.title.includes("Chat, teams, channels") &&
        candidate.reasons.includes("insufficient_direct_support")
    ),
    true
  );
});

test("landing and related-links content is contextual not direct", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does external access work in Teams?",
      entities: ["external access"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Chat, teams, channels, & apps in Microsoft Teams",
          text: "External access (federation) lets your users communicate with people outside of your organization via chat.",
          headingPath: [
            "Chat, teams, channels, & apps in Microsoft Teams",
            "Core deployment decisions",
            "External access"
          ],
          url: "https://learn.microsoft.com/en-us/microsoftteams/deploy-chat-teams-channels-microsoft-teams-landing-page"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "External access",
          text: "External access lets Teams users communicate with other organizations.",
          headingPath: ["External access", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/manage-external-access"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.answerability, "answered");
  assert.equal(bundle.evidence[0]?.source.title, "External access");
  const landingSupport = bundle.aspectCoverage.supportByAspect[
    bundle.aspectCoverage.aspects[0]?.aspectId ?? ""
  ]?.find((support) => support.candidateId.includes("chunk-1"));
  assert.equal(landingSupport?.strength, "contextual");
});

test("nested compound technical subject binds to one mandatory aspect", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Teams Direct Routing voice routing work?",
      entities: ["direct routing", "voice routing"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Direct Routing voice routing overview",
          text: "Direct Routing voice routing enables PSTN connectivity and routes calls by online voice routing policy.",
          headingPath: ["Direct Routing voice routing", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 1);
  assert.equal(mandatory[0]?.answerObject, "mechanism");
  assert.equal(mandatory[0]?.breadth, "broad");
  assert.ok(mandatory[0]?.derivation.ruleIds.includes("compound_subject_binding"));
  assert.deepEqual(
    mandatory[0]?.subjects.map((subject) => subject.value).sort(),
    ["direct routing", "voice routing"]
  );
  assert.equal(bundle.answerability, "answered");
});

test("compound subject components remain auditable in derivation spans", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Teams Direct Routing voice routing work?",
      entities: ["direct routing", "voice routing"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Direct Routing voice routing overview",
          text: "Direct Routing voice routing enables call path selection.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
        })
      ]
    })
  ).bundle;
  const aspect = bundle.aspectCoverage.aspects.find(
    (entry) => entry.requirement === "mandatory"
  );
  assert.ok(aspect);
  assert.ok(aspect.derivation.questionSpans.includes("direct routing"));
  assert.ok(aspect.derivation.questionSpans.includes("voice routing"));
  assert.ok(
    aspect.subjectTerms.includes("direct") ||
      aspect.subjectTerms.includes("routing")
  );
});

test("conjunction keeps separate mandatory aspects", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How do external access and guest access work?",
      entities: ["external access", "guest access"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "External access overview",
          text: "External access enables federation with other organizations.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/external-access"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Guest access overview",
          text: "Guest access allows people outside your tenant to join teams.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/guest-access"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 2);
  assert.equal(
    mandatory.some((aspect) =>
      aspect.derivation.ruleIds.includes("compound_subject_binding")
    ),
    false
  );
  assert.deepEqual(
    mandatory.map((aspect) => aspect.subject).sort(),
    ["external access", "guest access"]
  );
});

test("comparison keeps separate participants without compound binding", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "Compare external access and guest access",
      entities: ["external access", "guest access"],
      answerType: "comparison",
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "External access overview",
          text: "External access enables federation.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/external-access"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Guest access overview",
          text: "Guest access allows B2B collaboration.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/guest-access"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 2);
  assert.ok(mandatory.every((aspect) => aspect.answerObject === "comparison"));
  assert.equal(
    mandatory.some((aspect) =>
      aspect.derivation.ruleIds.includes("compound_subject_binding")
    ),
    false
  );
});

test("explicit relationship stays relational and is not compound-bound", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Conditional Access affect Teams on unmanaged devices?",
      entities: ["conditional access", "unmanaged devices"],
      domains: ["entra", "teams_admin"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-entra-docs",
          routePriority: "primary",
          title: "Conditional Access and unmanaged devices",
          text: "Conditional Access affects Teams access on unmanaged devices by requiring compliant controls.",
          headingPath: ["Conditional Access", "Unmanaged devices"],
          url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/unmanaged"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 1);
  assert.equal(mandatory[0]?.answerObject, "relationship");
  assert.equal(
    mandatory[0]?.derivation.ruleIds.includes("compound_subject_binding"),
    false
  );
});

test("broad conceptual question cannot be covered by configuration metadata alone", () => {
  const configOnly = makeCandidate({
    rank: 1,
    sourceId: "ms-teams-admin",
    routePriority: "primary",
    title: "Configure Direct Routing",
    text: "Follow these deployment checklist items for your SBC.",
    headingPath: ["Configure Direct Routing", "Prerequisites"],
    url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-configure",
    chunkId: "chunk-config-only"
  });
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Teams Direct Routing voice routing work?",
      entities: ["direct routing", "voice routing"],
      candidates: [configOnly]
    }),
    {
      metadataByChunkId: new Map([
        ["chunk-config-only", { chunkKind: "configuration" }]
      ])
    }
  ).bundle;
  assert.equal(bundle.answerability, "insufficient_evidence");
  const support = bundle.aspectCoverage.supportByAspect[
    bundle.aspectCoverage.aspects[0]?.aspectId ?? ""
  ]?.[0];
  assert.ok(support);
  assert.notEqual(support.strength, "direct");
  assert.ok(
    support.reasonCodes.includes("config_metadata_insufficient_for_broad") ||
      support.reasonCodes.includes("missing_required_facets")
  );
});

test("configuration question may use configuration evidence as direct", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How do I configure Direct Routing?",
      entities: ["direct routing"],
      operationIntents: ["configure"],
      answerType: "configuration",
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Configure Direct Routing",
          text: "Configure Direct Routing by connecting your SBC and assigning voice routing policy.",
          headingPath: ["Configure Direct Routing", "Steps"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-configure",
          chunkId: "chunk-config-ok"
        })
      ]
    }),
    {
      metadataByChunkId: new Map([
        ["chunk-config-ok", { chunkKind: "configuration" }]
      ])
    }
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory[0]?.answerObject, "configuration_behavior");
  assert.equal(bundle.answerability, "answered");
  const support = bundle.aspectCoverage.supportByAspect[
    mandatory[0]?.aspectId ?? ""
  ]?.find((entry) => entry.strength === "direct");
  assert.ok(support);
});

test("Conditional Access without direct relational evidence is insufficient", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Conditional Access affect Teams on unmanaged devices?",
      entities: ["conditional access", "unmanaged devices"],
      domains: ["entra", "teams_admin"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Chat, teams, channels, & apps in Microsoft Teams",
          text: "Will I need to configure conditional access for Teams?",
          headingPath: [
            "Chat, teams, channels, & apps in Microsoft Teams",
            "Additional deployment decisions",
            "Conditional access"
          ],
          url: "https://learn.microsoft.com/en-us/microsoftteams/deploy-chat-teams-channels-microsoft-teams-landing-page"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Unmanaged devices settings",
          text: "Unmanaged devices can be restricted for Teams meetings.",
          headingPath: ["Unmanaged devices", "Settings"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/unmanaged-devices"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 1);
  assert.equal(mandatory[0]?.answerObject, "relationship");
  assert.equal(bundle.answerability, "insufficient_evidence");
  assert.equal(bundle.evidence.length, 0);
});

test("unresolved fallback aspect cannot achieve direct support from an off-topic authoritative-source candidate", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question:
        "How would you secure SharePoint data so it is not accessible by all Copilot users?",
      domains: [],
      products: [],
      technologies: [],
      entities: [],
      unresolvedAmbiguity: ["domain_unresolved", "no_explicit_entity"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Guest access in Microsoft Teams",
          text: "Guest access lets external users join Teams and can also touch SharePoint sites shared with a team.",
          headingPath: ["Guest access", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/guest-access"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 1);
  assert.equal(mandatory[0]?.derivation.unresolved, true);
  assert.deepEqual(mandatory[0]?.authorityRequirement.requiredDomains, []);
  const supports =
    bundle.aspectCoverage.supportByAspect[mandatory[0]?.aspectId ?? ""] ?? [];
  assert.ok(supports.length > 0);
  assert.ok(supports.every((support) => support.strength !== "direct"));
  assert.equal(bundle.evidence.length, 0);
  assert.equal(bundle.answerability, "insufficient_evidence");
});

test("incidental single-token match cannot make an unresolved aspect answered", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How do I delegate access to a shared Exchange mailbox?",
      domains: [],
      products: [],
      technologies: [],
      entities: [],
      unresolvedAmbiguity: ["domain_unresolved", "no_explicit_entity"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Shared channels errors in Microsoft Teams",
          text: "This article lists shared channel error codes and how to resolve them for Teams users.",
          headingPath: ["Shared channels errors", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/shared-channels-errors"
        })
      ]
    })
  ).bundle;
  assert.equal(bundle.answerability, "insufficient_evidence");
  assert.equal(bundle.evidence.length, 0);
  assert.equal(bundle.aspectCoverage.supportedMandatoryAspectIds.length, 0);
});

test("SharePoint/Copilot security diagnostic case fails closed without corpus expansion", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question:
        "How would you secure SharePoint data so it is not accessible by all Copilot users?",
      domains: [],
      products: [],
      technologies: [],
      entities: [],
      unresolvedAmbiguity: ["domain_unresolved", "no_explicit_entity"],
      candidates: []
    })
  ).bundle;
  assert.equal(bundle.answerability, "insufficient_evidence");
  assert.equal(bundle.evidence.length, 0);
  assert.equal(bundle.aspectCoverage.aspects[0]?.derivation.unresolved, true);
});

test("Exchange mailbox delegation diagnostic case fails closed without corpus expansion", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How do I delegate access to a shared Exchange mailbox?",
      domains: [],
      products: [],
      technologies: [],
      entities: [],
      unresolvedAmbiguity: ["domain_unresolved", "no_explicit_entity"],
      candidates: []
    })
  ).bundle;
  assert.equal(bundle.answerability, "insufficient_evidence");
  assert.equal(bundle.evidence.length, 0);
  assert.equal(bundle.aspectCoverage.aspects[0]?.derivation.unresolved, true);
});

test("compound binding does not introduce scenario-specific product hardcoding", () => {
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Packet Mediation media path selection work?",
      entities: ["packet mediation", "media path selection"],
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Packet Mediation media path selection overview",
          text: "Packet Mediation media path selection enables approved media routing.",
          headingPath: ["Packet Mediation media path selection", "Overview"],
          url: "https://learn.microsoft.com/en-us/microsoftteams/packet-mediation-media-path"
        })
      ]
    })
  ).bundle;
  const mandatory = bundle.aspectCoverage.aspects.filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(mandatory.length, 1);
  assert.ok(mandatory[0]?.derivation.ruleIds.includes("compound_subject_binding"));
  assert.deepEqual(
    mandatory[0]?.subjects.map((subject) => subject.value).sort(),
    ["media path selection", "packet mediation"]
  );
  assert.equal(bundle.answerability, "answered");
});
