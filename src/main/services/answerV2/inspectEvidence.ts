import { resolve } from "node:path";
import {
  HostedOpenAiEmbeddingProvider,
  createKnowledgeV2SqliteStore,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";
import { routeQueryIntent } from "../retrievalV2/domainPolicies";
import { retrieveHybridCandidates } from "../retrievalV2/hybridRetriever";
import { extractQueryIntent } from "../retrievalV2/queryIntentRules";
import { buildEvidenceBundle } from "./evidenceBundleBuilder";
import type { EvidenceBundle } from "./types";
import type { HybridRetrievalResult } from "../retrievalV2";

export interface EvidenceInspectionRun {
  bundle: EvidenceBundle;
  hybridDiagnostics: HybridRetrievalResult["diagnostics"];
  routeScope: {
    selectedDomains: string[];
    focusSubdomains: string[];
    sourcePriorityChain: string[];
    exactMatchDirectives: Array<{ type: "cmdlet" | "policy" | "entity"; value: string; required: boolean }>;
  };
  databasePath: string;
}

export async function runQuestionToEvidenceBundle(params: {
  question: string;
  databasePath?: string;
}): Promise<EvidenceInspectionRun> {
  const dbPath = params.databasePath ?? resolveKnowledgeV2DatabasePath();
  const runtime = resolveEmbeddingRuntimeConfig();
  const bootstrapStore = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  bootstrapStore.initializeDatabase();
  bootstrapStore.close();

  const intentResult = extractQueryIntent(params.question);
  const routeResult = routeQueryIntent(intentResult.intent);
  const provider = new HostedOpenAiEmbeddingProvider({
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion
  });
  const hybrid = await retrieveHybridCandidates({
    databasePath: dbPath,
    scope: routeResult.scope,
    embeddingProvider: provider,
    embeddingRuntimeConfig: {
      model: runtime.model,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion
    }
  });
  return {
    bundle: buildEvidenceBundle(hybrid, { databasePath: dbPath }).bundle,
    hybridDiagnostics: hybrid.diagnostics,
    routeScope: {
      selectedDomains: routeResult.scope.selectedDomains,
      focusSubdomains: routeResult.scope.focusSubdomains,
      sourcePriorityChain: routeResult.scope.sourcePriorityChain,
      exactMatchDirectives: routeResult.scope.exactMatchDirectives
    },
    databasePath: dbPath
  };
}

export async function inspectEvidenceForQuestion(params: {
  question: string;
  databasePath?: string;
}): Promise<Record<string, unknown>> {
  const run = await runQuestionToEvidenceBundle(params);
  const evidence = run.bundle;
  return {
    question: params.question,
    databasePath: run.databasePath,
    intent: evidence.intent,
    scope: run.routeScope,
    hybridDiagnostics: run.hybridDiagnostics,
    answerability: evidence.answerability,
    aspectCoverage: evidence.aspectCoverage,
    freshness: evidence.freshness,
    exactIdentifierValidation: evidence.exactIdentifierValidation,
    conflicts: evidence.conflicts,
    selectedEvidence: evidence.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      sourceId: item.source.sourceId,
      sourceStatus: item.source.sourceStatus,
      sourceDomain: item.source.sourceDomain,
      routePriority: item.source.routePriority,
      title: item.source.title,
      canonicalUrl: item.source.canonicalUrl,
      headingPath: item.location.headingPath,
      selectionReason: item.selectionReason,
      supportTypes: item.supportTypes
    })),
    rejectedCandidates: evidence.rejectedCandidates,
    evidenceDiagnostics: evidence.diagnostics,
    bundle: evidence
  };
}
