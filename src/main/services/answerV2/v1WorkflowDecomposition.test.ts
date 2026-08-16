import assert from "node:assert/strict";
import test from "node:test";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import type { HybridRetrievalResult } from "../retrievalV2";
import type { QueryIntent } from "../retrievalV2";
import { buildAnswerPlan } from "./answerPlanner";
import { bindEvidenceBundleSnapshot, type EvidenceBundleDecisionState } from "./groundingDecisionSnapshot";
import {
  deriveEvidenceAspects,
  OUTPUT_TRANSFORMATION_RULE_ID
} from "./evidenceAspectPolicy";
import type { EvidenceAspect, EvidenceAspectCoverage, EvidenceBundle, EvidenceItem } from "./types";

// V1 — Multi-Output PowerShell Workflow Decomposition
// Primary acceptance question used throughout this suite (hyphenated, exactly
// as the user is expected to phrase it).
const ACCEPTANCE_QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

// Same request with the voice-routing-policy phrase unhyphenated, used to
// prove punctuation/hyphen normalization is equivalent (item 1).
const ACCEPTANCE_QUESTION_UNHYPHENATED =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice routing policy, dial plan, and calling policy, and exports the results to CSV.";

function deriveAspectsFor(question: string): {
  intent: QueryIntent;
  aspects: EvidenceAspect[];
} {
  const intent = extractQueryIntent(question).intent;
  const scope = routeQueryIntent(intent).scope;
  const result = { intent, scope } as HybridRetrievalResult;
  return { intent, aspects: deriveEvidenceAspects(result) };
}

function mandatoryTeamsOutputAspects(aspects: EvidenceAspect[]): EvidenceAspect[] {
  return aspects.filter(
    (aspect) =>
      aspect.requirement === "mandatory" &&
      aspect.answerObject === "configuration_state"
  );
}

// --- Item 1: hyphen/punctuation normalization -----------------------------

test("V1.1: hyphenated and unhyphenated 'voice-routing policy' / 'voice routing policy' normalize equivalently", () => {
  const hyphenated = extractQueryIntent(ACCEPTANCE_QUESTION).intent;
  const unhyphenated = extractQueryIntent(ACCEPTANCE_QUESTION_UNHYPHENATED).intent;
  assert.ok(hyphenated.entities.includes("voice routing policy"));
  assert.ok(unhyphenated.entities.includes("voice routing policy"));
  assert.deepEqual(hyphenated.entities, unhyphenated.entities);
  assert.deepEqual(hyphenated.policyNames, unhyphenated.policyNames);
  assert.deepEqual(hyphenated.domains, unhyphenated.domains);
});

test("V1.1: hyphen normalization does not weaken exact cmdlet identifier matching", () => {
  const intent = extractQueryIntent(
    "What does Set-CsOnlineVoiceRoutingPolicy do?"
  ).intent;
  assert.deepEqual(intent.commandNames, ["Set-CsOnlineVoiceRoutingPolicy"]);
});

// --- Items 2-6: missing Teams Voice reporting concepts are represented ----

test("V1.2: Enterprise Voice enabled state is represented as a mandatory aspect", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const aspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "enterprise voice"
  );
  assert.ok(aspect, "expected a mandatory 'enterprise voice' aspect");
});

test("V1.3: assigned phone number is represented as a mandatory aspect", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const aspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "phone number"
  );
  assert.ok(aspect, "expected a mandatory 'phone number' aspect");
});

test("V1.4: voice-routing policy is represented as a mandatory aspect", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const aspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "voice routing policy"
  );
  assert.ok(aspect, "expected a mandatory 'voice routing policy' aspect");
});

test("V1.5: dial plan is represented as a mandatory aspect", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const aspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "dial plan"
  );
  assert.ok(aspect, "expected a mandatory 'dial plan' aspect");
});

test("V1.6: calling policy is represented as a mandatory aspect", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const aspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "calling policy"
  );
  assert.ok(aspect, "expected a mandatory 'calling policy' aspect");
});

// --- Item 7: CSV output requirement is not silently dropped ---------------

test("V1.7: CSV export requirement is represented as an explicit mandatory output-transformation aspect, not silently dropped", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const csvAspect = aspects.find((item) =>
    item.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)
  );
  assert.ok(csvAspect, "expected an explicit CSV output-transformation aspect");
  assert.equal(csvAspect!.requirement, "mandatory");
  assert.deepEqual(csvAspect!.authorityRequirement.requiredDomains, [
    "powershell_core"
  ]);
  assert.deepEqual(csvAspect!.authorityRequirement.requiredRoles, [
    "powershell_core_primary"
  ]);
});

