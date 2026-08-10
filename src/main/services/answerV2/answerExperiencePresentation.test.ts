import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildExplanationContext,
  inferContextType
} from "./explanationContextBuilder";
import {
  assertPresentationDoesNotAlterProofFacts,
  buildAnswerPresentationPlan,
  presentGroundedAnswer,
  renderPresentedAnswer
} from "./deterministicAnswerPresenter";
import type {
  AnswerPlan,
  EvidenceBundle,
  ExtractiveAssemblyProvenance,
  GroundedAnswer,
  PlannedClaim
} from "./types";

function baseClaim(
  overrides: Partial<PlannedClaim> &
    Pick<PlannedClaim, "claimId" | "proposition" | "evidenceIds">
): PlannedClaim {
  return {
    groundingSnapshotId: "grounding:test",
    groundingSnapshotHash: "a".repeat(64),
    requiredAspectId: "aspect:main",
    coveredFacets: ["purpose"],
    claimType: "purpose",
    sectionId: "direct_answer",
    sourceSpans: [
      {
        spanId: "span:1",
        evidenceId: overrides.evidenceIds[0] ?? "evidence:1",
        chunkId: "chunk:1",
        documentId: "doc:1",
        sourceId: "ms-teams-admin",
        sourcePath: "path.md",
        sectionId: "sec-1",
        headingPath: ["Heading"],
        sourceField: "text",
        fieldIndex: null,
        sentenceIndex: null,
        startOffset: 0,
        endOffset: overrides.proposition.length,
        text: overrides.proposition,
        contentHash: "hash",
        authorityRole: "teams_admin_primary",
        sourceOrder: 1
      }
    ],
    supportStrength: "direct",
    status: "mandatory",
    mandatory: true,
    requiresCaveat: false,
    caveatCodes: [],
    unsupportedAspectIds: [],
    ordering: {
      sequence: 1,
      procedureStep: null,
      sourceOrder: 1,
      spanOrder: 1
    },
    authorityContext: {
      sourceIds: ["ms-teams-admin"],
      routePriorities: ["primary"],
      authorityRoles: ["teams_admin_primary"]
    },
    ...overrides
  };
}

