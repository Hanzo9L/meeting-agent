import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { classifyInterviewQuestionShape } from "../../src/main/services/answerV2/interviewQuestionShape";
import { deriveInterviewAnswerConcepts } from "../../src/main/services/answerV2/interviewAnswerConcepts";
import { routeInterviewPacks } from "../../src/main/services/answerV2/interviewPackRouter";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import {
  presentGroundedAnswer
} from "../../src/main/services/answerV2/deterministicAnswerPresenter";
import type {
  AnswerPlan,
  ExtractiveAssemblyProvenance,
  GroundedAnswer,
  PlannedClaim
} from "../../src/main/services/answerV2/types";

function intentOf(question: string) {
  return extractQueryIntent(question).intent;
}

function shapeOf(question: string) {
  const intent = intentOf(question);
  return {
    intent,
    shape: classifyInterviewQuestionShape(intent),
    route: routeInterviewPacks(intent, classifyInterviewQuestionShape(intent))
  };
}

test("I4 classifies conceptual, troubleshooting, procedural, powershell, and comparison shapes", () => {
  assert.equal(
    shapeOf("Explain Teams Direct Routing and the role of the SBC.").shape,
    "conceptual"
  );
  assert.equal(
    shapeOf("A user cannot call external PSTN numbers. What do you check?").shape,
    "troubleshooting"
  );
  assert.equal(
    shapeOf("How would you build an Auto Attendant that routes to a Call Queue?").shape,
    "procedural"
  );
  assert.equal(
    shapeOf("Describe a PowerShell process to audit Teams Voice users.").shape,
    "powershell"
  );
  assert.equal(
    shapeOf(
      "When would you use Call Analytics, Call Quality Dashboard, or meeting telemetry?"
    ).shape,
    "comparison"
  );
});

test("I4 pack routing is deterministic, bounded, and can union Rooms with Entra", () => {
  const direct = shapeOf("Explain Teams Direct Routing and the SBC role.");
  assert.deepEqual(direct.route.packIds, ["teams_voice_direct_routing"]);
  assert.equal(direct.route.reasons.length, 1);

  const quality = shapeOf(
    "When would you use Call Analytics versus CQD?"
  );
  assert.deepEqual(quality.route.packIds, ["call_quality_troubleshooting"]);

  const roomsLockout = shapeOf(
    "A Teams Room resource account is locked out and cannot sign in."
  );
  assert.ok(roomsLockout.route.packIds.includes("teams_rooms"));
  assert.ok(roomsLockout.route.packIds.includes("entra_identity_support"));
  assert.ok(roomsLockout.route.packIds.length <= 2);

  const sharepoint = shapeOf(
    "How would you secure SharePoint and OneDrive before Copilot rollout?"
  );
  assert.deepEqual(sharepoint.route.packIds, [
    "sharepoint_onedrive_copilot_governance"
  ]);

  const linux = shapeOf("On Linux, how would you check why a service failed?");
  assert.deepEqual(linux.route.packIds, []);
});

test("I4 does not search unrelated packs for a Direct Routing question", () => {
  const route = shapeOf("Explain Microsoft Teams Direct Routing at a high level.")
    .route;
  assert.ok(!route.packIds.includes("sharepoint_onedrive_copilot_governance"));
  assert.ok(!route.packIds.includes("teams_rooms"));
  assert.ok(!route.packIds.includes("call_quality_troubleshooting"));
});

test("I4 derives multiple distinct concepts without encoding a canned answer", () => {
  const { intent, shape, route } = shapeOf(
    "Explain Microsoft Teams Direct Routing at a high level."
  );
  const concepts = deriveInterviewAnswerConcepts({
    intent,
    shape,
    packIds: route.packIds
  });
  assert.ok(concepts.length >= 3);
  assert.ok(
    concepts.some((concept) => /sbc|direct routing|pstn/i.test(concept))
  );
});

function claim(id: string, text: string, sequence: number): PlannedClaim {
  return {
    claimId: id,
    groundingSnapshotId: "grounding:i4",
    groundingSnapshotHash: "b".repeat(64),
    requiredAspectId: "aspect:main",
    coveredFacets: ["purpose"],
    claimType: "purpose",
    sectionId: "direct_answer",
    proposition: text,
    evidenceIds: [`evidence:${id}`],
    sourceSpans: [
      {
        spanId: `span:${id}`,
        evidenceId: `evidence:${id}`,
        chunkId: `chunk:${id}`,
        documentId: "doc:1",
        sourceId: "ms-teams-admin",
        sourcePath: "path.md",
        sectionId: "sec-1",
        headingPath: ["Heading"],
        sourceField: "text",
        fieldIndex: null,
        sentenceIndex: null,
        startOffset: 0,
        endOffset: text.length,
        text,
        contentHash: "hash",
        authorityRole: "teams_admin_primary",
        sourceOrder: sequence
      }
    ],
    supportStrength: "direct",
    status: "mandatory",
    mandatory: true,
    requiresCaveat: false,
    caveatCodes: [],
    unsupportedAspectIds: [],
    ordering: {
      sequence,
      procedureStep: sequence,
      sourceOrder: sequence,
      spanOrder: 1
    },
    authorityContext: {
      sourceIds: ["ms-teams-admin"],
      routePriorities: ["primary"],
      authorityRoles: ["teams_admin_primary"]
    }
  };
}

