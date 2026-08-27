import {
  isPersonalResponseMode,
  type ResponseMode
} from "./questionIntent";
import { orderEvidenceForPresentation } from "./evidenceAuthorityOrder";

export type { ResponseMode } from "./questionIntent";
export { isPersonalResponseMode } from "./questionIntent";

export const EVIDENCE_PAYLOAD_SENTINEL =
  "\n\n\u0000RELAY_EVIDENCE_PAYLOAD\u0000\n";

export const EVIDENCE_CARD_KIND = "evidence";
export const LEGACY_EVIDENCE_CARD_KIND = "microsoft_evidence";
export const EVIDENCE_SNAPSHOT_SCHEMA = "evidence-retrieval-snapshot/v1";
export const EVIDENCE_RESOLVER_POLICY = "learn-rag-r0.4-scope-select";
export const EVIDENCE_PREVIEW_MAX_CHARS = 720;
export const EVIDENCE_PREVIEW_MAX_LINES = 6;
export const EVIDENCE_EMPTY_VISIBLE_TEXT =
  "No evidence found for this question.";
export const OVERLAY_EVIDENCE_PREVIEW_MAX_CHARS = 220;
export const OVERLAY_EVIDENCE_PREVIEW_MAX_LINES = 2;

export type EvidencePublisher = "Microsoft" | "AudioCodes" | "Linux";
export type EvidenceSourceRole =
  | "microsoft_authority"
  | "vendor_implementation_reference"
  | "upstream_reference";
export type EvidenceCardKind =
  | typeof EVIDENCE_CARD_KIND
  | typeof LEGACY_EVIDENCE_CARD_KIND;

export const PERSONAL_RESPONSE_HEADING = "Personal Response";
export const PERSONAL_RESPONSE_PROMPT =
  "This question calls for your own experience.";
export const NO_APPROVED_PERSONAL_STORY =
  "No approved personal story is stored for this question yet.";
export const SUPPORTING_EVIDENCE_HEADING = "Supporting Technical Evidence";
export const PERSONAL_STORY_FRAMEWORK = [
  "Situation",
  "Stakes",
  "Investigation / reasoning",
  "Action",
  "Validation",
  "Result",
  "Lesson"
] as const;

export type PersonalStoryStatus = "none" | "approved";

export interface PersonalResponseBlock {
  heading: typeof PERSONAL_RESPONSE_HEADING;
  prompt: typeof PERSONAL_RESPONSE_PROMPT;
  framework: readonly (typeof PERSONAL_STORY_FRAMEWORK)[number][];
  storyStatus: PersonalStoryStatus;
  storyText: string | null;
}

export interface EvidenceRoute {
  confidence: "HIGH" | "NONE" | string;
  service: string | null;
  repo: string | null;
  reason: string;
}

export interface EvidenceParent {
  parentId: string;
  title: string;
  section: string;
  url: string;
  body: string;
  score: number;
  matchedBy: string[];
  repo: string;
  publisher: EvidencePublisher;
  sourceRole: EvidenceSourceRole;
  retrievalRank?: number;
}

export interface EvidenceCardSource extends EvidenceParent {
  preview: string;
}

export interface EvidenceCardPayload {
  version: 1;
  kind: EvidenceCardKind;
  query: string;
  route: EvidenceRoute;
  primary: EvidenceCardSource | null;
  additional: EvidenceCardSource[];
  responseMode?: ResponseMode;
  personal?: PersonalResponseBlock | null;
}

export interface ParsedEvidenceCard {
  visibleText: string;
  payload: EvidenceCardPayload;
}

export type EvidenceMarkupToken =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "ordered"; ordinal: string; text: string }
  | { kind: "text"; text: string };

export function listEvidenceCardSources(
  payload: EvidenceCardPayload
): EvidenceCardSource[] {
  const retrievalOrder = [
    ...(payload.primary ? [payload.primary] : []),
    ...payload.additional
  ].map((source, index) => ({
    ...source,
    retrievalRank: source.retrievalRank ?? index + 1
  }));
  return orderEvidenceForPresentation(retrievalOrder, payload.query);
}

export function excerptParentBody(
  body: string,
  maxChars = EVIDENCE_PREVIEW_MAX_CHARS,
  maxLines = EVIDENCE_PREVIEW_MAX_LINES
): string {
  if (body.length === 0) return "";
  let end = Math.min(body.length, maxChars);
  let lineCount = 0;
  for (let index = 0; index < end; index += 1) {
    if (body[index] === "\n") {
      lineCount += 1;
      if (lineCount >= maxLines) {
        end = index;
        break;
      }
    }
  }
  if (end >= body.length) return body;
  const sliced = body.slice(0, end);
  const breakAt = Math.max(
    sliced.lastIndexOf("\n\n"),
    sliced.lastIndexOf("\n"),
    sliced.lastIndexOf(". ")
  );
  const preview =
    breakAt >= Math.floor(Math.min(maxChars, end) * 0.45)
      ? body.slice(0, sliced[breakAt] === "." ? breakAt + 1 : breakAt)
      : sliced;
  return preview.replace(/[ \t]+$/, "");
}

