import assert from "node:assert/strict";
import test from "node:test";
import { routeQueryIntent } from "./domainPolicies";
import { extractQueryIntent } from "./queryIntentRules";

function route(question: string) {
  const intent = extractQueryIntent(question).intent;
  return routeQueryIntent(intent);
}

function sourceIds(result: ReturnType<typeof route>): string[] {
  return result.scope.eligibleSources.map((source) => source.sourceId);
}

function sourceById(result: ReturnType<typeof route>, sourceId: string) {
  return result.scope.eligibleSources.find((source) => source.sourceId === sourceId);
}

test("Q1 direct routing routes to Teams Admin primary with Teams PowerShell support", () => {
  const result = route("How does Teams Direct Routing voice routing work?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-admin");
  assert.ok(sourceIds(result).includes("ms-teams-powershell"));
  assert.ok(result.scope.focusSubdomains.includes("voice_routing"));
  assert.ok(!sourceIds(result).includes("ms-graph-docs"));
  assert.ok(!sourceIds(result).includes("ms-entra-docs"));
  assert.equal(result.scope.betaPolicy.allowsBeta, false);
});

test("Q2 cmdlet query prioritizes Teams PowerShell with exact match directive", () => {
  const result = route("What does Set-CsOnlineVoiceRoutingPolicy do?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-powershell");
  assert.ok(
    result.scope.exactMatchDirectives.some(
      (directive) =>
        directive.type === "cmdlet" &&
        directive.value === "Set-CsOnlineVoiceRoutingPolicy" &&
        directive.required
    )
  );
  assert.ok(result.scope.strategy.exact);
});

test("generic policy nouns do not emit exact directives", () => {
  const result = route("How do I assign a voice routing policy to a Teams user?");
  assert.ok(
    !result.scope.exactMatchDirectives.some(
      (directive) => directive.type === "policy" && directive.value.toLowerCase() === "policy"
    )
  );
});

test("canonical policy identifiers still emit exact directives", () => {
  const result = route("How do I inspect TeamsMeetingPolicy values?");
  assert.ok(
    result.scope.exactMatchDirectives.some(
      (directive) =>
        directive.type === "policy" &&
        directive.value.toLowerCase().includes("teamsmeetingpolicy")
    )
  );
});

test("multiword policy concepts remain non-exact without canonical identifier form", () => {
  const result = route("Which cmdlet can grant a voice routing policy to a Teams user?");
  assert.ok(!result.scope.exactMatchDirectives.some((directive) => directive.type === "policy"));
});

test("Q3 conditional access routes to Entra with Teams Admin supporting", () => {
  const result = route(
    "How does Conditional Access affect Teams on unmanaged devices?"
  );
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-entra-docs");
  assert.ok(sourceIds(result).includes("ms-teams-admin"));
  assert.ok(!sourceIds(result).includes("ms-teams-powershell"));
  assert.ok(result.scope.selectedDomains.includes("entra"));
  assert.ok(result.scope.selectedDomains.includes("teams_admin"));
});

test("Q4 comparison preserves both voice technologies", () => {
  const result = route("What's the difference between Direct Routing and Operator Connect?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-admin");
  assert.ok(result.scope.focusSubdomains.includes("voice_routing"));
  assert.ok(result.scope.focusSubdomains.includes("operator_connect"));
});

test("Q5 ambiguity and freshness broaden scope in controlled way", () => {
  const result = route("Is this Teams feature still supported?");
  assert.equal(result.scope.freshnessVerification.required, true);
  assert.equal(result.scope.scopeMode, "broad_due_to_ambiguity");
  assert.ok(
    result.scope.routingWarnings.includes("scope_broadened_due_to_unresolved_ambiguity")
  );
  assert.ok(result.scope.estimatedCandidatePopulation >= 5000);
});

test("Q6 graph beta query prioritizes Graph and enables beta tracks", () => {
  const result = route("How does the Microsoft Graph beta API expose Teams data?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-graph-docs");
  assert.equal(result.scope.betaPolicy.allowsBeta, true);
  const graph = sourceById(result, "ms-graph-docs");
  assert.ok(graph);
  assert.ok((graph?.eligibleTrackStatuses ?? []).includes("ga"));
  assert.ok((graph?.eligibleTrackStatuses ?? []).includes("beta"));
  assert.ok(!sourceIds(result).includes("ms-teams-powershell"));
});

test("Q7 SBC troubleshooting narrows to Teams Admin + Teams PowerShell", () => {
  const result = route("Why is my Teams SBC not routing outbound calls?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-admin");
  assert.ok(sourceIds(result).includes("ms-teams-powershell"));
  assert.ok(result.scope.focusSubdomains.includes("sbc"));
  assert.equal(result.scope.strategy.semantic, true);
  assert.equal(result.scope.strategy.lexical, true);
});

test("meeting policy intent preserves policy-specific subdomain", () => {
  const result = route("How do Teams meeting policies work?");
  assert.ok(result.scope.focusSubdomains.includes("meeting_policy"));
  assert.ok(!result.scope.exactMatchDirectives.some((d) => d.value.toLowerCase() === "policy"));
});

test("meeting settings intent stays distinct from meeting policy intent", () => {
  const settings = route("How do Teams meeting settings work?");
  const policy = route("How do Teams meeting policies work?");
  assert.ok(settings.scope.focusSubdomains.includes("meeting_settings"));
  assert.ok(!settings.scope.focusSubdomains.includes("meeting_policy"));
  assert.ok(policy.scope.focusSubdomains.includes("meeting_policy"));
});

