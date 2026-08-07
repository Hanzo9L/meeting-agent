import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SourceAcquisitionCoordinator } from "../acquisition/coordinator";
import { createSourceSyncAdapter } from "../sync/sourceSyncJobs";
import type { AcquiredDocumentInput } from "./types";

async function saveFixture(path: string, payload: AcquiredDocumentInput): Promise<void> {
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

async function main(): Promise<void> {
  const outDir = resolve("src/main/services/knowledgeV2/parse/fixtures");
  await mkdir(outDir, { recursive: true });

  const coordinator = new SourceAcquisitionCoordinator();
  const learn = await coordinator.acquire({
    sourceId: "ms-teams-admin",
    trackId: "ga"
  });
  const learnDoc = learn.added[0];
  if (!learnDoc) {
    throw new Error(`Learn fixture acquisition failed: ${learn.errors.map((error) => error.message).join("; ")}`);
  }

  const sync = createSourceSyncAdapter();
  const powershell = await sync.syncTrack({
    sourceId: "ms-teams-powershell",
    trackId: "ga",
    options: { fetchContent: true, maxFileFetchFailures: 20 }
  });

  const conceptual = powershell.added.find((item) =>
    item.path.toLowerCase().startsWith("teams/docs-conceptual/")
  );
  const cmdlet = powershell.added.find((item) =>
    item.path.toLowerCase().startsWith("teams/teams-ps/microsoftteams/")
  );
  if (!conceptual || !cmdlet) {
    throw new Error("Unable to select required PowerShell conceptual and cmdlet fixtures.");
  }

  const toInput = (sourceId: string, trackId: string, item: { path: string; githubUrl: string; content?: string; commitSha: string; blobSha: string; repository: string; branch: string; }): AcquiredDocumentInput => ({
    sourceId,
    trackId,
    transport: "github",
    canonicalUrl: item.githubUrl,
    rawMarkdown: item.content ?? "",
    revision: {
      transport: "github",
      repository: item.repository,
      branch: item.branch,
      commitSha: item.commitSha,
      blobSha: item.blobSha,
      path: item.path
    }
  });

  await saveFixture(
    resolve(outDir, "teams-admin-learn-direct-routing.json"),
    {
      sourceId: learnDoc.sourceId,
      trackId: learnDoc.trackId,
      transport: "learn_mcp",
      canonicalUrl: learnDoc.canonicalUrl,
      rawMarkdown: learnDoc.rawMarkdown,
      revision: learnDoc.revision
    }
  );
  await saveFixture(
    resolve(outDir, "teams-powershell-conceptual.json"),
    toInput("ms-teams-powershell", "ga", conceptual)
  );
  await saveFixture(
    resolve(outDir, "teams-powershell-cmdlet.json"),
    toInput("ms-teams-powershell", "ga", cmdlet)
  );

  console.log(
    JSON.stringify(
      {
        outDir,
        learnUrl: learnDoc.canonicalUrl,
        conceptualPath: conceptual.path,
        cmdletPath: cmdlet.path
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      { error: error instanceof Error ? error.message : "Fixture generation failed." },
      null,
      2
    )
  );
  process.exitCode = 1;
});

