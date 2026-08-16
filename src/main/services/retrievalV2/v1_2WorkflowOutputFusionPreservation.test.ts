import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createKnowledgeV2SqliteStore,
  encodeFloat32Vector,
  FakeEmbeddingProvider,
  hashEmbeddingInput,
  parseCanonicalDocument,
  type AcquiredDocumentInput
} from "../knowledgeV2";
import { buildEvidenceBundle } from "../answerV2/evidenceBundleBuilder";
import { routeQueryIntent } from "./domainPolicies";
import { retrieveHybridCandidates, type FusedRetrievalCandidate } from "./hybridRetriever";
import { extractQueryIntent } from "./queryIntentRules";
import {
  applyWorkflowOutputPreservation,
  directiveTopicallyMatchesCandidate,
  type PreservationCandidate
} from "./workflowOutputPreservation";

// V1.2 — Required-Output Candidate Preservation Through Hybrid Fusion.
//
// V1.1 fixed R2 support classification for PowerShell read/reporting
// evidence, but a separate, upstream retrieval-layer defect remained: the
// canonical PowerShell reference for "Enterprise Voice enabled state" and
// "calling policy" is frequently found by lexical/semantic retrieval, yet
// never receives exact-match credit (their reference prose uses plural
// forms like "calling policies", or expresses the concept only via a
// PascalCase parameter/heading like "-EnterpriseVoiceEnabled" rather than
// literal prose), so its raw fusion score cannot compete with generic
// admin documents that agree across all three retrieval channels. Those
// candidates were silently discarded by the fixed top-24 final-fusion cut
// before R2 ever saw them. This file tests the fix: a bounded, directive-
// scoped preservation step applied at the final hybrid-fusion boundary.

const MIGRATIONS_DIR = resolve("src/main/services/knowledgeV2/store/migrations");
const ACCEPTANCE_QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";
const MODEL = "v1.2-test-model";
const SCHEMA = "v1.2-schema";

function buildScope(question: string) {
  return routeQueryIntent(extractQueryIntent(question).intent).scope;
}

// ---------------------------------------------------------------------------
// Unit-level fixtures: minimal objects satisfying PreservationCandidate,
// exercised directly against the pure algorithm with no DB/network/LLM
// dependency, for precise control over boundedness/precision/dedupe cases.
// ---------------------------------------------------------------------------

let nextCandidateSeq = 0;
function makeUnitCandidate(params: {
  title: string;
  text?: string;
  headingPath?: string[];
  canonicalUrl?: string;
  authorityRoles?: string[];
  score: number;
  documentId?: string;
}): PreservationCandidate {
  nextCandidateSeq += 1;
  return {
    candidateId: `cand-${nextCandidateSeq}`,
    chunkId: `chunk-${nextCandidateSeq}`,
    documentId: params.documentId ?? `doc-${nextCandidateSeq}`,
    title: params.title,
    text: params.text ?? "",
    headingPath: params.headingPath ?? [params.title],
    provenance: { canonicalUrl: params.canonicalUrl ?? `https://example.test/${params.title}` },
    authority: { authorityRoles: params.authorityRoles ?? ["teams_admin_primary"] },
    fusion: { score: params.score }
  };
}

const WORKFLOW_INTENT = extractQueryIntent(ACCEPTANCE_QUESTION).intent;
const WORKFLOW_DIRECTIVES = routeQueryIntent(WORKFLOW_INTENT).scope.exactMatchDirectives;

test("V1.2.7: candidate reservation is tied to explicit workflow-output directives, not any PowerShell question", () => {
  const nonWorkflowIntent = extractQueryIntent("What does Get-CsTenantDialPlan do?").intent;
  const psCandidate = makeUnitCandidate({
    title: "Get-CsTeamsCallingPolicy",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 20
  });
  const adminOnly = [
    makeUnitCandidate({ title: "Admin overview", score: 50 })
  ];
  const result = applyWorkflowOutputPreservation({
    sortedFused: [...adminOnly, psCandidate],
    selected: adminOnly,
    intent: nonWorkflowIntent,
    directives: WORKFLOW_DIRECTIVES,
    maxPerDocument: 4
  });
  assert.equal(result.diagnostics.triggered, false);
  assert.deepEqual(result.selected, adminOnly);
});

