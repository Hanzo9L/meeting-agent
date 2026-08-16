import { performance } from "node:perf_hooks";
import type { RetrievalScope } from "./domainRouter";
import { requestsPowerShellMethod } from "./domainPolicies";
import type {
  ExactMatchAttempt,
  ExactMatchDiagnostics,
  RetrievalCandidate
} from "./retrievalCandidates";
import {
  buildAuthorityContext,
  buildProvenance,
  buildScopeDocumentFilter,
  createSqliteConnection,
  makeCandidateId,
  normalizeToken,
  tokenizeForMatch,
  type ScopedCandidateRow
} from "./retrievalSqliteCommon";
import { ensureNotAborted } from "./retrievalAbort";

const MAX_EXACT_CANDIDATES = 64;
// Broad conceptual admin docs frequently win every slot of the per-directive
// row LIMIT via heading (metadata_weak) matches, which starves out narrow
// canonical PowerShell cmdlet docs that only match via body text
// (chunk_text_weak, a lower-ranked field in the same ORDER BY). When the
// requested method is PowerShell, reserve a small number of slots per
// directive exclusively for ms-teams-powershell so canonical cmdlet evidence
// for the requested output concept is guaranteed a chance to enter the
// candidate pool and be ranked on its own merits downstream.
const POWERSHELL_RESERVED_SLOTS_PER_DIRECTIVE = 16;
const POWERSHELL_RESERVED_SOURCE_ID = "ms-teams-powershell";

type MatchedField =
  | "title"
  | "entity"
  | "metadata"
  | "metadata_weak"
  | "section"
  | "canonical_identifier"
  | "chunk_text"
  | "chunk_text_weak";

interface ExactRow extends ScopedCandidateRow {
  matched_field: MatchedField;
}

export interface ExactMatchRetrievalResult {
  candidates: RetrievalCandidate[];
  diagnostics: ExactMatchDiagnostics;
  latencyMs: number;
}

function fieldScore(field: MatchedField): number {
  switch (field) {
    case "entity":
      return 1.0;
    case "title":
      return 0.97;
    case "canonical_identifier":
      return 0.94;
    case "section":
      return 0.88;
    case "metadata":
      return 0.82;
    case "metadata_weak":
      return 0.18;
    case "chunk_text":
      return 0.76;
    case "chunk_text_weak":
      return 0.08;
  }
}

function isCanonicalLikePolicy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  return (
    compact.endsWith("policy") &&
    compact.length > "policy".length &&
    normalized !== "policy" &&
    normalized !== "policies"
  );
}

function buildExactQuerySql(params: {
  scopeSql: string;
  allowWeakSubstring: boolean;
}): string {
  const weakCase = params.allowWeakSubstring
    ? "WHEN instr(lower(kc.heading_path_json), ?) > 0 THEN 'metadata_weak'"
    : "WHEN instr(lower(kc.heading_path_json), ?) > 0 THEN 'metadata'";
  const weakChunkCase = params.allowWeakSubstring ? "'chunk_text_weak'" : "'chunk_text'";
  const orderChunkPredicate = params.allowWeakSubstring
    ? "WHEN instr(lower(kc.chunk_text), ?) > 0 THEN 7"
    : "WHEN instr(lower(kc.chunk_text), ?) > 0 THEN 6";
  const whereChunkPredicate = params.allowWeakSubstring
    ? "OR instr(lower(kc.chunk_text), ?) > 0"
    : "";
  return `
        SELECT
          d.document_id,
          d.source_id,
          d.track_id,
          d.canonical_url,
          d.source_path,
          d.title,
          d.source_status,
          d.authority_tier,
          dc.source_revision_json,
          kc.chunk_id,
          kc.section_id,
          kc.heading_path_json,
          kc.chunk_text,
          CASE
            WHEN lower(COALESCE(d.title, '')) = ? THEN 'title'
            WHEN EXISTS (
              SELECT 1 FROM chunk_entities ce
              WHERE ce.chunk_id = kc.chunk_id
                AND lower(ce.entity_value) = ?
            ) THEN 'entity'
            WHEN lower(kc.section_id) = ? THEN 'section'
            WHEN lower(d.source_path) = ? OR lower(d.canonical_url) = ? THEN 'canonical_identifier'
            ${weakCase}
            ELSE ${weakChunkCase}
          END as matched_field
        FROM knowledge_chunks kc
        JOIN documents d ON d.document_id = kc.document_id
        JOIN document_contents dc ON dc.document_id = d.document_id
        WHERE d.tombstoned_at IS NULL
          AND kc.tombstoned_at IS NULL
          AND d.parse_status != 'failed'
          AND ${params.scopeSql}
          AND (
            lower(COALESCE(d.title, '')) = ?
            OR EXISTS (
              SELECT 1 FROM chunk_entities ce
              WHERE ce.chunk_id = kc.chunk_id
                AND lower(ce.entity_value) = ?
            )
            OR lower(kc.section_id) = ?
            OR lower(d.source_path) = ?
            OR lower(d.canonical_url) = ?
            OR instr(lower(kc.heading_path_json), ?) > 0
            ${whereChunkPredicate}
          )
        ORDER BY
          CASE
            WHEN lower(COALESCE(d.title, '')) = ? THEN 1
            WHEN EXISTS (
              SELECT 1 FROM chunk_entities ce
              WHERE ce.chunk_id = kc.chunk_id
                AND lower(ce.entity_value) = ?
            ) THEN 2
            WHEN lower(kc.section_id) = ? THEN 3
            WHEN lower(d.source_path) = ? OR lower(d.canonical_url) = ? THEN 4
            WHEN instr(lower(kc.heading_path_json), ?) > 0 THEN 5
            ${orderChunkPredicate}
            ELSE 8
          END,
          kc.source_order ASC
        LIMIT ?
      `;
}

