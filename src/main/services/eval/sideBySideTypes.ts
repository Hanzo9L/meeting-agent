import type { BaselineQuestionResult, BaselineRunArtifact, EvaluationQuestion } from "../../../../eval/harness/types";
import type { QueryIntent, RetrievalScope } from "../retrievalV2";
import type {
  HybridRetrievalDiagnostics,
  HybridFusionDiagnostics
} from "../retrievalV2/hybridRetriever";
import type { ExactMatchDiagnostics, LexicalDiagnostics } from "../retrievalV2/retrievalCandidates";
import type { SemanticRetrievalDiagnostics } from "../retrievalV2/semanticRetriever";

export type CorpusMode = "fixture" | "limited_real" | "real";

export interface V2CorpusStats {
  mode: CorpusMode;
  classificationReasons: string[];
  documentCount: number;
  chunkCount: number;
  embeddingCount: number;
  documentsBySource: Record<string, number>;
  chunksBySource: Record<string, number>;
  embeddingsBySource: Record<string, number>;
  documentsByTrack: Record<string, number>;
  chunksByTrack: Record<string, number>;
  embeddingsByTrack: Record<string, number>;
  documentsByTransport: Record<string, number>;
}

export interface CandidateReviewRow {
  rank: number;
  chunkId: string;
  documentId: string;
  title: string;
  sectionId: string;
  headingPath: string[];
  sourceId: string;
  trackId: string;
  authorityRoles: string[];
  methods: Array<"exact" | "lexical" | "semantic">;
  snippet: string;
  canonicalUrl: string;
  sourceStatus: string;
  exactMatchState: string | null;
  exactRank: number | null;
  lexicalRank: number | null;
  lexicalScore: number | null;
  semanticRank: number | null;
  semanticSimilarity: number | null;
  exactScore: number | null;
  fusionContribution: {
    exactScore: number;
    lexicalRank: number;
    semanticRank: number;
    methodAgreement: number;
    routePriority: number;
    authorityRole: number;
    betaPolicy: number;
    total: number;
  };
  fusionScore: number;
  reviewLabel: "highly_relevant" | "relevant_supporting" | "marginal" | "irrelevant" | "misleading" | null;
  reviewLabelOptions: Array<
    "highly_relevant" | "relevant_supporting" | "marginal" | "irrelevant" | "misleading"
  >;
}

export interface RetrievalMetricSet {
  expectedSourceHitTop1: boolean;
  expectedSourceHitTop3: boolean;
  expectedSourceHitTop5: boolean;
  expectedSourceHitTop10: boolean;
  firstExpectedSourceRank: number | null;
  reciprocalRank: number | null;
  recallAt1: number | null;
  recallAt3: number | null;
  recallAt5: number | null;
  recallAt10: number | null;
  exactCmdletMatchSuccess: boolean | null;
  domainRoutingCorrect: boolean;
  authorityCorrectTop1: boolean;
  betaPolicyCorrect: boolean;
  inappropriateSourceLeakageCount: number;
}

export interface SideBySideQuestionResult {
  question: EvaluationQuestion;
  legacy: {
    runId: string;
    result: BaselineQuestionResult;
    retrievedSources: Array<{ rank: number; sourceDomain: string; sourceUrl: string; title: string }>;
  };
  v2: {
    stageLatencyMs: {
      queryIntent: number;
      domainRouter: number;
      exact: number;
      lexical: number;
      semantic: number;
      fusion: number;
      totalHybridRetrieval: number;
    };
    queryIntent: QueryIntent;
    retrievalScope: RetrievalScope;
    exactDiagnostics: ExactMatchDiagnostics;
    lexicalDiagnostics: LexicalDiagnostics;
    semanticDiagnostics: SemanticRetrievalDiagnostics;
    fusionDiagnostics: HybridFusionDiagnostics;
    retrievalDiagnostics: HybridRetrievalDiagnostics;
    fusedCandidates: CandidateReviewRow[];
  };
  comparison: {
    legacyMetrics: RetrievalMetricSet;
    v2Metrics: RetrievalMetricSet;
  };
}

export interface SideBySideRunSummary {
  totalQuestions: number;
  methodContribution: Record<string, number>;
  legacy: {
    expectedSourceHitTop1: number;
    expectedSourceHitTop3: number;
    expectedSourceHitTop5: number;
    expectedSourceHitTop10: number;
    mrr: number;
    meanRecallAt5: number;
    meanRecallAt10: number;
    exactCmdletSuccess: { success: number; total: number };
    domainRoutingCorrect: number;
    authorityCorrectTop1: number;
    betaPolicyCorrect: number;
    leakageQuestions: number;
    p95RetrievalLatencyMs: number;
  };
  v2: {
    expectedSourceHitTop1: number;
    expectedSourceHitTop3: number;
    expectedSourceHitTop5: number;
    expectedSourceHitTop10: number;
    mrr: number;
    meanRecallAt5: number;
    meanRecallAt10: number;
    exactCmdletSuccess: { success: number; total: number };
    domainRoutingCorrect: number;
    authorityCorrectTop1: number;
    betaPolicyCorrect: number;
    leakageQuestions: number;
    p95TotalLatencyMs: number;
    p50TotalLatencyMs: number;
    p95HybridFusionLatencyMs: number;
    p50HybridFusionLatencyMs: number;
    p95SemanticLatencyMs: number;
    p50SemanticLatencyMs: number;
  };
}

export interface SupplementalQueryResult {
  queryId: string;
  question: string;
  stageLatencyMs: {
    queryIntent: number;
    domainRouter: number;
    exact: number;
    lexical: number;
    semantic: number;
    fusion: number;
    totalHybridRetrieval: number;
  };
  queryIntent: QueryIntent;
  retrievalScope: RetrievalScope;
  exactDiagnostics: ExactMatchDiagnostics;
  lexicalDiagnostics: LexicalDiagnostics;
  semanticDiagnostics: SemanticRetrievalDiagnostics;
  fusionDiagnostics: HybridFusionDiagnostics;
  retrievalDiagnostics: HybridRetrievalDiagnostics;
  topCandidates: CandidateReviewRow[];
}

export interface SideBySideRunArtifact {
  artifactVersion: "1.0";
  pipelineVersion: "side-by-side-wb17";
  runId: string;
  createdAt: string;
  commitSha: string;
  datasetPath: string;
  legacyArtifactPath: string;
  corpus: V2CorpusStats;
  freeze: {
    routingRulesUnchanged: true;
    fusionPolicyUnchanged: true;
    budgetsUnchanged: true;
  };
  summary: SideBySideRunSummary;
  questions: SideBySideQuestionResult[];
  supplementalCallingPlans: {
    enabled: true;
    note: string;
    queries: SupplementalQueryResult[];
  };
  warnings: string[];
  legacyBaseline: Pick<
    BaselineRunArtifact,
    "runId" | "pipelineVersion" | "usesKnowledgeEngineV2" | "summary"
  >;
}