function quickFromClaims(question: string, texts: string[]): string {
  const claims = texts.map((text, index) =>
    claim(`claim:${index + 1}`, text, index + 1)
  );
  const intent = intentOf(question);
  const plan = {
    planIdentity: {
      planId: "plan:i4",
      planHash: "c".repeat(64),
      schemaVersion: "atomic-source-bound-answer-plan/v1",
      plannerPolicyVersion: "minimal-atomic-source-bound-planner/r3"
    },
    snapshotBinding: {
      snapshotId: "grounding:i4",
      snapshotHash: "b".repeat(64)
    },
    question,
    intent,
    answerability: "answered",
    answerType: intent.expectedAnswerType,
    plannedClaims: claims,
    requiredCaveats: [],
    unsupportedAspects: [],
    evidenceReferences: { usedEvidenceIds: [], unusedEvidenceIds: [] },
    freshnessInstructions: { mustVerifyBeforeFinalAnswer: false, reasons: [] },
    previewInstructions: { previewEvidenceUsed: false, requiredLabel: false },
    exactIdentifierState: { required: false, verified: true, identifiers: [] },
    recommendedStructure: { format: "bullets", orderedSections: ["direct_answer"] },
    diagnostics: {
      latencyMs: 0,
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
        note: "ok"
      }
    }
  } as unknown as AnswerPlan;
  const provenance: ExtractiveAssemblyProvenance = {
    renderedClaims: claims.map((item) => ({
      claimId: item.claimId,
      renderedText: item.proposition,
      status: "mandatory",
      sectionId: item.sectionId
    })),
    policyUnits: [],
    omittedClaims: []
  } as unknown as ExtractiveAssemblyProvenance;
  const answer = {
    answerability: "answered",
    answerText: texts.join("\n\n"),
    caveats: [],
    extractiveAssembly: provenance
  } as unknown as GroundedAnswer;
  return presentGroundedAnswer({
    plan,
    answer,
    provenance,
    contextBlocks: []
  }).liveAssistQuick.answerText;
}

test("I4 Interview Quick renders a header plus distinct grounded bullets", () => {
  const answer = quickFromClaims(
    "Explain Teams Direct Routing and the SBC role.",
    [
      "Direct Routing connects Teams Phone to the PSTN through a certified SBC.",
      "SIP signaling stays with Microsoft while media can take a shorter path.",
      "The SBC terminates the PSTN connection and must present a valid TLS certificate.",
      "Direct Routing connects Teams Phone to the PSTN through a certified SBC."
    ]
  );
  assert.match(answer, /Direct Routing connects Teams Phone/);
  assert.match(answer, /^- /m);
  assert.equal((answer.match(/^- /gm) ?? []).length >= 2, true);
  assert.doesNotMatch(answer, /Microsoft documentation context/);
  const unique = new Set(
    answer
      .split(/\n+/)
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean)
  );
  assert.ok(unique.size >= 3);
});

test("I4 comparison answers keep both named sides", () => {
  const answer = quickFromClaims(
    "When would you use Call Analytics versus CQD?",
    [
      "Call Analytics is used to investigate an individual call or meeting.",
      "CQD shows organization-wide call quality trends across the tenant.",
      "Use Call Analytics for one user and CQD when the problem looks widespread."
    ]
  );
  assert.match(answer, /Call Analytics/);
  assert.match(answer, /CQD/);
});

test("I4 troubleshooting answers keep multiple distinct diagnostic points", () => {
  const answer = quickFromClaims(
    "How would you troubleshoot one-way audio on a Direct Routing call?",
    [
      "Confirm whether the failure is signaling or media by checking SIP and RTP paths.",
      "Review firewall, NAT, and media-bypass state for the affected call direction.",
      "Collect SBC traces and Teams call telemetry before changing certificates."
    ]
  );
  assert.ok((answer.match(/^- /gm) ?? []).length >= 2);
  assert.match(answer, /signaling|media/i);
  assert.match(answer, /firewall|NAT|telemetry|traces/i);
});

test("I4 G2.2 executable workflow remains Detailed-only and is not rebuilt", () => {
  const synthesis = readFileSync(
    resolve("src/main/services/answerV2/groundedAnswerSynthesis.ts"),
    "utf8"
  );
  assert.match(synthesis, /profile === "helpdesk_detailed"/);
  assert.match(synthesis, /buildExecutableWorkflow/);
  const presenter = readFileSync(
    resolve("src/main/services/answerV2/deterministicAnswerPresenter.ts"),
    "utf8"
  );
  assert.doesNotMatch(presenter, /Runnable PowerShell/);
  assert.doesNotMatch(presenter, /OpenAiGroundedAnswerGenerator/);
});

test("I4 Interview Quick still makes no cloud synthesis call", () => {
  const port = readFileSync(
    resolve("src/main/services/conversations/answerExecutionPort.ts"),
    "utf8"
  );
  assert.match(port, /presentationSynthesis === "disabled"/);
  assert.match(port, /expandInterviewQuickClaims/);
  assert.match(port, /multiConceptSelection/);
});
