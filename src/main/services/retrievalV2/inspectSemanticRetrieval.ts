import { resolve } from "node:path";
import {
  createKnowledgeV2SqliteStore,
  FakeEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { extractQueryIntent } from "./queryIntentRules";
import { retrieveSemanticCandidates } from "./semanticRetriever";

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
  const bootstrapStore = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  bootstrapStore.initializeDatabase();
  bootstrapStore.close();

  const intentResult = extractQueryIntent(question);
  const routeResult = routeQueryIntent(intentResult.intent);
  const runtime = resolveEmbeddingRuntimeConfig();

  const provider = new FakeEmbeddingProvider({
    providerId: "fake",
    dimensions: 8,
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion
  });

  const semantic = await retrieveSemanticCandidates({
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
        semanticLatencyMs: Number(semantic.diagnostics.latencyMs.total.toFixed(3)),
        routeSummary: {
          selectedDomains: routeResult.scope.selectedDomains,
          eligibleSources: routeResult.scope.eligibleSources.map((source) => ({
            sourceId: source.sourceId,
            priority: source.priority,
            tracks: source.eligibleTrackIds
          })),
          candidateBudget: routeResult.scope.candidateBudget
        },
        embeddingIdentity: semantic.diagnostics.embeddingIdentity,
        diagnostics: semantic.diagnostics,
        candidates: semantic.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          chunkId: candidate.chunkId,
          sourceId: candidate.authority.sourceId,
          trackId: candidate.authority.trackId,
          sourceStatus: candidate.authority.sourceStatus,
          title: candidate.title,
          sectionId: candidate.sectionId,
          semanticSimilarity: candidate.scores.semanticSimilarity,
          semanticRank: candidate.semanticRank,
          reasons: candidate.retrievalReasons
        }))
      },
      null,
      2
    )}\n`
  );
}

main();

