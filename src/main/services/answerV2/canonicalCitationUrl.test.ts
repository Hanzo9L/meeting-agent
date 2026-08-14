import assert from "node:assert/strict";
import test from "node:test";
import { resolveCanonicalCitationUrl } from "./canonicalCitationUrl";
import type { EvidenceItem } from "./types";

function makeEvidence(overrides: {
  sourceId: string;
  sourcePath: string;
  title?: string;
  canonicalUrl?: string;
  revision: Record<string, unknown>;
}): EvidenceItem {
  return {
    evidenceId: "evidence:test",
    chunkId: "chunk:test",
    documentId: "document:test",
    source: {
      sourceId: overrides.sourceId,
      trackId: "ga",
      sourceStatus: "ga",
      sourceDomain: "entra",
      authorityTier: "tier1",
      authorityRoles: ["entra_identity_primary"],
      routePriority: "primary",
      title: overrides.title ?? "Test Document",
      canonicalUrl: overrides.canonicalUrl ?? "",
      sourcePath: overrides.sourcePath,
      sourceRevision: overrides.revision
    },
    location: { sectionId: "section-1", headingPath: ["Test Document"] },
    text: "Sample evidence text.",
    supportTypes: ["configuration_behavior"],
    retrieval: {
      methods: ["lexical"],
      fusionRank: 1,
      fusionScore: 1,
      methodSignals: {
        methods: ["lexical"],
        exact: { matched: false, score: null, rank: null },
        lexical: { score: 1, rank: 1 },
        semantic: { similarity: null, rank: null }
      },
      exactMatch: null,
      retrievalReasons: ["fixture"]
    },
    selectionReason: "test"
  };
}

test("valid Entra GitHub path resolves to a trusted Learn canonical URL", () => {
  const evidence = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/role-based-access-control/permissions-reference.md",
    canonicalUrl: "https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/role-based-access-control/permissions-reference.md"
    }
  });
  const resolution = resolveCanonicalCitationUrl(evidence);
  assert.equal(resolution.failureReason, null);
  assert.equal(resolution.source, "source_registry_learn_mapping");
  assert.equal(
    resolution.canonicalUrl,
    "https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference"
  );
});

test("Entra canonical URL is trusted regardless of the persisted document-level canonicalUrl field", () => {
  const evidence = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/overview.md",
    canonicalUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/overview.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/conditional-access/overview.md"
    }
  });
  const resolution = resolveCanonicalCitationUrl(evidence);
  assert.equal(resolution.failureReason, null);
  assert.equal(resolution.canonicalUrl, "https://learn.microsoft.com/entra/identity/conditional-access/overview");
});

test("malformed Entra path is rejected rather than guessed", () => {
  const missingPrefix = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "identity/conditional-access/overview.md",
    canonicalUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/main/identity/conditional-access/overview.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "identity/conditional-access/overview.md"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(missingPrefix).failureReason, "canonical_url_untrusted");

  const traversal = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/../../etc/passwd.md",
    canonicalUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/../../etc/passwd.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/../../etc/passwd.md"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(traversal).failureReason, "canonical_url_untrusted");

  const notMarkdown = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/diagram.png",
    canonicalUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/conditional-access/diagram.png",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/conditional-access/diagram.png"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(notMarkdown).failureReason, "canonical_url_untrusted");
});

test("unknown GitHub source id is rejected (no registry mapping)", () => {
  const evidence = makeEvidence({
    sourceId: "ms-unregistered-docs",
    sourcePath: "docs/foo/bar.md",
    revision: {
      transport: "github",
      repository: "SomeOrg/some-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/foo/bar.md"
    }
  });
  const resolution = resolveCanonicalCitationUrl(evidence);
  assert.equal(resolution.canonicalUrl, null);
  assert.equal(resolution.failureReason, "canonical_url_missing");
});