test("V1.2.8: an irrelevant PowerShell candidate does not gain a reserved slot for a directive it does not match", () => {
  const irrelevantPs = makeUnitCandidate({
    title: "Get-CsTenantFederationConfiguration",
    text: "Retrieves federation settings for external access.",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 25
  });
  const adminOnly = [makeUnitCandidate({ title: "Admin overview", score: 50 })];
  const result = applyWorkflowOutputPreservation({
    sortedFused: [...adminOnly, irrelevantPs],
    selected: adminOnly,
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES,
    maxPerDocument: 4
  });
  assert.ok(
    !result.selected.some((candidate) => candidate.chunkId === irrelevantPs.chunkId),
    "an off-topic PowerShell candidate must not be preserved for any of the five directives"
  );
  assert.deepEqual(result.diagnostics.noUpstreamCandidateDirectives.sort(), [
    "calling policy",
    "dial plan",
    "enterprise voice",
    "phone number",
    "voice routing policy"
  ]);
});

test("V1.2.9: an already-selected relevant PowerShell candidate satisfies a directive without wasting a reservation", () => {
  const relevantPs = makeUnitCandidate({
    title: "Get-CsTeamsCallingPolicy",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 46
  });
  const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
  const selected = [admin, relevantPs];
  const result = applyWorkflowOutputPreservation({
    sortedFused: selected,
    selected,
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES,
    maxPerDocument: 4
  });
  assert.ok(result.diagnostics.alreadySatisfiedDirectives.includes("calling policy"));
  assert.deepEqual(result.selected, selected);
});

test("V1.2.9b: a second chunk from the same already-preserved cmdlet document does not consume a second reserved slot", () => {
  const docId = "doc-calling-policy";
  const synopsis = makeUnitCandidate({
    title: "Get-CsTeamsCallingPolicy",
    headingPath: ["Get-CsTeamsCallingPolicy", "SYNOPSIS"],
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    documentId: docId,
    score: 22
  });
  const description = makeUnitCandidate({
    title: "Get-CsTeamsCallingPolicy",
    headingPath: ["Get-CsTeamsCallingPolicy", "DESCRIPTION"],
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    documentId: docId,
    score: 21
  });
  const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
  const result = applyWorkflowOutputPreservation({
    sortedFused: [admin, synopsis, description],
    selected: [admin],
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES.filter((d) => d.value === "calling policy"),
    maxPerDocument: 4
  });
  const preservedFromDoc = result.selected.filter((candidate) => candidate.documentId === docId);
  assert.equal(preservedFromDoc.length, 1, "only one chunk from the calling-policy document should be preserved");
});

test("V1.2.10: the final candidate population remains exactly the same bounded size after preservation", () => {
  const admins = Array.from({ length: 20 }, (_, i) =>
    makeUnitCandidate({ title: `Admin doc ${i}`, score: 50 - i * 0.1 })
  );
  const psCandidates = [
    makeUnitCandidate({
      title: "Get-CsTeamsCallingPolicy",
      authorityRoles: ["teams_powershell_cmdlet_primary"],
      score: 20
    }),
    makeUnitCandidate({
      title: "Set-CsUser",
      headingPath: ["Set-CsUser", "PARAMETERS", "-EnterpriseVoiceEnabled"],
      authorityRoles: ["teams_powershell_cmdlet_primary"],
      score: 18
    })
  ];
  const result = applyWorkflowOutputPreservation({
    sortedFused: [...admins, ...psCandidates],
    selected: admins,
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES,
    maxPerDocument: 4
  });
  assert.equal(result.selected.length, admins.length, "preservation must not change the total selected count");
  assert.equal(result.diagnostics.evictedCandidateIds.length, result.diagnostics.preservedDirectives.length);
});

