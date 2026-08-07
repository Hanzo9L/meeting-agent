import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCanonicalDocument } from "./parser";
import type { AcquiredDocumentInput, CanonicalSection } from "./types";

async function loadFixture(name: string): Promise<AcquiredDocumentInput> {
  const path = resolve(`src/main/services/knowledgeV2/parse/fixtures/${name}`);
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as AcquiredDocumentInput;
}

function flattenSections(sections: CanonicalSection[]): CanonicalSection[] {
  const out: CanonicalSection[] = [];
  const queue = [...sections];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    out.push(current);
    queue.unshift(...current.children);
  }
  return out;
}

test("parses Learn MCP-acquired Teams Admin markdown successfully", async () => {
  const input = await loadFixture("teams-admin-learn-direct-routing.json");
  const parsed = parseCanonicalDocument(input);
  assert.equal(parsed.success, true);
  assert.ok(parsed.document);
  assert.equal(parsed.document?.transport, "learn_mcp");
  assert.ok((parsed.document?.sections.length ?? 0) > 0);
  assert.ok((parsed.document?.rawMarkdown.length ?? 0) > 1000);
});

test("parses GitHub-acquired Teams PowerShell markdown successfully", async () => {
  const input = await loadFixture("teams-powershell-cmdlet.json");
  const parsed = parseCanonicalDocument(input);
  assert.equal(parsed.success, true);
  assert.ok(parsed.document);
  assert.equal(parsed.document?.transport, "github");
  assert.ok((parsed.document?.sections.length ?? 0) > 0);
});

test("parser output remains transport-neutral while preserving provenance", async () => {
  const learn = parseCanonicalDocument(await loadFixture("teams-admin-learn-direct-routing.json"));
  const github = parseCanonicalDocument(await loadFixture("teams-powershell-conceptual.json"));
  assert.ok(learn.document && github.document);
  assert.equal(learn.document?.sourceRevision.transport, "learn_mcp");
  assert.equal(github.document?.sourceRevision.transport, "github");
  assert.equal(typeof learn.document?.normalizedMetadata.title, "string");
  assert.equal(typeof github.document?.normalizedMetadata.title, "string");
});

test("front matter is preserved and recognized metadata is normalized", async () => {
  const input = await loadFixture("teams-powershell-cmdlet.json");
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  assert.ok(parsed.document?.rawFrontMatter);
  assert.ok(Object.keys(parsed.document?.frontMatter ?? {}).length > 0);
  assert.ok(parsed.document?.normalizedMetadata.title);
  assert.ok(parsed.document?.normalizedMetadata.title?.length);
});

test("unknown metadata survives normalization", async () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/doc",
    rawMarkdown:
      "---\ncustomField: keep-me\nms.topic: conceptual\ntitle: Demo\n---\n\n# Demo\n\nBody text",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "doc.md"
    }
  };
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  assert.equal(parsed.document?.frontMatter.customField, "keep-me");
  assert.equal(parsed.document?.normalizedMetadata.topic, "conceptual");
});

test("heading hierarchy and section paths are preserved", async () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/hierarchy",
    rawMarkdown: "# Configure X\n\n## Prerequisites\nText\n\n## Configure routing\n### Step 1\nA\n### Step 2\nB",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "hierarchy.md"
    }
  };
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  const sections = flattenSections(parsed.document?.sections ?? []);
  const step1 = sections.find((item) => item.heading === "Step 1");
  assert.ok(step1);
  assert.deepEqual(step1?.headingPath, ["Configure X", "Configure routing", "Step 1"]);
});

test("source ordering is preserved across paragraph, code block, and callout", () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/order",
    rawMarkdown: "# Title\n\npara one\n\n```powershell\nGet-Thing\n```\n\n> NOTE: read this carefully",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "order.md"
    }
  };
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  const section = parsed.document?.sections[0];
  const kinds = section?.blocks.map((block) => block.kind) ?? [];
  assert.deepEqual(kinds, ["paragraph", "code_block", "callout"]);
});

test("tables remain structurally intact", () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/table",
    rawMarkdown: "# T\n\n| Col A | Col B |\n|---|---|\n| A1 | B1 |\n| A2 | B2 |",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "table.md"
    }
  };
  const parsed = parseCanonicalDocument(input);
  const section = parsed.document?.sections[0];
  const table = section?.blocks.find((block) => block.kind === "table");
  assert.ok(table && table.kind === "table");
  if (table.kind === "table") {
    assert.deepEqual(table.headers, ["Col A", "Col B"]);
    assert.equal(table.rows.length, 2);
  }
});

test("links and inline code are retained", () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "learn_mcp",
    canonicalUrl: "https://example.test/links",
    rawMarkdown: "# Title\n\nUse `Set-CsOnlineVoiceRoute` and see [docs](https://learn.microsoft.com/en-us/microsoftteams).",
    revision: {
      transport: "learn_mcp",
      canonicalUrl: "https://example.test/links",
      locale: "en-us",
      retrievedAt: new Date().toISOString(),
      contentHash: "x"
    }
  };
  const parsed = parseCanonicalDocument(input);
  const paragraph = parsed.document?.sections[0]?.blocks.find((block) => block.kind === "paragraph");
  assert.ok(paragraph && paragraph.kind === "paragraph");
  if (paragraph.kind === "paragraph") {
    assert.ok(paragraph.inline.some((token) => token.kind === "inline_code"));
    assert.ok(paragraph.links.some((link) => link.href.includes("learn.microsoft.com")));
  }
});

test("PowerShell sections remain distinguishable for future chunking", async () => {
  const input = await loadFixture("teams-powershell-cmdlet.json");
  const parsed = parseCanonicalDocument(input);
  const sections = flattenSections(parsed.document?.sections ?? []);
  const kinds = new Set(sections.map((item) => item.sectionKind));
  assert.ok(kinds.has("powershell_syntax"));
  assert.ok(kinds.has("powershell_examples"));
  assert.ok(kinds.has("powershell_parameters"));
});

test("malformed front matter yields diagnostics without crashing body parse", () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/malformed",
    rawMarkdown: "---\ntitle: bad\nms.topic: [oops\n\n# Body heading\n\nText",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "bad.md"
    }
  };
  const parsed = parseCanonicalDocument(input);
  assert.ok(parsed.document);
  assert.ok(parsed.fatalErrors.length > 0);
  assert.ok((parsed.document?.sections.length ?? 0) > 0);
});

test("unsupported constructs are preserved with diagnostics", () => {
  const input: AcquiredDocumentInput = {
    sourceId: "ms-test",
    trackId: "ga",
    transport: "github",
    canonicalUrl: "https://example.test/unsupported",
    rawMarkdown: "# T\n\n[^1]: Footnote value",
    revision: {
      transport: "github",
      repository: "owner/repo",
      branch: "main",
      commitSha: "abc",
      blobSha: "def",
      path: "unsupported.md"
    }
  };
  const parsed = parseCanonicalDocument(input);
  const hasWarning = parsed.warnings.some((diag) => diag.code === "unsupported_markdown_node");
  assert.equal(hasWarning, true);
  const unknownBlock = parsed.document?.sections[0]?.blocks.find((block) => block.kind === "unknown");
  assert.ok(unknownBlock);
});

test("document IDs are stable for identical source identity input", async () => {
  const input = await loadFixture("teams-powershell-conceptual.json");
  const first = parseCanonicalDocument(input);
  const second = parseCanonicalDocument(input);
  assert.equal(first.document?.documentId, second.document?.documentId);
});

