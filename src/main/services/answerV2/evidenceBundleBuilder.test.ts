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
}): FusedRetrievalCandidate {
  const chunkId = params.chunkId ?? `chunk-${params.rank}-${params.sourceId}`;
  const documentId = params.documentId ?? `doc-${params.sourceId}-${params.rank}`;
  return {
    candidateId: `cand-${chunkId}`,
    method: "semantic",
    documentId,
    chunkId,
    sectionId: "section-a",
    headingPath: ["h1", "h2"],
    title: params.title,
    text: params.text,
    authority: {
      sourceId: params.sourceId,
      trackId: "ga",
      sourceStatus: params.sourceStatus ?? "ga",
      authorityTier: "tier1",
      authorityRoles: params.sourceId === "ms-teams-powershell" ? ["teams_powershell_cmdlet_primary"] : ["teams_admin_primary"],
      routePriority: params.routePriority
    },
    provenance: {
      sourcePath: "path/to/doc.md",
      canonicalUrl: params.url,
      sourceRevision: { transport: "github", commitSha: "abc" },
      headingPath: ["h1", "h2"],
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
  domains?: Array<"teams_admin" | "teams_powershell" | "graph" | "entra" | "m365" | "teams_dev">;
  requiredDirective?: { type: "cmdlet" | "policy" | "entity"; value: string };
  missedRequired?: boolean;
}): HybridRetrievalResult {
  const intent = {
    originalQuestion: params.question,
    normalizedQuestion: params.question.toLowerCase(),
    domains: params.domains ?? ["teams_admin"],
    products: ["teams"],
    technologies: ["teams"],
    entities: ["voice routing policy"],
    operationIntents: ["grant"],
    commandNames: params.commandNames ?? [],
    policyNames: [],
    requiresFreshnessCheck: false,
    allowsBetaSources: params.allowsBeta ?? false,
    expectedAnswerType: "reference" as const,
    retrievalHints: [],
    unresolvedAmbiguity: []
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
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-teams-admin",
        routePriority: "primary",
        title: "Direct Routing voice routing overview",
        text: "Direct Routing voice routing policy behavior.",
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
    text: "Direct Routing voice routing policy behavior.",
    url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing"
  });
  const hybrid = makeHybrid({
    question: "How does Teams Direct Routing voice routing work?",
    candidates: [
      makeCandidate({
        rank: 1,
        sourceId: "ms-teams-admin",
        routePriority: "primary",
        title: "Direct Routing voice routing overview",
        text: "Direct Routing voice routing policy behavior.",
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
    title: "Preview policy feature",
    text: "Preview policy feature details.",
    url: "https://learn.microsoft.com/en-us/microsoftteams/preview-feature"
  });
  const gaCandidate = makeCandidate({
    rank: 2,
    sourceId: "ms-teams-admin",
    routePriority: "primary",
    title: "GA policy feature",
    text: "GA policy feature details.",
    url: "https://learn.microsoft.com/en-us/microsoftteams/ga-feature"
  });

  const blocked = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work?",
      allowsBeta: false,
      candidates: [betaCandidate, gaCandidate]
    })
  ).bundle;
  assert.equal(blocked.evidence.some((item) => item.source.sourceStatus === "beta"), false);

  const allowed = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work in preview?",
      allowsBeta: true,
      candidates: [betaCandidate]
    })
  ).bundle;
  assert.equal(allowed.evidence.some((item) => item.source.sourceStatus === "beta"), true);
});

test("meeting-policy and external-access direct evidence outrank generic pages", () => {
  const meeting = buildEvidenceBundle(
    makeHybrid({
      question: "How do Teams meeting policies work?",
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Meeting policies overview",
          text: "Meeting policy assignment and behavior in Teams.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-policies-overview"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Manage Teams with policies",
          text: "Generic policy guidance across teams.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/manage-teams-with-policies"
        })
      ]
    })
  ).bundle;
  assert.ok(meeting.evidence[0]?.source.canonicalUrl.includes("meeting-policies-overview"));

  const external = buildEvidenceBundle(
    makeHybrid({
      question: "How does external access work in Teams?",
      candidates: [
        makeCandidate({
          rank: 1,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Manage external access",
          text: "External access configuration and behavior in Teams.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/manage-external-access"
        }),
        makeCandidate({
          rank: 2,
          sourceId: "ms-teams-admin",
          routePriority: "primary",
          title: "Deploy chat and channels",
          text: "Landing page for broad Teams deployment.",
          url: "https://learn.microsoft.com/en-us/microsoftteams/deploy-chat-teams-channels-microsoft-teams-landing-page"
        })
      ]
    })
  ).bundle;
  assert.ok(external.evidence[0]?.source.canonicalUrl.includes("manage-external-access"));
});

test("conflicts, partial state, missing authority, and evidence cap are represented", () => {
  const candidates: FusedRetrievalCandidate[] = [];
  for (let i = 1; i <= 12; i += 1) {
    candidates.push(
      makeCandidate({
        rank: i,
        sourceId: i % 2 === 0 ? "ms-teams-admin" : "ms-teams-powershell",
        routePriority: "primary",
        title: i === 1 ? "Deprecated policy behavior" : `Candidate ${i}`,
        text:
          i === 1
            ? "This behavior is deprecated."
            : i === 2
              ? "This behavior is supported and recommended."
              : `Evidence candidate ${i}`,
        url: `https://learn.microsoft.com/en-us/microsoftteams/candidate-${i}`,
        sourceStatus: i === 3 ? "beta" : "ga",
        documentId: `doc-${Math.ceil(i / 2)}`
      })
    );
  }
  const bundle = buildEvidenceBundle(
    makeHybrid({
      question: "How does Conditional Access affect Teams on unmanaged devices?",
      domains: ["entra", "teams_admin"],
      candidates
    })
  ).bundle;
  assert.ok(bundle.conflicts.length > 0);
  assert.ok(bundle.answerability === "partial" || bundle.answerability === "insufficient_evidence");
  assert.ok(bundle.authorityCoverage.missingDomains.includes("entra"));
  assert.ok(bundle.evidence.length <= 8);
  assert.ok(bundle.rejectedCandidates.some((candidate) => candidate.reasons.includes("candidate_cap")));
});