function fixture(params?: {
  answerability?: AnswerPlan["answerability"];
  unsupported?: boolean;
  contextualOnly?: boolean;
}) {
  const answerability = params?.answerability ?? "answered";
  const proof =
    "Enterprise Voice must be enabled for the user before assigning a phone number.";
  const procedure =
    "1. Assign a Teams Phone license. 2. Enable the user for Enterprise Voice.";
  const evidence = [
    {
      evidenceId: "evidence:proof",
      chunkId: "chunk:proof",
      documentId: "doc:voice",
      source: {
        sourceId: "ms-teams-admin",
        trackId: "ga",
        sourceStatus: "ga" as const,
        sourceDomain: "teams_admin" as const,
        authorityTier: "tier1" as const,
        authorityRoles: ["teams_admin_primary" as const],
        routePriority: "primary" as const,
        title: "Enable users for voice",
        canonicalUrl:
          "https://learn.microsoft.com/en-us/microsoftteams/enable-users",
        sourcePath: "enable.md",
        sourceRevision: {}
      },
      location: {
        sectionId: "sec-enable",
        headingPath: ["Enable users"]
      },
      text: proof,
      supportTypes: ["configuration_behavior" as const],
      retrieval: {
        methods: ["lexical" as const],
        fusionRank: 1,
        fusionScore: 1,
        methodSignals: {},
        exactMatch: null,
        retrievalReasons: []
      },
      selectionReason: "direct"
    },
    {
      evidenceId: "evidence:procedure",
      chunkId: "chunk:procedure",
      documentId: "doc:voice",
      source: {
        sourceId: "ms-teams-admin",
        trackId: "ga",
        sourceStatus: "ga" as const,
        sourceDomain: "teams_admin" as const,
        authorityTier: "tier1" as const,
        authorityRoles: ["teams_admin_primary" as const],
        routePriority: "primary" as const,
        title: "Enable users for voice",
        canonicalUrl:
          "https://learn.microsoft.com/en-us/microsoftteams/enable-users",
        sourcePath: "enable.md",
        sourceRevision: {}
      },
      location: {
        sectionId: "sec-steps",
        headingPath: ["Enable users", "Steps"]
      },
      text: procedure,
      supportTypes: ["procedure" as const],
      retrieval: {
        methods: ["lexical" as const],
        fusionRank: 2,
        fusionScore: 0.9,
        methodSignals: {},
        exactMatch: null,
        retrievalReasons: []
      },
      selectionReason: "adjacent"
    },
    {
      evidenceId: "evidence:rejected-neighbor",
      chunkId: "chunk:rejected",
      documentId: "doc:other",
      source: {
        sourceId: "ms-teams-admin",
        trackId: "ga",
        sourceStatus: "ga" as const,
        sourceDomain: "teams_admin" as const,
        authorityTier: "tier1" as const,
        authorityRoles: ["teams_admin_primary" as const],
        routePriority: "supporting" as const,
        title: "Unrelated",
        canonicalUrl:
          "https://learn.microsoft.com/en-us/microsoftteams/unrelated",
        sourcePath: "other.md",
        sourceRevision: {}
      },
      location: {
        sectionId: "sec-x",
        headingPath: ["Other"]
      },
      text: "This must not appear as hidden proof.",
      supportTypes: ["contextual" as const],
      retrieval: {
        methods: ["lexical" as const],
        fusionRank: 9,
        fusionScore: 0.1,
        methodSignals: {},
        exactMatch: null,
        retrievalReasons: []
      },
      selectionReason: "noise"
    }
  ];

  const bundle = {
    decisionSnapshot: {
      snapshotId: "grounding:test",
      snapshotHash: "a".repeat(64),
      schemaVersion: "grounding-decision-snapshot/v1",
      resolverPolicyVersion:
        "proposition-aware-evidence-policy/r2.2",
      corpusRevisionHash: "b".repeat(64),
      createdAt: "2026-08-09T00:00:00.000Z"
    },
    question: "How do I enable a Teams user for voice using PowerShell?",
    intent: {
      originalQuestion:
        "How do I enable a Teams user for voice using PowerShell?",
      normalizedQuestion:
        "how do i enable a teams user for voice using powershell",
      domains: ["teams_admin"],
      products: ["Microsoft Teams"],
      technologies: [],
      entities: [],
      requiresFreshnessCheck: false,
      allowsBetaSources: false,
      expectedAnswerType: "procedural",
      retrievalHints: [],
      unresolvedAmbiguity: []
    },
    scope: {
      selectedDomains: ["teams_admin"],
      focusSubdomains: [],
      sourcePriorityChain: ["ms-teams-admin"],
      exactMatchDirectives: [],
      allowBeta: false
    },
    evidence: params?.contextualOnly
      ? evidence
      : evidence.filter(
          (item) => item.evidenceId !== "evidence:rejected-neighbor"
        ),
    rejectedCandidates: [
      {
        candidateId: "chunk:rejected",
        chunkId: "chunk:rejected",
        documentId: "doc:other",
        title: "Unrelated",
        sourceId: "ms-teams-admin",
        fusionRank: 9,
        reasons: ["low_topical_relevance" as const]
      }
    ],
    conflicts: [],
    freshness: {
      state: "current" as const,
      requiresVerification: false,
      reasons: []
    },
    exactIdentifierValidation: {
      required: false,
      verified: true,
      requiredDirectives: [],
      missingRequiredDirectives: []
    },
    aspectCoverage: {
      aspects: [],
      evidenceByAspect: {
        "aspect:main": ["evidence:proof", "evidence:procedure"],
        ...(params?.unsupported
          ? { "aspect:cmdlet": [] }
          : {}),
        ...(params?.contextualOnly
          ? { "aspect:context-only": ["evidence:rejected-neighbor"] }
          : {})
      },
      supportByAspect: {},
      supportedMandatoryAspectIds: ["aspect:main"],
      unsupportedMandatoryAspectIds: params?.unsupported
        ? ["aspect:cmdlet"]
        : [],
      authorityLimitedAspectIds: [],
      supportingOnlyAspectIds: [],
      contextualOnlyAspectIds: params?.contextualOnly
        ? ["aspect:context-only"]
        : [],
      supportedOptionalAspectIds: []
    },
    authorityCoverage: {
      requestedDomains: ["teams_admin"],
      coveredDomains: ["teams_admin"],
      missingDomains: []
    },
    answerability,
    diagnostics: {
      latencyMs: {
        total: 1,
        selection: 1,
        conflictDetection: 0,
        answerability: 0
      },
      populations: {
        candidates: 3,
        selectedEvidence: 2,
        rejectedCandidates: 1
      },
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
  } as unknown as EvidenceBundle;

  const claim = baseClaim({
    claimId: "claim:1",
    proposition: proof,
    evidenceIds: ["evidence:proof"],
    requiredAspectId: "aspect:main"
  });

  const plan = {
    planIdentity: {
      planId: "plan:1",
      planHash: "c".repeat(64),
      schemaVersion: "answer-plan/v1",
      plannerPolicyVersion: "answer-planner/r3"
    },
    snapshotBinding: {
      snapshotId: bundle.decisionSnapshot.snapshotId,
      snapshotHash: bundle.decisionSnapshot.snapshotHash
    },
    question: bundle.question,
    intent: bundle.intent,
    answerability,
    answerType: "procedural",
    plannedClaims: answerability === "insufficient_evidence" ? [] : [claim],
    requiredCaveats:
      answerability === "partial" || params?.unsupported
        ? [
            {
              code: "partial_coverage",
              detail: "Some requested aspects remain unsupported."
            }
          ]
        : [],
    unsupportedAspects: params?.unsupported
      ? [
          {
            aspectId: "aspect:cmdlet",
            reason: "insufficient_evidence",
            detail: "Exact PowerShell enablement cmdlet was not verified."
          }
        ]
      : [],
    evidenceReferences: {
      usedEvidenceIds: ["evidence:proof"],
      unusedEvidenceIds: ["evidence:procedure"]
    },
    freshnessInstructions: {
      mustVerifyBeforeFinalAnswer: false,
      reasons: []
    },
    previewInstructions: {
      previewEvidenceUsed: false,
      requiredLabel: false
    },
    exactIdentifierState: bundle.exactIdentifierValidation,
    recommendedStructure: {
      format: "steps",
      orderedSections: ["direct_answer", "steps"]
    },
    diagnostics: {
      latencyMs: 1,
      decomposition: {
        requestedConcepts: [],
        supportedConcepts: [],
        omittedConcepts: []
      },
      duplicateClaimsCollapsed: 0,
      facetCoverage: [],
      evidenceWithoutIndependentClaims: [],
      canonicalUrlCoverage: {
        complete: true,
        missingEvidenceIds: [],
        note: ""
      }
    }
  } as unknown as AnswerPlan;

  const provenance: ExtractiveAssemblyProvenance = {
    assemblerPolicyVersion: "deterministic-extractive-assembler/r4",
    planId: plan.planIdentity.planId,
    planHash: plan.planIdentity.planHash,
    renderedClaims:
      answerability === "insufficient_evidence"
        ? []
        : [
            {
              claimId: "claim:1",
              requiredAspectId: "aspect:main",
              sectionId: "direct_answer",
              status: "mandatory",
              renderedText: proof,
              transformation: "none",
              evidenceIds: ["evidence:proof"],
              sourceSpans: claim.sourceSpans,
              answerTextRange: {
                startOffset: 0,
                endOffset: proof.length
              }
            }
          ],
    omittedClaimIds: [],
    policyUnits: [
      ...(answerability === "insufficient_evidence"
        ? [
            {
              kind: "limitation" as const,
              code: "insufficient_evidence",
              text: "Unable to provide a factual answer from the approved evidence.",
              answerTextRange: { startOffset: 0, endOffset: 64 }
            }
          ]
        : []),
      ...(params?.unsupported
        ? [
            {
              kind: "unsupported_aspect" as const,
              code: "aspect:cmdlet",
              text: "Exact PowerShell enablement cmdlet was not verified.",
              answerTextRange: { startOffset: 0, endOffset: 10 }
            },
            {
              kind: "caveat" as const,
              code: "partial_coverage",
              text: "Some requested aspects remain unsupported.",
              answerTextRange: { startOffset: 0, endOffset: 10 }
            }
          ]
        : [])
    ],
    validation: { valid: true, issues: [] },
    factualTextAudit: {
      factualUnitCount:
        answerability === "insufficient_evidence" ? 0 : 1,
      allFactualUnitsAttributed: true,
      unattributedText: []
    }
  };

  const factualAnswerText =
    answerability === "insufficient_evidence"
      ? "Unable to provide a factual answer from the approved evidence."
      : proof;

  const answer = {
    snapshotBinding: plan.snapshotBinding,
    answerability,
    answerText: factualAnswerText,
    realizedClaims:
      answerability === "insufficient_evidence"
        ? []
        : [
            {
              claimId: "claim:1",
              generatedText: proof,
              evidenceIds: ["evidence:proof"]
            }
          ],
    caveats: plan.requiredCaveats.map((caveat) => ({
      code: caveat.code,
      text: caveat.detail
    })),
    unsupportedAspects: plan.unsupportedAspects.map((aspect) => ({
      aspectId: aspect.aspectId,
      text: aspect.detail
    })),
    evidenceReferences: plan.evidenceReferences,
    freshnessState: plan.freshnessInstructions,
    previewState: plan.previewInstructions,
    exactIdentifierState: plan.exactIdentifierState,
    validation: {
      valid: true,
      issues: [],
      coverage: {
        mandatoryClaimsTotal: 1,
        mandatoryClaimsRealized: 1,
        unknownClaimCount: 0,
        missingCaveatCount: 0
      }
    },
    diagnostics: {
      generatorProviderId: "deterministic-extractive-assembler/r4",
      generationLatencyMs: 0,
      validationLatencyMs: 0,
      totalLatencyMs: 1,
      claimTaskCount: 1,
      mandatoryClaimTaskCount: 1,
      successfulClaimCount: 1,
      failedClaimCount: 0,
      requestCount: 0,
      retryCount: 0,
      firstAttemptValid: true,
      finalAttemptValid: true,
      firstAttemptIssues: [],
      attempts: []
    },
    extractiveAssembly: provenance
  } as unknown as GroundedAnswer;

  return { bundle, plan, answer, provenance, proof, procedure };
}

test("context type inference uses supportTypes metadata only", () => {
  assert.equal(inferContextType(["procedure"]), "procedure");
  assert.equal(inferContextType(["prerequisite"]), "prerequisite");
  assert.equal(inferContextType(["cmdlet_semantics"]), "cmdlet_reference");
  assert.equal(inferContextType(["contextual"]), "supporting_context");
});

test("R4 factual text remains unchanged by presentation", () => {
  const { plan, answer, provenance, bundle, proof } = fixture();
  const context = buildExplanationContext({ bundle, plan });
  const presented = presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  assert.equal(answer.answerText, proof);
  assert.ok(
    presented.helpdeskDetailed.answerText.includes(proof)
  );
  assert.deepEqual(
    assertPresentationDoesNotAlterProofFacts({
      factualAnswerText: answer.answerText,
      provenance,
      presented: presented.helpdeskDetailed
    }),
    []
  );
});

test("Explanation Context has exact provenance and content hash", () => {
  const { plan, bundle, procedure } = fixture();
  const context = buildExplanationContext({ bundle, plan });
  const procedureBlock = context.blocks.find(
    (block) => block.evidenceId === "evidence:procedure"
  );
  assert.ok(procedureBlock);
  assert.equal(procedureBlock?.exactText, procedure);
  assert.equal(procedureBlock?.contentHash.length, 64);
  assert.equal(
    procedureBlock?.groundingSnapshotId,
    bundle.decisionSnapshot.snapshotId
  );
  assert.ok(procedureBlock?.canonicalUrl.startsWith("https://"));
});

test("context cannot change answerability and unsupported gaps stay gaps", () => {
  const { plan, answer, provenance, bundle } = fixture({
    answerability: "partial",
    unsupported: true
  });
  assert.equal(bundle.answerability, "partial");
  const context = buildExplanationContext({ bundle, plan });
  const presented = presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  assert.equal(presented.helpdeskDetailed.plan.answerability, "partial");
  assert.ok(
    presented.helpdeskDetailed.answerText.includes(
      "Not established from available authoritative evidence"
    )
  );
  assert.ok(
    presented.helpdeskDetailed.answerText.includes(
      "Some requested aspects remain unsupported."
    )
  );
  assert.equal(bundle.answerability, "partial");
});

test("rejected and contextual-only evidence cannot become hidden proof", () => {
  const { plan, bundle } = fixture({ contextualOnly: true });
  const withRejected = {
    ...bundle,
    evidence: [
      ...bundle.evidence,
      {
        evidenceId: "evidence:rejected-neighbor",
        chunkId: "chunk:rejected",
        documentId: "doc:other",
        source: {
          sourceId: "ms-teams-admin",
          trackId: "ga",
          sourceStatus: "ga" as const,
          sourceDomain: "teams_admin" as const,
          authorityTier: "tier1" as const,
          authorityRoles: ["teams_admin_primary" as const],
          routePriority: "supporting" as const,
          title: "Unrelated",
          canonicalUrl:
            "https://learn.microsoft.com/en-us/microsoftteams/unrelated",
          sourcePath: "other.md",
          sourceRevision: {}
        },
        location: { sectionId: "sec-x", headingPath: ["Other"] },
        text: "This must not appear as hidden proof.",
        supportTypes: ["contextual" as const],
        retrieval: {
          methods: ["lexical" as const],
          fusionRank: 9,
          fusionScore: 0.1,
          methodSignals: {},
          exactMatch: null,
          retrievalReasons: []
        },
        selectionReason: "noise"
      }
    ]
  } as EvidenceBundle;
  const context = buildExplanationContext({
    bundle: withRejected,
    plan
  });
  assert.ok(
    context.blocks.every(
      (block) =>
        block.evidenceId !== "evidence:rejected-neighbor" &&
        !block.exactText.includes("hidden proof")
    )
  );
});

test("Helpdesk Detailed omits empty sections and attributes context", () => {
  const { plan, answer, provenance, bundle } = fixture();
  const context = buildExplanationContext({ bundle, plan });
  const presented = presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  assert.match(
    presented.helpdeskDetailed.answerText,
    /Summary/
  );
  assert.match(
    presented.helpdeskDetailed.answerText,
    /Microsoft documentation context/
  );
  assert.doesNotMatch(
    presented.helpdeskDetailed.answerText,
    /What to verify\n\nSources/
  );
  assert.ok(presented.helpdeskDetailed.contextReferences.length > 0);
});

test("Live Assist Quick uses selection not string truncation", () => {
  const { plan, answer, provenance, bundle, proof } = fixture({
    unsupported: true
  });
  const context = buildExplanationContext({ bundle, plan });
  const presented = presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  const detailed = presented.helpdeskDetailed.answerText;
  const quick = presented.liveAssistQuick.answerText;
  assert.notEqual(quick, detailed.slice(0, quick.length));
  assert.ok(quick.includes(proof));
  assert.ok(
    quick.includes("Some requested aspects remain unsupported.")
  );
  assert.ok(
    presented.liveAssistQuick.plan.selectedProofFacts.length <= 2
  );
  assert.ok(
    presented.liveAssistQuick.plan.selectedContextBlockIds.length <= 1
  );
});

test("commands / procedure context remain exact source-bound text", () => {
  const { plan, answer, provenance, bundle, procedure } = fixture();
  const context = buildExplanationContext({ bundle, plan });
  const presented = presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  assert.ok(presented.helpdeskDetailed.answerText.includes(procedure));
});

test("insufficient evidence keeps gaps and invents no identifiers", () => {
  const { plan, answer, provenance, bundle } = fixture({
    answerability: "insufficient_evidence"
  });
  const context = buildExplanationContext({ bundle, plan });
  const presented = presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  assert.match(
    presented.helpdeskDetailed.answerText,
    /Unable to provide a factual answer/
  );
  assert.equal(
    presented.helpdeskDetailed.plan.selectedContextBlockIds.length,
    0
  );
  assert.doesNotMatch(
    presented.helpdeskDetailed.answerText,
    /Set-Cs|Grant-Cs|Enable-Cs/
  );
});

test("presentation modules perform zero provider or OpenAI calls", () => {
  const sources = [
    "src/main/services/answerV2/explanationContextBuilder.ts",
    "src/main/services/answerV2/deterministicAnswerPresenter.ts",
    "src/main/services/conversations/answerExecutionPort.ts"
  ];
  for (const path of sources) {
    const text = readFileSync(resolve(path), "utf8");
    assert.doesNotMatch(
      text,
      /OpenAiGroundedAnswerGenerator|streamAnswer|chat\.completions|answers\.generate/i
    );
  }
});

test("presentation planning is independent per profile", () => {
  const { plan, answer, provenance, bundle } = fixture();
  const context = buildExplanationContext({ bundle, plan });
  const detailedPlan = buildAnswerPresentationPlan({
    profile: "helpdesk_detailed",
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  const quickPlan = buildAnswerPresentationPlan({
    profile: "live_assist_quick",
    plan,
    answer,
    provenance,
    contextBlocks: context.blocks
  });
  assert.notDeepEqual(
    detailedPlan.selectedContextBlockIds,
    quickPlan.selectedContextBlockIds
  );
  const quick = renderPresentedAnswer({
    presentationPlan: quickPlan,
    contextBlocks: context.blocks
  });
  assert.ok(quick.answerText.length > 0);
});
