import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_RESOLVER_POLICY,
  EVIDENCE_SNAPSHOT_SCHEMA
} from "@shared/evidenceCard";
import {
  persistEvidenceCard
} from "./evidenceCardBuilder";
import type { EvidenceSearchSuccess } from "./evidenceTypes";

function success(
  results: EvidenceSearchSuccess["results"]
): EvidenceSearchSuccess {
  return {
    ok: true,
    query: "How would you use PowerShell to audit Teams Voice users?",
    route: {
      confidence: "HIGH",
      service: "msteams-ps",
      repo: "teams-ps",
      reason: "powershell"
    },
    results,
    timing: { total_ms: 20 },
    topK: 5,
    engine: "learn-rag-r0.4",
    corpusFingerprint: "c".repeat(16),
    indexFingerprint: "i".repeat(16)
  };
}

test("primary preview is exact source text and citations cover that preview", () => {
  const body =
    "The Get-CsOnlineUser cmdlet returns information about users.\n\n- Identity\n- VoicePolicy";
  const persisted = persistEvidenceCard(
    success([
      {
        parentId: "parent-a",
        title: "Get-CsOnlineUser",
        section: "Synopsis",
        url: "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser",
        body,
        score: 0.9,
        matchedBy: ["lexical"]
      },
      {
        parentId: "parent-b",
        title: "Teams PowerShell",
        section: "Overview",
        url: "https://learn.microsoft.com/en-us/microsoftteams/teams-powershell-overview",
        body: "Use the Teams PowerShell module.",
        score: 0.4,
        matchedBy: ["vector"]
      }
    ])
  );
  assert.ok(body.startsWith(persisted.payload.primary!.preview));
  assert.equal(persisted.citations.length, 2);
  const citation = persisted.citations[0]!;
  const preview = persisted.content.slice(
    citation.answerRange.startOffset,
    citation.answerRange.endOffset
  );
  assert.equal(preview, persisted.payload.primary!.preview);
  assert.equal(citation.claimId, null);
  assert.equal(citation.documentId, "parent-a");
  assert.equal(persisted.citations[1]?.documentId, "parent-b");
  assert.equal(
    persisted.content.slice(
      persisted.citations[1]!.answerRange.startOffset,
      persisted.citations[1]!.answerRange.endOffset
    ),
    persisted.payload.additional[0]?.preview
  );
  assert.equal(citation.canonicalUrl.includes("learn.microsoft.com"), true);
  assert.equal(citation.sourceId, "microsoft-learn");
  assert.equal(citation.authorityRole, "microsoft_learn");
  assert.equal(persisted.contextReferences.length, 2);
  assert.equal(persisted.contextReferences[1]?.documentId, "parent-b");
  assert.equal(persisted.snapshot.schemaVersion, EVIDENCE_SNAPSHOT_SCHEMA);
  assert.equal(persisted.snapshot.resolverPolicyVersion, EVIDENCE_RESOLVER_POLICY);
  assert.doesNotMatch(persisted.content, /This answers your question/);
  assert.doesNotMatch(persisted.content, /Interview Quick/);
});

test("peer evidence cards keep retrieval order and attach each source URL", () => {
  const persisted = persistEvidenceCard(
    success([
      {
        parentId: "voice-routing-policy",
        title: "Get-CsOnlineVoiceRoutingPolicy",
        section: "Synopsis",
        url: "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlinevoiceroutingpolicy",
        body: "Returns voice routing policies.\n\n```powershell\nGet-CsOnlineVoiceRoutingPolicy\n```",
        score: 0.9,
        matchedBy: ["lexical"]
      },
      {
        parentId: "online-user",
        title: "Get-CsOnlineUser",
        section: "Description",
        url: "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser",
        body: "The Get-CsOnlineUser cmdlet returns information about users.",
        score: 0.8,
        matchedBy: ["lexical"]
      },
      {
        parentId: "voice-route",
        title: "Get-CsOnlineVoiceRoute",
        section: "Synopsis",
        url: "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlinevoiceroute",
        body: "Returns voice routes used by Direct Routing.",
        score: 0.7,
        matchedBy: ["lexical"]
      }
    ])
  );
  const visible = persisted.content.slice(
    0,
    persisted.content.indexOf("\n\n\u0000RELAY_EVIDENCE_PAYLOAD\u0000\n")
  );
  assert.match(visible, /1\. Get-CsOnlineVoiceRoutingPolicy/);
  assert.match(visible, /2\. Get-CsOnlineUser/);
  assert.match(visible, /3\. Get-CsOnlineVoiceRoute/);
  assert.doesNotMatch(
    visible,
    /Best answer|Best source|Recommended answer|Primary answer/
  );
  assert.deepEqual(
    persisted.citations.map((citation) => citation.documentId),
    ["voice-routing-policy", "online-user", "voice-route"]
  );
  assert.equal(
    persisted.citations[1]?.canonicalUrl,
    "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser"
  );
});

test("zero results persist the gap sentence without citations", () => {
  const persisted = persistEvidenceCard(success([]));
  assert.equal(persisted.payload.primary, null);
  assert.equal(persisted.citations.length, 0);
  assert.match(persisted.content, /No evidence found for this question\./);
});

test("AudioCodes hits persist vendor provenance instead of microsoft_learn", () => {
  const persisted = persistEvidenceCard(
    success([
      {
        parentId: "ac-1",
        title: "AudioCodes Mediant: Connecting to Microsoft Teams Direct Routing",
        section: "Pairing",
        url: "https://www.audiocodes.com/media/13243/connecting-audiocodes-sbc-to-microsoft-teams-direct-routing-enterprise-model-configuration-note.pdf",
        body: "Configure the Mediant SBC for Teams Direct Routing pairing.",
        score: 0.9,
        matchedBy: ["lexical"],
        repo: "audiocodes"
      }
    ])
  );
  assert.equal(persisted.payload.kind, "evidence");
  assert.equal(persisted.payload.primary?.publisher, "AudioCodes");
  assert.equal(
    persisted.payload.primary?.sourceRole,
    "vendor_implementation_reference"
  );
  assert.match(persisted.content, /^AudioCodes Evidence/);
  assert.match(persisted.content, /AudioCodes · vendor implementation/);
  assert.doesNotMatch(persisted.content, /^Microsoft Evidence/);
  assert.equal(persisted.citations[0]?.sourceId, "audiocodes");
  assert.equal(
    persisted.citations[0]?.authorityRole,
    "vendor_implementation_reference"
  );
  assert.equal(persisted.contextReferences[0]?.sourceId, "audiocodes");
});
