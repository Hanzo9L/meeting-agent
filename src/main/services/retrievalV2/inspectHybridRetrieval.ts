import { resolve } from "node:path";
import {
  createKnowledgeV2SqliteStore,
  FakeEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { retrieveHybridCandidates } from "./hybridRetriever";
import { extractQueryIntent } from "./queryIntentRules";

function resolveQuestionFromArgs(): string {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return "How does Teams Direct Routing voice routing work?";
  }
  return args.join(" ");
}

async function main(): Promise<void> {
  const question = resolveQuestionFromArgs();
  const dbPath = resolveKnowledgeV2DatabasePath();
  const runtime = resolveEmbeddingRuntimeConfig();
  const bootstrapStore = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  bootstrapStore.initializeDatabase();
  bootstrapStore.close();

  const intentResult = extractQueryIntent(question);
  const routeResult = routeQueryIntent(intentResult.intent);
  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
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

  process.stdout.write(
    `${JSON.stringify(
      {
        question,
        databasePath: dbPath,
        queryIntentLatencyMs: Number(intentResult.latencyMs.toFixed(3)),
        routeLatencyMs: Number(routeResult.latencyMs.toFixed(3)),
        hybridLatencyMs: Number(hybrid.diagnostics.totalLatencyMs.toFixed(3)),
        queryIntent: intentResult.intent,
        routeSummary: {
          selectedDomains: routeResult.scope.selectedDomains,
          focusSubdomains: routeResult.scope.focusSubdomains,
          scopeMode: routeResult.scope.scopeMode,
          candidateBudget: routeResult.scope.candidateBudget,
          sourcePriorityChain: routeResult.scope.sourcePriorityChain,
          eligibleSources: routeResult.scope.eligibleSources.map((source) => ({
            sourceId: source.sourceId,
            priority: source.priority,
            roles: source.authorityRoles,
            tracks: source.eligibleTrackIds
          }))
        },
        exactDiagnostics: hybrid.exact.diagnostics,
        lexicalDiagnostics: hybrid.lexical.diagnostics,
        semanticDiagnostics: hybrid.semantic.diagnostics,
        fusionDiagnostics: hybrid.fusionDiagnostics,
        rankedCandidates: hybrid.candidates.map((candidate) => ({
          rank: candidate.fusion.rank,
          sourceId: candidate.authority.sourceId,
          trackId: candidate.authority.trackId,
          sourceStatus: candidate.authority.sourceStatus,
          authorityRoles: candidate.authority.authorityRoles,
          title: candidate.title,
          sectionId: candidate.sectionId,
          methods: candidate.methods,
          exactMatch: candidate.exactMatch ?? null,
          lexicalScore: candidate.scores.lexical,
          lexicalRank: candidate.methodSignals.lexical.rank,
          semanticSimilarity: candidate.scores.semanticSimilarity,
          semanticRank: candidate.methodSignals.semantic.rank,
          fusionScore: candidate.fusion.score,
          fusionContributions: candidate.fusion.contributions,
          rationale: candidate.fusion.rationale
        })),
        warnings: hybrid.warnings
      },
      null,
      2
    )}\n`
  );
}

main();
