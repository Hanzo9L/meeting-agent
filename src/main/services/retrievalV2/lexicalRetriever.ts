import { performance } from "node:perf_hooks";
import type { RetrievalScope } from "./domainRouter";
import type { LexicalDiagnostics, RetrievalCandidate } from "./retrievalCandidates";
import {
  buildAuthorityContext,
  buildProvenance,
  buildScopeDocumentFilter,
  createSqliteConnection,
  makeCandidateId,
  tokenizeForMatch,
  type ScopedCandidateRow
} from "./retrievalSqliteCommon";
import { ensureNotAborted } from "./retrievalAbort";
import {
  cmdletOperationPrefixes,
  extractObjectKeys,
  isCanonicalCmdletDocument,
  isCmdletDiscoveryQuestion,
  isModuleIndexDocument,
  isImplicitCmdletIntent,
  objectAligned,
  operationPrefixAligned
} from "./implicitCmdletSignals";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "what",
  "does",
  "how",
  "why",
  "when",
  "where",
  "your",
  "their",
  "still",
  "work"
]);

const MAX_QUERY_TERMS = 18;
const MAX_TERM_LENGTH = 64;

interface LexicalRow extends ScopedCandidateRow {
  lexical_score: number;
}

interface RankedLexicalRow extends LexicalRow {
  lexical_adjusted_score: number;
  concept_hits: number;
  powershell_operation_hit: boolean;
  implicit_cmdlet_specificity_hit: boolean;
  module_index_penalty_hit: boolean;
}

export interface LexicalRetrievalResult {
  candidates: RetrievalCandidate[];
  diagnostics: LexicalDiagnostics;
  latencyMs: number;
}