function mergeRowsIntoDedup(params: {
  rows: ExactRow[];
  attempt: ExactMatchAttempt;
  dedup: Map<string, RetrievalCandidate>;
  scope: RetrievalScope;
  signal?: AbortSignal;
}): void {
  const { rows, attempt, dedup, scope } = params;
  for (const row of rows) {
    ensureNotAborted(params.signal);
    const key = row.chunk_id;
    const score = fieldScore(row.matched_field);
    const existing = dedup.get(key);
    if (existing) {
      existing.retrievalReasons.push(
        `exact_match:${attempt.directiveType}:${attempt.directiveValue}:${row.matched_field}`
      );
      if ((existing.scores.exactMatch ?? 0) < score) {
        existing.scores.exactMatch = score;
        existing.exactMatch = {
          directiveType: attempt.directiveType,
          directiveValue: attempt.directiveValue,
          required: attempt.required,
          matchedField: row.matched_field
        };
      }
      continue;
    }

    const candidate: RetrievalCandidate = {
      candidateId: makeCandidateId([
        "exact",
        row.chunk_id,
        attempt.directiveType,
        attempt.directiveValue,
        row.matched_field
      ]),
      method: "exact",
      documentId: row.document_id,
      chunkId: row.chunk_id,
      sectionId: row.section_id,
      headingPath: buildProvenance(row).headingPath,
      title: row.title ?? "(untitled)",
      text: row.chunk_text,
      authority: buildAuthorityContext(scope, row),
      provenance: buildProvenance(row),
      scores: {
        lexical: null,
        exactMatch: score,
        semanticSimilarity: null
      },
      exactMatch: {
        directiveType: attempt.directiveType,
        directiveValue: attempt.directiveValue,
        required: attempt.required,
        matchedField: row.matched_field
      },
      retrievalReasons: [
        `exact_match:${attempt.directiveType}:${attempt.directiveValue}:${row.matched_field}`
      ]
    };
    dedup.set(key, candidate);
  }
}

