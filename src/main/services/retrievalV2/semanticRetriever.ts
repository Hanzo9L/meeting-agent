import { performance } from "node:perf_hooks";
import {
  resolveEmbeddingRuntimeConfig,
  type EmbeddingProvider,
  type EmbeddingResult,
  type EmbeddingRuntimeConfig
} from "../knowledgeV2";
import type { RetrievalScope } from "./domainRouter";
import type { RetrievalCandidate } from "./retrievalCandidates";
import {
  buildAuthorityContext,
  buildProvenance,
  buildScopeDocumentFilter,
  createSqliteConnection,
  makeCandidateId,
  type ScopedCandidateRow
} from "./retrievalSqliteCommon";
import {
  cmdletOperationPrefixes,
  extractObjectKeys,
  isCanonicalCmdletDocument,
  isCmdletDiscoveryQuestion,
  isImplicitCmdletIntent,
  objectAligned,
  operationPrefixAligned
} from "./implicitCmdletSignals";
import {
  scoreSemanticVectors,
  type DecodedSemanticVectorRow
} from "./semanticScorer";
import { buildSafeLexicalQueryForScope } from "./lexicalRetriever";

type SemanticPreselectionReason =
  | "entity_title_shortlist"
  | "powershell_cmdlet_specificity_shortlist"
  | "lexical_shortlist"
  | "powershell_operation_shortlist"
  | "scope_reserve";

interface PreselectedChunkRow extends ScopedCandidateRow {
  source_order: number;
  content_hash: string;
  preselection_reason: SemanticPreselectionReason;
}

interface EmbeddingMetadataRow {
  chunk_id: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_schema_version: string;
  input_content_hash: string;
}

interface EmbeddingBlobRow {
  chunk_id: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_schema_version: string;
  input_content_hash: string;
  vector_blob: Uint8Array;
}

interface CompatibleChunk {
  row: PreselectedChunkRow;
  expectedInputHash: string;
}

export interface SemanticRetrievalDiagnostics {
  eligiblePopulation: number;
  preselectedPopulation: number;
  compatibleEmbeddingPopulation: number;
  missingEmbeddingCount: number;
  staleOrIncompatibleEmbeddingCount: number;
  corruptEmbeddingCount: number;
  scoredPopulation: number;
  returnedPopulation: number;
  configuredSemanticBudget: number;
  prefilteredByBudget: boolean;
  latencyMs: {
    queryEmbedding: number;
    sqlPreselection: number;
    sqlEmbeddingMetadata: number;
    sqlEmbeddingBlobFetch: number;
    compatibilityCheck: number;
    sqliteFetch: number;
    decode: number;
    scoring: number;
    topK: number;
    total: number;
  };
  embeddingIdentity: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
  };
  preselectionReasonCounts: Record<SemanticPreselectionReason, number>;
  warnings: string[];
}

export interface SemanticRetrievalResult {
  candidates: RetrievalCandidate[];
  diagnostics: SemanticRetrievalDiagnostics;
}

export class SemanticRetrievalAbortedError extends Error {
  constructor() {
    super("semantic_retrieval_aborted");
    this.name = "SemanticRetrievalAbortedError";
  }
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SemanticRetrievalAbortedError();
  }
}

function buildOrderedScopePairs(scope: RetrievalScope): Array<{ sourceId: string; trackId: string }> {
  const pairs: Array<{ sourceId: string; trackId: string }> = [];
  for (const source of scope.eligibleSources) {
    for (const trackId of source.eligibleTrackIds) {
      pairs.push({ sourceId: source.sourceId, trackId });
    }
  }
  return pairs;
}

function buildPairOrderSql(
  pairs: Array<{ sourceId: string; trackId: string }>
): { sql: string; params: string[] } {
  if (pairs.length === 0) {
    return { sql: "0", params: [] };
  }
  const cases: string[] = [];
  const params: string[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (!pair) continue;
    cases.push(`WHEN d.source_id = ? AND d.track_id = ? THEN ${index}`);
    params.push(pair.sourceId, pair.trackId);
  }
  return {
    sql: `CASE ${cases.join(" ")} ELSE ${pairs.length + 1000} END`,
    params
  };
}