// --- Item 8: one workflow, multiple required output aspects ---------------

test("V1.8: one workflow contains multiple required output aspects rather than a single merged compound subject", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const teamsOutputs = mandatoryTeamsOutputAspects(aspects);
  // All five Teams-side outputs remain distinct from Core orchestration.
  assert.equal(teamsOutputs.length, 5, `expected 5 Teams-side output aspects, got ${teamsOutputs.length}`);
  const subjects = teamsOutputs.map((aspect) => aspect.subject).sort();
  assert.deepEqual(subjects, [
    "calling policy",
    "dial plan",
    "enterprise voice",
    "phone number",
    "voice routing policy"
  ]);
  // None of the five was collapsed into a compound subject spanning more
  // than one requested output (e.g. "phone number voice routing policy").
  for (const aspect of teamsOutputs) {
    assert.equal(aspect.subjects.length, 1, `expected a single subject for aspect ${aspect.aspectId}`);
    assert.ok(
      !aspect.derivation.ruleIds.includes("compound_subject_binding"),
      `aspect ${aspect.aspectId} should not be a compound-bound subject`
    );
  }
  const total = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(
    total.length,
    9,
    "expected 5 Teams outputs + 4 bounded PowerShell Core aspects"
  );
});

// --- Item 9: Teams PowerShell authority is required per output ------------

test("V1.9: each requested Teams output aspect requires PowerShell method + Teams PowerShell cmdlet authority", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const teamsOutputs = mandatoryTeamsOutputAspects(aspects);
  assert.equal(teamsOutputs.length, 5);
  for (const aspect of teamsOutputs) {
    const powershellConstraint = aspect.methodConstraints.find(
      (constraint) => constraint.kind === "powershell"
    );
    assert.ok(
      powershellConstraint?.required,
      `expected a required PowerShell method constraint on ${aspect.aspectId}`
    );
    assert.ok(
      aspect.authorityRequirement.requiredRoles.includes("teams_powershell_cmdlet_primary"),
      `expected teams_powershell_cmdlet_primary authority on ${aspect.aspectId}`
    );
    assert.ok(aspect.authorityRequirement.requiredDomains.includes("teams_powershell"));
  }
});

// --- Item 11: narrow single-cmdlet questions remain narrow -----------------

test("V1.11: a narrow single-cmdlet question does not get decomposed into a multi-output workflow", () => {
  const { aspects } = deriveAspectsFor("What does Get-CsOnlineVoiceRoutingPolicy do?");
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1, "narrow cmdlet question should keep a single mandatory aspect");
  assert.ok(
    mandatory[0]!.answerObject === "cmdlet_identifier" || mandatory[0]!.answerObject === "cmdlet_semantics"
  );
  assert.ok(
    !aspects.some((aspect) => aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)),
    "narrow cmdlet question must not gain a CSV/output-transformation aspect"
  );
});

// --- Item 12: unrelated policy questions do not explode into workflows -----

test("V1.12: an unrelated policy question (no population enumeration + reporting) does not explode into workflow aspects", () => {
  const { aspects } = deriveAspectsFor("How do Microsoft Teams Calling Plans work?");
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1, "unrelated policy question should stay a single mandatory aspect");
  assert.ok(
    !aspects.some((aspect) => aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)),
    "unrelated policy question must not gain a CSV/output-transformation aspect"
  );
});

test("V1.12: PowerShell questions in general are not treated as workflows without population enumeration + reporting", () => {
  const { aspects } = deriveAspectsFor(
    "How do I change a Teams voice routing policy with PowerShell?"
  );
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory.length <= 2, "a normal PowerShell question should not decompose into a workflow");
  assert.ok(!aspects.some((aspect) => aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)));
});

// --- Item 13: Entra/SharePoint regressions unchanged -----------------------

test("V1.13: Entra Conditional Access question authority is unaffected by V1", () => {
  const { aspects } = deriveAspectsFor(
    "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  assert.deepEqual(mandatory!.authorityRequirement.requiredDomains, ["entra"]);
  assert.ok(!aspects.some((aspect) => aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)));
});

test("V1.13: SharePoint/Copilot governance question authority is unaffected by V1", () => {
  const { aspects } = deriveAspectsFor(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory.length > 0);
  for (const aspect of mandatory) {
    assert.ok(aspect.authorityRequirement.requiredDomains.includes("sharepoint"));
  }
  assert.ok(!aspects.some((aspect) => aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)));
});

// --- Item 14: unresolved-domain fail-closed behavior unchanged ------------

