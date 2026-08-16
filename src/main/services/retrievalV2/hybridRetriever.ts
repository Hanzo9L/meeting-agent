import { performance } from "node:perf_hooks";
import type { EmbeddingProvider, EmbeddingRuntimeConfig } from "../knowledgeV2";
import type { RetrievalScope } from "./domainRouter";
import { retrieveExactMatches, type ExactMatchRetrievalResult } from "./exactMatchRetriever";
import {
  HYBRID_FUSION_POLICY,
  scoreHybridCandidate,
  type CandidateMethodSignals,
  type FusionContributionBreakdown,
  type HybridPolicyWarning
} from "./hybridFusionPolicy";
import { retrieveLexicalCandidates, type LexicalRetrievalResult } from "./lexicalRetriever";
import type { RetrievalCandidate } from "./retrievalCandidates";
import {
  retrieveSemanticCandidates,
  SemanticRetrievalAbortedError,
  type SemanticRetrievalResult
} from "./semanticRetriever";
import { RetrievalAbortedError, ensureNotAborted } from "./retrievalAbort";
import {
  applyWorkflowOutputPreservation,
  type WorkflowOutputPreservationDiagnostics
} from "./workflowOutputPreservation";

export interface FusedRetrievalCandidate extends RetrievalCandidate {
  methods: Array<"exact" | "lexical" | "semantic">;
  methodSignals: CandidateMethodSignals;
  fusion: {
    rank: number;
    score: number;
    contributions: FusionContributionBreakdown;
    rationale: string[];
  };
  sourceDedup: {
    mergedFromCandidateIds: string[];
  };
}

export interface HybridFusionDiagnostics {
  exactCandidateCount: number;
  lexicalCandidateCount: number;
  semanticCandidateCount: number;
  uniqueCandidatesBeforeDedup: number;
  uniqueCandidatesAfterDedup: number;
  returnedCandidateCount: number;
  methodOverlapCounts: {
    exactOnly: number;
    lexicalOnly: number;
    semanticOnly: number;
    exactAndLexical: number;
    exactAndSemantic: number;
    lexicalAndSemantic: number;
    allThree: number;
  };
  sourceDistribution: Record<string, number>;
  authorityDistribution: Record<string, number>;
  cap: {
    finalCandidateCap: number;
    maxPerDocument: number;
    truncated: boolean;
  };
  requiredExactMisses: Array<{
    directiveType: "cmdlet" | "policy" | "entity";
    directiveValue: string;
    required: boolean;
  }>;
  warnings: HybridPolicyWarning[];
  workflowOutputPreservation: WorkflowOutputPreservationDiagnostics;
}

export interface HybridRetrievalDiagnostics {
  exactLatencyMs: number;
  lexicalLatencyMs: number;
  semanticLatencyMs: number;
  fusionLatencyMs: number;
  totalLatencyMs: number;
  orchestrationMode: "overlap_semantic_with_exact_lexical" | "sequential";
}

export interface HybridRetrievalResult {
  intent: RetrievalScope["intent"];
  scope: RetrievalScope;
  candidates: FusedRetrievalCandidate[];
  exact: ExactMatchRetrievalResult;
  lexical: LexicalRetrievalResult;
  semantic: SemanticRetrievalResult;
  fusionDiagnostics: HybridFusionDiagnostics;
  diagnostics: HybridRetrievalDiagnostics;
  warnings: string[];
}

export class HybridRetrievalAbortedError extends Error {
  constructor() {
    super("hybrid_retrieval_aborted");
    this.name = "HybridRetrievalAbortedError";
  }
}

function lexicalRank(candidate: RetrievalCandidate): number | null {
  const score = candidate.scores.lexical;
  if (score === null) return null;
  return Number.isFinite(score) ? score : null;
}

function rankByMethod(candidates: RetrievalCandidate[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!candidate) continue;
    if (!out.has(candidate.chunkId)) out.set(candidate.chunkId, i + 1);
  }
  return out;
}

function chooseCanonicalCandidate(entries: RetrievalCandidate[]): RetrievalCandidate {
  const exact = entries.find((entry) => entry.method === "exact");
  if (exact) return exact;
  const lexical = entries.find((entry) => entry.method === "lexical");
  if (lexical) return lexical;
  return entries[0] as RetrievalCandidate;
}