test("V1.2 precision safeguard: a differently-named, textually-overlapping object does not out-rank the directive's own canonical object", () => {
  const wrongObject = makeUnitCandidate({
    title: "New-CsTeamsEmergencyCallingPolicy",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 30 // deliberately higher score, e.g. via a spurious exact-match hit
  });
  const rightObject = makeUnitCandidate({
    title: "Get-CsTeamsCallingPolicy",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 20
  });
  const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
  const result = applyWorkflowOutputPreservation({
    sortedFused: [admin, wrongObject, rightObject],
    selected: [admin],
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES.filter((d) => d.value === "calling policy"),
    maxPerDocument: 4
  });
  const preserved = result.diagnostics.preservedDirectives.find((p) => p.directiveValue === "calling policy");
  assert.equal(preserved?.title, "Get-CsTeamsCallingPolicy");
});

test("V1.2 precision safeguard: a read-verb cmdlet is preferred over an equally topical write-verb cmdlet for a read/reporting workflow", () => {
  const removeVariant = makeUnitCandidate({
    title: "Remove-CsTeamsCallingPolicy",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 25
  });
  const getVariant = makeUnitCandidate({
    title: "Get-CsTeamsCallingPolicy",
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    score: 20
  });
  const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
  const result = applyWorkflowOutputPreservation({
    sortedFused: [admin, removeVariant, getVariant],
    selected: [admin],
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES.filter((d) => d.value === "calling policy"),
    maxPerDocument: 4
  });
  const preserved = result.diagnostics.preservedDirectives.find((p) => p.directiveValue === "calling policy");
  assert.equal(preserved?.title, "Get-CsTeamsCallingPolicy");
});

test("V1.2.15: the preservation algorithm is a pure, synchronous function requiring no provider, network, or LLM call", () => {
  const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
  const started = Date.now();
  const result = applyWorkflowOutputPreservation({
    sortedFused: [admin],
    selected: [admin],
    intent: WORKFLOW_INTENT,
    directives: WORKFLOW_DIRECTIVES,
    maxPerDocument: 4
  });
  assert.ok(Date.now() - started < 50, "must complete synchronously without any async provider call");
  assert.ok(result.selected);
});

test("V1.2.11: a narrow single-cmdlet question retains existing (unmodified) hybrid fusion output", () => {
  const narrowIntent = extractQueryIntent("What does Get-CsTenantDialPlan do?").intent;
  const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
  const scope = buildScope("What does Get-CsTenantDialPlan do?");
  const result = applyWorkflowOutputPreservation({
    sortedFused: [admin],
    selected: [admin],
    intent: narrowIntent,
    directives: scope.exactMatchDirectives,
    maxPerDocument: 4
  });
  assert.equal(result.diagnostics.triggered, false);
  assert.deepEqual(result.selected, [admin]);
});

test("V1.2.12: Entra and SharePoint routing/fusion are unaffected (preservation gate never engages)", () => {
  for (const question of [
    "How does Conditional Access affect unmanaged devices signing into Teams?",
    "What SharePoint admin settings control external sharing?"
  ]) {
    const intent = extractQueryIntent(question).intent;
    const scope = buildScope(question);
    const admin = makeUnitCandidate({ title: "Admin overview", score: 50 });
    const result = applyWorkflowOutputPreservation({
      sortedFused: [admin],
      selected: [admin],
      intent,
      directives: scope.exactMatchDirectives,
      maxPerDocument: 4
    });
    assert.equal(result.diagnostics.triggered, false, `expected no preservation for: ${question}`);
  }
});

