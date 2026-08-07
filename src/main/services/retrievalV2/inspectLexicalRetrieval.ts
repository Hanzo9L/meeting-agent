import { resolve } from "node:path";
import {
  createKnowledgeV2SqliteStore,
  resolveKnowledgeV2DatabasePath
} from "../knowledgeV2";
import { routeQueryIntent } from "./domainPolicies";
import { buildSafeLexicalQueryForScope } from "./lexicalRetriever";
import { extractQueryIntent } from "./queryIntentRules";
import { retrieveScopedCandidates } from "./scopedCandidateRetriever";

function resolveQuestionFromArgs(): string {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return "What does Set-CsOnlineVoiceRoutingPolicy do?";
  }
  return args.join(" ");
}

function main(): void {
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
  const lexicalQuery = buildSafeLexicalQueryForScope(routeResult.scope);
  const retrieval = retrieveScopedCandidates({
    databasePath: dbPath,
    scope: routeResult.scope
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        question,
        databasePath: dbPath,
        queryIntentLatencyMs: Number(intentResult.latencyMs.toFixed(3)),
        routeLatencyMs: Number(routeResult.latencyMs.toFixed(3)),
        retrievalLatencyMs: Number(retrieval.latencyMs.toFixed(3)),
        routeSummary: {
          selectedDomains: routeResult.scope.selectedDomains,
          eligibleSources: routeResult.scope.eligibleSources.map((source) => ({
            sourceId: source.sourceId,
            priority: source.priority,
            tracks: source.eligibleTrackIds
          })),
          scopeMode: routeResult.scope.scopeMode,
          candidateBudget: routeResult.scope.candidateBudget
        },
        exact: retrieval.exact.diagnostics,
        lexical: {
          ...retrieval.lexical.diagnostics,
          lexicalQueryPreview: lexicalQuery
        },
        candidates: retrieval.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          method: candidate.method,
          sourceId: candidate.authority.sourceId,
          trackId: candidate.authority.trackId,
          sourceStatus: candidate.authority.sourceStatus,
          title: candidate.title,
          sectionId: candidate.sectionId,
          lexicalScore: candidate.scores.lexical,
          exact: candidate.exactMatch ?? null,
          reasons: candidate.retrievalReasons
        })),
        diagnostics: retrieval.diagnostics
      },
      null,
      2
    )}\n`
  );
}

main();