function groupByChunk(rows: EmbeddingMetadataRow[]): Map<string, EmbeddingMetadataRow[]> {
  const grouped = new Map<string, EmbeddingMetadataRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.chunk_id) ?? [];
    current.push(row);
    grouped.set(row.chunk_id, current);
  }
  return grouped;
}

function summarizeCompatibleChunks(params: {
  rows: PreselectedChunkRow[];
  embeddingRows: EmbeddingMetadataRow[];
  identity: {
    providerId: string;
    model: string;
    dimensions: number;
    embeddingSchemaVersion: string;
  };
}): {
  compatible: CompatibleChunk[];
  missingEmbeddingCount: number;
  staleOrIncompatibleEmbeddingCount: number;
} {
  const grouped = groupByChunk(params.embeddingRows);
  const compatible: CompatibleChunk[] = [];
  let missingEmbeddingCount = 0;
  let staleOrIncompatibleEmbeddingCount = 0;

  for (const row of params.rows) {
    const embeddings = grouped.get(row.chunk_id) ?? [];
    if (embeddings.length === 0) {
      missingEmbeddingCount += 1;
      continue;
    }
    const expectedInputHash = row.content_hash;
    const providerMatches = embeddings.filter(
      (item) => item.embedding_provider === params.identity.providerId
    );
    const modelMatches = providerMatches.filter(
      (item) => item.embedding_model === params.identity.model
    );
    const schemaMatches = modelMatches.filter(
      (item) => item.embedding_schema_version === params.identity.embeddingSchemaVersion
    );
    const dimensionMatches = schemaMatches.filter(
      (item) => item.embedding_dimensions === params.identity.dimensions
    );
    const hashMatches = dimensionMatches.filter(
      (item) => item.input_content_hash === expectedInputHash
    );

    if (hashMatches.length > 0) {
      compatible.push({
        row,
        expectedInputHash
      });
      continue;
    }

    staleOrIncompatibleEmbeddingCount += 1;
  }

  return {
    compatible,
    missingEmbeddingCount,
    staleOrIncompatibleEmbeddingCount
  };
}

function toSemanticCandidate(params: {
  scope: RetrievalScope;
  row: PreselectedChunkRow;
  score: number;
  rank: number;
}): RetrievalCandidate {
  const provenance = buildProvenance(params.row);
  return {
    candidateId: makeCandidateId([
      "semantic",
      params.row.chunk_id,
      params.score.toFixed(8),
      String(params.rank)
    ]),
    method: "semantic",
    documentId: params.row.document_id,
    chunkId: params.row.chunk_id,
    sectionId: params.row.section_id,
    headingPath: provenance.headingPath,
    title: params.row.title ?? "(untitled)",
    text: params.row.chunk_text,
    authority: buildAuthorityContext(params.scope, params.row),
    provenance,
    scores: {
      lexical: null,
      exactMatch: null,
      semanticSimilarity: params.score
    },
    semanticRank: params.rank,
    retrievalReasons: [
      `semantic_preselection:${params.row.preselection_reason}`,
      "semantic_similarity",
      `semantic_rank:${params.rank}`
    ]
  };
}