test("GitHub sources without a verified registry mapping (Graph, M365) fail closed", () => {
  const graph = makeEvidence({
    sourceId: "ms-graph-docs",
    sourcePath: "api-reference/v1.0/api/user-list.md",
    canonicalUrl: "https://learn.microsoft.com/graph/api/user-list",
    revision: {
      transport: "github",
      repository: "microsoftgraph/microsoft-graph-docs-contrib",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "api-reference/v1.0/api/user-list.md"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(graph).failureReason, "canonical_url_untrusted");

  const m365 = makeEvidence({
    sourceId: "ms-m365-docs",
    sourcePath: "microsoft-365/security/top-security-tasks-for-remote-work.md",
    canonicalUrl:
      "https://learn.microsoft.com/en-us/microsoft-365/security/top-security-tasks-for-remote-work?view=o365-worldwide",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/microsoft-365-docs",
      branch: "public",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "microsoft-365/security/top-security-tasks-for-remote-work.md"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(m365).failureReason, "canonical_url_untrusted");
});

test("non-Microsoft canonical destination is rejected even if syntactically plausible", () => {
  // A spoofed non-Learn revision.canonicalUrl short-circuits tier 1 as an untrusted
  // persisted value; it deliberately does not fall through to a more permissive tier.
  const spoofedRevisionCanonicalUrl = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/overview.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/conditional-access/overview.md",
      canonicalUrl: "https://evil.example.com/entra/identity/conditional-access/overview"
    }
  });
  assert.equal(
    resolveCanonicalCitationUrl(spoofedRevisionCanonicalUrl).failureReason,
    "canonical_url_untrusted"
  );

  const directAttack = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/overview.md",
    revision: {
      transport: "learn_mcp",
      canonicalUrl: "https://evil.example.com/entra/identity/conditional-access/overview",
      contentHash: "fixture"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(directAttack).failureReason, "canonical_url_untrusted");

  // The document-level canonicalUrl field (distinct from revision metadata) is
  // never trusted at all by the registry-mapping tier, spoofed or not.
  const spoofedDocumentLevelField = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/overview.md",
    canonicalUrl: "https://evil.example.com/entra/identity/conditional-access/overview",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/conditional-access/overview.md"
    }
  });
  assert.equal(
    resolveCanonicalCitationUrl(spoofedDocumentLevelField).canonicalUrl,
    "https://learn.microsoft.com/entra/identity/conditional-access/overview"
  );
});

test("Teams PowerShell bespoke reconstruction is unchanged and still takes effect (no registry mapping defined for it)", () => {
  const evidence = makeEvidence({
    sourceId: "ms-teams-powershell",
    sourcePath: "teams/teams-ps/MicrosoftTeams/Set-CsPolicy.md",
    title: "Set-CsPolicy",
    canonicalUrl: "https://github.com/MicrosoftDocs/office-docs-powershell/blob/main/teams/teams-ps/MicrosoftTeams/Set-CsPolicy.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/office-docs-powershell",
      commitSha: "a".repeat(40),
      path: "teams/teams-ps/MicrosoftTeams/Set-CsPolicy.md"
    }
  });
  const resolution = resolveCanonicalCitationUrl(evidence);
  assert.equal(resolution.source, "powershell_document_identity");
  assert.equal(resolution.canonicalUrl, "https://learn.microsoft.com/powershell/module/microsoftteams/set-cspolicy");
});

test("learn_mcp canonical behavior is unchanged for Teams Admin", () => {
  const evidence = makeEvidence({
    sourceId: "ms-teams-admin",
    sourcePath: "microsoftteams/direct-routing",
    revision: {
      transport: "learn_mcp",
      canonicalUrl: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing",
      contentHash: "fixture"
    }
  });
  const resolution = resolveCanonicalCitationUrl(evidence);
  assert.equal(resolution.source, "persisted_revision");
  assert.equal(resolution.canonicalUrl, "https://learn.microsoft.com/en-us/microsoftteams/direct-routing");
});

test("Teams Developer docs resolve through the same verified registry mapping mechanism as Entra", () => {
  const evidence = makeEvidence({
    sourceId: "ms-teams-dev-docs",
    sourcePath: "msteams-platform/agents-in-teams/overview.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/msteams-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "msteams-platform/agents-in-teams/overview.md"
    }
  });
  const resolution = resolveCanonicalCitationUrl(evidence);
  assert.equal(resolution.source, "source_registry_learn_mapping");
  assert.equal(
    resolution.canonicalUrl,
    "https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/overview"
  );
});

test("no title-based URL construction occurs for the generalized GitHub mapping", () => {
  const withMisleadingTitle = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/overview.md",
    title: "Totally Different Page Name",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/conditional-access/overview.md"
    }
  });
  const resolution = resolveCanonicalCitationUrl(withMisleadingTitle);
  // Resolved purely from path; the misleading title has no influence on the result.
  assert.equal(resolution.canonicalUrl, "https://learn.microsoft.com/entra/identity/conditional-access/overview");
});

test("revision path and source path mismatch is rejected (provenance inconsistency)", () => {
  const evidence = makeEvidence({
    sourceId: "ms-entra-docs",
    sourcePath: "docs/identity/conditional-access/overview.md",
    canonicalUrl: "https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/identity/authentication/different-page.md",
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/entra-docs",
      branch: "main",
      commitSha: "a".repeat(40),
      blobSha: "b".repeat(40),
      path: "docs/identity/authentication/different-page.md"
    }
  });
  assert.equal(resolveCanonicalCitationUrl(evidence).failureReason, "canonical_url_untrusted");
});
