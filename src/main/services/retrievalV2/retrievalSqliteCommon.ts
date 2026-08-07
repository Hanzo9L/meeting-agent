import Database from "better-sqlite3";
import {
  getDefaultSourceRegistry,
  type SourceAuthorityRole,
  type SourceStatus
} from "../knowledgeV2";
import type { RetrievalScope } from "./domainRouter";
import type { CandidateAuthorityContext, CandidateProvenance } from "./retrievalCandidates";

export interface ScopedCandidateRow {
  document_id: string;
  source_id: string;
  track_id: string;
  canonical_url: string;
  source_path: string;
  title: string | null;
  source_status: string | null;
  authority_tier: string | null;
  source_revision_json: string;
  chunk_id: string;
  section_id: string;
  source_order?: number;
  heading_path_json: string;
  chunk_text: string;
}

const REGISTRY_BY_SOURCE_ID = new Map(
  getDefaultSourceRegistry().sources.map((source) => [source.id, source] as const)
);
const SOURCE_REVISION_CACHE = new Map<string, Record<string, unknown>>();

interface ScopeFilterResult {
  sql: string;
  params: string[];
}

function safeArrayJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function normalizeStatus(raw: string | null): SourceStatus | "unknown" {
  if (raw === "ga" || raw === "beta" || raw === "preview") return raw;
  return "unknown";
}

function normalizeTier(raw: string | null): "tier1" | "secondary" | "unknown" {
  if (raw === "tier1" || raw === "secondary") return raw;
  return "unknown";
}

export function createSqliteConnection(databasePath: string): Database.Database {
  const db = new Database(databasePath, { readonly: true });
  db.pragma("foreign_keys = ON");
  return db;
}

export function buildScopeDocumentFilter(scope: RetrievalScope, documentAlias = "d"): ScopeFilterResult {
  const pairs: Array<{ sourceId: string; trackId: string }> = [];
  for (const source of scope.eligibleSources) {
    for (const trackId of source.eligibleTrackIds) {
      pairs.push({ sourceId: source.sourceId, trackId });
    }
  }
  if (pairs.length === 0) {
    return { sql: "1 = 0", params: [] };
  }

  const clauses: string[] = [];
  const params: string[] = [];
  for (const pair of pairs) {
    clauses.push(`(${documentAlias}.source_id = ? AND ${documentAlias}.track_id = ?)`);
    params.push(pair.sourceId, pair.trackId);
  }
  return {
    sql: `(${clauses.join(" OR ")})`,
    params
  };
}

export function buildAuthorityContext(scope: RetrievalScope, row: ScopedCandidateRow): CandidateAuthorityContext {
  const sourceInScope = scope.eligibleSources.find((source) => source.sourceId === row.source_id);
  const trackIndex = sourceInScope?.eligibleTrackIds.findIndex((trackId) => trackId === row.track_id) ?? -1;
  const trackStatus =
    trackIndex >= 0 ? sourceInScope?.eligibleTrackStatuses[trackIndex] : undefined;
  const registrySource = REGISTRY_BY_SOURCE_ID.get(row.source_id);
  const normalizedTier = normalizeTier(row.authority_tier);

  return {
    sourceId: row.source_id,
    trackId: row.track_id,
    sourceStatus: trackStatus ?? normalizeStatus(row.source_status),
    authorityTier: normalizedTier === "unknown"
      ? registrySource?.authorityTier ?? "unknown"
      : normalizedTier,
    authorityRoles:
      sourceInScope?.authorityRoles ??
      ((registrySource?.authorityRoles as SourceAuthorityRole[] | undefined) ?? []),
    routePriority: sourceInScope?.priority ?? "supporting"
  };
}

export function buildProvenance(row: ScopedCandidateRow): CandidateProvenance {
  let sourceRevision = SOURCE_REVISION_CACHE.get(row.source_revision_json);
  if (!sourceRevision) {
    sourceRevision = JSON.parse(row.source_revision_json) as Record<string, unknown>;
    SOURCE_REVISION_CACHE.set(row.source_revision_json, sourceRevision);
  }
  return {
    sourcePath: row.source_path,
    canonicalUrl: row.canonical_url,
    sourceRevision,
    headingPath: safeArrayJson(row.heading_path_json),
    sectionId: row.section_id
  };
}

export function makeCandidateId(parts: string[]): string {
  // Stable non-cryptographic identity keeps retrieval deterministic and avoids
  // per-candidate hashing overhead in hot paths.
  return parts.join("|");
}

export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenizeForMatch(value: string): string[] {
  return normalizeToken(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

