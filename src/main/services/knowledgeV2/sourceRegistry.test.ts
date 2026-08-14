import test from "node:test";
import assert from "node:assert/strict";
import {
  getDefaultSourceRegistry,
  getDomainAuthorityPriority,
  getSourceById,
  getSourcePriorityChainForDomain,
  querySources,
  validateSourceRegistry
} from "./sourceRegistry";
import type { SourceRegistry } from "./sourceTypes";

test("loads all approved initial sources with stable unique IDs", () => {
  const registry = getDefaultSourceRegistry();
  const ids = registry.sources.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 6);
  assert.ok(ids.includes("ms-teams-admin"));
  assert.ok(ids.includes("ms-teams-powershell"));
  assert.ok(ids.includes("ms-graph-docs"));
  assert.ok(ids.includes("ms-entra-docs"));
  assert.ok(ids.includes("ms-m365-docs"));
  assert.ok(ids.includes("ms-teams-dev-docs"));
});

test("has required repository branch and include globs", () => {
  const registry = getDefaultSourceRegistry();
  const teamsAdmin = registry.sources.find((source) => source.id === "ms-teams-admin");
  assert.equal(teamsAdmin?.acquisition.transport, "learn_mcp");
  if (teamsAdmin?.acquisition.transport === "learn_mcp") {
    assert.equal(teamsAdmin.acquisition.endpoint, "https://learn.microsoft.com/api/mcp");
    assert.ok(teamsAdmin.acquisition.searchScope.includePathPrefixes.includes("/en-us/microsoftteams/"));
  }
  for (const source of registry.sources) {
    if (source.acquisition.transport === "github") {
      assert.ok(source.acquisition.owner.length > 0);
      assert.ok(source.acquisition.repo.length > 0);
      assert.ok(source.acquisition.branch.length > 0);
    } else {
      assert.ok(source.acquisition.canonicalBaseUrl.startsWith("https://learn.microsoft.com/"));
    }
    assert.ok(source.contentTracks.length > 0);
    for (const track of source.contentTracks) {
      assert.ok(track.includeGlobs.length > 0);
    }
  }
});

test("distinguishes Teams admin from Teams developer source roles", () => {
  const teamsAdmin = getSourceById("ms-teams-admin");
  const teamsDev = getSourceById("ms-teams-dev-docs");
  assert.ok(teamsAdmin);
  assert.ok(teamsDev);
  assert.equal(teamsAdmin?.authorityTier, "tier1");
  assert.equal(teamsDev?.authorityTier, "secondary");
  assert.equal(teamsAdmin?.defaultRetrievalEligible, true);
  assert.equal(teamsDev?.defaultRetrievalEligible, false);
  assert.ok(teamsAdmin?.authorityRoles.includes("teams_admin_primary"));
  assert.ok(teamsDev?.authorityRoles.includes("teams_dev_specialized"));
  assert.equal(teamsAdmin?.acquisition.transport, "learn_mcp");
  assert.equal(teamsDev?.acquisition.transport, "github");
});

test("identifies Teams PowerShell as cmdlet authority", () => {
  const teamsPowerShell = getSourceById("ms-teams-powershell");
  assert.ok(teamsPowerShell);
  assert.ok(teamsPowerShell?.domains.includes("teams_powershell"));
  assert.ok(teamsPowerShell?.authorityRoles.includes("teams_powershell_cmdlet_primary"));
});

test("scopes ms-entra-docs to QA Assist first-pass identity paths and enables github sync", () => {
  const entra = getSourceById("ms-entra-docs");
  assert.ok(entra);
  assert.equal(entra?.synchronizationEnabled, true);
  assert.deepEqual(entra?.authorityRoles, ["entra_identity_primary"]);
  assert.ok(entra?.subdomains.includes("conditional_access"));
  assert.ok(entra?.subdomains.includes("authentication"));
  assert.ok(entra?.subdomains.includes("authorization"));
  assert.ok(entra?.subdomains.includes("guest_identity"));
  assert.ok(entra?.subdomains.includes("device_identity"));
  assert.ok(entra?.subdomains.includes("app_service_principal"));
  assert.equal(entra?.acquisition.transport, "github");
  if (entra?.acquisition.transport === "github") {
    assert.equal(entra.acquisition.owner, "MicrosoftDocs");
    assert.equal(entra.acquisition.repo, "entra-docs");
    assert.equal(entra.acquisition.branch, "main");
  }
  const gaTrack = entra?.contentTracks.find((track) => track.id === "ga");
  assert.ok(gaTrack);
  assert.equal(gaTrack?.synchronizationEnabled, true);
  assert.deepEqual(gaTrack?.includeGlobs, [
    "docs/identity/conditional-access/**/*.md",
    "docs/identity/authentication/**/*.md",
    "docs/identity/role-based-access-control/**/*.md",
    "docs/identity/devices/**/*.md",
    "docs/identity-platform/**/*.md"
  ]);
  assert.ok(gaTrack?.excludeGlobs.includes("**/includes/**"));
  assert.ok(!gaTrack?.includeGlobs.some((glob) => glob === "docs/**/*.md"));
  assert.ok(!gaTrack?.includeGlobs.some((glob) => glob.includes("id-governance")));
  assert.ok(!gaTrack?.includeGlobs.some((glob) => glob.includes("permissions-management")));
  assert.ok(!gaTrack?.includeGlobs.some((glob) => glob.includes("verified-id")));
});

