import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_CARD_KIND,
  EVIDENCE_PREVIEW_MAX_CHARS,
  EVIDENCE_PREVIEW_MAX_LINES,
  LEGACY_EVIDENCE_CARD_KIND,
  deriveEvidenceProvenance,
  encodeEvidenceCardContent,
  excerptOverlayPreview,
  excerptParentBody,
  formatEvidenceCardHeading,
  formatEvidenceSourceRoleLabel,
  formatEvidenceVisibleText,
  isAuthoritativeEvidenceUrl,
  listEvidenceCardSources,
  parseEvidenceCardContent,
  toggleExpandedEvidenceSource,
  tokenizeEvidenceMarkup,
  type EvidenceCardPayload,
  type EvidenceCardSource
} from "./evidenceCard";

function source(
  overrides: Partial<EvidenceCardSource> &
    Pick<EvidenceCardSource, "parentId" | "title" | "section" | "body">
): EvidenceCardSource {
  const body = overrides.body;
  return {
    url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing",
    score: 0.5,
    matchedBy: ["lexical"],
    preview: excerptParentBody(body),
    ...deriveEvidenceProvenance({
      url: overrides.url ?? "https://learn.microsoft.com/en-us/microsoftteams/direct-routing",
      repo: overrides.repo
    }),
    ...overrides,
    body
  };
}

const payload: EvidenceCardPayload = {
  version: 1,
  kind: EVIDENCE_CARD_KIND,
  query: "Explain the Direct Routing chain",
  route: {
    confidence: "HIGH",
    service: "msteams",
    repo: "teams-docs",
    reason: "direct-routing"
  },
  primary: source({
    parentId: "analog",
    title: "Direct Routing - Connecting analog devices",
    section: "Step 4: Assign the voice route to the PSTN usage",
    body:
      "This command creates a new online per-user voice routing policy with the Identity \u201cAnalogInteropPolicy\u201d.\n\n```powershell\nNew-CsOnlineVoiceRoutingPolicy -Identity \"AnalogInteropPolicy\" -OnlinePstnUsages \"Interop\"\nGet-CsOnlineVoiceRoutingPolicy\n```\n"
  }),
  additional: [
    source({
      parentId: "overview",
      title: "Configure call routing for Direct Routing",
      section: "Call routing overview",
      url: "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan",
      body:
        "## Call routing overview\n\nDirect Routing lets you connect a supported Session Border Controller (SBC) to Microsoft Phone System.\n\n1. Create a voice routing policy\n2. Assign PSTN usage\n3. Create a voice route\n4. Point the route at the SBC/gateway"
    }),
    source({
      parentId: "example",
      title: "Configure call routing for Direct Routing",
      section: "Example 1: Configuration steps",
      body: "Example 1 walks through creating PSTN usages and routes.\n\n- Create the PSTN usage\n- Create the voice route"
    })
  ]
};

test("excerpt is an exact compact prefix of the parent body", () => {
  const body = payload.primary!.body + "x".repeat(2000);
  const preview = excerptParentBody(body);
  assert.ok(body.startsWith(preview));
  assert.ok(preview.length <= EVIDENCE_PREVIEW_MAX_CHARS);
  assert.ok(preview.split("\n").length <= EVIDENCE_PREVIEW_MAX_LINES);
  assert.doesNotMatch(preview, /This answers your question/);
});

