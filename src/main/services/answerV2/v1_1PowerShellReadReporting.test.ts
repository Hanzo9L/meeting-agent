import assert from "node:assert/strict";
import test from "node:test";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import type { FusedRetrievalCandidate, HybridRetrievalResult } from "../retrievalV2";
import { buildAnswerPlan } from "./answerPlanner";
import { validateAnswerPlanIntegrity } from "./answerPlanIntegrity";
import { assembleDeterministicAnswer } from "./deterministicAnswerAssembler";
import { bindEvidenceBundleSnapshot, type EvidenceBundleDecisionState } from "./groundingDecisionSnapshot";
import { deriveEvidenceAspects, evaluateCandidateAspectSupport } from "./evidenceAspectPolicy";
import type { EvidenceAspect, EvidenceAspectCoverage, EvidenceBundle, EvidenceItem } from "./types";

// V1.1 — PowerShell Read/Reporting Evidence Support
//
// Primary acceptance question used throughout this suite.
const ACCEPTANCE_QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

function deriveAspectsFor(question: string): {
  result: HybridRetrievalResult;
  aspects: EvidenceAspect[];
} {
  const intent = extractQueryIntent(question).intent;
  const scope = routeQueryIntent(intent).scope;
  const result = { intent, scope } as HybridRetrievalResult;
  return { result, aspects: deriveEvidenceAspects(result) };
}

function makeCandidate(params: {
  sourceId: string;
  authorityRoles: FusedRetrievalCandidate["authority"]["authorityRoles"];
  routePriority: "primary" | "supporting";
  title: string;
  text: string;
  url: string;
  headingPath?: string[];
  rank?: number;
}): FusedRetrievalCandidate {
  return {
    candidateId: `cand-${params.sourceId}-${params.title}`,
    method: "semantic",
    documentId: `doc-${params.title}`,
    chunkId: `chunk-${params.title}`,
    sectionId: "section-a",
    headingPath: params.headingPath ?? [params.title],
    title: params.title,
    text: params.text,
    authority: {
      sourceId: params.sourceId,
      trackId: "ga",
      sourceStatus: "ga",
      authorityTier: "tier1",
      authorityRoles: params.authorityRoles,
      routePriority: params.routePriority
    },
    provenance: {
      sourcePath: "path/to/doc.md",
      canonicalUrl: params.url,
      sourceRevision: { transport: "github", commitSha: "abc" },
      headingPath: params.headingPath ?? [params.title],
      sectionId: "section-a"
    },
    scores: { lexical: 0.4, exactMatch: null, semanticSimilarity: 0.8 },
    retrievalReasons: ["semantic_match_signal"],
    methods: ["semantic"],
    methodSignals: {
      methods: ["semantic"],
      exact: { matched: false, score: null, rank: null },
      lexical: { score: 0.4, rank: 1 },
      semantic: { similarity: 0.8, rank: 1 }
    },
    fusion: {
      rank: params.rank ?? 1,
      score: 90,
      contributions: {
        exactScore: 0,
        lexicalRank: 2,
        semanticRank: 3,
        methodAgreement: 0,
        routePriority: params.routePriority === "primary" ? 7 : 2,
        authorityRole: 6,
        betaPolicy: 0,
        implicitCmdletSpecificity: 0,
        total: 90
      },
      rationale: ["test"]
    },
    sourceDedup: { mergedFromCandidateIds: [] }
  };
}

// --- Item 1: read/reporting intent is distinguished from configuration-changing intent

test("G2.1: a per-user Enterprise Voice report requires target and returned-value facets", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const aspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "enterprise voice"
  );
  assert.ok(aspect, "expected a mandatory 'enterprise voice' aspect");
  assert.equal(aspect!.answerObject, "configuration_state");
  assert.deepEqual(aspect!.requiredFacets, [
    "user_target",
    "returned_value"
  ]);
});

