import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createKnowledgeV2SqliteStore,
  hashEmbeddingInput,
  parseCanonicalDocument,
  type AcquiredDocumentInput
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { retrieveExactMatches } from "./exactMatchRetriever";
import { extractQueryIntent } from "./queryIntentRules";

// V1 — Multi-Output PowerShell Workflow Decomposition, item 6/7/10:
// once a requested output concept (e.g. "calling policy", "dial plan",
// "voice routing policy") is represented explicitly and PowerShell is the
// requested method, canonical Teams PowerShell evidence for that concept
// must be retrievable even when a much larger population of generic Teams
// admin documents also matches the same concept via heading text.

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");
const ACCEPTANCE_QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-v1-anchor-"));
  return join(root, "knowledge-v2.sqlite");
}

function fixtureDoc(input: AcquiredDocumentInput) {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

function markdown(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", "", `# ${title}`, "", body].join("\n");
}

/**
 * Seeds a fixture where a generic ms-teams-admin document contributes many
 * heading-matching chunks for a requested output concept (metadata_weak,
 * score 0.18) and a single ms-teams-powershell cmdlet document only matches
 * that same concept via body text (chunk_text_weak, score 0.08) — the exact
 * shape of the starvation bug V1 fixed. No embeddings are seeded because
 * retrieveExactMatches never reads chunk_embeddings.
 */
async function seedAnchoringFixture(concept: {
  label: string;
  adminHeadingCount: number;
  cmdletName: string;
}): Promise<string> {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();

  const adminDoc = fixtureDoc({
    sourceId: "ms-teams-admin",
    trackId: "ga",
    transport: "learn_mcp",
    canonicalUrl: `https://learn.microsoft.com/en-us/microsoftteams/${concept.cmdletName.toLowerCase()}-admin-overview`,
    rawMarkdown: markdown(
      `${concept.label} admin overview`,
      `Admin overview of ${concept.label} management in the Teams admin center.`
    ),
    revision: {
      transport: "learn_mcp",
      canonicalUrl: `https://learn.microsoft.com/en-us/microsoftteams/${concept.cmdletName.toLowerCase()}-admin-overview`,
      locale: "en-us",
      retrievedAt: new Date().toISOString(),
      contentHash: `v1-admin-${concept.cmdletName}`
    }
  });
  const psDoc = fixtureDoc({
    sourceId: "ms-teams-powershell",
    trackId: "ga",
    transport: "github",
    canonicalUrl: `https://learn.microsoft.com/powershell/module/microsoftteams/${concept.cmdletName.toLowerCase()}`,
    rawMarkdown: markdown(concept.cmdletName, `${concept.cmdletName} cmdlet reference.`),
    revision: {
      transport: "github",
      repository: "MicrosoftDocs/office-docs-powershell",
      branch: "main",
      commitSha: `v1-ps-${concept.cmdletName}`,
      blobSha: `v1-ps-blob-${concept.cmdletName}`,
      path: `teams/teams-ps/MicrosoftTeams/${concept.cmdletName.toLowerCase()}.md`
    }
  });

  store.saveKnowledgeDocument(adminDoc, { parserVersion: "v1-anchor-test-v1" });
  store.saveKnowledgeDocument(psDoc, { parserVersion: "v1-anchor-test-v1" });

  for (let i = 0; i < concept.adminHeadingCount; i += 1) {
    const chunkId = `chunk-admin-${concept.cmdletName}-${i}`;
    const text = `Section ${i} describes unrelated administrative background for ${concept.label}.`;
    store.saveChunkPlaceholder({
      chunkId,
      documentId: adminDoc.documentId,
      sectionId: `admin-section-${i}`,
      // The literal requested-output phrase lives ONLY in the heading, so
      // these chunks match via metadata_weak (score 0.18) — higher than the
      // PowerShell chunk's chunk_text_weak match (score 0.08) below.
      headingPath: [`${concept.label} overview`, `${concept.label}`],
      chunkKind: "conceptual",
      text,
      sourceOrder: i,
      contentHash: hashEmbeddingInput(text.trim()),
      provenance: {},
      metadata: {}
    });
  }

  const psChunkId = `chunk-ps-${concept.cmdletName}`;
  const psText = `${concept.cmdletName} retrieves the ${concept.label} assigned to a Teams user.`;
  store.saveChunkPlaceholder({
    chunkId: psChunkId,
    documentId: psDoc.documentId,
    sectionId: concept.cmdletName.toLowerCase(),
    // Deliberately does NOT contain the requested-output phrase, so this
    // chunk can only be found via the body-text weak-substring match.
    headingPath: [concept.cmdletName],
    chunkKind: "reference",
    text: psText,
    sourceOrder: 100,
    contentHash: hashEmbeddingInput(psText.trim()),
    provenance: {},
    metadata: {}
  });

  store.close();
  return dbPath;
}

test("V1.10: canonical Teams PowerShell evidence for 'calling policy' is retrievable even when heavily outnumbered by generic admin heading matches", async () => {
  const dbPath = await seedAnchoringFixture({
    label: "calling policy",
    adminHeadingCount: 5,
    cmdletName: "Get-CsTeamsCallingPolicy"
  });
  const intent = extractQueryIntent(ACCEPTANCE_QUESTION).intent;
  const baseScope = routeQueryIntent(intent).scope;
  assert.ok(
    baseScope.exactMatchDirectives.some(
      (directive) => directive.type === "entity" && directive.value === "calling policy"
    ),
    "expected an exact-match entity directive for 'calling policy'"
  );
  // Force the final-output cut down to fewer slots than the number of
  // generic admin matches, so the reserved-slot mechanism is the only thing
  // that can still surface the PowerShell candidate.
  const scope = {
    ...baseScope,
    candidateBudget: { ...baseScope.candidateBudget, maxLexicalCandidates: 3 }
  };
  const result = retrieveExactMatches({ databasePath: dbPath, scope });
  const powershellCandidate = result.candidates.find(
    (candidate) => candidate.authority.sourceId === "ms-teams-powershell"
  );
  assert.ok(
    powershellCandidate,
    `expected a ms-teams-powershell candidate among the returned exact matches, got sources: ${result.candidates
      .map((candidate) => candidate.authority.sourceId)
      .join(", ")}`
  );
  assert.equal(powershellCandidate!.chunkId, `chunk-ps-Get-CsTeamsCallingPolicy`);
});

test("V1.10: canonical Teams PowerShell evidence for 'dial plan' is retrievable even when heavily outnumbered by generic admin heading matches", async () => {
  const dbPath = await seedAnchoringFixture({
    label: "dial plan",
    adminHeadingCount: 5,
    cmdletName: "Get-CsTenantDialPlan"
  });
  const intent = extractQueryIntent(ACCEPTANCE_QUESTION).intent;
  const baseScope = routeQueryIntent(intent).scope;
  const scope = {
    ...baseScope,
    candidateBudget: { ...baseScope.candidateBudget, maxLexicalCandidates: 3 }
  };
  const result = retrieveExactMatches({ databasePath: dbPath, scope });
  const powershellCandidate = result.candidates.find(
    (candidate) => candidate.authority.sourceId === "ms-teams-powershell"
  );
  assert.ok(powershellCandidate, "expected a ms-teams-powershell candidate for 'dial plan'");
});

test("V1.10: canonical Teams PowerShell evidence for 'voice routing policy' is retrievable even when heavily outnumbered by generic admin heading matches", async () => {
  const dbPath = await seedAnchoringFixture({
    label: "voice routing policy",
    adminHeadingCount: 5,
    cmdletName: "Get-CsOnlineVoiceRoutingPolicy"
  });
  const intent = extractQueryIntent(ACCEPTANCE_QUESTION).intent;
  const baseScope = routeQueryIntent(intent).scope;
  const scope = {
    ...baseScope,
    candidateBudget: { ...baseScope.candidateBudget, maxLexicalCandidates: 3 }
  };
  const result = retrieveExactMatches({ databasePath: dbPath, scope });
  const powershellCandidate = result.candidates.find(
    (candidate) => candidate.authority.sourceId === "ms-teams-powershell"
  );
  assert.ok(powershellCandidate, "expected a ms-teams-powershell candidate for 'voice routing policy'");
});

test("V1.10 (regression): without a PowerShell method requested, ms-teams-powershell is not reserved/eligible and anchoring is scoped, not global", () => {
  const intent = extractQueryIntent(
    "What is Calling Policy in Microsoft Teams admin center?"
  ).intent;
  assert.equal(intent.technologies.includes("PowerShell"), false);
  const scope = routeQueryIntent(intent).scope;
  assert.ok(
    !scope.eligibleSources.some((source) => source.sourceId === "ms-teams-powershell"),
    "a non-PowerShell admin-center question must not pull in ms-teams-powershell via V1's anchoring change"
  );
});