export function excerptOverlayPreview(body: string): string {
  return excerptParentBody(
    body,
    OVERLAY_EVIDENCE_PREVIEW_MAX_CHARS,
    OVERLAY_EVIDENCE_PREVIEW_MAX_LINES
  );
}

export function formatPersonalFrameworkText(): string {
  return PERSONAL_STORY_FRAMEWORK.join("\n→ ");
}

export function buildPersonalResponseBlock(
  storyText: string | null
): PersonalResponseBlock {
  const approved = typeof storyText === "string" && storyText.trim().length > 0;
  return {
    heading: PERSONAL_RESPONSE_HEADING,
    prompt: PERSONAL_RESPONSE_PROMPT,
    framework: [...PERSONAL_STORY_FRAMEWORK],
    storyStatus: approved ? "approved" : "none",
    storyText: approved ? storyText.trim() : null
  };
}

export function resolveResponseMode(
  payload: EvidenceCardPayload
): ResponseMode {
  return payload.responseMode ?? "technical_evidence";
}

export function formatEvidenceCardHeading(payload: EvidenceCardPayload): string {
  if (isPersonalResponseMode(resolveResponseMode(payload))) {
    return PERSONAL_RESPONSE_HEADING;
  }
  const publishers = [
    ...new Set(
      listEvidenceCardSources(payload).map(
        (source) => deriveEvidenceProvenance(source).publisher
      )
    )
  ];
  if (publishers.length === 1 && publishers[0] === "Microsoft") {
    return "Microsoft Evidence";
  }
  if (publishers.length === 1 && publishers[0] === "AudioCodes") {
    return "AudioCodes Evidence";
  }
  if (publishers.length === 1 && publishers[0] === "Linux") {
    return "Linux Evidence";
  }
  return "Evidence";
}

export function formatEvidenceSourceRoleLabel(
  source: EvidenceProvenanceInput
): string {
  const provenance = deriveEvidenceProvenance(source);
  if (provenance.publisher === "AudioCodes") {
    return "AudioCodes · vendor implementation";
  }
  if (provenance.publisher === "Linux") {
    return "Linux · upstream reference";
  }
  return "Microsoft";
}

function formatEvidenceSourceBlocks(payload: EvidenceCardPayload): string[] {
  const sources = listEvidenceCardSources(payload);
  const blocks: string[] = [];
  sources.forEach((source, index) => {
    blocks.push(
      "",
      `${index + 1}. ${source.title}`,
      formatEvidenceSourceRoleLabel(source),
      source.section,
      "",
      source.preview,
      source.url
    );
  });
  return blocks;
}

function formatPersonalVisibleText(payload: EvidenceCardPayload): string {
  const personal =
    payload.personal ?? buildPersonalResponseBlock(null);
  const blocks = [
    PERSONAL_RESPONSE_HEADING,
    "",
    personal.prompt,
    "",
    formatPersonalFrameworkText(),
    "",
    personal.storyText ?? NO_APPROVED_PERSONAL_STORY
  ];
  const sources = listEvidenceCardSources(payload);
  if (sources.length > 0) {
    blocks.push("", SUPPORTING_EVIDENCE_HEADING, ...formatEvidenceSourceBlocks(payload));
  }
  return blocks.join("\n");
}

export function formatEvidenceVisibleText(payload: EvidenceCardPayload): string {
  if (isPersonalResponseMode(resolveResponseMode(payload))) {
    return formatPersonalVisibleText(payload);
  }
  const sources = listEvidenceCardSources(payload);
  if (sources.length === 0) {
    return EVIDENCE_EMPTY_VISIBLE_TEXT;
  }
  return [formatEvidenceCardHeading(payload), ...formatEvidenceSourceBlocks(payload)].join(
    "\n"
  );
}

export function encodeEvidenceCardContent(payload: EvidenceCardPayload): string {
  return `${formatEvidenceVisibleText(payload)}${EVIDENCE_PAYLOAD_SENTINEL}${JSON.stringify(payload)}`;
}

export function parseEvidenceCardContent(
  content: string
): ParsedEvidenceCard | null {
  const index = content.indexOf(EVIDENCE_PAYLOAD_SENTINEL);
  if (index < 0) return null;
  try {
    const payload = JSON.parse(
      content.slice(index + EVIDENCE_PAYLOAD_SENTINEL.length)
    ) as EvidenceCardPayload;
    if (!isEvidenceCardKind(payload?.kind) || payload.version !== 1) {
      return null;
    }
    return {
      visibleText: content.slice(0, index),
      payload: normalizeEvidenceCardPayload(payload)
    };
  } catch {
    return null;
  }
}

export interface EvidenceProvenanceInput {
  url: string;
  repo?: string | null;
  publisher?: string | null;
  sourceRole?: string | null;
  msService?: string | null;
  msCollection?: string | null;
}

export function isEvidenceCardKind(kind: unknown): kind is EvidenceCardKind {
  return kind === EVIDENCE_CARD_KIND || kind === LEGACY_EVIDENCE_CARD_KIND;
}

export function isLearnMicrosoftUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host === "learn.microsoft.com";
}

export function isAuthoritativeEvidenceUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (host === "learn.microsoft.com") return true;
  if (hostMatches(host, "audiocodes.com")) return true;
  if (hostMatches(host, "man7.org")) return true;
  if (hostMatches(host, "freedesktop.org")) return true;
  if (hostMatches(host, "tcpdump.org")) return true;
  if (host === "docs.python.org") return true;
  return false;
}

export function deriveEvidenceProvenance(input: EvidenceProvenanceInput): {
  repo: string;
  publisher: EvidencePublisher;
  sourceRole: EvidenceSourceRole;
} {
  const repo = (input.repo ?? "").trim();
  const host = hostnameOf(input.url) ?? "";
  const service = (input.msService ?? "").trim().toLowerCase();
  const collection = (input.msCollection ?? "").trim().toLowerCase();
  if (
    repo === "audiocodes" ||
    hostMatches(host, "audiocodes.com") ||
    service === "audiocodes-sbc" ||
    collection === "certified_sbc_vendor"
  ) {
    return {
      repo: repo || "audiocodes",
      publisher: "AudioCodes",
      sourceRole: "vendor_implementation_reference"
    };
  }
  if (
    repo === "linux" ||
    service === "linux-upstream" ||
    hostMatches(host, "man7.org") ||
    hostMatches(host, "freedesktop.org") ||
    hostMatches(host, "tcpdump.org") ||
    host === "docs.python.org"
  ) {
    return {
      repo: repo || "linux",
      publisher: "Linux",
      sourceRole: "upstream_reference"
    };
  }
  return {
    repo,
    publisher: "Microsoft",
    sourceRole: "microsoft_authority"
  };
}

export function evidenceCitationAuthority(source: EvidenceProvenanceInput): {
  sourceId: string;
  authorityRole: string;
  sourceStatus: string;
} {
  const provenance = deriveEvidenceProvenance(source);
  if (provenance.publisher === "AudioCodes") {
    return {
      sourceId: "audiocodes",
      authorityRole: "vendor_implementation_reference",
      sourceStatus: "certified_sbc_vendor"
    };
  }
  if (provenance.publisher === "Linux") {
    return {
      sourceId: "linux-upstream",
      authorityRole: "upstream_reference",
      sourceStatus: "upstream_reference"
    };
  }
  return {
    sourceId: "microsoft-learn",
    authorityRole: "microsoft_learn",
    sourceStatus: "microsoft_learn"
  };
}

function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

function normalizeEvidenceCardSource(
  source: EvidenceCardSource
): EvidenceCardSource {
  return {
    ...source,
    ...deriveEvidenceProvenance(source),
    retrievalRank: source.retrievalRank
  };
}

function normalizeEvidenceCardPayload(
  payload: EvidenceCardPayload
): EvidenceCardPayload {
  const responseMode = resolveResponseMode(payload);
  return {
    ...payload,
    responseMode,
    personal: isPersonalResponseMode(responseMode)
      ? payload.personal ?? buildPersonalResponseBlock(null)
      : payload.personal ?? null,
    primary: payload.primary
      ? normalizeEvidenceCardSource(payload.primary)
      : null,
    additional: (payload.additional ?? []).map(normalizeEvidenceCardSource)
  };
}

export function tokenizeEvidenceMarkup(source: string): EvidenceMarkupToken[] {
  const tokens: EvidenceMarkupToken[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(source))) {
    if (match.index > cursor) {
      tokens.push(...tokenizeEvidenceProse(source.slice(cursor, match.index)));
    }
    tokens.push({
      kind: "code",
      language: match[1].trim(),
      text: match[2].replace(/\n$/, "")
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) {
    tokens.push(...tokenizeEvidenceProse(source.slice(cursor)));
  }
  return tokens.length > 0 ? tokens : [{ kind: "text", text: source }];
}

function tokenizeEvidenceProse(source: string): EvidenceMarkupToken[] {
  const tokens: EvidenceMarkupToken[] = [];
  const lines = source.split("\n");
  let textLines: string[] = [];
  const flushText = (): void => {
    if (textLines.length === 0) return;
    const text = textLines.join("\n").replace(/^\n+|\n+$/g, "");
    textLines = [];
    if (text.length > 0) {
      tokens.push({ kind: "text", text });
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushText();
      tokens.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2]
      });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushText();
      tokens.push({ kind: "bullet", text: bullet[1] });
      continue;
    }
    const ordered = /^(\d+)\.\s+(.+)$/.exec(line);
    if (ordered) {
      flushText();
      tokens.push({
        kind: "ordered",
        ordinal: ordered[1],
        text: ordered[2]
      });
      continue;
    }
    textLines.push(line);
  }
  flushText();
  return tokens;
}

export function toggleExpandedEvidenceSource(
  expandedIds: ReadonlySet<string>,
  sourceId: string
): Set<string> {
  const next = new Set(expandedIds);
  if (next.has(sourceId)) {
    next.delete(sourceId);
  } else {
    next.add(sourceId);
  }
  return next;
}

export function evidenceSourceItemId(
  source: Pick<EvidenceCardSource, "parentId">,
  index: number
): string {
  return `${index}:${source.parentId}`;
}