test("implicit cmdlet intent routes Teams PowerShell without explicit cmdlet name", () => {
  const result = route("Which cmdlet assigns a voice routing policy to a Teams user?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-powershell");
  assert.ok(result.scope.eligibleSources.some((s) => s.sourceId === "ms-teams-admin"));
  assert.ok(
    !result.scope.exactMatchDirectives.some(
      (directive) => directive.type === "policy" && directive.value.toLowerCase() === "policy"
    )
  );
});

test("operation verbs alone do not force PowerShell authority", () => {
  const result = route("How do I set up Microsoft Teams Calling Plans?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-admin");
});

test("teams developer is excluded for ordinary admin question", () => {
  const result = route("How do I configure Teams meeting policy for external users?");
  assert.ok(!sourceIds(result).includes("ms-teams-dev-docs"));
});

test("teams developer can become primary for developer platform intent", () => {
  const result = route("How do I add a Teams app manifest for a tab app?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-dev-docs");
});

test("beta is excluded by default and explicitly tracked as excluded", () => {
  const result = route("How does the Microsoft Graph API expose Teams data?");
  assert.equal(result.scope.betaPolicy.allowsBeta, false);
  assert.ok(
    result.scope.betaPolicy.excludedBetaTracks.some(
      (track) => track.sourceId === "ms-graph-docs" && track.trackId === "beta-preview"
    )
  );
});

test("candidate budgets remain bounded for all representative queries", () => {
  const queries = [
    "How does Teams Direct Routing voice routing work?",
    "What does Set-CsOnlineVoiceRoutingPolicy do?",
    "How does Conditional Access affect Teams on unmanaged devices?",
    "What's the difference between Direct Routing and Operator Connect?",
    "Is this Teams feature still supported?"
  ];
  for (const query of queries) {
    const result = route(query);
    assert.ok(result.scope.candidateBudget.maxLexicalCandidates > 0);
    assert.ok(result.scope.candidateBudget.maxLexicalCandidates <= 5000);
    assert.ok(result.scope.candidateBudget.maxSemanticCandidates > 0);
    assert.ok(result.scope.candidateBudget.maxSemanticCandidates <= 6000);
    assert.ok(result.scope.candidateBudget.broadScopeWarningThreshold <= 10000);
  }
});

test("unresolved domain survives routing without pretending Teams Admin is authoritative", () => {
  const result = route(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  assert.deepEqual(result.scope.selectedDomains, []);
  assert.deepEqual(result.scope.eligibleSources, []);
  assert.ok(!sourceIds(result).includes("ms-teams-admin"));
  assert.ok(
    result.scope.routingWarnings.includes(
      "domain_unresolved_no_authoritative_scope"
    )
  );
  assert.ok(result.scope.routingRationale.includes("domain_unresolved"));
  assert.ok(
    result.scope.routingRationale.includes("primary_domain:unresolved")
  );
  assert.equal(result.scope.estimatedCandidatePopulation, 0);
});

test("second unresolved-domain question (Exchange) also produces an empty authoritative scope", () => {
  const result = route("How do I delegate access to a shared Exchange mailbox?");
  assert.deepEqual(result.scope.selectedDomains, []);
  assert.deepEqual(result.scope.eligibleSources, []);
});

test("Conditional Access regression: genuine Entra detection remains routed with Teams Admin support", () => {
  const result = route(
    "How does Conditional Access affect Teams on unmanaged devices?"
  );
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-entra-docs");
  assert.ok(sourceIds(result).includes("ms-teams-admin"));
  assert.ok(!result.scope.routingWarnings.includes("domain_unresolved_no_authoritative_scope"));
});

test("Teams Rooms regression: genuine Teams detection routes to Teams Admin", () => {
  const result = route("How do I configure a Teams Rooms device account?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-admin");
  assert.ok(!result.scope.routingWarnings.includes("domain_unresolved_no_authoritative_scope"));
});

test("Calling Plans regression: recognized without literal teams keyword", () => {
  const result = route("How do I assign a Calling Plan phone number to a user?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-teams-admin");
  assert.ok(!result.scope.routingWarnings.includes("domain_unresolved_no_authoritative_scope"));
});

test("service principal questions route to Entra without treating Teams as primary", () => {
  const result = route("How do I create a service principal?");
  assert.equal(result.scope.eligibleSources[0]?.sourceId, "ms-entra-docs");
  assert.ok(result.scope.selectedDomains.includes("entra"));
  assert.ok(result.scope.focusSubdomains.includes("app_service_principal"));
  assert.ok(!result.scope.routingWarnings.includes("domain_unresolved_no_authoritative_scope"));
});

test("routing output is deterministic and retrieval free", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_should_not_be_used");
  }) as typeof fetch;
  try {
    const first = route("How does Teams Direct Routing voice routing work?");
    const second = route("How does Teams Direct Routing voice routing work?");
    assert.deepEqual(first.scope, second.scope);
    assert.ok(first.latencyMs >= 0);
    assert.ok(first.scope.routingRationale.length > 0);
    assert.ok(first.scope.sourcePriorityChain.length > 0);
    assert.ok((first.scope as unknown as { globalSourceScore?: number }).globalSourceScore === undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

