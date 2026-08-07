import type { TeamsAdminSearchResultCandidate } from "./types";

function readStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(value: unknown, sink: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, sink);
    return;
  }
  if (!isRecord(value)) return;
  sink.push(value);
  for (const nested of Object.values(value)) {
    walk(nested, sink);
  }
}

export function extractSearchCandidates(payload: unknown): TeamsAdminSearchResultCandidate[] {
  const records: Record<string, unknown>[] = [];
  walk(payload, records);

  const candidates: TeamsAdminSearchResultCandidate[] = [];
  for (const record of records) {
    const url = readStringField(record, [
      "url",
      "contentUrl",
      "link",
      "href",
      "documentUrl",
      "canonicalUrl",
      "webUrl",
      "path"
    ]);
    if (!url || !/^https?:\/\//i.test(url)) continue;

    const title = readStringField(record, ["title", "name", "heading", "documentTitle"]);
    const snippet = readStringField(record, ["description", "snippet", "summary", "text", "excerpt", "content"]);
    const locale = readStringField(record, ["locale", "language"]);
    candidates.push({
      url,
      title,
      snippet,
      locale,
      raw: record
    });

    if (snippet) {
      const links = snippet.match(/https:\/\/learn\.microsoft\.com\/[^\s)>"'`]+/gi) ?? [];
      for (const link of links) {
        candidates.push({
          url: link,
          title: undefined,
          snippet: undefined,
          locale,
          raw: record
        });
      }
    }
  }

  return candidates;
}