function escapeFtsToken(token: string): string {
  return token.replace(/"/g, "").trim();
}

function buildLexicalQuery(scope: RetrievalScope): { query: string; queryTerms: string[] } {
  const terms: string[] = [];
  const addTerm = (value: string) => {
    const normalized = tokenizeForMatch(value)
      .filter((token) => token.length > 1 && token.length <= MAX_TERM_LENGTH)
      .join(" ");
    if (!normalized) return;
    terms.push(normalized);
  };

  for (const cmdlet of scope.intent.commandNames ?? []) addTerm(cmdlet);
  for (const policy of scope.intent.policyNames ?? []) addTerm(policy);
  for (const entity of scope.intent.entities) addTerm(entity);
  for (const hint of scope.focusSubdomains) addTerm(hint.replaceAll("_", " "));
  for (const hint of buildOperationLexicalHints(scope)) addTerm(hint);

  const normalizedQuestionTokens = tokenizeForMatch(scope.intent.normalizedQuestion).filter(
    (token) => token.length > 2 && !STOPWORDS.has(token)
  );
  for (const token of normalizedQuestionTokens) terms.push(token);

  const dedup = [...new Set(terms)].slice(0, MAX_QUERY_TERMS);
  if (dedup.length === 0) {
    return { query: "", queryTerms: [] };
  }

  const clauses = dedup.map((term) => {
    const escaped = escapeFtsToken(term);
    if (/^[a-z0-9]+$/i.test(escaped)) return escaped;
    return `"${escaped}"`;
  });
  return {
    queryTerms: dedup,
    query: clauses.join(" OR ")
  };
}

function buildOperationLexicalHints(scope: RetrievalScope): string[] {
  const hasExplicitCmdlet = (scope.intent.commandNames ?? []).length > 0;
  if (hasExplicitCmdlet) return [];
  const ops = new Set(scope.intent.operationIntents ?? []);
  const hasCmdletSignal =
    scope.intent.normalizedQuestion.includes("which cmdlet") ||
    scope.intent.normalizedQuestion.includes("powershell command") ||
    scope.intent.normalizedQuestion.includes("powershell cmdlet") ||
    scope.intent.normalizedQuestion.includes("which command");
  const hasPowerShell = scope.intent.normalizedQuestion.includes("powershell");
  if (!(hasCmdletSignal || hasPowerShell)) return [];
  const hints: string[] = [];
  if (ops.has("grant")) hints.push("grant cs");
  if (ops.has("set")) hints.push("set cs");
  if (ops.has("get")) hints.push("get cs");
  if (ops.has("remove")) hints.push("remove cs");
  if (ops.has("new")) hints.push("new cs");
  if (ops.has("enable")) hints.push("enable cs", "disable cs");
  if (ops.has("test")) hints.push("test cs");
  return hints;
}

function buildTechnicalConcepts(scope: RetrievalScope): string[][] {
  const terms = [
    ...(scope.intent.entities ?? []),
    ...(scope.intent.policyNames ?? [])
  ].map((value) => value.toLowerCase());
  const concepts = new Set<string>();
  for (const value of terms) {
    if (!value.includes(" ")) continue;
    if (value.length < 8) continue;
    concepts.add(value.replace(/\s+/g, " ").trim());
  }
  return [...concepts].map((concept) => tokenizeForMatch(concept)).filter((tokens) => tokens.length >= 2);
}

function rankLexicalRows(scope: RetrievalScope, rows: LexicalRow[]): RankedLexicalRow[] {
  const concepts = buildTechnicalConcepts(scope);
  const prefixes = cmdletOperationPrefixes(scope.intent);
  const objectKeys = extractObjectKeys(scope.intent);
  const implicitCmdlet = isImplicitCmdletIntent(scope.intent);
  const cmdletDiscovery = isCmdletDiscoveryQuestion(scope.intent);
  const cmdletIntent =
    scope.intent.normalizedQuestion.includes("which cmdlet") ||
    scope.intent.normalizedQuestion.includes("powershell command") ||
    scope.intent.normalizedQuestion.includes("powershell cmdlet");
  const ranked = rows.map((row) => {
    const searchable = `${row.title ?? ""} ${row.heading_path_json ?? ""}`.toLowerCase();
    const conceptHits = concepts.reduce((count, tokens) => {
      const matches = tokens.every((token) => searchable.includes(token));
      return matches ? count + 1 : count;
    }, 0);
    const titleLower = (row.title ?? "").toLowerCase();
    const canonicalUrl = row.canonical_url ?? "";
    const canonicalCmdlet = isCanonicalCmdletDocument(row.title ?? "", canonicalUrl);
    const opAligned = operationPrefixAligned(prefixes, row.title ?? "", canonicalUrl);
    const objectMatch = objectAligned(objectKeys, row.title ?? "", canonicalUrl);
    const specificityHit = implicitCmdlet && canonicalCmdlet && opAligned && objectMatch;
    const moduleIndexPenalty =
      cmdletDiscovery &&
      row.source_id === "ms-teams-powershell" &&
      isModuleIndexDocument(row.title ?? "", canonicalUrl);
    const powershellOperationHit =
      cmdletIntent &&
      row.source_id === "ms-teams-powershell" &&
      prefixes.some((prefix) => titleLower.startsWith(prefix));
    const adjusted =
      row.lexical_score -
      conceptHits * 0.75 -
      (powershellOperationHit ? 1.15 : 0) -
      (specificityHit ? 4.25 : 0) +
      (moduleIndexPenalty ? 2.75 : 0);
    return {
      ...row,
      lexical_adjusted_score: adjusted,
      concept_hits: conceptHits,
      powershell_operation_hit: powershellOperationHit || specificityHit,
      implicit_cmdlet_specificity_hit: specificityHit,
      module_index_penalty_hit: moduleIndexPenalty
    };
  });
  ranked.sort((a, b) => {
    if (a.lexical_adjusted_score !== b.lexical_adjusted_score) {
      return a.lexical_adjusted_score - b.lexical_adjusted_score;
    }
    return (a.source_order ?? 0) - (b.source_order ?? 0);
  });
  return ranked.slice(0, scope.candidateBudget.maxLexicalCandidates);
}

export function retrieveLexicalCandidates(params: {
  databasePath: string;
  scope: RetrievalScope;
  signal?: AbortSignal;
}): LexicalRetrievalResult {
  const started = performance.now();
  ensureNotAborted(params.signal);
  const scope = params.scope;
  const query = buildLexicalQuery(scope);
  const diagnostics: LexicalDiagnostics = {
    eligiblePopulation: 0,
    matchedPopulation: 0,
    returnedPopulation: 0,
    lexicalQuery: query.query,
    queryTerms: query.queryTerms
  };

  if (!scope.strategy.lexical || !query.query) {
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

    const eligible = db
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
    diagnostics.eligiblePopulation = eligible.count;

    const matched = db
      .prepare(
        `
          SELECT COUNT(*) as count
          FROM knowledge_chunk_fts fts
          JOIN knowledge_chunks kc ON kc.chunk_id = fts.chunk_id
          JOIN documents d ON d.document_id = kc.document_id
          WHERE d.tombstoned_at IS NULL
            AND kc.tombstoned_at IS NULL
            AND d.parse_status != 'failed'
            AND ${scopeFilter.sql}
            AND knowledge_chunk_fts MATCH ?
        `
      )
      .get(...scopeFilter.params, query.query) as { count: number };
    diagnostics.matchedPopulation = matched.count;

    const rows = db
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
            kc.source_order,
            kc.heading_path_json,
            kc.chunk_text,
            bm25(knowledge_chunk_fts) as lexical_score
          FROM knowledge_chunk_fts
          JOIN knowledge_chunks kc ON kc.chunk_id = knowledge_chunk_fts.chunk_id
          JOIN documents d ON d.document_id = kc.document_id
          JOIN document_contents dc ON dc.document_id = d.document_id
          WHERE d.tombstoned_at IS NULL
            AND kc.tombstoned_at IS NULL
            AND d.parse_status != 'failed'
            AND ${scopeFilter.sql}
            AND knowledge_chunk_fts MATCH ?
          ORDER BY lexical_score ASC, kc.source_order ASC
          LIMIT ?
        `
      )
      .all(
        ...scopeFilter.params,
        query.query,
        scope.candidateBudget.maxLexicalCandidates
      ) as LexicalRow[];
    ensureNotAborted(params.signal);

    const rankedRows = rankLexicalRows(scope, rows);
    const candidates = rankedRows.map((row) => {
      const provenance = buildProvenance(row);
      const retrievalReasons = ["lexical_fts_match"];
      if (row.concept_hits > 0) {
        retrievalReasons.push("lexical_technical_concept_match");
      }
      if (row.powershell_operation_hit) {
        retrievalReasons.push("lexical_powershell_operation_match");
      }
      if (row.implicit_cmdlet_specificity_hit) {
        retrievalReasons.push("lexical_implicit_cmdlet_specificity");
      }
      if (row.module_index_penalty_hit) {
        retrievalReasons.push("lexical_module_index_deprioritized");
      }
      return {
        candidateId: makeCandidateId(["lexical", row.chunk_id, String(row.lexical_score)]),
        method: "lexical" as const,
        documentId: row.document_id,
        chunkId: row.chunk_id,
        sectionId: row.section_id,
        headingPath: provenance.headingPath,
        title: row.title ?? "(untitled)",
        text: row.chunk_text,
        authority: buildAuthorityContext(scope, row),
        provenance,
        scores: {
          lexical: row.lexical_score,
          exactMatch: null,
          semanticSimilarity: null
        },
        retrievalReasons
      } satisfies RetrievalCandidate;
    });
    diagnostics.returnedPopulation = candidates.length;
    return {
      candidates,
      diagnostics,
      latencyMs: performance.now() - started
    };
  } finally {
    db.close();
  }
}

export function buildSafeLexicalQueryForScope(scope: RetrievalScope): {
  query: string;
  queryTerms: string[];
} {
  return buildLexicalQuery(scope);
}

