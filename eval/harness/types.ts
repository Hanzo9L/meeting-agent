export type ExpectedDomain =
  | "teams_admin"
  | "teams_powershell"
  | "teams_dev"
  | "graph"
  | "entra"
  | "m365"
  | "unknown";

export type ExpectedIntent =
  | "conceptual"
  | "procedural"
  | "troubleshooting"
  | "configuration"
  | "comparison"
  | "reference"
  | "unknown";

export interface EvaluationQuestion {
  schemaVersion: "1.0";
  questionId: string;
  question: string;
  expectedDomain: ExpectedDomain;
  expectedIntent: ExpectedIntent;
  expectedSourceDomains: ExpectedDomain[];
  requiredConcepts: string[];
  prohibitedClaims: string[];
  knownSourceHints: string[];
  evaluationNotes: string;
}

export interface LegacyBaselineRunOptions {
  datasetPath: string;
  indexCachePath: string;
  outputDir: string;
  topK: number;
  includeAnswers: boolean;
  openAiApiKey?: string;
  topic: string;
  topicPromptTemplate: string;
}

export interface LegacyRetrievalItem {
  rank: number;
  title: string;
  path: string;
  textSnippet: string;
  sourceUrl: string;
}

export interface LegacyAnswerResult {
  attempted: boolean;
  status:
    | "not_attempted"
    | "skipped_not_question"
    | "missing_api_key"
    | "answered"
    | "insufficient_evidence"
    | "error";
  text: string;
  error?: string;
  citations: Array<{
    title: string;
    path: string;
    url: string;
  }>;
}

export interface QuestionMetrics {
  expectedSourceRetrievedTopK: boolean;
  firstExpectedSourceRank: number | null;
  citationValidity: "valid" | "invalid" | "not_applicable";
  answerability: "answered" | "not_answered" | "insufficient_evidence" | "error";
  unsupportedClaimsHeuristic: "not_evaluated" | "possible_issue";
}

export interface BaselineQuestionResult {
  questionId: string;
  question: string;
  expectedDomain: ExpectedDomain;
  expectedIntent: ExpectedIntent;
  gating: {
    looksLikeQuestion: boolean;
  };
  retrieval: {
    topK: number;
    count: number;
    ordered: LegacyRetrievalItem[];
  };
  answer: LegacyAnswerResult;
  metrics: QuestionMetrics;
  latenciesMs: {
    gating: number;
    retrieval: number;
    answer: number;
    total: number;
  };
  errors: string[];
  humanReview: {
    required: boolean;
    reasons: string[];
  };
}

export interface BaselineRunSummary {
  totalQuestions: number;
  retrievedAnyCount: number;
  expectedSourceHitCount: number;
  citationValidCount: number;
  answerProducedCount: number;
  insufficientEvidenceCount: number;
  errorCount: number;
  p95RetrievalLatencyMs: number;
  p95AnswerLatencyMs: number;
}

export interface BaselineRunArtifact {
  artifactVersion: "1.0";
  pipelineVersion: "legacy-v1";
  usesKnowledgeEngineV2: false;
  runId: string;
  commitSha: string;
  createdAt: string;
  datasetPath: string;
  indexCachePath: string;
  options: {
    topK: number;
    includeAnswers: boolean;
  };
  summary: BaselineRunSummary;
  results: BaselineQuestionResult[];
}

