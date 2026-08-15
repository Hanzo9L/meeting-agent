import assert from "node:assert/strict";
import test from "node:test";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import type { FusedRetrievalCandidate, HybridRetrievalResult } from "../retrievalV2";
import { deriveEvidenceAspects, evaluateCandidateAspectSupport } from "./evidenceAspectPolicy";

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
    candidateId: `cand-${params.sourceId}`,
    method: "semantic",
    documentId: `doc-${params.sourceId}`,
    chunkId: `chunk-${params.sourceId}`,
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

function deriveSharePointAspects(question: string): {
  result: HybridRetrievalResult;
  aspects: ReturnType<typeof deriveEvidenceAspects>;
} {
  const intent = extractQueryIntent(question).intent;
  const scope = routeQueryIntent(intent).scope;
  const result = { intent, scope } as HybridRetrievalResult;
  return { result, aspects: deriveEvidenceAspects(result) };
}

test("K2: SharePoint-primary question requires sharepoint_admin_primary or sharepoint_powershell_cmdlet_primary authority", () => {
  const { aspects } = deriveSharePointAspects(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  const mandatory = aspects.filter((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory.length > 0);
  for (const aspect of mandatory) {
    assert.ok(aspect.authorityRequirement.requiredDomains.includes("sharepoint"));
    assert.ok(
      aspect.authorityRequirement.requiredRoles.includes("sharepoint_admin_primary") ||
        aspect.authorityRequirement.requiredRoles.includes("sharepoint_powershell_cmdlet_primary")
    );
  }
});

test("K2: a genuinely on-topic Teams Admin candidate cannot satisfy a mandatory SharePoint aspect's authority", () => {
  const { result, aspects } = deriveSharePointAspects(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  const teamsCandidate = makeCandidate({
    sourceId: "ms-teams-admin",
    authorityRoles: ["teams_admin_primary"],
    routePriority: "supporting",
    title: "SharePoint integration notes",
    text: "This Teams admin article briefly mentions SharePoint data access and Copilot content permissions.",
    url: "https://learn.microsoft.com/en-us/microsoftteams/sharepoint-integration-notes"
  });
  const support = evaluateCandidateAspectSupport(result, teamsCandidate, mandatory!);
  assert.equal(support.authoritySatisfied, false);
});

test("K2: a genuine SharePoint admin candidate satisfies the mandatory SharePoint aspect's authority", () => {
  const { result, aspects } = deriveSharePointAspects(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  const sharePointCandidate = makeCandidate({
    sourceId: "ms-sharepoint-docs",
    authorityRoles: ["sharepoint_admin_primary"],
    routePriority: "primary",
    title: "Restricted content discovery",
    text: "Restricted Content Discovery prevents high-risk SharePoint sites and files from surfacing in Microsoft 365 Copilot experiences, so SharePoint data is not accessible by all Copilot users.",
    url: "https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery"
  });
  const support = evaluateCandidateAspectSupport(result, sharePointCandidate, mandatory!);
  assert.equal(support.authoritySatisfied, true);
});

test("K2: an Entra candidate alone cannot satisfy a mandatory SharePoint aspect (supporting evidence is not independently sufficient)", () => {
  const { result, aspects } = deriveSharePointAspects(
    "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  const entraCandidate = makeCandidate({
    sourceId: "ms-entra-docs",
    authorityRoles: ["entra_identity_primary"],
    routePriority: "supporting",
    title: "Conditional Access and SharePoint",
    text: "Conditional Access can restrict SharePoint data access for Copilot users based on device compliance.",
    url: "https://learn.microsoft.com/entra/identity/conditional-access/sharepoint"
  });
  const support = evaluateCandidateAspectSupport(result, entraCandidate, mandatory!);
  assert.equal(support.authoritySatisfied, false);
});

test("K2: SPO* cmdlet question requires sharepoint_powershell_cmdlet_primary authority, and Teams PowerShell cannot satisfy it", () => {
  const { result, aspects } = deriveSharePointAspects("What does Set-SPOSite do?");
  const cmdletAspect = aspects.find(
    (aspect) => aspect.answerObject === "cmdlet_identifier" || aspect.answerObject === "cmdlet_semantics"
  );
  assert.ok(cmdletAspect);
  assert.deepEqual(cmdletAspect!.authorityRequirement.requiredDomains, ["sharepoint"]);
  assert.deepEqual(cmdletAspect!.authorityRequirement.requiredRoles, [
    "sharepoint_powershell_cmdlet_primary"
  ]);

  const teamsPowerShellCandidate = makeCandidate({
    sourceId: "ms-teams-powershell",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    routePriority: "supporting",
    title: "Set-SPOSite",
    text: "Set-SPOSite sets properties on a site.",
    url: "https://learn.microsoft.com/powershell/module/microsoftteams/set-sposite"
  });
  const support = evaluateCandidateAspectSupport(result, teamsPowerShellCandidate, cmdletAspect!);
  assert.equal(support.authoritySatisfied, false);
});

test("U1: identifier-verification bonus does not apply when 'identifier' is not a required facet (conceptual preference)", () => {
  const { result, aspects } = deriveSharePointAspects(
    "What is Restricted Content Discovery?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  assert.ok(!mandatory!.requiredFacets.includes("identifier"));

  // Retrieval (lexical/semantic fusion) is what actually orders these two in
  // production for this question: the conceptual article ranks well ahead of
  // the parameter reference (see eval/runs/indexing/u1-validation.json,
  // "restricted-content-discovery" — rank 1 vs rank 5). Reflect that real
  // ordering here rather than an artificial tie, since quality-score bonuses
  // for facets the aspect never asked for (e.g. "identifier") must not be
  // used to manufacture a preference — that is exactly the CA-MFA failure
  // mode this slice fixes, just pointed the other direction.
  const cmdletParameterCandidate = makeCandidate({
    sourceId: "ms-sharepoint-powershell",
    authorityRoles: ["sharepoint_powershell_cmdlet_primary"],
    routePriority: "primary",
    title: "Set-SPOSite",
    text: "Set-SPOSite -RestrictedAccessControl sets restricted content discovery on a site.",
    url: "https://learn.microsoft.com/powershell/module/sharepoint-online/set-sposite",
    rank: 5
  });
  const conceptualCandidate = makeCandidate({
    sourceId: "ms-sharepoint-docs",
    authorityRoles: ["sharepoint_admin_primary"],
    routePriority: "primary",
    title: "Restrict discovery of SharePoint sites and content",
    text: "Restricted Content Discovery lets admins prevent high-risk sites and files from being referenced by Microsoft 365 Copilot and other AI experiences, without changing existing permissions.",
    url: "https://learn.microsoft.com/en-us/sharepoint/restrict-content-discovery",
    rank: 1
  });
  const metadataByChunkId = new Map([
    [conceptualCandidate.chunkId, { chunkKind: "conceptual" }]
  ]);
  const cmdletSupport = evaluateCandidateAspectSupport(result, cmdletParameterCandidate, mandatory!);
  const conceptualSupport = evaluateCandidateAspectSupport(result, conceptualCandidate, mandatory!, {
    metadataByChunkId
  });
  assert.equal(cmdletSupport.strength, "direct");
  assert.equal(conceptualSupport.strength, "direct");
  // Neither candidate earns a quality-score bonus for a facet this aspect
  // never required (identifier for the cmdlet, purpose/mechanism for the
  // conceptual article) — the only remaining difference is the small
  // retrieval-rank tiebreak term, which correctly favors the conceptual
  // candidate because that is how retrieval actually ranked them.
  assert.ok(
    conceptualSupport.qualityScore > cmdletSupport.qualityScore,
    `expected conceptual evidence (${conceptualSupport.qualityScore}) to outrank a cmdlet-shaped title (${cmdletSupport.qualityScore})`
  );
  assert.ok(
    Math.abs(
      conceptualSupport.qualityScore -
        cmdletSupport.qualityScore -
        (cmdletParameterCandidate.fusion.rank - conceptualCandidate.fusion.rank) / 20
    ) < 1e-9,
    "the entire margin must come from retrieval-rank ordering, not from an unearned facet bonus"
  );
});

test("U1: a procedure that performs the requested operation counts as configuration content even without the literal word 'configure'", () => {
  const { result, aspects } = deriveSharePointAspects(
    "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  );
  const mandatory = aspects.find((aspect) => aspect.requirement === "mandatory");
  assert.ok(mandatory);
  assert.ok(mandatory!.requiredFacets.includes("configuration"));

  const stepByStepCandidate = makeCandidate({
    sourceId: "ms-entra-docs",
    authorityRoles: ["entra_identity_primary"],
    routePriority: "primary",
    title: "Require MFA for administrators with Conditional Access",
    headingPath: ["Require MFA for administrators", "Create a Conditional Access policy"],
    text: [
      "The following steps help create a Conditional Access policy to require those",
      "assigned administrative roles to perform multifactor authentication.",
      "1. Sign in to the Microsoft Entra admin center as at least a Conditional Access Administrator.",
      "2. Browse to Entra ID > Conditional Access > Policies.",
      "3. Select New policy.",
      "4. Give your policy a name.",
      "5. Under Assignments, select Users or workload identities. Under Include, select Directory roles and choose at least the previously listed roles.",
      "6. Under Target resources > Resources > Include, select All resources.",
      "7. Under Access controls > Grant, select Grant access, Require multifactor authentication, and select Select.",
      "8. Confirm your settings and set Enable policy to Report-only.",
      "9. Select Create to enable your policy."
    ].join(" "),
    url: "https://learn.microsoft.com/entra/identity/conditional-access/policy-mfa-admins"
  });
  const metadataByChunkId = new Map([
    [stepByStepCandidate.chunkId, { chunkKind: "procedure" }]
  ]);
  const support = evaluateCandidateAspectSupport(result, stepByStepCandidate, mandatory!, {
    metadataByChunkId
  });
  assert.ok(support.matchedFacets.includes("procedure"));
  assert.ok(support.matchedFacets.includes("operation"));
  assert.ok(
    support.matchedFacets.includes("configuration"),
    `expected 'configuration' to be inferred from procedure+operation content; matchedFacets=${support.matchedFacets.join(",")}`
  );
  assert.equal(support.strength, "direct");
});