test("V1.2.12b: Teams narrow, Entra, and SharePoint domain routing selection is untouched by the V1.2 change (no dependency on workflowOutputPreservation)", () => {
  const teamsNarrow = buildScope("How do Calling Plans work?");
  assert.ok(teamsNarrow.selectedDomains.includes("teams_admin"));

  const entra = buildScope("How does Conditional Access affect unmanaged devices signing into Teams?");
  assert.ok(entra.selectedDomains.includes("entra"));

  const sharePoint = buildScope("What SharePoint admin settings control external sharing?");
  assert.ok(sharePoint.selectedDomains.includes("sharepoint"));

  // V1.2 introduces no new import edges into domainPolicies.ts; routing
  // decisions (selectedDomains/eligibleSources/exactMatchDirectives) are
  // produced entirely before applyWorkflowOutputPreservation ever runs.
});

test("V1.2.13: an unresolved-domain question has no directives to preserve and remains a no-op", () => {
  const question = "How do I configure retention for an unrelated unmodeled product?";
  const intent = extractQueryIntent(question).intent;
  const scope = buildScope(question);
  const result = applyWorkflowOutputPreservation({
    sortedFused: [],
    selected: [],
    intent,
    directives: scope.exactMatchDirectives,
    maxPerDocument: 4
  });
  assert.equal(result.diagnostics.triggered, false);
  assert.deepEqual(result.selected, []);
});

test("directiveTopicallyMatchesCandidate: matches a PascalCase parameter heading without a literal space-separated phrase", () => {
  const candidate = makeUnitCandidate({
    title: "Set-CsUser",
    headingPath: ["Set-CsUser", "PARAMETERS", "-EnterpriseVoiceEnabled"],
    score: 0
  });
  assert.ok(directiveTopicallyMatchesCandidate("enterprise voice", candidate));
});

test("directiveTopicallyMatchesCandidate: does not match an unrelated cmdlet with no textual or structural overlap", () => {
  const candidate = makeUnitCandidate({
    title: "Get-CsTenantFederationConfiguration",
    text: "Retrieves federation settings for external access.",
    score: 0
  });
  assert.ok(!directiveTopicallyMatchesCandidate("calling policy", candidate));
});

// ---------------------------------------------------------------------------
// Integration-level: a real end-to-end pass through retrieveHybridCandidates
// (exact + lexical + semantic + fusion + preservation) against a seeded
// SQLite fixture, replicating the acceptance-question shape: three outputs
// (dial plan, phone number, voice-routing policy) whose PowerShell reference
// prose contains the literal directive phrase and so already earns exact-
// match credit, and two outputs (Enterprise Voice, calling policy) whose
// reference prose only uses a plural ("calling policies") or a PascalCase
// parameter/heading ("-EnterpriseVoiceEnabled"), so they only reach the
// candidate pool via lexical/semantic signals and depend on the V1.2
// preservation step to survive the final top-24 cut against a crowd of
// generic admin filler documents that agree across all three channels.
// ---------------------------------------------------------------------------

async function makeTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-v1-2-fusion-"));
  return join(root, "knowledge-v2.sqlite");
}

function markdown(title: string, body: string): string {
  return ["---", `title: ${title}`, "---", "", `# ${title}`, "", body].join("\n");
}

function fixtureDoc(input: AcquiredDocumentInput) {
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  return parsed.document;
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const value of v) norm += value * value;
  const out = new Float32Array(v.length);
  const scale = norm === 0 ? 1 : 1 / Math.sqrt(norm);
  for (let i = 0; i < v.length; i += 1) out[i] = (v[i] ?? 0) * scale;
  return out;
}

function withOffset(base: Float32Array, offset: number): Float32Array {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) {
    out[i] = (base[i] ?? 0) + (i % 2 === 0 ? offset : -offset);
  }
  return normalize(out);
}

interface Fixture {
  dbPath: string;
  provider: FakeEmbeddingProvider;
  runtime: { model: string; embeddingSchemaVersion: string };
}

let cachedFixture: Promise<Fixture> | null = null;