function methodOverlapKey(methods: Array<"exact" | "lexical" | "semantic">): keyof HybridFusionDiagnostics["methodOverlapCounts"] {
  const hasExact = methods.includes("exact");
  const hasLexical = methods.includes("lexical");
  const hasSemantic = methods.includes("semantic");
  if (hasExact && hasLexical && hasSemantic) return "allThree";
  if (hasExact && hasLexical) return "exactAndLexical";
  if (hasExact && hasSemantic) return "exactAndSemantic";
  if (hasLexical && hasSemantic) return "lexicalAndSemantic";
  if (hasExact) return "exactOnly";
  if (hasLexical) return "lexicalOnly";
  return "semanticOnly";
}

function buildRationale(params: {
  candidate: RetrievalCandidate;
  methods: Array<"exact" | "lexical" | "semantic">;
  contributions: FusionContributionBreakdown;
}): string[] {
  const rationale: string[] = [];
  if (params.methods.includes("exact")) rationale.push("exact_match_signal");
  if (params.methods.includes("lexical")) rationale.push("lexical_match_signal");
  if (params.methods.includes("semantic")) rationale.push("semantic_match_signal");
  if (params.methods.length >= 2) rationale.push("multi_method_agreement");
  rationale.push(`route_priority:${params.candidate.authority.routePriority}`);
  rationale.push(`source_status:${params.candidate.authority.sourceStatus}`);
  if (params.contributions.betaPolicy !== 0) {
    rationale.push(
      params.contributions.betaPolicy > 0 ? "beta_explicitly_supported" : "beta_deprioritized"
    );
  }
  return rationale;
}

function applyPostFusionCaps(sorted: FusedRetrievalCandidate[]): {
  selected: FusedRetrievalCandidate[];
  truncated: boolean;
} {
  const selected: FusedRetrievalCandidate[] = [];
  const overflow: FusedRetrievalCandidate[] = [];
  const perDoc = new Map<string, number>();
  for (const candidate of sorted) {
    const docCount = perDoc.get(candidate.documentId) ?? 0;
    if (docCount >= HYBRID_FUSION_POLICY.maxPerDocument) {
      overflow.push(candidate);
      continue;
    }
    selected.push(candidate);
    perDoc.set(candidate.documentId, docCount + 1);
    if (selected.length >= HYBRID_FUSION_POLICY.finalCandidateCap) {
      return { selected, truncated: true };
    }
  }
  for (const candidate of overflow) {
    if (selected.length >= HYBRID_FUSION_POLICY.finalCandidateCap) {
      return { selected, truncated: true };
    }
    selected.push(candidate);
  }
  return {
    selected,
    truncated: sorted.length > selected.length
  };
}

