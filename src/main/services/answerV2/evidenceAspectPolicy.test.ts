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
      rank: 1,
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
