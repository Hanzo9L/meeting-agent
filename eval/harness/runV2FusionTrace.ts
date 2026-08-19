import "dotenv/config";
import { resolve } from "node:path";
import {
  HostedOpenAiEmbeddingProvider,
  createKnowledgeV2SqliteStore,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath
} from "../../src/main/services/knowledgeV2";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../src/main/services/retrievalV2/domainPolicies";
import { retrieveExactMatches } from "../../src/main/services/retrievalV2/exactMatchRetriever";
import { retrieveLexicalCandidates } from "../../src/main/services/retrievalV2/lexicalRetriever";
import { retrieveSemanticCandidates } from "../../src/main/services/retrievalV2/semanticRetriever";
import { scoreHybridCandidate, HYBRID_FUSION_POLICY } from "../../src/main/services/retrievalV2/hybridFusionPolicy";
import { retrieveHybridCandidates } from "../../src/main/services/retrievalV2/hybridRetriever";
import { directiveTopicallyMatchesCandidate } from "../../src/main/services/retrievalV2/workflowOutputPreservation";

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

// Trace terms — one loose keyword set per output concept, used only to
// FILTER the trace report to relevant candidates. Not used for retrieval.
const TRACE_TERMS: Record<string, string[]> = {
  "enterprise-voice": ["enterprise voice", "onlinevoice", "csonlineuser", "voice enabled"],
  "calling-policy": ["calling policy", "teamscallingpolicy", "callingpolicy"],
  "dial-plan": ["dial plan", "tenantdialplan", "dialplan"],
  "phone-number": ["phone number", "phonenumber"],
  "voice-routing-policy": ["voice routing policy", "voiceroutingpolicy", "onlinevoiceroutingpolicy"]
};