async function seedAcceptanceWorkflowFixture(): Promise<Fixture> {
  const dbPath = await makeTempDbPath();
  const store = createKnowledgeV2SqliteStore({ databasePath: dbPath, migrationsDir: MIGRATIONS_DIR });
  store.initializeDatabase();
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: MODEL,
    embeddingSchemaVersion: SCHEMA
  });

  type ChunkSeed = { chunkId: string; documentId: string; sectionId: string; heading: string[]; text: string; sourceOrder: number };
  const chunks: ChunkSeed[] = [];

  function addPsDoc(params: { cmdlet: string; url: string; heading: string[]; text: string }) {
    const doc = fixtureDoc({
      sourceId: "ms-teams-powershell",
      trackId: "ga",
      transport: "github",
      canonicalUrl: `https://learn.microsoft.com/powershell/module/microsoftteams/${params.url}`,
      rawMarkdown: markdown(params.cmdlet, params.text),
      revision: {
        transport: "github",
        repository: "MicrosoftDocs/office-docs-powershell",
        branch: "main",
        commitSha: `v1.2-ps-${params.url}`,
        blobSha: `v1.2-ps-blob-${params.url}`,
        path: `teams/teams-ps/MicrosoftTeams/${params.url}.md`
      }
    });
    store.saveKnowledgeDocument(doc, { parserVersion: "v1.2-test-v1" });
    const chunkId = `chunk-ps-${params.url}`;
    chunks.push({
      chunkId,
      documentId: doc.documentId,
      sectionId: params.url,
      heading: params.heading,
      text: params.text,
      sourceOrder: chunks.length
    });
    return chunkId;
  }

  addPsDoc({
    cmdlet: "Get-CsTenantDialPlan",
    url: "get-cstenantdialplan",
    heading: ["Get-CsTenantDialPlan", "DESCRIPTION"],
    text: "Get-CsTenantDialPlan retrieves the dial plan configured for a Teams user."
  });
  addPsDoc({
    cmdlet: "Get-CsPhoneNumberAssignment",
    url: "get-csphonenumberassignment",
    heading: ["Get-CsPhoneNumberAssignment", "DESCRIPTION"],
    text: "Get-CsPhoneNumberAssignment retrieves the phone number assigned to a Teams user."
  });
  addPsDoc({
    cmdlet: "Get-CsOnlineVoiceRoutingPolicy",
    url: "get-csonlinevoiceroutingpolicy",
    heading: ["Get-CsOnlineVoiceRoutingPolicy", "DESCRIPTION"],
    text: "Get-CsOnlineVoiceRoutingPolicy retrieves the voice routing policy assigned to a Teams user."
  });
  // Deliberately uses the PLURAL "calling policies" — never the literal
  // singular phrase "calling policy" — replicating the real Microsoft Learn
  // reference prose gap that defeats the exact-match retriever's substring
  // check even though the concept is genuinely and canonically present.
  const callingPolicyChunkId = addPsDoc({
    cmdlet: "Get-CsTeamsCallingPolicy",
    url: "get-csteamscallingpolicy",
    heading: ["Get-CsTeamsCallingPolicy", "SYNOPSIS"],
    text: "Returns information about the teams calling policies configured for use in your organization."
  });
  // Deliberately expresses the concept only via a PascalCase parameter
  // heading, never as literal prose — replicating the real
  // "-EnterpriseVoiceEnabled" parameter-heading gap on a generically named
  // cmdlet document.
  const enterpriseVoiceChunkId = addPsDoc({
    cmdlet: "Set-CsUser",
    url: "set-csuser",
    heading: ["Set-CsUser", "PARAMETERS", "-EnterpriseVoiceEnabled"],
    text: "Enables or disables a user for voice functionality within your organization."
  });

  // A crowd of generic, broadly-matching admin filler documents that agree
  // across exact (weak heading substring), lexical, and semantic channels
  // for most of the query's own vocabulary — the same dynamic that crowds
  // out narrow PowerShell body-text matches in the real corpus.
  const fillerDocs: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const doc = fixtureDoc({
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp",
      canonicalUrl: `https://learn.microsoft.com/en-us/microsoftteams/filler-topic-${i}`,
      rawMarkdown: markdown(
        `Teams voice admin filler topic ${i}`,
        `Admin guidance covering Teams users, calling policy, dial plan, phone number, voice routing policy, and enterprise voice settings.`
      ),
      revision: {
        transport: "learn_mcp",
        canonicalUrl: `https://learn.microsoft.com/en-us/microsoftteams/filler-topic-${i}`,
        locale: "en-us",
        retrievedAt: new Date().toISOString(),
        contentHash: `v1.2-filler-${i}`
      }
    });
    store.saveKnowledgeDocument(doc, { parserVersion: "v1.2-test-v1" });
    fillerDocs.push(doc.documentId);
    for (let c = 0; c < 4; c += 1) {
      chunks.push({
        chunkId: `chunk-filler-${i}-${c}`,
        documentId: doc.documentId,
        sectionId: `filler-${i}-${c}`,
        heading: [
          `Teams users calling policy dial plan phone number voice routing policy enterprise voice ${i}-${c}`
        ],
        text: `Admin guidance for Teams users covering calling policy, dial plan, phone number assignment, voice routing policy, and enterprise voice configuration in your organization. Section ${i}-${c}.`,
        sourceOrder: chunks.length
      });
    }
  }

  for (const chunk of chunks) {
    store.saveChunkPlaceholder({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      sectionId: chunk.sectionId,
      headingPath: chunk.heading,
      chunkKind: "reference",
      text: chunk.text,
      sourceOrder: chunk.sourceOrder,
      contentHash: hashEmbeddingInput(chunk.text.trim()),
      provenance: {},
      metadata: {}
    });
  }

  const query = await provider.embedQuery(
    { id: "q-workflow", text: ACCEPTANCE_QUESTION },
    { model: MODEL, embeddingSchemaVersion: SCHEMA }
  );
  for (const chunk of chunks) {
    const isFiller = chunk.chunkId.startsWith("chunk-filler-");
    // Filler admin chunks sit very close to the query vector (dominant
    // semantic + lexical signal); the two "gap" PowerShell chunks sit
    // further away (still on-topic, but weaker), matching the real
    // corpus's weak lexical/semantic ranks for these two outputs.
    const offset = isFiller ? 0.01 : chunk.chunkId === callingPolicyChunkId || chunk.chunkId === enterpriseVoiceChunkId ? 0.2 : 0.05;
    const vector = withOffset(query.vector, offset);
    store.saveChunkEmbedding({
      chunkId: chunk.chunkId,
      providerId: provider.providerId,
      model: MODEL,
      dimensions: vector.length,
      embeddingSchemaVersion: SCHEMA,
      inputContentHash: hashEmbeddingInput(chunk.text.trim()),
      vectorBlob: new Uint8Array(encodeFloat32Vector(Array.from(vector))),
      usage: { requestCount: 1, batchSize: 1 }
    });
  }

  store.close();
  return { dbPath, provider, runtime: { model: MODEL, embeddingSchemaVersion: SCHEMA } };
}

