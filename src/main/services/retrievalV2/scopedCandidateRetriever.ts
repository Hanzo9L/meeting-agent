import { performance } from "node:perf_hooks";
import type { RetrievalScope } from "./domainRouter";
import { retrieveExactMatches, type ExactMatchRetrievalResult } from "./exactMatchRetriever";
import { retrieveLexicalCandidates, type LexicalRetrievalResult } from "./lexicalRetriever";
import type { RetrievalCandidate } from "./retrievalCandidates";

export interface ScopedCandidateRetrievalResult {
  scope: RetrievalScope;
  candidates: RetrievalCandidate[];
  exact: ExactMatchRetrievalResult;
  lexical: LexicalRetrievalResult;
  diagnostics: {
    budget: {
      requestedMaxLexicalCandidates: number;
      truncated: boolean;
    };
    returnedCount: number;
  };
  latencyMs: number;
}

export function retrieveScopedCandidates(params: {
  databasePath: string;
  scope: RetrievalScope;
}): ScopedCandidateRetrievalResult {
  const started = performance.now();
  const exact = retrieveExactMatches({
    databasePath: params.databasePath,
    scope: params.scope
  });
  const lexical = retrieveLexicalCandidates({
    databasePath: params.databasePath,
    scope: params.scope
  });

  const dedup = new Map<string, RetrievalCandidate>();
  for (const candidate of [...exact.candidates, ...lexical.candidates]) {
    if (!dedup.has(candidate.chunkId)) {
      dedup.set(candidate.chunkId, candidate);
      continue;
    }
    const existing = dedup.get(candidate.chunkId);
    if (!existing) continue;
    if (existing.method === "lexical" && candidate.method === "exact") {
      dedup.set(candidate.chunkId, candidate);
      continue;
    }
    if (existing.method === candidate.method) {
      existing.retrievalReasons = [...new Set([...existing.retrievalReasons, ...candidate.retrievalReasons])];
    }
  }

  const combined = [...dedup.values()]
    .sort((left, right) => {
      if (left.method !== right.method) return left.method === "exact" ? -1 : 1;
      const leftScore = left.scores.lexical ?? Number.POSITIVE_INFINITY;
      const rightScore = right.scores.lexical ?? Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.chunkId.localeCompare(right.chunkId);
    })
    .slice(0, params.scope.candidateBudget.maxLexicalCandidates);

  return {
    scope: params.scope,
    candidates: combined,
    exact,
    lexical,
    diagnostics: {
      budget: {
        requestedMaxLexicalCandidates: params.scope.candidateBudget.maxLexicalCandidates,
        truncated:
          exact.diagnostics.matchedPopulation + lexical.diagnostics.matchedPopulation >
          params.scope.candidateBudget.maxLexicalCandidates
      },
      returnedCount: combined.length
    },
    latencyMs: performance.now() - started
  };
}

