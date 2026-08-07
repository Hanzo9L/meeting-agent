import { createSourceSyncAdapter } from "./sourceSyncJobs";
import {
  GitHubRestRepositoryClient,
  type GitHubRequestDiagnostic
} from "./githubAdapter";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const sourceId = getArg("--source") ?? "ms-teams-admin";
  const trackId = getArg("--track") ?? "ga";
  const fetchContent = process.argv.includes("--fetch-content");
  const noAuth = process.argv.includes("--no-auth");
  const diagnosticsEnabled = process.argv.includes("--debug-http");
  const diagnostics: GitHubRequestDiagnostic[] = [];
  const client = new GitHubRestRepositoryClient({
    token: noAuth ? "" : process.env.GITHUB_TOKEN,
    onDiagnostic: diagnosticsEnabled ? (event) => diagnostics.push(event) : undefined
  });
  const adapter = createSourceSyncAdapter({ client });

  const plan = adapter.createSyncPlan(sourceId, trackId);
  const result = await adapter.syncTrack({
    sourceId,
    trackId,
    options: { fetchContent }
  });

  const payload = {
    plan,
    summary: {
      resolvedCommitSha: result.resolvedCommitSha,
      added: result.added.length,
      modified: result.modified.length,
      unchanged: result.unchanged.length,
      deleted: result.deleted.length,
      skipped: result.skipped.length,
      errors: result.errors.length
    },
    firstErrors: result.errors.slice(0, 5),
    authMode: noAuth ? "anonymous_forced" : "default",
    diagnostics: diagnosticsEnabled ? diagnostics : undefined
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Unknown source sync inspection error"
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