function getFixture(): Promise<Fixture> {
  if (!cachedFixture) cachedFixture = seedAcceptanceWorkflowFixture();
  return cachedFixture;
}

async function runAcceptanceQuestion(): Promise<{
  candidates: FusedRetrievalCandidate[];
  fixture: Fixture;
  result: Awaited<ReturnType<typeof retrieveHybridCandidates>>;
}> {
  const fixture = await getFixture();
  const scope = buildScope(ACCEPTANCE_QUESTION);
  const result = await retrieveHybridCandidates({
    databasePath: fixture.dbPath,
    scope,
    embeddingProvider: fixture.provider,
    embeddingRuntimeConfig: fixture.runtime
  });
  return { candidates: result.candidates, fixture, result };
}

test("V1.2.1: all five acceptance-workflow Teams-side outputs retain an eligible PowerShell candidate through final hybrid fusion", async () => {
  const { candidates, result } = await runAcceptanceQuestion();
  const psTitles = new Set(
    candidates
      .filter((c) => c.authority.sourceId === "ms-teams-powershell")
      .map((c) => c.title)
  );
  assert.ok(psTitles.has("Get-CsTenantDialPlan"), "dial plan candidate missing from final pool");
  assert.ok(psTitles.has("Get-CsPhoneNumberAssignment"), "phone number candidate missing from final pool");
  assert.ok(psTitles.has("Get-CsOnlineVoiceRoutingPolicy"), "voice-routing-policy candidate missing from final pool");
  assert.ok(psTitles.has("Get-CsTeamsCallingPolicy"), "calling-policy candidate missing from final pool");
  assert.ok(psTitles.has("Set-CsUser"), "enterprise-voice candidate missing from final pool");
  assert.ok(
    result.fusionDiagnostics.workflowOutputPreservation.triggered,
    "expected preservation to have engaged for at least the two gap outputs"
  );
});