test("V1.14: an unresolved-domain (Exchange) question still fails closed with zero domains rather than defaulting", () => {
  const intent = extractQueryIntent(
    "How do I set up a mail flow rule to forward external email in Exchange Online?"
  ).intent;
  assert.deepEqual(intent.domains, []);
});

// --- Item 15: R3 behavior on the richer workflow evidence bundle ----------

function makeEvidence(id: string, sourceId: string, text: string): EvidenceItem {
  const powershell = sourceId === "ms-teams-powershell";
  return {
    evidenceId: id,
    chunkId: `${id}-chunk`,
    documentId: `${id}-doc`,
    source: {
      sourceId,
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain: powershell ? "teams_powershell" : "teams_admin",
      authorityTier: "tier1",
      authorityRoles: powershell ? ["teams_powershell_cmdlet_primary"] : ["teams_admin_primary"],
      routePriority: "primary",
      title: id,
      canonicalUrl: `https://learn.microsoft.com/docs/${id}`,
      sourcePath: `docs/${id}.md`,
      sourceRevision: { transport: "github", commitSha: "v1-fixture" }
    },
    location: { sectionId: `section-${id}`, headingPath: [id] },
    text,
    supportTypes: powershell ? ["cmdlet_semantics"] : ["concept_definition"],
    retrieval: {
      methods: ["exact"],
      fusionRank: 1,
      fusionScore: 100,
      methodSignals: {
        methods: ["exact"],
        exact: { matched: true, score: 1, rank: 1 },
        lexical: { score: null, rank: null },
        semantic: { similarity: null, rank: null }
      },
      exactMatch: null,
      retrievalReasons: ["fixture"]
    },
    selectionReason: "selected:aspect:fixture:direct"
  };
}

