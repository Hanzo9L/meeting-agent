import test from "node:test";
import assert from "node:assert/strict";
import { extractQueryIntent } from "./queryIntentRules";

test("direct routing intent recognition", () => {
  const result = extractQueryIntent(
    "How does Teams Direct Routing voice routing work?"
  );
  assert.ok(result.intent.domains.includes("teams_admin"));
  assert.ok(result.intent.entities.includes("direct routing"));
  assert.ok(result.intent.entities.includes("voice routing"));
  assert.equal(result.intent.expectedAnswerType, "conceptual");
});

test("teams voice/powershell cmdlet exact recognition", () => {
  const result = extractQueryIntent(
    "What does Set-CsOnlineVoiceRoutingPolicy do?"
  );
  assert.ok(result.intent.domains.includes("teams_powershell"));
  assert.deepEqual(result.intent.commandNames, ["Set-CsOnlineVoiceRoutingPolicy"]);
  assert.equal(result.intent.expectedAnswerType, "reference");
});

test("cross-domain conditional access question", () => {
  const result = extractQueryIntent(
    "How does Conditional Access affect Teams on unmanaged devices?"
  );
  assert.ok(result.intent.domains.includes("teams_admin"));
  assert.ok(result.intent.domains.includes("entra"));
  assert.ok(result.intent.entities.includes("conditional access"));
  assert.ok(result.intent.entities.includes("unmanaged devices"));
});

test("comparison classification", () => {
  const result = extractQueryIntent(
    "What's the difference between Direct Routing and Operator Connect?"
  );
  assert.equal(result.intent.expectedAnswerType, "comparison");
  assert.ok(result.intent.entities.includes("direct routing"));
  assert.ok(result.intent.entities.includes("operator connect"));
});

test("freshness detection with unresolved feature ambiguity", () => {
  const result = extractQueryIntent(
    "Is this Teams feature still supported?"
  );
  assert.equal(result.intent.requiresFreshnessCheck, true);
  assert.ok(
    result.intent.unresolvedAmbiguity.includes(
      "ambiguous_feature_or_policy_reference"
    )
  );
});

test("explicit beta enablement remains off by default otherwise", () => {
  const beta = extractQueryIntent(
    "How does the Microsoft Graph beta API expose Teams data?"
  );
  const nonBeta = extractQueryIntent(
    "How does the Microsoft Graph API expose Teams data?"
  );
  assert.equal(beta.intent.allowsBetaSources, true);
  assert.equal(nonBeta.intent.allowsBetaSources, false);
  assert.ok(beta.intent.domains.includes("graph"));
});

test("troubleshooting classification and entities", () => {
  const result = extractQueryIntent(
    "Why is my Teams SBC not routing outbound calls?"
  );
  assert.equal(result.intent.expectedAnswerType, "troubleshooting");
  assert.ok(result.intent.entities.includes("sbc"));
  assert.ok(result.intent.domains.includes("teams_admin"));
});

test("policy/entity extraction and deterministic hints", () => {
  const first = extractQueryIntent("How do I fix the Teams policy?");
  const second = extractQueryIntent("How do I fix the Teams policy?");
  assert.ok((first.intent.policyNames ?? []).includes("policy"));
  assert.deepEqual(first.intent.retrievalHints, second.intent.retrievalHints);
  assert.ok(first.intent.retrievalHints.includes("entity:policy"));
});

test("meeting policy is extracted as multiword technical concept", () => {
  const result = extractQueryIntent("How do Teams meeting policies work?");
  assert.ok(result.intent.entities.includes("meeting policies"));
  assert.ok((result.intent.policyNames ?? []).includes("meeting policy"));
});

test("implicit cmdlet intent captures operation intent", () => {
  const result = extractQueryIntent(
    "Which cmdlet assigns a voice routing policy to a Teams user?"
  );
  assert.ok((result.intent.operationIntents ?? []).includes("grant"));
  assert.ok(result.intent.retrievalHints.includes("operation:grant"));
});

test("repeatability and no network dependency", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_should_not_be_used");
  }) as typeof fetch;
  try {
    const first = extractQueryIntent("What does Set-CsOnlineVoiceRoutingPolicy do?");
    const second = extractQueryIntent("What does Set-CsOnlineVoiceRoutingPolicy do?");
    assert.deepEqual(first.intent, second.intent);
    assert.ok(first.latencyMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
