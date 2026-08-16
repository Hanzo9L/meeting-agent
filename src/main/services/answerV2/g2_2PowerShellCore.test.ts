import assert from "node:assert/strict";
import test from "node:test";
import { getSourceById } from "../knowledgeV2";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import type { HybridRetrievalResult } from "../retrievalV2";
import {
  deriveEvidenceAspects,
  evidenceEstablishesPowerShellSyntax,
  WORKFLOW_ORCHESTRATION_RULE_ID
} from "./evidenceAspectPolicy";
import {
  validateExecutablePowerShellAgainstClaims,
  type GroundedSynthesisClaim
} from "./groundedAnswerSynthesis";

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

test("G2.2 registers bounded PowerShell Core authority separately from Teams", () => {
  const source = getSourceById("ms-powershell-core");
  assert.deepEqual(source?.domains, ["powershell_core"]);
  assert.deepEqual(source?.authorityRoles, ["powershell_core_primary"]);
  assert.equal(source?.contentTracks[0]?.includeGlobs.length, 4);
  assert.ok(
    !source?.authorityRoles.includes("teams_powershell_cmdlet_primary")
  );
});

test("G2.2 workflow keeps five Teams state aspects and four Core aspects", () => {
  const intent = extractQueryIntent(QUESTION).intent;
  const scope = routeQueryIntent(intent).scope;
  const aspects = deriveEvidenceAspects({
    intent,
    scope
  } as HybridRetrievalResult).filter(
    (aspect) => aspect.requirement === "mandatory"
  );
  assert.equal(
    aspects.filter((aspect) => aspect.answerObject === "configuration_state")
      .length,
    5
  );
  const core = aspects.filter(
    (aspect) =>
      aspect.derivation.ruleIds.includes(WORKFLOW_ORCHESTRATION_RULE_ID) ||
      aspect.subject === "CSV export"
  );
  assert.deepEqual(
    core.map((aspect) => aspect.subject).sort(),
    [
      "CSV export",
      "output object construction",
      "per-user iteration",
      "policy assignment filtering"
    ]
  );
  for (const aspect of core) {
    assert.deepEqual(aspect.authorityRequirement.requiredDomains, [
      "powershell_core"
    ]);
    assert.deepEqual(aspect.authorityRequirement.requiredRoles, [
      "powershell_core_primary"
    ]);
    assert.ok(aspect.requiredFacets.includes("syntax"));
  }
});

test("G2.2 recognizes only the selected grounded executable primitives", () => {
  assert.equal(
    evidenceEstablishesPowerShellSyntax(
      "Get-Process | ForEach-Object {$_.ProcessName}",
      "per-user iteration"
    ),
    true
  );
  assert.equal(
    evidenceEstablishesPowerShellSyntax(
      "1..8 | ForEach-Object -Parallel { $_ }",
      "per-user iteration"
    ),
    false
  );
  assert.equal(
    evidenceEstablishesPowerShellSyntax(
      "[pscustomobject]@{Name = 'PowerShell'}",
      "output object construction"
    ),
    true
  );
  assert.equal(
    evidenceEstablishesPowerShellSyntax(
      "Export-Csv -Path .\\report.csv -NoTypeInformation",
      "CSV export"
    ),
    true
  );
  assert.equal(
    evidenceEstablishesPowerShellSyntax(
      "Start-Job { Get-Process }",
      "per-user iteration"
    ),
    false
  );
});

test("G2.2 unknown Core cmdlets fail closed while bounded Core questions route", () => {
  assert.deepEqual(
    extractQueryIntent("How do I use Start-Job in PowerShell?").intent.domains,
    []
  );
  const exportIntent = extractQueryIntent("What does Export-Csv do?").intent;
  assert.deepEqual(exportIntent.domains, ["powershell_core"]);
  assert.deepEqual(
    routeQueryIntent(exportIntent).scope.eligibleSources.map(
      (source) => source.sourceId
    ),
    ["ms-powershell-core"]
  );
});

test("G2.2 script validator rejects unknown cmdlets, properties, and primitives", () => {
  const claim: GroundedSynthesisClaim = {
    claimId: "claim:all",
    aspectId: "aspect:all",
    aspectSubject: "workflow",
    text:
      "Get-CsOnlineUser -Filter EnterpriseVoiceEnabled Identity ForEach-Object Where-Object -eq [pscustomobject] Export-Csv -Path -NoTypeInformation",
    mandatory: true,
    requestedMethods: ["PowerShell"],
    sources: []
  };
  const valid =
    "Get-CsOnlineUser -Filter EnterpriseVoiceEnabled | ForEach-Object { [pscustomobject]@{ Identity = $_.Identity } } | Export-Csv -Path .\\report.csv -NoTypeInformation";
  assert.deepEqual(validateExecutablePowerShellAgainstClaims(valid, [claim]), {
    valid: true,
    issues: []
  });
  const invalid = `Invoke-RestMethod | ForEach-Object {
  [pscustomobject]@{
    SecretValue = $_.UnknownProperty
  }
}`;
  const result = validateExecutablePowerShellAgainstClaims(invalid, [claim]);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.includes(
      "ungrounded_script_cmdlet:invoke-restmethod"
    )
  );
  assert.ok(
    result.issues.includes("ungrounded_script_property:unknownproperty")
  );
  assert.ok(
    result.issues.includes("ungrounded_script_property:secretvalue")
  );
});

test("G2.2 acceptance script uses only tokens present in the grounded workflow claims", () => {
  const claim: GroundedSynthesisClaim = {
    claimId: "claim:acceptance",
    aspectId: "aspect:acceptance",
    aspectSubject: "workflow",
    text: [
      "Get-CsOnlineUser -Filter EnterpriseVoiceEnabled -eq $True -and FeatureTypes -contains PhoneSystem AccountEnabled -AccountType User",
      "Identity UserPrincipalName TelephoneNumbers Primary Private Alternate",
      "Select OnlineVoiceRoutingPolicy",
      "Get-CsEffectiveTenantDialPlan -Identity EffectiveTenantDialPlanName",
      "EffectivePolicyAssignments PolicyType TeamsCallingPolicy PolicyAssignment displayName assignmentType policyId groupId",
      "ForEach-Object Where-Object [pscustomobject]",
      "Export-Csv -Path -NoTypeInformation"
    ].join(" "),
    mandatory: true,
    requestedMethods: ["PowerShell"],
    sources: []
  };
  const script = `$users = Get-CsOnlineUser -Filter {(EnterpriseVoiceEnabled -eq $True) -and (FeatureTypes -contains 'PhoneSystem') -and (AccountEnabled -eq $True)} -AccountType User

$users | ForEach-Object {
  $user = $_
  $dialPlan = Get-CsEffectiveTenantDialPlan -Identity $user.Identity
  $callingPolicy = $user.EffectivePolicyAssignments |
    Where-Object { $_.PolicyType -eq 'TeamsCallingPolicy' }

  [pscustomobject]@{
    Identity = $user.Identity
    EnterpriseVoiceEnabled = $user.EnterpriseVoiceEnabled
    TelephoneNumbers = $user.TelephoneNumbers
    OnlineVoiceRoutingPolicy = $user.OnlineVoiceRoutingPolicy
    EffectiveTenantDialPlanName = $dialPlan.EffectiveTenantDialPlanName
    TeamsCallingPolicy = $callingPolicy.PolicyAssignment.displayName
  }
} | Export-Csv -Path .\\TeamsVoiceReport.csv -NoTypeInformation`;
  assert.deepEqual(validateExecutablePowerShellAgainstClaims(script, [claim]), {
    valid: true,
    issues: []
  });
});