function makeWorkflowBundle(): EvidenceBundle {
  const { intent, aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const scope = routeQueryIntent(intent).scope;
  const teamsOutputs = mandatoryTeamsOutputAspects(aspects);
  const csvAspect = aspects.find((aspect) =>
    aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)
  )!;
  // Text is written to satisfy R3's facet-scoring heuristics. V1.1 — each of
  // the five per-output aspects in this workflow resolves to
  // answerObject "configuration_state" (read/reporting a property's current
  // value), which requires the "state" facet: evidence whose own cmdlet verb
  // is read-shaped (Get-/Show-/Test-...) or whose text uses read/retrieve
  // language, matching the corpus's actual Get-* cmdlet synopsis style. This
  // is deliberately NOT "configure/set/assign" wording (that would instead
  // satisfy "configuration", the write-facet, which this read workflow does
  // not require) so R3's existing per-sentence claim derivation — unmodified
  // by V1.1 — can actually plan a claim from each output's evidence.
  const evidenceTextBySubject: Record<string, string> = {
    "enterprise voice":
      "Get-CsOnlineUser -Filter {EnterpriseVoiceEnabled -eq $True} returns users whose EnterpriseVoiceEnabled property is true.",
    "phone number":
      "Get-CsOnlineUser -Identity user@contoso.com returns the TelephoneNumbers property for that user.",
    "voice routing policy":
      "Get-CsOnlineUser -Identity user@contoso.com | Select OnlineVoiceRoutingPolicy returns that user's OnlineVoiceRoutingPolicy.",
    "dial plan":
      "Get-CsEffectiveTenantDialPlan -Identity user@contoso.com returns the EffectiveTenantDialPlanName effective for that user.",
    "calling policy":
      "Get-CsUserPolicyAssignment -Identity user@contoso.com -PolicyType TeamsCallingPolicy returns the effective assignment PolicyName for that user."
  };
  const evidenceTextByAspectId: Record<string, string> = {};
  for (const aspect of teamsOutputs) {
    evidenceTextByAspectId[aspect.aspectId] =
      evidenceTextBySubject[aspect.subject]!;
  }
  const evidence = teamsOutputs.map((aspect) =>
    makeEvidence(`ev-${aspect.aspectId}`, "ms-teams-powershell", evidenceTextByAspectId[aspect.aspectId]!)
  );
  const evidenceByAspect: Record<string, string[]> = {};
  for (let i = 0; i < teamsOutputs.length; i += 1) {
    evidenceByAspect[teamsOutputs[i]!.aspectId] = [evidence[i]!.evidenceId];
  }
  evidenceByAspect[csvAspect.aspectId] = [];

  const supportByAspect: EvidenceAspectCoverage["supportByAspect"] = {};
  for (const aspect of aspects) supportByAspect[aspect.aspectId] = [];

  const coverage: EvidenceAspectCoverage = {
    aspects,
    evidenceByAspect,
    supportByAspect,
    supportedMandatoryAspectIds: teamsOutputs.map((aspect) => aspect.aspectId),
    unsupportedMandatoryAspectIds: aspects
      .filter(
        (aspect) =>
          aspect.requirement === "mandatory" &&
          !teamsOutputs.some((team) => team.aspectId === aspect.aspectId)
      )
      .map((aspect) => aspect.aspectId),
    authorityLimitedAspectIds: aspects
      .filter(
        (aspect) =>
          aspect.requirement === "mandatory" &&
          !teamsOutputs.some((team) => team.aspectId === aspect.aspectId)
      )
      .map((aspect) => aspect.aspectId),
    supportingOnlyAspectIds: [],
    contextualOnlyAspectIds: [],
    supportedOptionalAspectIds: []
  };

  const decisionState: EvidenceBundleDecisionState = {
    question: intent.originalQuestion,
    intent,
    scope,
    evidence,
    rejectedCandidates: [],
    conflicts: [],
    freshness: { state: "current", requiresVerification: false, reasons: [] },
    exactIdentifierValidation: {
      required: false,
      verified: true,
      requiredDirectives: [],
      missingRequiredDirectives: []
    },
    aspectCoverage: coverage,
    authorityCoverage: {
      requestedDomains: [...intent.domains],
      coveredDomains: [...intent.domains],
      missingDomains: []
    },
    answerability: "partial",
    diagnostics: {
      latencyMs: { total: 1, selection: 1, conflictDetection: 0, answerability: 0 },
      populations: { candidates: evidence.length, selectedEvidence: evidence.length, rejectedCandidates: 0 },
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
  return bindEvidenceBundleSnapshot(decisionState, "2026-08-14T00:00:00.000Z");
}

test("V1.15: R3 sequences the supported per-output facts into claims while explicitly caveating the unsupported CSV output", () => {
  const bundle = makeWorkflowBundle();
  const plan = buildAnswerPlan(bundle);
  // The five Teams-side outputs are each represented by at least one claim
  // sourced from real evidence; R3 was not redesigned, it simply received a
  // richer aspect/evidence bundle and sequenced what it was given.
  const teamsOutputs = mandatoryTeamsOutputAspects(bundle.aspectCoverage.aspects);
  const claimedAspectIds = new Set(plan.plannedClaims.map((claim) => claim.requiredAspectId));
  for (const aspect of teamsOutputs) {
    assert.ok(claimedAspectIds.has(aspect.aspectId), `expected a claim for ${aspect.aspectId}`);
  }
  // CSV is explicitly reported as unsupported with the user-specified caveat
  // wording, rather than being silently dropped or fabricated.
  const csvUnsupported = plan.unsupportedAspects.find((item) =>
    bundle.aspectCoverage.aspects
      .find((aspect) => aspect.aspectId === item.aspectId)
      ?.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)
  );
  assert.ok(csvUnsupported, "expected an explicit unsupported-aspect entry for CSV export");
  assert.equal(csvUnsupported!.reason, "missing_authority");
  assert.match(csvUnsupported!.detail, /generic PowerShell step not currently covered/i);
  // The answer does not degenerate into "insufficient evidence" just because
  // one generic output-transformation step is uncovered.
  assert.notEqual(bundle.answerability, "insufficient_evidence");
});

// --- Item 16: zero answer-generation LLM calls -----------------------------

test("V1.16: workflow decomposition, evidence evaluation, and planning are synchronous with zero LLM/provider calls", () => {
  // deriveEvidenceAspects and buildAnswerPlan are plain synchronous
  // functions: there is no await point, network call, or provider handle
  // through which an LLM could be invoked while producing V1's richer
  // multi-output aspect/claim structure.
  assert.notEqual(deriveEvidenceAspects.constructor.name, "AsyncFunction");
  assert.notEqual(buildAnswerPlan.constructor.name, "AsyncFunction");
  const bundle = makeWorkflowBundle();
  const plan = buildAnswerPlan(bundle);
  assert.ok(plan.plannedClaims.length > 0);
});

// Sanity check that the fixture helpers above stay aligned with the real
// aspect-derivation contract (protects V1.15/V1.16 against silent drift).
test("V1: workflow bundle fixture reflects 5 Teams outputs + 1 CSV aspect", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  assert.equal(mandatoryTeamsOutputAspects(aspects).length, 5);
  assert.equal(
    aspects.filter((aspect) => aspect.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)).length,
    1
  );
});
