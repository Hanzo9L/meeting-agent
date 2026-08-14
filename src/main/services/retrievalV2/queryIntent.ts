export type QueryDomain =
  | "teams_admin"
  | "teams_powershell"
  | "graph"
  | "entra"
  | "m365"
  | "teams_dev"
  | "sharepoint";

export type QueryAnswerType =
  | "conceptual"
  | "procedural"
  | "troubleshooting"
  | "configuration"
  | "comparison"
  | "reference";

export interface QueryIntent {
  originalQuestion: string;
  normalizedQuestion: string;
  domains: QueryDomain[];
  products: string[];
  technologies: string[];
  entities: string[];
  operationIntents?: string[];
  commandNames?: string[];
  policyNames?: string[];
  requiresFreshnessCheck: boolean;
  allowsBetaSources: boolean;
  expectedAnswerType: QueryAnswerType;
  retrievalHints: string[];
  unresolvedAmbiguity: string[];
}

export interface QueryIntentExtractionResult {
  intent: QueryIntent;
  latencyMs: number;
}
