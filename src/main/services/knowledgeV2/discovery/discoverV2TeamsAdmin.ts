import { parseTeamsAdminDiscoveryCliArgs, TeamsAdminDiscoveryJob } from "./teamsAdminDiscoveryJob";

async function main(): Promise<void> {
  const request = parseTeamsAdminDiscoveryCliArgs(process.argv.slice(2));
  const job = new TeamsAdminDiscoveryJob();
  const result = await job.run(request);
  process.stdout.write(
    `[CG-01E1] run=${result.runId} mode=${result.mode} queries=${result.summary.totalQueries} success=${result.summary.successfulQueries} failed=${result.summary.failedQueries} rawHits=${result.summary.rawSearchHits} unique=${result.summary.uniqueCanonicalArticles} accepted=${result.summary.acceptedCount} excluded=${result.summary.excludedCount} needsReview=${result.summary.needsReviewCount} candidate=${result.summary.candidateCount}\n`
  );
  process.stdout.write(
    `[CG-01E1] directRoutingDiscovered=${result.directRoutingValidation.discovered} queryIds=${result.directRoutingValidation.discoveredByQueryIds.join(",") || "none"}\n`
  );
  process.stdout.write(
    `[CG-01E1] artifacts json=${result.artifacts.jsonPath} jsonl=${result.artifacts.jsonlPath} md=${result.artifacts.markdownPath}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`[CG-01E1] discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