test("represents Graph GA and beta tracks separately", () => {
  const graph = getSourceById("ms-graph-docs");
  assert.ok(graph);
  const gaTrack = graph?.contentTracks.find((track) => track.status === "ga");
  const betaTrack = graph?.contentTracks.find((track) => track.status === "beta");
  assert.ok(gaTrack);
  assert.ok(betaTrack);
  assert.equal(gaTrack?.defaultRetrievalEligible, true);
  assert.equal(betaTrack?.defaultRetrievalEligible, false);
});

test("resolves domain-aware authority priority without flat score ranking", () => {
  const teamsAdminOrder = getDomainAuthorityPriority("teams_admin");
  assert.deepEqual(teamsAdminOrder.slice(0, 2), ["ms-teams-admin", "ms-teams-powershell"]);

  const cmdletOrder = getDomainAuthorityPriority("teams_powershell");
  assert.deepEqual(cmdletOrder.slice(0, 2), ["ms-teams-powershell", "ms-teams-admin"]);
});

test("supports query by domain and authority role without repo-name hacks", () => {
  const domainMatches = querySources({ domain: "teams_admin", defaultRetrievalEligible: true });
  assert.ok(domainMatches.length > 0);
  assert.ok(domainMatches.every((source) => source.domains.includes("teams_admin")));

  const roleMatches = querySources({ authorityRole: "teams_powershell_cmdlet_primary" });
  assert.equal(roleMatches.length, 1);
  assert.equal(roleMatches[0]?.id, "ms-teams-powershell");
});

test("returns ordered source definitions for domain chain", () => {
  const chain = getSourcePriorityChainForDomain("teams_admin");
  assert.ok(chain.length >= 2);
  assert.equal(chain[0]?.id, "ms-teams-admin");
  assert.equal(chain[1]?.id, "ms-teams-powershell");
});

test("fails validation for duplicate IDs and malformed repository identifiers", () => {
  const registry = getDefaultSourceRegistry();
  const duplicate: SourceRegistry = structuredClone(registry);
  duplicate.sources.push(structuredClone(duplicate.sources[0]!));
  assert.throws(() => validateSourceRegistry(duplicate), /Duplicate source id/i);

  const malformed: SourceRegistry = structuredClone(registry);
  const githubBacked = malformed.sources.find((source) => source.acquisition.transport === "github");
  if (!githubBacked || githubBacked.acquisition.transport !== "github") {
    throw new Error("Expected a github-backed source.");
  }
  githubBacked.acquisition.owner = "bad owner";
  assert.throws(() => validateSourceRegistry(malformed), /malformed repository owner/i);
});

test("fails validation for invalid learn_mcp configuration", () => {
  const registry = getDefaultSourceRegistry();
  const mutated: SourceRegistry = structuredClone(registry);
  const teamsAdmin = mutated.sources.find((source) => source.id === "ms-teams-admin");
  if (!teamsAdmin || teamsAdmin.acquisition.transport !== "learn_mcp") {
    throw new Error("Expected learn_mcp Teams admin source.");
  }
  teamsAdmin.acquisition.endpoint = "http://learn.microsoft.com/api/mcp";
  assert.throws(() => validateSourceRegistry(mutated), /endpoint must be https/i);
});

test("fails validation when beta track is default-eligible alongside GA", () => {
  const registry = getDefaultSourceRegistry();
  const mutated: SourceRegistry = structuredClone(registry);
  const graph = mutated.sources.find((source) => source.id === "ms-graph-docs");
  const betaTrack = graph?.contentTracks.find((track) => track.status === "beta");
  if (!betaTrack) {
    throw new Error("Expected beta track for Graph source.");
  }
  betaTrack.defaultRetrievalEligible = true;
  assert.throws(() => validateSourceRegistry(mutated), /cannot be default eligible while GA track exists/i);
});

