import assert from "node:assert/strict";
import test from "node:test";
import {
  EVIDENCE_CARD_KIND,
  EVIDENCE_PREVIEW_MAX_CHARS,
  EVIDENCE_PREVIEW_MAX_LINES,
  LEGACY_EVIDENCE_CARD_KIND,
  NO_APPROVED_PERSONAL_STORY,
  PERSONAL_RESPONSE_HEADING,
  PERSONAL_RESPONSE_PROMPT,
  SUPPORTING_EVIDENCE_HEADING,
  buildPersonalResponseBlock,
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

test("peer sources stay unlabeled peers after intent-aware presentation order", () => {
  const sources = listEvidenceCardSources(payload);
  const visible = formatEvidenceVisibleText(payload);
  assert.deepEqual(
    sources.map((item) => item.parentId),
    ["overview", "analog", "example"]
  );
  assert.equal(payload.primary?.parentId, "analog");
  assert.match(visible, /^Microsoft Evidence/);
  assert.match(visible, /1\. Configure call routing for Direct Routing/);
  assert.match(visible, /Call routing overview/);
  assert.match(visible, /\nMicrosoft\n/);
  assert.match(visible, /2\. Direct Routing - Connecting analog devices/);
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

test("personal response cards are not Microsoft evidence dumps", () => {
  const personal: EvidenceCardPayload = {
    ...payload,
    query: "Tell me about the hardest UC problem you solved.",
    responseMode: "personal_response",
    personal: buildPersonalResponseBlock(null),
    primary: source({
      parentId: "cqd",
      title: "Call Quality Dashboard",
      section: "Overview",
      body: "Use CQD to inspect organization-wide call quality."
    }),
    additional: []
  };
  const visible = formatEvidenceVisibleText(personal);
  assert.equal(formatEvidenceCardHeading(personal), PERSONAL_RESPONSE_HEADING);
  assert.match(visible, new RegExp(`^${PERSONAL_RESPONSE_HEADING}`));
  assert.match(visible, new RegExp(PERSONAL_RESPONSE_PROMPT));
  assert.match(visible, /Situation\n→ Stakes\n→ Investigation \/ reasoning/);
  assert.match(visible, new RegExp(NO_APPROVED_PERSONAL_STORY));
  assert.match(visible, new RegExp(SUPPORTING_EVIDENCE_HEADING));
  assert.match(visible, /Call Quality Dashboard/);
  assert.doesNotMatch(visible, /^Microsoft Evidence/);
  assert.doesNotMatch(visible, /I diagnosed|I solved|I wrote/);
  const parsed = parseEvidenceCardContent(encodeEvidenceCardContent(personal));
  assert.equal(parsed?.payload.responseMode, "personal_response");
  assert.equal(parsed?.payload.personal?.storyStatus, "none");
  assert.equal(parsed?.payload.personal?.storyText, null);
});

function rankedSource(
  parentId: string,
  title: string,
  publisher: EvidenceCardSource["publisher"],
  retrievalRank: number,
  extras: Partial<EvidenceCardSource> = {}
): EvidenceCardSource {
  const url =
    publisher === "AudioCodes"
      ? "https://www.audiocodes.com/media/note.pdf"
      : publisher === "Linux"
        ? "https://man7.org/linux/man-pages/man1/ps.1.html"
        : "https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan";
  return source({
    parentId,
    title,
    section: title,
    body: `${title} body.`,
    url,
    repo:
      publisher === "AudioCodes"
        ? "audiocodes"
        : publisher === "Linux"
          ? "linux"
          : "teams",
    retrievalRank,
    ...extras
  });
}

test("A1/B1 Explain Direct Routing presents Plan Overview ahead of analog steps", () => {
  const mixed: EvidenceCardPayload = {
    ...payload,
    query: "Explain Direct Routing",
    primary: rankedSource(
      "ac-prereq",
      "AudioCodes infrastructure prerequisites",
      "AudioCodes",
      1,
      { section: "Infrastructure Prerequisites" }
    ),
    additional: [
      rankedSource(
        "analog",
        "Direct Routing - Connecting analog devices",
        "Microsoft",
        3,
        { section: "Step 1: Connect the SBC to Direct Routing" }
      ),
      rankedSource(
        "ms-plan",
        "Plan Direct Routing",
        "Microsoft",
        5,
        { section: "Overview" }
      )
    ]
  };
  assert.equal(mixed.primary?.publisher, "AudioCodes");
  assert.equal(mixed.primary?.retrievalRank, 1);
  const presented = listEvidenceCardSources(mixed);
  assert.equal(presented[0]?.parentId, "ms-plan");
  assert.ok(
    presented.findIndex((item) => item.parentId === "ms-plan") <
      presented.findIndex((item) => item.parentId === "analog")
  );
  assert.equal(presented.find((item) => item.parentId === "analog")?.retrievalRank, 3);
  assert.equal(presented.find((item) => item.parentId === "ms-plan")?.retrievalRank, 5);
  assert.equal(presented.length, 3);
  const visible = formatEvidenceVisibleText(mixed);
  assert.match(visible, /1\. Plan Direct Routing/);
});

test("A2/B2 geographic redundancy presents HA ahead of country/region codes", () => {
  const mixed: EvidenceCardPayload = {
    ...payload,
    query: "What would geographic redundancy look like for Direct Routing?",
    primary: rankedSource(
      "ac-ha",
      "AudioCodes Mediant SBC: Overview of High Availability Mode",
      "AudioCodes",
      1,
      { section: "Overview" }
    ),
    additional: [
      rankedSource(
        "ms-geo",
        "Direct Routing country/region codes",
        "Microsoft",
        2,
        { section: "Country and region code reference table" }
      ),
      rankedSource(
        "ms-lmo",
        "Local Media Optimization for Direct Routing",
        "Microsoft",
        3
      )
    ]
  };
  const presented = listEvidenceCardSources(mixed);
  assert.equal(presented[0]?.parentId, "ac-ha");
  assert.equal(presented[0]?.publisher, "AudioCodes");
  assert.ok(
    presented.findIndex((item) => item.parentId === "ac-ha") <
      presented.findIndex((item) => item.parentId === "ms-geo")
  );
  assert.equal(presented.find((item) => item.parentId === "ac-ha")?.retrievalRank, 1);
  assert.equal(mixed.primary?.parentId, "ac-ha");
  assert.equal(presented.length, 3);
});

test("A3 explicit AudioCodes/Mediant questions keep vendor evidence first", () => {
  const mixed: EvidenceCardPayload = {
    ...payload,
    query:
      "How would you configure an AudioCodes Mediant SBC for Teams Direct Routing?",
    primary: rankedSource(
      "ac-1",
      "AudioCodes Mediant pairing",
      "AudioCodes",
      1
    ),
    additional: [
      rankedSource("ms-plan", "Plan Direct Routing Overview", "Microsoft", 2)
    ]
  };
  const presented = listEvidenceCardSources(mixed);
  assert.deepEqual(
    presented.map((item) => item.parentId),
    ["ac-1", "ms-plan"]
  );
  assert.equal(presented[0]?.retrievalRank, 1);
  assert.equal(presented[1]?.retrievalRank, 2);
});

test("A4 explicit Linux questions keep Linux evidence first", () => {
  const mixed: EvidenceCardPayload = {
    ...payload,
    query: "A Linux service is failing intermittently. How would you investigate it?",
    primary: rankedSource("linux-systemctl", "systemctl", "Linux", 1),
    additional: [
      rankedSource("ms-cqd", "CQD reliability investigations", "Microsoft", 2),
      rankedSource("linux-ps", "ps(1)", "Linux", 4)
    ]
  };
  const presented = listEvidenceCardSources(mixed);
  assert.equal(presented[0]?.parentId, "linux-systemctl");
  assert.deepEqual(
    new Set(presented.map((item) => item.parentId)),
    new Set(["linux-systemctl", "ms-cqd", "linux-ps"])
  );
  assert.equal(presented.find((item) => item.parentId === "linux-ps")?.retrievalRank, 4);
  assert.equal(presented.find((item) => item.parentId === "ms-cqd")?.retrievalRank, 2);
});

test("A5 Get-CsOnlineUser stays Microsoft-first with no behavioral change", () => {
  const card: EvidenceCardPayload = {
    ...payload,
    query: "What does Get-CsOnlineUser return?",
    primary: rankedSource("ms-user", "Get-CsOnlineUser", "Microsoft", 1),
    additional: [
      rankedSource("ms-vrp", "Get-CsOnlineVoiceRoutingPolicy", "Microsoft", 2)
    ]
  };
  assert.deepEqual(
    listEvidenceCardSources(card).map((item) => item.parentId),
    ["ms-user", "ms-vrp"]
  );
});

test("A6 Copilot SharePoint cards keep Microsoft-only retrieval order", () => {
  const card: EvidenceCardPayload = {
    ...payload,
    query: "How would you secure SharePoint and OneDrive before Copilot?",
    primary: rankedSource("ms-rollout", "SharePoint OneDrive rollout Overview", "Microsoft", 1),
    additional: [
      rankedSource("ms-plan", "Plan SharePoint and OneDrive Overview", "Microsoft", 2),
      rankedSource("ms-overshare", "SAM Step 3 oversharing", "Microsoft", 3)
    ]
  };
  assert.deepEqual(
    listEvidenceCardSources(card).map((item) => item.parentId),
    ["ms-rollout", "ms-plan", "ms-overshare"]
  );
});

test("Gixonline STT miss is not solved here; Linux may only move below Microsoft", () => {
  const card: EvidenceCardPayload = {
    ...payload,
    query: "What does Gixonline user return?",
    primary: rankedSource(
      "ms-vrp",
      "Get-CsOnlineVoiceRoutingPolicy",
      "Microsoft",
      1
    ),
    additional: [
      rankedSource("ms-user", "Get-CsOnlineUser", "Microsoft", 2),
      rankedSource("linux-ps", "ps(1)", "Linux", 5)
    ]
  };
  const presented = listEvidenceCardSources(card);
  assert.deepEqual(
    presented.map((item) => item.parentId),
    ["ms-vrp", "ms-user", "linux-ps"]
  );
  assert.equal(presented[2]?.retrievalRank, 5);
  assert.equal(card.primary?.parentId, "ms-vrp");
});

test("personal cards without sources still show the framework, not a source gap", () => {
  const emptyPersonal: EvidenceCardPayload = {
    ...payload,
    responseMode: "personal_response",
    personal: buildPersonalResponseBlock(null),
    primary: null,
    additional: []
  };
  const visible = formatEvidenceVisibleText(emptyPersonal);
  assert.match(visible, new RegExp(PERSONAL_RESPONSE_HEADING));
  assert.match(visible, new RegExp(NO_APPROVED_PERSONAL_STORY));
  assert.doesNotMatch(visible, /No evidence found for this question/);
  assert.doesNotMatch(visible, new RegExp(SUPPORTING_EVIDENCE_HEADING));
});