export function retrieveExactMatches(params: {
  databasePath: string;
  scope: RetrievalScope;
  signal?: AbortSignal;
}): ExactMatchRetrievalResult {
  const started = performance.now();
  ensureNotAborted(params.signal);
  const scope = params.scope;
  const directives = scope.exactMatchDirectives.filter(
    (directive) => directive.type === "cmdlet" || directive.type === "policy" || directive.type === "entity"
  );

  const diagnostics: ExactMatchDiagnostics = {
    eligiblePopulation: 0,
    matchedPopulation: 0,
    returnedPopulation: 0,
    attempted: directives.map((directive) => ({
      directiveType: directive.type,
      directiveValue: directive.value,
      required: directive.required,
      matchedCount: 0
    })),
    missedRequired: []
  };

  if (!scope.strategy.exact || directives.length === 0) {
    return {
      candidates: [],
      diagnostics,
      latencyMs: performance.now() - started
    };
  }

  const db = createSqliteConnection(params.databasePath);
  try {
    ensureNotAborted(params.signal);
    const scopeFilter = buildScopeDocumentFilter(scope, "d");
    const eligibleRow = db
      .prepare(
        `
          SELECT COUNT(*) as count
          FROM knowledge_chunks kc
          JOIN documents d ON d.document_id = kc.document_id
          WHERE d.tombstoned_at IS NULL
            AND kc.tombstoned_at IS NULL
            AND d.parse_status != 'failed'
            AND ${scopeFilter.sql}
        `
      )
      .get(...scopeFilter.params) as { count: number };
    diagnostics.eligiblePopulation = eligibleRow.count;

    const dedup = new Map<string, RetrievalCandidate>();

    for (const attempt of diagnostics.attempted) {
      ensureNotAborted(params.signal);
      const normalizedValue = normalizeToken(attempt.directiveValue);
      const phrase = tokenizeForMatch(attempt.directiveValue).join(" ");
      if (!normalizedValue) {
        continue;
      }

      const allowWeakSubstring =
        attempt.directiveType === "entity" ||
        (attempt.directiveType === "policy" && !isCanonicalLikePolicy(attempt.directiveValue));
      const sql = buildExactQuerySql({
        scopeSql: scopeFilter.sql,
        allowWeakSubstring
      });

      const rows = db.prepare(sql).all(
        normalizedValue,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        phrase || normalizedValue,
        ...scopeFilter.params,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        phrase || normalizedValue,
        ...(allowWeakSubstring ? [phrase || normalizedValue] : []),
        normalizedValue,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        normalizedValue,
        phrase || normalizedValue,
        // orderChunkPredicate (unlike whereChunkPredicate) always contains
        // exactly one placeholder regardless of allowWeakSubstring — both of
        // its branches emit a `?` (only the THEN rank differs) — so this
        // final param is unconditional, not gated a second time.
        phrase || normalizedValue,
        MAX_EXACT_CANDIDATES
      ) as ExactRow[];

      attempt.matchedCount = rows.length;
      if (attempt.required && rows.length === 0) {
        diagnostics.missedRequired.push(attempt);
      }

      mergeRowsIntoDedup({ rows, attempt, dedup, scope, signal: params.signal });

      // The row LIMIT above is filled in matched_field rank order, so a
      // directive with many generic-admin heading matches can exhaust the
      // limit before any canonical PowerShell body-text match is returned.
      // When PowerShell is the requested method, run a small supplemental
      // query scoped to ms-teams-powershell only, so the requested output's
      // canonical cmdlet evidence still gets a chance to enter the pool.
      const powershellEligible = scope.eligibleSources.some(
        (source) => source.sourceId === POWERSHELL_RESERVED_SOURCE_ID
      );
      if (allowWeakSubstring && powershellEligible && requestsPowerShellMethod(scope.intent)) {
        const reservedSql = buildExactQuerySql({
          scopeSql: `${scopeFilter.sql} AND d.source_id = ?`,
          allowWeakSubstring
        });
        const reservedRows = db.prepare(reservedSql).all(
          normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          phrase || normalizedValue,
          ...scopeFilter.params,
          POWERSHELL_RESERVED_SOURCE_ID,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          phrase || normalizedValue,
          phrase || normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          normalizedValue,
          phrase || normalizedValue,
          phrase || normalizedValue,
          POWERSHELL_RESERVED_SLOTS_PER_DIRECTIVE
        ) as ExactRow[];
        mergeRowsIntoDedup({ rows: reservedRows, attempt, dedup, scope, signal: params.signal });
      }
    }

    const ordered = [...dedup.values()].sort((left, right) => {
      const leftScore = left.scores.exactMatch ?? 0;
      const rightScore = right.scores.exactMatch ?? 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.chunkId.localeCompare(right.chunkId);
    });

    diagnostics.matchedPopulation = ordered.length;
    const outputCap = Math.min(MAX_EXACT_CANDIDATES, scope.candidateBudget.maxLexicalCandidates);
    const powershellEligibleForOutput = scope.eligibleSources.some(
      (source) => source.sourceId === POWERSHELL_RESERVED_SOURCE_ID
    );
    let returned: RetrievalCandidate[];
    if (powershellEligibleForOutput && requestsPowerShellMethod(scope.intent)) {
      // The overall top-N cut is dominated by score, and generic admin docs
      // routinely out-score narrow PowerShell body-text matches even after
      // the per-directive reservation above. Reserve a slice of the final
      // output too, so canonical PowerShell evidence reaches downstream
      // aspect/fusion scoring instead of being trimmed here on raw score.
      const reservedCount = Math.min(POWERSHELL_RESERVED_SLOTS_PER_DIRECTIVE, outputCap);
      const reservedPowershell = ordered
        .filter((candidate) => candidate.authority.sourceId === POWERSHELL_RESERVED_SOURCE_ID)
        .slice(0, reservedCount);
      const reservedIds = new Set(reservedPowershell.map((candidate) => candidate.chunkId));
      const remainder = ordered
        .filter((candidate) => !reservedIds.has(candidate.chunkId))
        .slice(0, Math.max(0, outputCap - reservedPowershell.length));
      returned = [...reservedPowershell, ...remainder].sort((left, right) => {
        const leftScore = left.scores.exactMatch ?? 0;
        const rightScore = right.scores.exactMatch ?? 0;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return left.chunkId.localeCompare(right.chunkId);
      });
    } else {
      returned = ordered.slice(0, outputCap);
    }
    diagnostics.returnedPopulation = returned.length;
    return {
      candidates: returned,
      diagnostics,
      latencyMs: performance.now() - started
    };
  } finally {
    db.close();
  }
}

