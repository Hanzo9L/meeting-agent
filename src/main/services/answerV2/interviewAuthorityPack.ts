import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  getSourceById,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";

export const INTERVIEW_PACK_BY_SECTION = {
  A: "teams_voice_direct_routing",
  B: "call_quality_troubleshooting",
  C: "auto_attendants_call_queues",
  D: "teams_rooms",
  E: "teams_powershell_interview_subset",
  F: "sharepoint_onedrive_copilot_governance",
  G: "entra_identity_support"
} as const;

export type MicrosoftInterviewPackId =
  (typeof INTERVIEW_PACK_BY_SECTION)[keyof typeof INTERVIEW_PACK_BY_SECTION];

export interface LocalPackDocument {
  documentId: string;
  canonicalUrl: string;
  sourcePath: string;
  title: string;
  chunkCount: number;
}

export interface ResolvedInterviewPack {
  packId: MicrosoftInterviewPackId;
  selectedCanonicalUrls: string[];
  localDocuments: LocalPackDocument[];
  missingCanonicalUrls: string[];
}

interface DocumentRow {
  document_id: string;
  canonical_url: string;
  source_path: string;
  title: string | null;
  chunk_count: number;
}

const packCache = new Map<string, Map<MicrosoftInterviewPackId, ResolvedInterviewPack>>();

export function interviewPowerShellCoreCanonicalUrls(): string[] {
  const source = getSourceById("ms-powershell-core");
  const mapped = source?.learnMapping?.githubExactCanonicalUrls;
  return mapped ? Object.values(mapped) : [];
}

function cmdletSlug(canonicalUrl: string): string {
  return canonicalUrl
    .split("/")
    .at(-1)!
    .split("?")[0]!
    .replace(/\.md$/i, "")
    .toLowerCase();
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname
      .replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/")
      .replace(/\/+$/, "")
      .toLowerCase();
    return `${url.hostname.toLowerCase()}${path}`;
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function loadSelectedMicrosoftPackUrls(
  packPath = resolve("docs/interview/RELAY_INTERVIEW_AUTHORITY_PACK.md")
): Map<MicrosoftInterviewPackId, string[]> {
  const selected = new Map<MicrosoftInterviewPackId, string[]>();
  let current: MicrosoftInterviewPackId | null = null;
  for (const line of readFileSync(packPath, "utf8").split(/\r?\n/)) {
    const section = /^### ([A-G])\./.exec(line);
    if (section) {
      current =
        INTERVIEW_PACK_BY_SECTION[
          section[1] as keyof typeof INTERVIEW_PACK_BY_SECTION
        ];
      if (!selected.has(current)) selected.set(current, []);
      continue;
    }
    if (/^## /.test(line)) {
      current = null;
      continue;
    }
    if (!current || !/^\d+\./.test(line)) continue;
    if (line.includes("**reference-only**")) continue;
    const match = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/.exec(line);
    if (match?.[1]) selected.get(current)!.push(match[1]);
  }
  return selected;
}

export function resolveLocalInterviewPacks(
  databasePath = resolveKnowledgeV2DatabasePath()
): Map<MicrosoftInterviewPackId, ResolvedInterviewPack> {
  const cached = packCache.get(databasePath);
  if (cached) return cached;
  const db = new Database(databasePath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT
           d.document_id,
           d.canonical_url,
           d.source_path,
           d.title,
           COUNT(c.chunk_id) AS chunk_count
         FROM documents d
         LEFT JOIN knowledge_chunks c ON c.document_id = d.document_id
         WHERE d.parse_status IN ('success', 'warning')
         GROUP BY d.document_id`
      )
      .all() as DocumentRow[];
    const byCanonical = new Map<string, DocumentRow>();
    for (const row of rows) {
      byCanonical.set(normalizedUrl(row.canonical_url), row);
    }
    const selections = loadSelectedMicrosoftPackUrls();
    const resolved = new Map<
      MicrosoftInterviewPackId,
      ResolvedInterviewPack
    >();
    for (const [packId, selectedUrls] of selections) {
      const localDocuments: LocalPackDocument[] = [];
      const missingCanonicalUrls: string[] = [];
      const seen = new Set<string>();
      const urls = [...selectedUrls];
      if (packId === "teams_powershell_interview_subset") {
        urls.push(...interviewPowerShellCoreCanonicalUrls());
      }
      for (const canonicalUrl of urls) {
        let row = byCanonical.get(normalizedUrl(canonicalUrl));
        if (!row && canonicalUrl.includes("/powershell/module/")) {
          const slug = cmdletSlug(canonicalUrl);
          row = rows.find(
            (candidate) =>
              candidate.source_path.toLowerCase().endsWith(`/${slug}.md`) ||
              candidate.title?.toLowerCase() === slug
          );
        }
        if (!row) {
          missingCanonicalUrls.push(canonicalUrl);
          continue;
        }
        if (seen.has(row.document_id)) continue;
        seen.add(row.document_id);
        localDocuments.push({
          documentId: row.document_id,
          canonicalUrl: row.canonical_url,
          sourcePath: row.source_path,
          title: row.title ?? row.source_path,
          chunkCount: Number(row.chunk_count)
        });
      }
      resolved.set(packId, {
        packId,
        selectedCanonicalUrls: urls,
        localDocuments,
        missingCanonicalUrls
      });
    }
    packCache.set(databasePath, resolved);
    return resolved;
  } finally {
    db.close();
  }
}

export function documentIdsForInterviewPacks(
  packIds: MicrosoftInterviewPackId[],
  databasePath = resolveKnowledgeV2DatabasePath()
): string[] {
  const packs = resolveLocalInterviewPacks(databasePath);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const packId of packIds) {
    const pack = packs.get(packId);
    if (!pack) continue;
    for (const document of pack.localDocuments) {
      if (seen.has(document.documentId)) continue;
      seen.add(document.documentId);
      ids.push(document.documentId);
    }
  }
  return ids;
}