test("peer sources keep retrieval order and are not labeled as the answer", () => {
  const sources = listEvidenceCardSources(payload);
  const visible = formatEvidenceVisibleText(payload);
  assert.deepEqual(
    sources.map((item) => item.parentId),
    ["analog", "overview", "example"]
  );
  assert.match(visible, /^Microsoft Evidence/);
  assert.match(visible, /1\. Direct Routing - Connecting analog devices/);
  assert.match(visible, /\nMicrosoft\n/);
  assert.match(visible, /2\. Configure call routing for Direct Routing/);
  assert.match(visible, /Call routing overview/);
  assert.match(visible, /3\. Configure call routing for Direct Routing/);
  assert.doesNotMatch(visible, /Best answer|Best source|Recommended answer|Primary answer/);
  assert.doesNotMatch(visible, /Additional Microsoft sources/);
  assert.doesNotMatch(visible, /This answers your question/);
  for (const item of sources) {
    assert.ok(item.body.startsWith(item.preview));
    assert.match(visible, new RegExp(item.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(visible.includes(item.url));
  }
});

test("encoded card hides the JSON payload from visible text", () => {
  const content = encodeEvidenceCardContent(payload);
  const parsed = parseEvidenceCardContent(content);
  assert.ok(parsed);
  assert.equal(parsed.visibleText, formatEvidenceVisibleText(payload));
  assert.doesNotMatch(parsed.visibleText, /RELAY_EVIDENCE_PAYLOAD/);
  assert.doesNotMatch(parsed.visibleText, /"kind":"microsoft_evidence"/);
  assert.doesNotMatch(parsed.visibleText, /"kind":"evidence"/);
  assert.equal(parsed.payload.kind, EVIDENCE_CARD_KIND);
  assert.equal(parsed.payload.primary?.publisher, "Microsoft");
  assert.equal(parsed.payload.primary?.parentId, "analog");
  assert.equal(parsed.payload.additional[0]?.parentId, "overview");
});

test("zero results encode the source-gap sentence", () => {
  const empty: EvidenceCardPayload = {
    ...payload,
    primary: null,
    additional: []
  };
  const parsed = parseEvidenceCardContent(encodeEvidenceCardContent(empty));
  assert.equal(
    parsed?.visibleText,
    "No evidence found for this question."
  );
  assert.deepEqual(listEvidenceCardSources(empty), []);
});

test("curly quotes in source-authored text are preserved", () => {
  const body =
    "Identity \u201cAnalogInteropPolicy\u201d and PSTN usage \u201cInterop\u201d.";
  const preview = excerptParentBody(body);
  assert.equal(preview, body);
  assert.match(preview, /\u201cAnalogInteropPolicy\u201d/);
  assert.doesNotMatch(preview, /\uFFFD/);
  const visible = formatEvidenceVisibleText({
    ...payload,
    primary: source({
      parentId: "quotes",
      title: "Direct Routing - Connecting analog devices",
      section: "Step 4",
      body
    }),
    additional: []
  });
  assert.match(visible, /\u201cAnalogInteropPolicy\u201d/);
  assert.doesNotMatch(visible, /\uFFFD/);
});

test("markup tokenizer keeps PowerShell fences and does not execute HTML", () => {
  const tokens = tokenizeEvidenceMarkup(
    "## Synopsis\n\nReturns user objects.\n\n```powershell\nGet-CsOnlineUser -Identity user@contoso.com\nGet-CsOnlineVoiceRoutingPolicy\n```\n\n<script>alert(1)</script>\n\n- Identity\n- VoicePolicy"
  );
  assert.deepEqual(
    tokens.map((token) => token.kind),
    ["heading", "text", "code", "text", "bullet", "bullet"]
  );
  const code = tokens.find((token) => token.kind === "code");
  assert.equal(code?.kind, "code");
  if (code?.kind !== "code") return;
  assert.equal(code.language, "powershell");
  assert.match(code.text, /Get-CsOnlineUser -Identity user@contoso.com/);
  assert.match(code.text, /Get-CsOnlineVoiceRoutingPolicy/);
  assert.ok(code.text.includes("\n"));
  const html = tokens.find(
    (token) => token.kind === "text" && token.text.includes("<script>")
  );
  assert.equal(html?.kind, "text");
  if (html?.kind === "text") {
    assert.equal(html.text, "<script>alert(1)</script>");
  }
});

test("expanding one source does not expand another", () => {
  const first = toggleExpandedEvidenceSource(new Set(), "0:analog");
  const second = toggleExpandedEvidenceSource(first, "1:overview");
  assert.equal(first.has("0:analog"), true);
  assert.equal(first.has("1:overview"), false);
  assert.equal(second.has("0:analog"), true);
  assert.equal(second.has("1:overview"), true);
  const collapsedFirst = toggleExpandedEvidenceSource(second, "0:analog");
  assert.equal(collapsedFirst.has("0:analog"), false);
  assert.equal(collapsedFirst.has("1:overview"), true);
});

test("AudioCodes URLs are authoritative vendor evidence, not Microsoft", () => {
  assert.equal(
    isAuthoritativeEvidenceUrl(
      "https://www.audiocodes.com/media/13243/connecting-audiocodes-sbc-to-microsoft-teams-direct-routing-enterprise-model-configuration-note.pdf"
    ),
    true
  );
  assert.equal(
    isAuthoritativeEvidenceUrl("https://techdocs.audiocodes.com/bundle/mediant"),
    true
  );
  assert.equal(isAuthoritativeEvidenceUrl("https://example.com/docs"), false);
  const provenance = deriveEvidenceProvenance({
    url: "https://www.audiocodes.com/media/note.pdf",
    repo: "audiocodes"
  });
  assert.equal(provenance.publisher, "AudioCodes");
  assert.equal(provenance.sourceRole, "vendor_implementation_reference");
});

test("mixed Microsoft and AudioCodes cards are not typed as Microsoft-only", () => {
  const mixed: EvidenceCardPayload = {
    ...payload,
    primary: source({
      parentId: "ms",
      title: "Plan Direct Routing",
      section: "SBC",
      body: "Use a certified Session Border Controller."
    }),
    additional: [
      source({
        parentId: "ac",
        title: "AudioCodes Mediant: Connecting to Microsoft Teams Direct Routing",
        section: "Pairing",
        url: "https://www.audiocodes.com/media/13243/connecting-audiocodes-sbc-to-microsoft-teams-direct-routing-enterprise-model-configuration-note.pdf",
        repo: "audiocodes",
        body: "Configure the Mediant SBC pairing toward Teams Direct Routing."
      })
    ]
  };
  assert.equal(formatEvidenceCardHeading(mixed), "Evidence");
  assert.equal(mixed.kind, EVIDENCE_CARD_KIND);
  const visible = formatEvidenceVisibleText(mixed);
  assert.match(visible, /^Evidence\n/);
  assert.match(visible, /AudioCodes · vendor implementation/);
  assert.doesNotMatch(visible, /^Microsoft Evidence/);
  assert.equal(
    formatEvidenceSourceRoleLabel(mixed.additional[0]!),
    "AudioCodes · vendor implementation"
  );
});

test("legacy microsoft_evidence payloads still parse", () => {
  const legacy = encodeEvidenceCardContent({
    ...payload,
    kind: LEGACY_EVIDENCE_CARD_KIND
  });
  const parsed = parseEvidenceCardContent(legacy);
  assert.ok(parsed);
  assert.equal(parsed.payload.kind, LEGACY_EVIDENCE_CARD_KIND);
  assert.equal(parsed.payload.primary?.publisher, "Microsoft");
});

test("overlay preview is a shorter exact prefix than the Helpdesk preview", () => {
  const body = `${"Direct Routing uses a certified SBC.\n".repeat(8)}More detail.`;
  const overlay = excerptOverlayPreview(body);
  const helpdesk = excerptParentBody(body);
  assert.ok(body.startsWith(overlay));
  assert.ok(helpdesk.startsWith(overlay) || overlay === helpdesk);
  assert.ok(overlay.length <= 220);
  assert.ok(overlay.split("\n").length <= 2);
});