function scopedSelectSql(scopeSql: string, pairOrderSql: string): string {
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
        kc.content_hash,
        kc.source_order
      FROM knowledge_chunks kc
      JOIN documents d ON d.document_id = kc.document_id
      JOIN document_contents dc ON dc.document_id = d.document_id
      WHERE d.tombstoned_at IS NULL
        AND kc.tombstoned_at IS NULL
        AND d.parse_status != 'failed'
        AND ${scopeSql}
      ORDER BY ${pairOrderSql}, kc.source_order ASC, kc.chunk_id ASC
  `;
}

function buildEntityTerms(scope: RetrievalScope): string[] {
  const generic = new Set([
    "policy",
    "policies",
    "voice",
    "routing",
    "meeting",
    "calling",
    "user",
    "users",
    "settings",
    "configuration",
    "report",
    "reports"
  ]);
  const raw = [
    ...(scope.intent.commandNames ?? []),
    ...(scope.intent.policyNames ?? []),
    ...scope.intent.entities,
    ...scope.focusSubdomains.map((value) => value.replace(/_/g, " "))
  ];
  return [...new Set(raw.map((value) => value.trim().toLowerCase()))].filter(
    (value) => value.length >= 4 && !generic.has(value)
  );
}

function fetchEntityTitleRows(params: {
  db: ReturnType<typeof createSqliteConnection>;
  scopeSql: string;
  scopeParams: string[];
  pairOrderSql: string;
  pairOrderParams: string[];
  entityTerms: string[];
  limit: number;
}): PreselectedChunkRow[] {
  if (params.entityTerms.length === 0 || params.limit <= 0) return [];
  const termClauses: string[] = [];
  const termParams: string[] = [];
  for (const term of params.entityTerms) {
    termClauses.push(
      `(lower(COALESCE(d.title, '')) = ? OR instr(lower(kc.heading_path_json), ?) > 0 OR lower(kc.section_id) = ? OR EXISTS (SELECT 1 FROM chunk_entities ce WHERE ce.chunk_id = kc.chunk_id AND lower(ce.entity_value) = ?))`
    );
    termParams.push(term, term, term, term);
  }
  const rows = params.db
    .prepare(
      `
      ${scopedSelectSql(params.scopeSql, params.pairOrderSql).replace(
        "ORDER BY",
        `AND (${termClauses.join(" OR ")}) ORDER BY`
      )}
      LIMIT ?
    `
    )
    .all(
      ...params.scopeParams,
      ...termParams,
      ...params.pairOrderParams,
      params.limit
    ) as Array<Omit<PreselectedChunkRow, "preselection_reason">>;
  return rows.map((row) => ({
    ...row,
    preselection_reason: "entity_title_shortlist"
  }));
}

function fetchLexicalRows(params: {
  db: ReturnType<typeof createSqliteConnection>;
  scopeSql: string;
  scopeParams: string[];
  lexicalQuery: string;
  limit: number;
}): PreselectedChunkRow[] {
  if (!params.lexicalQuery || params.limit <= 0) return [];
  const rows = params.db
    .prepare(
      `
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
        kc.content_hash,
        kc.source_order
      FROM knowledge_chunk_fts
      JOIN knowledge_chunks kc ON kc.chunk_id = knowledge_chunk_fts.chunk_id
      JOIN documents d ON d.document_id = kc.document_id
      JOIN document_contents dc ON dc.document_id = d.document_id
      WHERE d.tombstoned_at IS NULL
        AND kc.tombstoned_at IS NULL
        AND d.parse_status != 'failed'
        AND ${params.scopeSql}
        AND knowledge_chunk_fts MATCH ?
      ORDER BY bm25(knowledge_chunk_fts) ASC, kc.source_order ASC, kc.chunk_id ASC
      LIMIT ?
    `
    )
    .all(...params.scopeParams, params.lexicalQuery, params.limit) as Array<
    Omit<PreselectedChunkRow, "preselection_reason">
  >;
  return rows.map((row) => ({
    ...row,
    preselection_reason: "lexical_shortlist"
  }));
}

function fetchPowerShellOperationRows(params: {
  db: ReturnType<typeof createSqliteConnection>;
  scopeSql: string;
  scopeParams: string[];
  pairOrderSql: string;
  pairOrderParams: string[];
  cmdletPrefixes: string[];
  limit: number;
}): PreselectedChunkRow[] {
  if (params.limit <= 0 || params.cmdletPrefixes.length === 0) return [];
  const titleClauses = params.cmdletPrefixes.map(() => "lower(COALESCE(d.title, '')) LIKE ?");
  const titleParams = params.cmdletPrefixes.map((prefix) => `${prefix}%`);
  const rows = params.db
    .prepare(
      `
      ${scopedSelectSql(params.scopeSql, params.pairOrderSql).replace(
        "ORDER BY",
        `AND d.source_id = 'ms-teams-powershell' AND (${titleClauses.join(" OR ")}) ORDER BY`
      )}
      LIMIT ?
    `
    )
    .all(
      ...params.scopeParams,
      ...titleParams,
      ...params.pairOrderParams,
      params.limit
    ) as Array<Omit<PreselectedChunkRow, "preselection_reason">>;
  return rows.map((row) => ({
    ...row,
    preselection_reason: "powershell_operation_shortlist"
  }));
}

function fetchPowerShellSpecificCmdletRows(params: {
  db: ReturnType<typeof createSqliteConnection>;
  scopeSql: string;
  scopeParams: string[];
  pairOrderSql: string;
  pairOrderParams: string[];
  scope: RetrievalScope;
  limit: number;
}): PreselectedChunkRow[] {
  if (params.limit <= 0 || !isImplicitCmdletIntent(params.scope.intent)) return [];
  const prefixes = cmdletOperationPrefixes(params.scope.intent);
  const objectKeys = extractObjectKeys(params.scope.intent);
  if (prefixes.length === 0 || objectKeys.length === 0) return [];
  const rows = params.db
    .prepare(
      `
      ${scopedSelectSql(params.scopeSql, params.pairOrderSql)}
      LIMIT ?
    `
    )
    .all(
      ...params.scopeParams,
      ...params.pairOrderParams,
      Math.max(params.limit * 3, params.limit)
    ) as Array<Omit<PreselectedChunkRow, "preselection_reason">>;
  const shortlisted = rows
    .filter((row) => {
      const title = row.title ?? "";
      const url = row.canonical_url ?? "";
      return (
        row.source_id === "ms-teams-powershell" &&
        isCanonicalCmdletDocument(title, url) &&
        operationPrefixAligned(prefixes, title, url) &&
        objectAligned(objectKeys, title, url)
      );
    })
    .slice(0, params.limit)
    .map((row) => ({
      ...row,
      preselection_reason: "powershell_cmdlet_specificity_shortlist" as const
    }));
  return shortlisted;
}

function fetchReserveRows(params: {
  db: ReturnType<typeof createSqliteConnection>;
  scopeSql: string;
  scopeParams: string[];
  pairOrderSql: string;
  pairOrderParams: string[];
  limit: number;
}): PreselectedChunkRow[] {
  if (params.limit <= 0) return [];
  const rows = params.db
    .prepare(
      `
      ${scopedSelectSql(params.scopeSql, params.pairOrderSql)}
      LIMIT ?
    `
    )
    .all(...params.scopeParams, ...params.pairOrderParams, params.limit) as Array<
    Omit<PreselectedChunkRow, "preselection_reason">
  >;
  return rows.map((row) => ({
    ...row,
    preselection_reason: "scope_reserve"
  }));
}

function composePreselectionPool(params: {
  scope: RetrievalScope;
  budget: number;
  entityRows: PreselectedChunkRow[];
  powershellSpecificRows: PreselectedChunkRow[];
  lexicalRows: PreselectedChunkRow[];
  powershellRows: PreselectedChunkRow[];
  reserveRows: PreselectedChunkRow[];
}): {
  rows: PreselectedChunkRow[];
  reasonCounts: Record<SemanticPreselectionReason, number>;
} {
  const selected = new Map<string, PreselectedChunkRow>();
  const reasonCounts: Record<SemanticPreselectionReason, number> = {
    entity_title_shortlist: 0,
    powershell_cmdlet_specificity_shortlist: 0,
    lexical_shortlist: 0,
    powershell_operation_shortlist: 0,
    scope_reserve: 0
  };
  const cmdletSpecificCap = Math.min(
    params.budget,
    isCmdletDiscoveryQuestion(params.scope.intent) ? Math.max(0, Math.floor(params.budget * 0.15)) : 0
  );
  const entityCap = Math.min(
    params.budget - cmdletSpecificCap,
    Math.max(0, Math.floor(params.budget * 0.25))
  );
  const lexicalCap = Math.min(
    params.budget - cmdletSpecificCap - entityCap,
    Math.max(0, Math.floor(params.budget * 0.45))
  );
  const powershellCap = Math.min(
    params.budget - cmdletSpecificCap - entityCap - lexicalCap,
    Math.max(0, Math.floor(params.budget * 0.2))
  );

  const take = (rows: PreselectedChunkRow[], cap: number): void => {
    for (const row of rows) {
      if (selected.size >= params.budget) return;
      if (cap >= 0 && reasonCounts[row.preselection_reason] >= cap) continue;
      if (selected.has(row.chunk_id)) continue;
      selected.set(row.chunk_id, row);
      reasonCounts[row.preselection_reason] += 1;
    }
  };

  take(params.powershellSpecificRows, cmdletSpecificCap);
  take(params.entityRows, entityCap);
  take(params.lexicalRows, lexicalCap);
  take(params.powershellRows, powershellCap);
  take(params.reserveRows, -1);
  return {
    rows: [...selected.values()].slice(0, params.budget),
    reasonCounts
  };
}

function defaultEmbeddingIdentity(providerId: string): SemanticRetrievalDiagnostics["embeddingIdentity"] {
  const runtime = resolveEmbeddingRuntimeConfig();
  return {
    providerId,
    model: runtime.model,
    dimensions: 0,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion
  };
}

export async function retrieveSemanticCandidates(params: {
  databasePath: string;
  scope: RetrievalScope;
  embeddingProvider: EmbeddingProvider;
  embeddingRuntimeConfig?: Pick<EmbeddingRuntimeConfig, "model" | "embeddingSchemaVersion">;
  signal?: AbortSignal;
}): Promise<SemanticRetrievalResult> {
  const started = performance.now();
  ensureNotAborted(params.signal);

  const runtime = params.embeddingRuntimeConfig ?? resolveEmbeddingRuntimeConfig();
  const defaultDiagnostics: SemanticRetrievalDiagnostics = {
    eligiblePopulation: 0,
    preselectedPopulation: 0,
    compatibleEmbeddingPopulation: 0,
    missingEmbeddingCount: 0,
    staleOrIncompatibleEmbeddingCount: 0,
    corruptEmbeddingCount: 0,
    scoredPopulation: 0,
    returnedPopulation: 0,
    configuredSemanticBudget: params.scope.candidateBudget.maxSemanticCandidates,
    prefilteredByBudget: false,
    latencyMs: {
      queryEmbedding: 0,
      sqlPreselection: 0,
      sqlEmbeddingMetadata: 0,
      sqlEmbeddingBlobFetch: 0,
      compatibilityCheck: 0,
      sqliteFetch: 0,
      decode: 0,
      scoring: 0,
      topK: 0,
      total: 0
    },
    embeddingIdentity: defaultEmbeddingIdentity(params.embeddingProvider.providerId),
    preselectionReasonCounts: {
      entity_title_shortlist: 0,
      powershell_cmdlet_specificity_shortlist: 0,
      lexical_shortlist: 0,
      powershell_operation_shortlist: 0,
      scope_reserve: 0
    },
    warnings: []
  };

  if (!params.scope.strategy.semantic) {
    defaultDiagnostics.warnings.push("semantic_strategy_disabled_by_scope");
    defaultDiagnostics.latencyMs.total = performance.now() - started;
    return {
      candidates: [],
      diagnostics: defaultDiagnostics
    };
  }

  let queryEmbedding: EmbeddingResult;
  const queryEmbeddingStarted = performance.now();
  try {
    queryEmbedding = await params.embeddingProvider.embedQuery(
      {
        id: "semantic-query",
        text: params.scope.intent.originalQuestion
      },
      {
        model: runtime.model,
        embeddingSchemaVersion: runtime.embeddingSchemaVersion,
        signal: params.signal
      }
    );
  } catch (error) {
    if (params.signal?.aborted || (error instanceof Error && /aborted/i.test(error.message))) {
      throw new SemanticRetrievalAbortedError();
    }
    throw error;
  }
  ensureNotAborted(params.signal);
  defaultDiagnostics.latencyMs.queryEmbedding = performance.now() - queryEmbeddingStarted;
  defaultDiagnostics.embeddingIdentity = {
    providerId: queryEmbedding.providerId,
    model: queryEmbedding.model,
    dimensions: queryEmbedding.dimensions,
    embeddingSchemaVersion: queryEmbedding.embeddingSchemaVersion
  };

  const scopePairs = buildOrderedScopePairs(params.scope);
  const pairOrder = buildPairOrderSql(scopePairs);
  const db = createSqliteConnection(params.databasePath);
  try {
    const scopeFilter = buildScopeDocumentFilter(params.scope, "d");
    const sqlPreselectionStarted = performance.now();
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
    defaultDiagnostics.eligiblePopulation = eligibleRow.count;
    defaultDiagnostics.prefilteredByBudget =
      defaultDiagnostics.eligiblePopulation > params.scope.candidateBudget.maxSemanticCandidates;

    const lexicalQuery = buildSafeLexicalQueryForScope(params.scope).query;
    const entityRows = fetchEntityTitleRows({
      db,
      scopeSql: scopeFilter.sql,
      scopeParams: scopeFilter.params,
      pairOrderSql: pairOrder.sql,
      pairOrderParams: pairOrder.params,
      entityTerms: buildEntityTerms(params.scope),
      limit: params.scope.candidateBudget.maxSemanticCandidates
    });
    const powershellSpecificRows = fetchPowerShellSpecificCmdletRows({
      db,
      scopeSql: scopeFilter.sql,
      scopeParams: scopeFilter.params,
      pairOrderSql: pairOrder.sql,
      pairOrderParams: pairOrder.params,
      scope: params.scope,
      limit: params.scope.candidateBudget.maxSemanticCandidates
    });
    const lexicalRows = fetchLexicalRows({
      db,
      scopeSql: scopeFilter.sql,
      scopeParams: scopeFilter.params,
      lexicalQuery,
      limit: params.scope.candidateBudget.maxSemanticCandidates
    });
    const powershellRows = fetchPowerShellOperationRows({
      db,
      scopeSql: scopeFilter.sql,
      scopeParams: scopeFilter.params,
      pairOrderSql: pairOrder.sql,
      pairOrderParams: pairOrder.params,
      cmdletPrefixes: cmdletOperationPrefixes(params.scope.intent),
      limit: params.scope.candidateBudget.maxSemanticCandidates
    });
    const reserveRows = fetchReserveRows({
      db,
      scopeSql: scopeFilter.sql,
      scopeParams: scopeFilter.params,
      pairOrderSql: pairOrder.sql,
      pairOrderParams: pairOrder.params,
      limit: params.scope.candidateBudget.maxSemanticCandidates
    });
    const pool = composePreselectionPool({
      budget: params.scope.candidateBudget.maxSemanticCandidates,
      scope: params.scope,
      entityRows,
      powershellSpecificRows,
      lexicalRows,
      powershellRows,
      reserveRows
    });
    const preselectedRows = pool.rows;
    defaultDiagnostics.latencyMs.sqlPreselection =
      performance.now() - sqlPreselectionStarted;

    defaultDiagnostics.preselectedPopulation = preselectedRows.length;
    defaultDiagnostics.preselectionReasonCounts = pool.reasonCounts;

    if (preselectedRows.length === 0) {
      defaultDiagnostics.latencyMs.sqliteFetch = defaultDiagnostics.latencyMs.sqlPreselection;
      defaultDiagnostics.latencyMs.total = performance.now() - started;
      return {
        candidates: [],
        diagnostics: defaultDiagnostics
      };
    }

    const chunkIds = preselectedRows.map((row) => row.chunk_id);
    const placeholders = chunkIds.map(() => "?").join(",");
    const sqlMetadataStarted = performance.now();
    const metadataRows = db
      .prepare(
        `
          SELECT
            chunk_id,
            embedding_provider,
            embedding_model,
            embedding_dimensions,
            embedding_schema_version,
            input_content_hash
          FROM chunk_embeddings
          WHERE chunk_id IN (${placeholders})
        `
      )
      .all(...chunkIds) as EmbeddingMetadataRow[];
    defaultDiagnostics.latencyMs.sqlEmbeddingMetadata =
      performance.now() - sqlMetadataStarted;

    const compatibilityStarted = performance.now();
    const compatibility = summarizeCompatibleChunks({
      rows: preselectedRows,
      embeddingRows: metadataRows,
      identity: defaultDiagnostics.embeddingIdentity
    });
    defaultDiagnostics.latencyMs.compatibilityCheck =
      performance.now() - compatibilityStarted;
    defaultDiagnostics.compatibleEmbeddingPopulation = compatibility.compatible.length;
    defaultDiagnostics.missingEmbeddingCount = compatibility.missingEmbeddingCount;
    defaultDiagnostics.staleOrIncompatibleEmbeddingCount =
      compatibility.staleOrIncompatibleEmbeddingCount;

    if (compatibility.compatible.length === 0) {
      defaultDiagnostics.latencyMs.sqliteFetch =
        defaultDiagnostics.latencyMs.sqlPreselection +
        defaultDiagnostics.latencyMs.sqlEmbeddingMetadata;
      defaultDiagnostics.latencyMs.total = performance.now() - started;
      return {
        candidates: [],
        diagnostics: defaultDiagnostics
      };
    }

    const compatibleChunkIds = compatibility.compatible.map((item) => item.row.chunk_id);
    const compatiblePlaceholders = compatibleChunkIds.map(() => "?").join(",");
    const sqlBlobStarted = performance.now();
    const blobRows = db
      .prepare(
        `
          SELECT
            chunk_id,
            embedding_provider,
            embedding_model,
            embedding_dimensions,
            embedding_schema_version,
            input_content_hash,
            vector_blob
          FROM chunk_embeddings
          WHERE chunk_id IN (${compatiblePlaceholders})
            AND embedding_provider = ?
            AND embedding_model = ?
            AND embedding_schema_version = ?
            AND embedding_dimensions = ?
        `
      )
      .all(
        ...compatibleChunkIds,
        defaultDiagnostics.embeddingIdentity.providerId,
        defaultDiagnostics.embeddingIdentity.model,
        defaultDiagnostics.embeddingIdentity.embeddingSchemaVersion,
        defaultDiagnostics.embeddingIdentity.dimensions
      ) as EmbeddingBlobRow[];
    defaultDiagnostics.latencyMs.sqlEmbeddingBlobFetch =
      performance.now() - sqlBlobStarted;
    defaultDiagnostics.latencyMs.sqliteFetch =
      defaultDiagnostics.latencyMs.sqlPreselection +
      defaultDiagnostics.latencyMs.sqlEmbeddingMetadata +
      defaultDiagnostics.latencyMs.sqlEmbeddingBlobFetch;
    ensureNotAborted(params.signal);

    const blobLookup = new Map<string, EmbeddingBlobRow>();
    for (const row of blobRows) {
      blobLookup.set(`${row.chunk_id}:${row.input_content_hash}`, row);
    }

    const scoreRows: DecodedSemanticVectorRow<PreselectedChunkRow>[] = [];
    for (const candidate of compatibility.compatible) {
      const blob = blobLookup.get(`${candidate.row.chunk_id}:${candidate.expectedInputHash}`);
      if (!blob) {
        defaultDiagnostics.staleOrIncompatibleEmbeddingCount += 1;
        defaultDiagnostics.compatibleEmbeddingPopulation -= 1;
        continue;
      }
      scoreRows.push({
        id: candidate.row.chunk_id,
        // better-sqlite3 returns Buffer (Uint8Array subtype); avoid per-row blob copy.
        vectorBlob: blob.vector_blob as Uint8Array,
        dimensions: blob.embedding_dimensions,
        meta: candidate.row
      });
    }

    const scoring = scoreSemanticVectors({
      queryVector: queryEmbedding.vector,
      rows: scoreRows,
      topK: params.scope.candidateBudget.maxSemanticCandidates
    });
    defaultDiagnostics.corruptEmbeddingCount = scoring.corruptCount;
    defaultDiagnostics.scoredPopulation = scoring.scored.length;
    defaultDiagnostics.returnedPopulation = scoring.topK.length;
    defaultDiagnostics.latencyMs.decode = scoring.decodeLatencyMs;
    defaultDiagnostics.latencyMs.scoring = scoring.scoringLatencyMs;
    defaultDiagnostics.latencyMs.topK = scoring.topKLatencyMs;

    const candidates = scoring.topK.map((item, index) =>
      toSemanticCandidate({
        scope: params.scope,
        row: item.meta,
        score: item.score,
        rank: index + 1
      })
    );

    if (defaultDiagnostics.eligiblePopulation >= 10000) {
      defaultDiagnostics.warnings.push(
        "semantic_eligible_population_approaches_whole_corpus_scan_risk"
      );
    } else if (defaultDiagnostics.eligiblePopulation >= 5000) {
      defaultDiagnostics.warnings.push("semantic_eligible_population_above_preferred_target");
    }

    defaultDiagnostics.latencyMs.total = performance.now() - started;
    return {
      candidates,
      diagnostics: defaultDiagnostics
    };
  } finally {
    db.close();
  }
}