test("V1.1.1: a configuration-changing phrasing of Enterprise Voice still resolves to answerObject 'configuration_behavior' requiring the 'configuration' facet", () => {
  const { aspects } = deriveAspectsFor(
    "How would I enable Enterprise Voice for a user with PowerShell?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  assert.equal(mandatory!.answerObject, "configuration_behavior");
  assert.ok(mandatory!.requiredFacets.includes("configuration"));
});

// --- Item 2/3: canonical Get-* reference evidence directly supports a relevant
//     read/reporting aspect; unrelated Get-* evidence cannot.

test("G2.1: a tenant dial-plan definition getter does not satisfy a per-user effective-value aspect", () => {
  const { result, aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const dialPlanAspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "dial plan"
  );
  assert.ok(dialPlanAspect);
  const cmdletCandidate = makeCandidate({
    sourceId: "ms-teams-powershell",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    routePriority: "primary",
    title: "Get-CsTenantDialPlan",
    headingPath: ["Get-CsTenantDialPlan", "SYNOPSIS"],
    text: "Use the Get-CsTenantDialPlan cmdlet to retrieve a tenant dial plan.",
    url: "https://learn.microsoft.com/powershell/module/microsoftteams/get-cstenantdialplan"
  });
  const support = evaluateCandidateAspectSupport(result, cmdletCandidate, dialPlanAspect!);
  assert.equal(support.strength, "supporting");
  assert.ok(!support.matchedFacets.includes("returned_value"));
});

test("V1.1.3: an unrelated Get-* cmdlet cannot directly support a read/reporting aspect about a different subject", () => {
  const { result, aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const dialPlanAspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "dial plan"
  );
  assert.ok(dialPlanAspect);
  const unrelatedCmdletCandidate = makeCandidate({
    sourceId: "ms-teams-powershell",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    routePriority: "primary",
    title: "Get-CsTeamsMeetingPolicy",
    headingPath: ["Get-CsTeamsMeetingPolicy", "SYNOPSIS"],
    text: "Use the Get-CsTeamsMeetingPolicy cmdlet to retrieve meeting policy settings for meetings held in your organization.",
    url: "https://learn.microsoft.com/powershell/module/microsoftteams/get-csteamsmeetingpolicy"
  });
  const support = evaluateCandidateAspectSupport(result, unrelatedCmdletCandidate, dialPlanAspect!);
  assert.notEqual(support.strength, "direct");
});

// --- Item 4/9: PowerShell authority remains required when PowerShell is the requested method; P1/P2 semantics unchanged.

test("V1.1.4: every read/reporting output aspect still requires PowerShell method + Teams PowerShell cmdlet authority", () => {
  const { aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const teamsOutputs = aspects.filter(
    (aspect) => aspect.requirement === "mandatory" && aspect.answerObject === "configuration_state"
  );
  assert.ok(teamsOutputs.length >= 4, "expected multiple configuration_state Teams outputs");
  for (const aspect of teamsOutputs) {
    const powershellConstraint = aspect.methodConstraints.find(
      (constraint) => constraint.kind === "powershell"
    );
    assert.ok(powershellConstraint?.required, `expected required PowerShell constraint on ${aspect.aspectId}`);
    assert.ok(
      aspect.authorityRequirement.requiredRoles.includes("teams_powershell_cmdlet_primary"),
      `expected teams_powershell_cmdlet_primary authority on ${aspect.aspectId}`
    );
  }
});

test("V1.1.9: a non-PowerShell (Entra) question's method semantics are unaffected by the read/reporting facet contract", () => {
  const { aspects } = deriveAspectsFor(
    "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  assert.ok(!mandatory!.methodConstraints.some((constraint) => constraint.required));
});

// --- Item 5: write/configuration questions still require write/configuration support; Get-* alone is insufficient.

test("V1.1.5: a write/configuration question (assign a phone number) requires procedure+operation (write) support, and read-only Get-* evidence cannot satisfy it", () => {
  const { result, aspects } = deriveAspectsFor(
    "How do I assign a phone number to a Teams user with PowerShell?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  // A write/configuration-changing question is not reclassified as
  // read/reporting: it keeps its pre-existing "grant" operation and
  // procedure+operation facet requirement rather than the new
  // configuration_state/state contract introduced for read/reporting intent.
  assert.notEqual(mandatory!.answerObject, "configuration_state");
  assert.equal(mandatory!.operation, "grant");
  assert.ok(mandatory!.requiredFacets.includes("operation"));
  const readOnlyCandidate = makeCandidate({
    sourceId: "ms-teams-powershell",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    routePriority: "primary",
    title: "Get-CsOnlineTelephoneNumber",
    headingPath: ["Get-CsOnlineTelephoneNumber", "SYNOPSIS"],
    text: "Use the Get-CsOnlineTelephoneNumber cmdlet to retrieve telephone numbers in your tenant.",
    url: "https://learn.microsoft.com/powershell/module/microsoftteams/get-csonlinetelephonenumber"
  });
  const support = evaluateCandidateAspectSupport(result, readOnlyCandidate, mandatory!);
  assert.notEqual(support.strength, "direct");
});

test("V1.1.5: a write/configuration question is satisfied directly by matching Set-*/Grant-* configuration evidence", () => {
  const { result, aspects } = deriveAspectsFor(
    "How do I assign a phone number to a Teams user with PowerShell?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  const writeCandidate = makeCandidate({
    sourceId: "ms-teams-powershell",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    routePriority: "primary",
    title: "Set-CsPhoneNumberAssignment",
    headingPath: ["Set-CsPhoneNumberAssignment", "EXAMPLES"],
    text: [
      "Use the Set-CsPhoneNumberAssignment cmdlet to assign a phone number to a user.",
      "1. Run Set-CsPhoneNumberAssignment -Identity user@contoso.com -PhoneNumber \"+14255551234\" -PhoneNumberType DirectRouting.",
      "2. Configure the assignment and confirm the number now appears on the user's account."
    ].join(" "),
    url: "https://learn.microsoft.com/powershell/module/microsoftteams/set-csphonenumberassignment"
  });
  const support = evaluateCandidateAspectSupport(result, writeCandidate, mandatory!);
  // Write/configuration facet requirements (procedure + operation) are
  // untouched by V1.1: this assertion only proves the "operation" facet
  // still requires genuine write/assign language, which is what the
  // read/reporting distinction (item 1) must never weaken.
  assert.ok(support.matchedFacets.includes("operation"));
  assert.ok(!support.missingFacets.includes("operation"));
});

// --- Item 6: all five acceptance-workflow outputs can select appropriate authoritative evidence.

test("V1.1.6: each of the five acceptance-workflow read/reporting outputs can be directly supported by plausible authoritative PowerShell evidence", () => {
  const { result, aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const fixtures: Record<string, { title: string; text: string }> = {
    "enterprise voice": {
      title: "Get-CsOnlineUser",
      text: "Get-CsOnlineUser -Filter {EnterpriseVoiceEnabled -eq $True} returns users whose EnterpriseVoiceEnabled property is true."
    },
    "phone number": {
      title: "Get-CsOnlineUser",
      text: "Get-CsOnlineUser -Identity user@contoso.com returns the TelephoneNumbers property for that user."
    },
    "voice routing policy": {
      title: "Get-CsOnlineUser",
      text: "Get-CsOnlineUser -Identity user@contoso.com | Select OnlineVoiceRoutingPolicy returns that user's OnlineVoiceRoutingPolicy."
    },
    "dial plan": {
      title: "Get-CsEffectiveTenantDialPlan",
      text: "Get-CsEffectiveTenantDialPlan -Identity user@contoso.com returns the EffectiveTenantDialPlanName effective for the user."
    },
    "calling policy": {
      title: "Get-CsUserPolicyAssignment",
      text: "Get-CsUserPolicyAssignment -Identity user@contoso.com -PolicyType TeamsCallingPolicy returns the effective assignment PolicyName for that user."
    }
  };
  const teamsOutputs = aspects.filter(
    (aspect) => aspect.requirement === "mandatory" && aspect.answerObject === "configuration_state"
  );
  assert.equal(teamsOutputs.length, Object.keys(fixtures).length);
  for (const aspect of teamsOutputs) {
    const fixture = fixtures[aspect.subject];
    assert.ok(fixture, `missing fixture for subject ${aspect.subject}`);
    const candidate = makeCandidate({
      sourceId: "ms-teams-powershell",
      authorityRoles: ["teams_powershell_cmdlet_primary"],
      routePriority: "primary",
      title: fixture!.title,
      headingPath: [fixture!.title, "SYNOPSIS"],
      text: fixture!.text,
      url: `https://learn.microsoft.com/powershell/module/microsoftteams/${fixture!.title.toLowerCase()}`
    });
    const support = evaluateCandidateAspectSupport(result, candidate, aspect);
    assert.equal(
      support.strength,
      "direct",
      `expected direct support for ${aspect.subject} from ${fixture!.title}`
    );
    assert.deepEqual(support.matchedFacets, [
      "user_target",
      "returned_value"
    ]);
  }
});

// --- Item 7: Teams Admin prose does not displace stronger method-authoritative PowerShell evidence.

test("V1.1.7: a canonical read-cmdlet reference scores higher than generic Teams Admin prose for the same read/reporting aspect", () => {
  const { result, aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const dialPlanAspect = aspects.find(
    (item) => item.requirement === "mandatory" && item.subject === "dial plan"
  );
  assert.ok(dialPlanAspect);
  const cmdletCandidate = makeCandidate({
    sourceId: "ms-teams-powershell",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    routePriority: "primary",
    title: "Get-CsEffectiveTenantDialPlan",
    headingPath: ["Get-CsEffectiveTenantDialPlan", "DESCRIPTION"],
    text: "Get-CsEffectiveTenantDialPlan -Identity user@contoso.com returns the EffectiveTenantDialPlanName effective for the user.",
    url: "https://learn.microsoft.com/powershell/module/microsoftteams/get-cseffectivetenantdialplan"
  });
  const adminProseCandidate = makeCandidate({
    sourceId: "ms-teams-admin",
    authorityRoles: ["teams_admin_primary"],
    routePriority: "primary",
    title: "Planning Teams dial plans for Teams Phone",
    headingPath: ["Planning Teams dial plans for Teams Phone", "Dial plans and routing considerations"],
    text: "A dial plan is a set of normalization rules that translate dialed phone numbers into the standard format used for call routing.",
    url: "https://learn.microsoft.com/en-us/microsoftteams/dial-plans-routing-overview"
  });
  const cmdletSupport = evaluateCandidateAspectSupport(result, cmdletCandidate, dialPlanAspect!);
  const adminSupport = evaluateCandidateAspectSupport(result, adminProseCandidate, dialPlanAspect!);
  assert.equal(cmdletSupport.strength, "direct");
  assert.ok(
    cmdletSupport.qualityScore > adminSupport.qualityScore,
    `expected canonical read-cmdlet evidence (${cmdletSupport.qualityScore}) to outrank generic admin prose (${adminSupport.qualityScore})`
  );
});

// --- Item 8: narrow single-cmdlet questions remain correct (cmdlet_identifier/cmdlet_semantics untouched).

test("V1.1.8: a narrow single-cmdlet question is unaffected by the configuration_state/state facet contract", () => {
  const { aspects } = deriveAspectsFor("What does Get-CsOnlineVoiceRoutingPolicy do?");
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.equal(mandatory.length, 1);
  assert.ok(
    mandatory[0]!.answerObject === "cmdlet_identifier" || mandatory[0]!.answerObject === "cmdlet_semantics"
  );
  assert.ok(!mandatory[0]!.requiredFacets.includes("state"));
});

// --- Item 10: Entra/SharePoint regressions unchanged.

test("V1.1.10: Entra Conditional Access authority is unaffected by the read/reporting facet contract", () => {
  const { aspects } = deriveAspectsFor(
    "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  assert.deepEqual(mandatory!.authorityRequirement.requiredDomains, ["entra"]);
});

test("V1.1.10: SharePoint/Copilot governance authority is unaffected by the read/reporting facet contract", () => {
  const { aspects } = deriveAspectsFor(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory.length > 0);
  for (const aspect of mandatory) {
    assert.ok(aspect.authorityRequirement.requiredDomains.includes("sharepoint"));
  }
});

// --- Item 11: unresolved-domain fail-closed behavior unchanged.

test("V1.1.11: an unresolved-domain (Exchange) question still fails closed with zero domains", () => {
  const intent = extractQueryIntent(
    "How do I set up a mail flow rule to forward external email in Exchange Online?"
  ).intent;
  assert.deepEqual(intent.domains, []);
});

// --- Item 12: R3/R4/WB-21 integrity unchanged — R2-supported aspects must always be plannable by R3.

function makeEvidence(id: string, sourceId: string, title: string, text: string): EvidenceItem {
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
      title,
      canonicalUrl: `https://learn.microsoft.com/docs/${id}`,
      sourcePath: `docs/${id}.md`,
      sourceRevision: { transport: "github", commitSha: "v1-1-fixture" }
    },
    location: { sectionId: `section-${id}`, headingPath: [title] },
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

function makeReadReportingBundle(): EvidenceBundle {
  const { result, aspects } = deriveAspectsFor(ACCEPTANCE_QUESTION);
  const intent = result.intent;
  const scope = result.scope;
  const teamsOutputs = aspects.filter(
    (aspect) => aspect.requirement === "mandatory" && aspect.answerObject === "configuration_state"
  );
  const stateEvidence: Record<string, { title: string; text: string }> = {
    "enterprise voice": {
      title: "Get-CsOnlineUser",
      text: "Get-CsOnlineUser -Filter {EnterpriseVoiceEnabled -eq $True} returns users whose EnterpriseVoiceEnabled property is true."
    },
    "phone number": {
      title: "Get-CsOnlineUser",
      text: "Get-CsOnlineUser -Identity user@contoso.com returns the TelephoneNumbers property for that user."
    },
    "voice routing policy": {
      title: "Get-CsOnlineUser",
      text: "Get-CsOnlineUser -Identity user@contoso.com | Select OnlineVoiceRoutingPolicy returns that user's OnlineVoiceRoutingPolicy."
    },
    "dial plan": {
      title: "Get-CsEffectiveTenantDialPlan",
      text: "Get-CsEffectiveTenantDialPlan -Identity user@contoso.com returns the EffectiveTenantDialPlanName effective for that user."
    },
    "calling policy": {
      title: "Get-CsUserPolicyAssignment",
      text: "Get-CsUserPolicyAssignment -Identity user@contoso.com -PolicyType TeamsCallingPolicy returns the effective assignment PolicyName for that user."
    }
  };
  const evidence = teamsOutputs.map((aspect) => {
    const fixture = stateEvidence[aspect.subject]!;
    return makeEvidence(
      `ev-${aspect.aspectId}`,
      "ms-teams-powershell",
      fixture.title,
      fixture.text
    );
  });
  const evidenceByAspect: Record<string, string[]> = {};
  for (let i = 0; i < teamsOutputs.length; i += 1) {
    evidenceByAspect[teamsOutputs[i]!.aspectId] = [evidence[i]!.evidenceId];
  }
  const supportByAspect: EvidenceAspectCoverage["supportByAspect"] = {};
  for (const aspect of aspects) supportByAspect[aspect.aspectId] = [];

  const coverage: EvidenceAspectCoverage = {
    aspects,
    evidenceByAspect,
    supportByAspect,
    supportedMandatoryAspectIds: teamsOutputs.map((aspect) => aspect.aspectId),
    unsupportedMandatoryAspectIds: aspects
      .filter((aspect) => aspect.requirement === "mandatory" && aspect.answerObject !== "configuration_state")
      .map((aspect) => aspect.aspectId),
    authorityLimitedAspectIds: [],
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

test("G2.1: R3 plans target/value claims for every R2-supported per-user state aspect", () => {
  const bundle = makeReadReportingBundle();
  const plan = buildAnswerPlan(bundle);
  const supportedIds = new Set(bundle.aspectCoverage.supportedMandatoryAspectIds);
  const claimedIds = new Set(plan.plannedClaims.map((claim) => claim.requiredAspectId));
  for (const aspectId of supportedIds) {
    assert.ok(claimedIds.has(aspectId), `expected R3 to plan a claim for R2-supported aspect ${aspectId}`);
  }
  const stateClaims = plan.plannedClaims.filter((claim) => claim.requiredAspectId && supportedIds.has(claim.requiredAspectId));
  assert.ok(stateClaims.length > 0);
  for (const claim of stateClaims) {
    assert.equal(claim.claimType, "configuration");
    assert.equal(claim.sectionId, "configuration");
  }
  assert.equal(plan.diagnostics.decomposition.supportedConcepts.length, stateClaims.length);
  const callingPolicy = stateClaims.find(
    (claim) =>
      claim.requiredAspectId ===
      "mandatory:policy:calling-policy:general"
  );
  assert.equal(
    callingPolicy?.proposition,
    "Get-CsUserPolicyAssignment -Identity user@contoso.com -PolicyType TeamsCallingPolicy returns the effective assignment PolicyName for that user."
  );
  const integrity = validateAnswerPlanIntegrity({ bundle, plan });
  assert.equal(integrity.valid, true, JSON.stringify(integrity.issues));
  const assembled = assembleDeterministicAnswer({ bundle, plan });
  assert.equal(assembled.ok, true);
});

// --- Item 13: zero answer-generation LLM calls.

test("V1.1.13: aspect derivation, candidate evaluation, and planning are synchronous with zero LLM/provider calls", () => {
  assert.notEqual(deriveEvidenceAspects.constructor.name, "AsyncFunction");
  assert.notEqual(evaluateCandidateAspectSupport.constructor.name, "AsyncFunction");
  assert.notEqual(buildAnswerPlan.constructor.name, "AsyncFunction");
  const bundle = makeReadReportingBundle();
  const plan = buildAnswerPlan(bundle);
  assert.ok(plan.plannedClaims.length > 0);
});