export async function retrieveHybridCandidates(params: {
  databasePath: string;
  scope: RetrievalScope;
  embeddingProvider: EmbeddingProvider;
  embeddingRuntimeConfig?: Pick<EmbeddingRuntimeConfig, "model" | "embeddingSchemaVersion">;
  orchestrationMode?: "overlap_semantic_with_exact_lexical" | "sequential";
  signal?: AbortSignal;
}): Promise<HybridRetrievalResult> {
  const totalStarted = performance.now();
  try {
    ensureNotAborted(params.signal);
  } catch {
    throw new HybridRetrievalAbortedError();
  }

  const orchestrationMode = params.orchestrationMode ?? "overlap_semantic_with_exact_lexical";
  let semanticPromise: Promise<SemanticRetrievalResult> | null = null;
  if (orchestrationMode === "overlap_semantic_with_exact_lexical") {
    semanticPromise = retrieveSemanticCandidates({
      databasePath: params.databasePath,
      scope: params.scope,
      embeddingProvider: params.embeddingProvider,
      embeddingRuntimeConfig: params.embeddingRuntimeConfig,
      signal: params.signal
    });
  }

  let exact: ExactMatchRetrievalResult;
  let lexical: LexicalRetrievalResult;
  try {
    exact = retrieveExactMatches({
      databasePath: params.databasePath,
      scope: params.scope,
      signal: params.signal
    });
    try {
      ensureNotAborted(params.signal);
    } catch {
      throw new HybridRetrievalAbortedError();
    }
    lexical = retrieveLexicalCandidates({
      databasePath: params.databasePath,
      scope: params.scope,
      signal: params.signal
    });
    try {
      ensureNotAborted(params.signal);
    } catch {
      throw new HybridRetrievalAbortedError();
    }
  } catch (error) {
    if (error instanceof HybridRetrievalAbortedError || error instanceof RetrievalAbortedError) {
      throw new HybridRetrievalAbortedError();
    }
    if (params.signal?.aborted) throw new HybridRetrievalAbortedError();
    throw error;
  }

  let semantic: SemanticRetrievalResult;
  try {
    semantic =
      orchestrationMode === "overlap_semantic_with_exact_lexical"
        ? await (semanticPromise as Promise<SemanticRetrievalResult>)
        : await retrieveSemanticCandidates({
            databasePath: params.databasePath,
            scope: params.scope,
            embeddingProvider: params.embeddingProvider,
            embeddingRuntimeConfig: params.embeddingRuntimeConfig,
            signal: params.signal
          });
  } catch (error) {
    if (error instanceof SemanticRetrievalAbortedError || params.signal?.aborted) {
      throw new HybridRetrievalAbortedError();
    }
    throw error;
  }
  try {
    ensureNotAborted(params.signal);
  } catch {
    throw new HybridRetrievalAbortedError();
  }

  const fusionStarted = performance.now();
  const exactRanks = rankByMethod(exact.candidates);
  const lexicalRanks = rankByMethod(lexical.candidates);
  const semanticRanks = rankByMethod(semantic.candidates);

  const grouped = new Map<string, RetrievalCandidate[]>();
  for (const candidate of [...exact.candidates, ...lexical.candidates, ...semantic.candidates]) {
    const key = candidate.chunkId;
    const existing = grouped.get(key) ?? [];
    existing.push(candidate);
    grouped.set(key, existing);
  }

  const fusionWarnings: HybridPolicyWarning[] = [];
  const fused: FusedRetrievalCandidate[] = [];
  const sourceDistribution: Record<string, number> = {};
  const authorityDistribution: Record<string, number> = {};
  const methodOverlapCounts: HybridFusionDiagnostics["methodOverlapCounts"] = {
    exactOnly: 0,
    lexicalOnly: 0,
    semanticOnly: 0,
    exactAndLexical: 0,
    exactAndSemantic: 0,
    lexicalAndSemantic: 0,
    allThree: 0
  };

  for (const entries of grouped.values()) {
    const canonical = chooseCanonicalCandidate(entries);
    const methods = [...new Set(entries.map((entry) => entry.method))].sort() as Array<
      "exact" | "lexical" | "semantic"
    >;
    const signals: CandidateMethodSignals = {
      methods,
      exact: {
        matched: methods.includes("exact"),
        score: entries.find((entry) => entry.method === "exact")?.scores.exactMatch ?? null,
        rank: exactRanks.get(canonical.chunkId) ?? null
      },
      lexical: {
        score: entries.find((entry) => entry.method === "lexical")?.scores.lexical ?? null,
        rank: lexicalRanks.get(canonical.chunkId) ?? null
      },
      semantic: {
        similarity: entries.find((entry) => entry.method === "semantic")?.scores.semanticSimilarity ?? null,
        rank: semanticRanks.get(canonical.chunkId) ?? null
      }
    };

    const scored = scoreHybridCandidate({
      candidate: canonical,
      intent: params.scope.intent,
      methodSignals: signals
    });
    fusionWarnings.push(...scored.warnings);

    methodOverlapCounts[methodOverlapKey(methods)] += 1;
    sourceDistribution[canonical.authority.sourceId] =
      (sourceDistribution[canonical.authority.sourceId] ?? 0) + 1;
    authorityDistribution[canonical.authority.routePriority] =
      (authorityDistribution[canonical.authority.routePriority] ?? 0) + 1;

    const reasons = [...new Set(entries.flatMap((entry) => entry.retrievalReasons))];
    const exactMatchCandidate = entries.find((entry) => entry.exactMatch)?.exactMatch;
    const lexicalSignal = entries.find((entry) => entry.method === "lexical");
    const semanticSignal = entries.find((entry) => entry.method === "semantic");
    const exactSignal = entries.find((entry) => entry.method === "exact");

    fused.push({
      ...canonical,
      method: canonical.method,
      scores: {
        lexical: lexicalSignal?.scores.lexical ?? null,
        exactMatch: exactSignal?.scores.exactMatch ?? null,
        semanticSimilarity: semanticSignal?.scores.semanticSimilarity ?? null
      },
      exactMatch: exactMatchCandidate,
      retrievalReasons: reasons,
      methods,
      methodSignals: signals,
      fusion: {
        rank: 0,
        score: scored.contributions.total,
        contributions: scored.contributions,
        rationale: buildRationale({
          candidate: canonical,
          methods,
          contributions: scored.contributions
        })
      },
      sourceDedup: {
        mergedFromCandidateIds: entries.map((entry) => entry.candidateId)
      }
    });
  }

  fused.sort((left, right) => {
    if (left.fusion.score !== right.fusion.score) {
      return right.fusion.score - left.fusion.score;
    }
    if (left.methodSignals.exact.matched !== right.methodSignals.exact.matched) {
      return left.methodSignals.exact.matched ? -1 : 1;
    }
    const leftLexical = lexicalRank(left);
    const rightLexical = lexicalRank(right);
    if (leftLexical !== rightLexical) {
      if (leftLexical === null) return 1;
      if (rightLexical === null) return -1;
      return leftLexical - rightLexical;
    }
    const leftSemantic = left.scores.semanticSimilarity ?? Number.NEGATIVE_INFINITY;
    const rightSemantic = right.scores.semanticSimilarity ?? Number.NEGATIVE_INFINITY;
    if (leftSemantic !== rightSemantic) return rightSemantic - leftSemantic;
    return left.chunkId.localeCompare(right.chunkId);
  });

  const capped = applyPostFusionCaps(fused);
  const preservation = applyWorkflowOutputPreservation({
    sortedFused: fused,
    selected: capped.selected,
    intent: params.scope.intent,
    directives: params.scope.exactMatchDirectives,
    maxPerDocument: HYBRID_FUSION_POLICY.maxPerDocument
  });
  const ranked = preservation.selected.map((candidate, index) => ({
    ...candidate,
    fusion: {
      ...candidate.fusion,
      rank: index + 1
    }
  }));

  const requiredExactMisses = exact.diagnostics.missedRequired.map((attempt) => ({
    directiveType: attempt.directiveType,
    directiveValue: attempt.directiveValue,
    required: attempt.required
  }));

  const fusionLatencyMs = performance.now() - fusionStarted;
  const diagnostics: HybridRetrievalDiagnostics = {
    exactLatencyMs: exact.latencyMs,
    lexicalLatencyMs: lexical.latencyMs,
    semanticLatencyMs: semantic.diagnostics.latencyMs.total,
    fusionLatencyMs,
    totalLatencyMs: performance.now() - totalStarted,
    orchestrationMode
  };

  const warnings = [
    ...params.scope.routingWarnings,
    ...semantic.diagnostics.warnings,
    ...(requiredExactMisses.length > 0 ? ["required_exact_match_missing"] : [])
  ];

  return {
    intent: params.scope.intent,
    scope: params.scope,
    candidates: ranked,
    exact,
    lexical,
    semantic,
    fusionDiagnostics: {
      exactCandidateCount: exact.candidates.length,
      lexicalCandidateCount: lexical.candidates.length,
      semanticCandidateCount: semantic.candidates.length,
      uniqueCandidatesBeforeDedup:
        exact.candidates.length + lexical.candidates.length + semantic.candidates.length,
      uniqueCandidatesAfterDedup: fused.length,
      returnedCandidateCount: ranked.length,
      methodOverlapCounts,
      sourceDistribution,
      authorityDistribution,
      cap: {
        finalCandidateCap: HYBRID_FUSION_POLICY.finalCandidateCap,
        maxPerDocument: HYBRID_FUSION_POLICY.maxPerDocument,
        truncated: capped.truncated
      },
      requiredExactMisses,
      warnings: fusionWarnings,
      workflowOutputPreservation: preservation.diagnostics
    },
    diagnostics,
    warnings
  };
}
