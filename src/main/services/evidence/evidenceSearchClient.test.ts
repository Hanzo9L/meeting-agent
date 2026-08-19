import assert from "node:assert/strict";
import test from "node:test";
import { parseEvidenceBridgeResponse } from "./evidenceSearchClient";

const fallback = {
  engine: "learn-rag-r0.4",
  corpusFingerprint: "abc",
  indexFingerprint: "def"
};

const validHit = {
  parentId: "p1",
  title: "Get-CsOnlineUser",
  section: "Synopsis",
  url: "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser",
  body: "Returns users.",
  score: 0.8,
  matchedBy: ["lexical"]
};

test("client accepts a valid R0.4 protocol response", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      id: "req-1",
      ok: true,
      query: "What does Get-CsOnlineUser return?",
      route: {
        confidence: "HIGH",
        service: "msteams-ps",
        repo: "teams-ps",
        reason: "powershell"
      },
      results: [validHit],
      timing: { total_ms: 12 },
      topK: 5
    },
    fallback
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.topK, 5);
  assert.equal(parsed.route.confidence, "HIGH");
  assert.equal(parsed.results[0]?.url, validHit.url);
});

test("client preserves source-authored curly quotes", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      id: "req-quotes",
      ok: true,
      query: "Analog devices",
      route: {
        confidence: "HIGH",
        service: "msteams",
        repo: "teams-docs",
        reason: "direct-routing"
      },
      results: [
        {
          ...validHit,
          body: "Identity \u201cAnalogInteropPolicy\u201d"
        }
      ],
      timing: { total_ms: 9 },
      topK: 5
    },
    fallback
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(
    parsed.results[0]?.body,
    "Identity \u201cAnalogInteropPolicy\u201d"
  );
  assert.equal(parsed.results[0]?.body.includes("\uFFFD"), false);
});

test("client rejects arbitrary non-allowlisted URLs", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      ok: true,
      query: "q",
      route: { confidence: "NONE", service: null, repo: null, reason: "none" },
      results: [{ ...validHit, url: "https://example.com/docs" }],
      timing: {},
      topK: 5
    },
    fallback
  );
  assert.equal(parsed.ok, false);
});

test("client accepts AudioCodes vendor URLs and labels provenance", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      ok: true,
      query: "How do you configure an SBC for Teams Direct Routing?",
      route: {
        confidence: "HIGH",
        service: "msteams",
        repo: "teams-docs",
        reason: "direct-routing"
      },
      results: [
        {
          parentId: "ac-1",
          title: "AudioCodes Mediant: Connecting to Microsoft Teams Direct Routing",
          section: "Pairing",
          url: "https://www.audiocodes.com/media/13243/connecting-audiocodes-sbc-to-microsoft-teams-direct-routing-enterprise-model-configuration-note.pdf",
          body: "Configure the Mediant SBC for Teams Direct Routing pairing.",
          score: 0.8,
          matchedBy: ["lexical"],
          repo: "audiocodes",
          publisher: "AudioCodes",
          sourceRole: "vendor_implementation_reference"
        }
      ],
      timing: { total_ms: 11 },
      topK: 5
    },
    fallback
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.results[0]?.publisher, "AudioCodes");
  assert.equal(parsed.results[0]?.sourceRole, "vendor_implementation_reference");
  assert.equal(parsed.results[0]?.repo, "audiocodes");
});

test("client derives Microsoft provenance when bridge omits publisher", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      ok: true,
      query: "q",
      route: {
        confidence: "HIGH",
        service: "msteams-ps",
        repo: "teams-ps",
        reason: "powershell"
      },
      results: [validHit],
      timing: {},
      topK: 5
    },
    fallback
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.results[0]?.publisher, "Microsoft");
  assert.equal(parsed.results[0]?.sourceRole, "microsoft_authority");
});

test("client requires top_k=5 in the protocol", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      ok: true,
      query: "q",
      route: { confidence: "NONE", service: null, repo: null, reason: "none" },
      results: [validHit],
      timing: {},
      topK: 3
    },
    fallback
  );
  assert.equal(parsed.ok, false);
});

test("client maps bridge errors without semantic classification", () => {
  const parsed = parseEvidenceBridgeResponse(
    {
      ok: false,
      error: { code: "search_timeout", message: "timed out" }
    },
    fallback
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "search_timeout");
});