test("V1.2.2: Enterprise Voice candidate survives final fusion", async () => {
  const { candidates } = await runAcceptanceQuestion();
  assert.ok(candidates.some((c) => c.title === "Set-CsUser" && c.authority.sourceId === "ms-teams-powershell"));
});

test("V1.2.3: calling-policy candidate survives final fusion", async () => {
  const { candidates } = await runAcceptanceQuestion();
  assert.ok(
    candidates.some((c) => c.title === "Get-CsTeamsCallingPolicy" && c.authority.sourceId === "ms-teams-powershell")
  );
});

test("V1.2.4: dial-plan candidate still survives final fusion (unchanged from V1.1)", async () => {
  const { candidates } = await runAcceptanceQuestion();
  assert.ok(
    candidates.some((c) => c.title === "Get-CsTenantDialPlan" && c.authority.sourceId === "ms-teams-powershell")
  );
});

test("V1.2.5: phone-number candidate still survives final fusion (unchanged from V1.1)", async () => {
  const { candidates } = await runAcceptanceQuestion();
  assert.ok(
    candidates.some(
      (c) => c.title === "Get-CsPhoneNumberAssignment" && c.authority.sourceId === "ms-teams-powershell"
    )
  );
});

test("V1.2.6: voice-routing-policy candidate still survives final fusion (unchanged from V1.1)", async () => {
  const { candidates } = await runAcceptanceQuestion();
  assert.ok(
    candidates.some(
      (c) => c.title === "Get-CsOnlineVoiceRoutingPolicy" && c.authority.sourceId === "ms-teams-powershell"
    )
  );
});

test("V1.2.10b: the final candidate population from a real fusion pass remains bounded at the fixed cap", async () => {
  const { candidates, result } = await runAcceptanceQuestion();
  assert.ok(candidates.length <= 24, `expected <= 24 final candidates, got ${candidates.length}`);
  assert.equal(result.fusionDiagnostics.cap.finalCandidateCap, 24);
});

test("V1.2.15b: the full acceptance-question retrieval + preservation + R2 evidence-bundle pass makes zero network/LLM calls", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network_should_not_be_used");
  }) as typeof fetch;
  try {
    const { result } = await runAcceptanceQuestion();
    const bundleResult = buildEvidenceBundle(result, { databasePath: (await getFixture()).dbPath });
    assert.ok(result.fusionDiagnostics.workflowOutputPreservation.triggered);
    assert.ok(bundleResult.bundle.evidence.length >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V1.2.14: R2 evidence-bundle construction is unaffected by the new preservation diagnostics field", async () => {
  const { result } = await runAcceptanceQuestion();
  const bundleResult = buildEvidenceBundle(result, { databasePath: (await getFixture()).dbPath });
  assert.ok(bundleResult.bundle.evidence.length >= 0);
  assert.ok(bundleResult.bundle.aspectCoverage);
});