function matchesConcept(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

async function main(): Promise<void> {
  const dbPath = resolveKnowledgeV2DatabasePath();
  const runtime = resolveEmbeddingRuntimeConfig();
  const bootstrapStore = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  bootstrapStore.initializeDatabase();
  bootstrapStore.close();

  const intent = extractQueryIntent(QUESTION).intent;
  const route = routeQueryIntent(intent);
  const scope = route.scope;

  const provider = new HostedOpenAiEmbeddingProvider({
    defaultModel: runtime.model,
    embeddingSchemaVersion: runtime.embeddingSchemaVersion
  });

  const exact = retrieveExactMatches({ databasePath: dbPath, scope });
  const lexical = retrieveLexicalCandidates({ databasePath: dbPath, scope });
  const semantic = await retrieveSemanticCandidates({
    databasePath: dbPath,
    scope,
    embeddingProvider: provider,
    embeddingRuntimeConfig: { model: runtime.model, embeddingSchemaVersion: runtime.embeddingSchemaVersion }
  });

  const hybrid = await retrieveHybridCandidates({
    databasePath: dbPath,
    scope,
    embeddingProvider: provider,
    embeddingRuntimeConfig: { model: runtime.model, embeddingSchemaVersion: runtime.embeddingSchemaVersion }
  });

  const finalIds = new Set(hybrid.candidates.map((c) => c.chunkId));

  const report: Record<string, unknown> = {
    exactMatchDirectives: scope.exactMatchDirectives,
    finalCandidateCap: HYBRID_FUSION_POLICY.finalCandidateCap,
    maxPerDocument: HYBRID_FUSION_POLICY.maxPerDocument,
    perConcept: {}
  };

  for (const [concept, terms] of Object.entries(TRACE_TERMS)) {
    const exactHits = exact.candidates
      .filter((c) => matchesConcept(`${c.title} ${c.provenance.canonicalUrl} ${c.text}`, terms))
      .map((c) => ({
        title: c.title,
        sourceId: c.authority.sourceId,
        authorityRoles: c.authority.authorityRoles,
        chunkId: c.chunkId,
        exactScore: c.scores.exactMatch,
        matchedField: c.exactMatch?.matchedField ?? null
      }));

    const lexicalHits = lexical.candidates
      .filter((c) => matchesConcept(`${c.title} ${c.provenance.canonicalUrl} ${c.text}`, terms))
      .map((c) => ({ title: c.title, sourceId: c.authority.sourceId, chunkId: c.chunkId, lexicalScore: c.scores.lexical }));

    const semanticHits = semantic.candidates
      .filter((c) => matchesConcept(`${c.title} ${c.provenance.canonicalUrl} ${c.text}`, terms))
      .map((c) => ({ title: c.title, sourceId: c.authority.sourceId, chunkId: c.chunkId, similarity: c.scores.semanticSimilarity }));

    const fusedHits = hybrid.candidates
      .filter((c) => matchesConcept(`${c.title} ${c.provenance.canonicalUrl} ${c.text}`, terms))
      .map((c) => ({
        title: c.title,
        sourceId: c.authority.sourceId,
        authorityRoles: c.authority.authorityRoles,
        chunkId: c.chunkId,
        methods: c.methods,
        fusionRank: c.fusion.rank,
        fusionScore: c.fusion.score,
        survivedFinalCap: finalIds.has(c.chunkId)
      }));

    // Score every exact-match hit for this concept through the fusion
    // formula even if it did NOT survive dedup/cap, so we can see its
    // would-be fusion score and rank position relative to the cap.
    const exactHitScored = exact.candidates
      .filter((c) => matchesConcept(`${c.title} ${c.provenance.canonicalUrl} ${c.text}`, terms))
      .map((c) => {
        const scored = scoreHybridCandidate({
          candidate: c,
          intent: scope.intent,
          methodSignals: {
            methods: ["exact"],
            exact: { matched: true, score: c.scores.exactMatch, rank: null },
            lexical: { score: null, rank: null },
            semantic: { similarity: null, rank: null }
          }
        });
        return {
          title: c.title,
          sourceId: c.authority.sourceId,
          chunkId: c.chunkId,
          hypotheticalFusionScoreExactOnly: scored.contributions.total,
          survivedIntoFinalFused: finalIds.has(c.chunkId)
        };
      });

    (report.perConcept as Record<string, unknown>)[concept] = {
      exactMatchCount: exactHits.length,
      exactMatchHits: exactHits.slice(0, 5),
      lexicalCount: lexicalHits.length,
      lexicalHits: lexicalHits.slice(0, 5),
      semanticCount: semanticHits.length,
      semanticHits: semanticHits.slice(0, 5),
      fusedFinalHits: fusedHits,
      exactHitScoredIfNeverMerged: exactHitScored.slice(0, 5)
    };
  }

  // Locate specific candidate DOCUMENTS by title, across every channel, at
  // their true rank (not sliced), to see exactly where each channel placed
  // them and whether they were present in the corpus/candidate pool at all.
  const titlesOfInterest = [
    "Get-CsOnlineUser",
    "Get-CsOnlineVoiceUser",
    "Get-CsTeamsCallingPolicy",
    "Grant-CsTeamsCallingPolicy",
    "Get-CsOnlineVoiceRoutingPolicy"
  ];
  const locate = (candidates: Array<{ title: string | null; chunkId: string; scores: unknown }>) =>
    titlesOfInterest.map((title) => {
      const idx = candidates.findIndex((c) => c.title === title);
      return { title, foundAtRank: idx === -1 ? null : idx + 1, total: candidates.length };
    });
  report.specificDocumentRanks = {
    exact: locate(exact.candidates as any),
    lexical: locate(lexical.candidates as any),
    semantic: locate(semantic.candidates as any),
    fused: locate(hybrid.candidates as any)
  };

  // Inspect the actual chunk content (heading path + text snippet) for the
  // best-ranked instance of each title of interest, across lexical+semantic,
  // to see whether the retrieved CHUNK (not just the document) actually
  // carries the requested concept in a matchable way.
  report.chunkInspection = titlesOfInterest.map((title) => {
    const allInstances = [...lexical.candidates, ...semantic.candidates].filter((c) => c.title === title);
    const best = allInstances[0];
    return best
      ? {
          title,
          chunkId: best.chunkId,
          headingPath: best.headingPath,
          canonicalUrl: best.provenance.canonicalUrl,
          textSnippet: best.text.slice(0, 400)
        }
      : { title, found: false };
  });

  // Search ALL channels for any chunk whose heading path literally names an
  // EnterpriseVoiceEnabled-style parameter/property, to find the true best
  // upstream candidate for the "Enterprise Voice enabled state" output.
  const evPattern = /enterprisevoice/i;
  const findEvChunks = (label: string, candidates: typeof exact.candidates) =>
    candidates
      .map((c, index) => ({ idx: index, c }))
      .filter(({ c }) => evPattern.test(`${c.title} ${c.headingPath.join(" ")}`))
      .slice(0, 10)
      .map(({ idx, c }) => ({
        channel: label,
        rankInChannel: idx + 1,
        title: c.title,
        headingPath: c.headingPath,
        chunkId: c.chunkId
      }));
  report.enterpriseVoiceParamSearch = [
    ...findEvChunks("exact", exact.candidates),
    ...findEvChunks("lexical", lexical.candidates),
    ...findEvChunks("semantic", semantic.candidates)
  ];

  // Debug the "calling policy" preservation decision directly: why did
  // "Set-CsTenantNetworkSite" qualify as topically relevant?
  const callingPolicyDebugTitles = ["Get-CsTeamsCallingPolicy", "Set-CsTenantNetworkSite"];
  const debugAll = [...exact.candidates, ...lexical.candidates, ...semantic.candidates];
  report.callingPolicyDebug = callingPolicyDebugTitles.map((title) => {
    const instances = debugAll.filter((c) => c.title === title);
    return instances.slice(0, 3).map((c) => ({
      title,
      chunkId: c.chunkId,
      headingPath: c.headingPath,
      matchesDirective: directiveTopicallyMatchesCandidate("calling policy", c as any),
      textSnippet: c.text.slice(0, 300)
    }));
  });

  report.finalFusedCount = hybrid.candidates.length;
  report.finalFusedTop24Titles = hybrid.candidates.map((c) => ({
    rank: c.fusion.rank,
    title: c.title,
    sourceId: c.authority.sourceId,
    score: c.fusion.score
  }));
  report.fusionDiagnostics = hybrid.fusionDiagnostics;

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
