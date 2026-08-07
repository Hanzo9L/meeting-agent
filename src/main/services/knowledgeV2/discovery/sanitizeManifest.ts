import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createKnowledgeV2SqliteStore,
  resolveKnowledgeV2DatabasePath
} from "../index";
import { classifyTeamsAdminEntry } from "./classifier";
import { TEAMS_ADMIN_TAXONOMY } from "./taxonomy";
import type {
  TeamsAdminDiscoveryRunResult,
  TeamsAdminDiscoveryStatus,
  TeamsAdminDomainCoverage,
  TeamsAdminManifestEntry,
  TeamsAdminSanitizedEntry,
  TeamsAdminSanitizedManifest,
  TeamsAdminSanitizedSummary
} from "./types";

const DEFAULT_INPUT_MANIFEST =
  "eval/runs/discovery/cg01e1-2026-08-07T18-55-12-407Z.json";
const DEFAULT_OUTPUT_DIR = "eval/runs/discovery";
const APPROVAL_DOC_PATH = "docs/engineering/CG01E1_TEAMS_ADMIN_CORPUS_APPROVAL.md";
const SANITIZATION_VERSION = "cg01e1.1-sanitized-v1";
const DOMAIN_ORDER = [
  "core_admin",
  "voice_direct_routing",
  "voice_calling",
  "meetings",
  "external_collaboration",
  "messaging_teams_management",
  "devices",
  "security_compliance_intersections"
] as const;

type DomainId = (typeof DOMAIN_ORDER)[number];

function parseArgs(argv: string[]): {
  input: string;
  outputDir: string;
  dbPath?: string;
} {
  const readFlag = (flag: string): string | undefined => {
    const index = argv.findIndex((arg) => arg === flag);
    if (index < 0) return undefined;
    return argv[index + 1];
  };
  return {
    input: readFlag("--input") ?? DEFAULT_INPUT_MANIFEST,
    outputDir: readFlag("--output-dir") ?? DEFAULT_OUTPUT_DIR,
    dbPath: readFlag("--db")
  };
}

function sanitizeEntry(entry: TeamsAdminManifestEntry): TeamsAdminSanitizedEntry {
  const classified = classifyTeamsAdminEntry({
    articlePath: entry.articlePath,
    canonicalUrl: entry.canonicalUrl,
    title: entry.title,
    snippet: entry.snippet,
    taxonomyDomains: entry.taxonomyDomains
  });
  const changed =
    entry.status !== classified.status ||
    JSON.stringify(entry.reasonCodes) !== JSON.stringify(classified.reasonCodes) ||
    entry.authorityClassification !== classified.authorityClassification;
  const changeReason =
    changed && classified.reasonCodes.includes("excluded_non_article_asset")
      ? "non_article_asset_rule_applied"
      : changed
        ? "classifier_re_evaluated"
        : null;
  return {
    entryId: entry.entryId,
    canonicalUrl: entry.canonicalUrl,
    articlePath: entry.articlePath,
    title: entry.title,
    taxonomyDomains: [...entry.taxonomyDomains],
    discoveryQueryIds: [...entry.discoveryQueryIds],
    originalStatus: entry.status,
    originalReasonCodes: [...entry.reasonCodes],
    sanitizedStatus: classified.status,
    sanitizedReasonCodes: [...classified.reasonCodes],
    originalAuthorityClassification: entry.authorityClassification,
    sanitizedAuthorityClassification: classified.authorityClassification,
    originalAdjacentDomainHints: [...entry.adjacentDomainHints],
    sanitizedAdjacentDomainHints: [...classified.adjacentDomainHints],
    changed,
    changeReason
  };
}

function countStatuses(entries: TeamsAdminSanitizedEntry[], mode: "original" | "sanitized"): {
  accepted: number;
  needsReview: number;
  candidate: number;
  excluded: number;
} {
  const readStatus = (entry: TeamsAdminSanitizedEntry): TeamsAdminDiscoveryStatus =>
    mode === "original" ? entry.originalStatus : entry.sanitizedStatus;
  return {
    accepted: entries.filter((entry) => readStatus(entry) === "accepted").length,
    needsReview: entries.filter((entry) => readStatus(entry) === "needs_review").length,
    candidate: entries.filter((entry) => readStatus(entry) === "candidate").length,
    excluded: entries.filter((entry) => readStatus(entry) === "excluded").length
  };
}

function buildSummary(entries: TeamsAdminSanitizedEntry[]): TeamsAdminSanitizedSummary {
  const originalCounts = countStatuses(entries, "original");
  const sanitizedCounts = countStatuses(entries, "sanitized");
  const changedEntries = entries.filter((entry) => entry.changed).length;
  const movedFromAcceptedToExcluded = entries.filter(
    (entry) => entry.originalStatus === "accepted" && entry.sanitizedStatus === "excluded"
  ).length;
  const movedFromAcceptedToNeedsReview = entries.filter(
    (entry) => entry.originalStatus === "accepted" && entry.sanitizedStatus === "needs_review"
  ).length;
  const movedFromAccepted = movedFromAcceptedToExcluded + movedFromAcceptedToNeedsReview;
  const excludedNonArticleAssets = entries.filter((entry) =>
    entry.sanitizedReasonCodes.includes("excluded_non_article_asset")
  ).length;
  return {
    uniqueCanonicalArticles: entries.length,
    originalCounts,
    sanitizedCounts,
    changedEntries,
    movedFromAccepted,
    movedFromAcceptedToExcluded,
    movedFromAcceptedToNeedsReview,
    excludedNonArticleAssets
  };
}

function coverageWarnings(stats: {
  rawHits: number;
  uniqueCandidates: number;
  excluded: number;
  duplicateHits: number;
}): string[] {
  const warnings: string[] = [];
  if (stats.rawHits === 0) warnings.push("zero_results");
  if (stats.uniqueCandidates > 0 && stats.excluded / stats.uniqueCandidates > 0.7) {
    warnings.push("high_exclusion_rate");
  }
  if (stats.rawHits > 0 && stats.duplicateHits / stats.rawHits >= 0.5) {
    warnings.push("high_duplication");
  }
  if (stats.uniqueCandidates > 0 && stats.rawHits <= 2) {
    warnings.push("weak_result_volume");
  }
  return warnings;
}

function buildSanitizedCoverage(
  source: TeamsAdminDiscoveryRunResult,
  entries: TeamsAdminSanitizedEntry[]
): TeamsAdminDomainCoverage[] {
  return TEAMS_ADMIN_TAXONOMY.domains.map((domain) => {
    const sourceCoverage = source.coverage.find((item) => item.domainId === domain.domainId);
    const domainEntries = entries.filter((entry) => entry.taxonomyDomains.includes(domain.domainId));
    const accepted = domainEntries.filter((entry) => entry.sanitizedStatus === "accepted").length;
    const excluded = domainEntries.filter((entry) => entry.sanitizedStatus === "excluded").length;
    const needsReview = domainEntries.filter((entry) => entry.sanitizedStatus === "needs_review").length;
    const candidate = domainEntries.filter((entry) => entry.sanitizedStatus === "candidate").length;
    const rawHits = sourceCoverage?.rawHits ?? 0;
    const duplicateHits = sourceCoverage?.duplicateHits ?? 0;
    return {
      domainId: domain.domainId,
      queryCount: sourceCoverage?.queryCount ?? 0,
      successfulQueries: sourceCoverage?.successfulQueries ?? 0,
      failedQueries: sourceCoverage?.failedQueries ?? 0,
      rawHits,
      uniqueCandidates: domainEntries.length,
      accepted,
      excluded,
      needsReview,
      candidate,
      duplicateHits,
      warnings: coverageWarnings({
        rawHits,
        uniqueCandidates: domainEntries.length,
        excluded,
        duplicateHits
      })
    };
  });
}

function classifyCoverageStrength(coverage: TeamsAdminDomainCoverage): "strong" | "adequate" | "weak" | "absent" {
  if (coverage.accepted === 0) return "absent";
  if (coverage.accepted >= 15) return "strong";
  if (coverage.accepted >= 6) return "adequate";
  return "weak";
}

function includeExcludeRecommendation(entry: TeamsAdminSanitizedEntry): {
  decision: "INCLUDE" | "EXCLUDE";
  rationale: string;
} {
  const hints = entry.sanitizedAdjacentDomainHints.map((hint) => hint.toLowerCase());
  if (
    hints.includes("entra") ||
    hints.includes("intune") ||
    hints.includes("purview") ||
    hints.includes("microsoft 365")
  ) {
    return {
      decision: "EXCLUDE",
      rationale: "Cross-product authority hints suggest primary ownership is outside Teams Admin."
    };
  }
  return {
    decision: "INCLUDE",
    rationale: "Appears Teams-admin-relevant and useful if reviewer confirms operational ownership."
  };
}

function suspiciousAcceptedEntries(entries: TeamsAdminSanitizedEntry[]): TeamsAdminSanitizedEntry[] {
  return entries.filter((entry) => {
    if (entry.sanitizedStatus !== "accepted") return false;
    const text = `${entry.title ?? ""} ${entry.canonicalUrl}`.toLowerCase();
    return (
      text.includes("/platform/") ||
      text.includes("/answers/") ||
      text.includes("/training/") ||
      text.includes("quickstart") ||
      text.includes("for users") ||
      text.includes("/media/")
    );
  });
}

function writeApprovalMarkdown(
  sanitized: TeamsAdminSanitizedManifest
): string {
  const accepted = sanitized.entries.filter((entry) => entry.sanitizedStatus === "accepted");
  const needsReview = sanitized.entries.filter((entry) => entry.sanitizedStatus === "needs_review");
  const candidates = sanitized.entries.filter((entry) => entry.sanitizedStatus === "candidate");
  const excluded = sanitized.entries.filter((entry) => entry.sanitizedStatus === "excluded");
  const suspicious = suspiciousAcceptedEntries(sanitized.entries);
  const acceptedByPrimary = new Map<DomainId, TeamsAdminSanitizedEntry[]>();
  for (const domain of DOMAIN_ORDER) acceptedByPrimary.set(domain, []);
  for (const entry of accepted) {
    const primary = (entry.taxonomyDomains[0] ?? "core_admin") as DomainId;
    const current = acceptedByPrimary.get(primary) ?? [];
    current.push(entry);
    acceptedByPrimary.set(primary, current);
  }
  for (const domain of DOMAIN_ORDER) {
    const current = acceptedByPrimary.get(domain) ?? [];
    current.sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
  }

  const lines: string[] = [];
  lines.push("# CG-01E1.1 Teams Admin Corpus Approval Gate");
  lines.push("");
  lines.push("SANITIZED PROPOSED INITIAL TEAMS ADMIN CORPUS");
  lines.push(`Accepted: ${sanitized.summary.sanitizedCounts.accepted}`);
  lines.push(`Needs human decision: ${sanitized.summary.sanitizedCounts.needsReview}`);
  lines.push(`Candidates deferred: ${sanitized.summary.sanitizedCounts.candidate}`);
  lines.push(`Excluded: ${sanitized.summary.sanitizedCounts.excluded}`);
  lines.push(
    `Removed from automatic acceptance as non-article assets: ${sanitized.summary.movedFromAcceptedToExcluded}`
  );
  lines.push("");
  lines.push("## Scope");
  lines.push(`- Source manifest: \`${sanitized.sourceManifestPath}\``);
  lines.push(`- Sanitized manifest run: \`${sanitized.runId}\``);
  lines.push("- No discovery rerun and no corpus indexing occurred in this pass.");
  lines.push("");
  lines.push("## Approval Set");
  lines.push(`- Automatically proposed for approval: ${accepted.length} sanitized accepted entries.`);
  lines.push(
    `- Human-decision queue: ${needsReview.length} sanitized needs_review entries (listed individually below).`
  );
  lines.push(`- Candidate queue (deferred): ${candidates.length} entries.`);
  lines.push(`- Excluded queue: ${excluded.length} entries.`);
  lines.push("");
  lines.push("## Coverage Assessment");
  for (const domain of sanitized.coverage) {
    lines.push(`- ${domain.domainId}: ${classifyCoverageStrength(domain)}`);
  }
  lines.push("");
  lines.push("## Known Validation Articles");
  const findAccepted = (needle: string): TeamsAdminSanitizedEntry | undefined =>
    accepted.find((entry) => entry.canonicalUrl.includes(needle));
  const knownChecks: Array<{ label: string; needle: string }> = [
    { label: "Direct Routing", needle: "/microsoftteams/direct-routing-landing-page" },
    { label: "Meeting policies", needle: "/microsoftteams/meeting-policies-overview" },
    { label: "External access", needle: "/microsoftteams/manage-external-access" },
    { label: "Guest access", needle: "/microsoftteams/guest-access" },
    { label: "Call queue", needle: "/microsoftteams/create-a-phone-system-call-queue" },
    { label: "Auto attendants", needle: "/microsoftteams/create-a-phone-system-auto-attendant" },
    { label: "Teams Rooms", needle: "/microsoftteams/rooms/" }
  ];
  for (const check of knownChecks) {
    const found = findAccepted(check.needle);
    lines.push(
      `- ${check.label}: ${found ? `FOUND (\`${found.canonicalUrl}\`)` : "NOT FOUND in sanitized accepted set"}`
    );
  }
  lines.push("");
  lines.push("## Security/Compliance Interpretation");
  const secCoverage = sanitized.coverage.find(
    (domain) => domain.domainId === "security_compliance_intersections"
  );
  lines.push(
    `- security_compliance_intersections: accepted=${secCoverage?.accepted ?? 0}, needs_review=${secCoverage?.needsReview ?? 0}, candidate=${secCoverage?.candidate ?? 0}, excluded=${secCoverage?.excluded ?? 0}`
  );
  lines.push(
    "- Zero accepted appears consistent with authority boundaries (Entra/Intune/Purview/M365 often primary for those controls)."
  );
  lines.push("");
  lines.push("## Accepted Entries Requiring Human Reconsideration");
  if (suspicious.length === 0) {
    lines.push("- None flagged by deterministic metadata checks.");
  } else {
    lines.push(`- ${suspicious.length} accepted entries flagged for reconsideration:`);
    for (const entry of suspicious) {
      lines.push(
        `- ${entry.entryId} | ${entry.title ?? "(untitled)"} | ${entry.canonicalUrl} | domains=${entry.taxonomyDomains.join(",")} | queries=${entry.discoveryQueryIds.join(",")}`
      );
    }
  }
  lines.push("");
  lines.push("## Human-Review Queue (All needs_review Entries)");
  const sortedNeeds = [...needsReview].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
  for (const entry of sortedNeeds) {
    const rec = includeExcludeRecommendation(entry);
    lines.push(`- ${entry.entryId}`);
    lines.push(`  - title: ${entry.title ?? "(untitled)"}`);
    lines.push(`  - canonical_url: ${entry.canonicalUrl}`);
    lines.push(`  - taxonomy_domains: ${entry.taxonomyDomains.join(", ")}`);
    lines.push(`  - why_review: ${entry.sanitizedReasonCodes.join(", ")}`);
    lines.push(`  - recommendation: ${rec.decision}`);
    lines.push(`  - rationale: ${rec.rationale}`);
  }
  lines.push("");
  lines.push("## Candidate Queue Summary (Deferred)");
  const candidateCounts = new Map<DomainId, number>();
  for (const domain of DOMAIN_ORDER) candidateCounts.set(domain, 0);
  for (const entry of candidates) {
    for (const domain of entry.taxonomyDomains) {
      candidateCounts.set(domain, (candidateCounts.get(domain as DomainId) ?? 0) + 1);
    }
  }
  for (const domain of DOMAIN_ORDER) {
    lines.push(`- ${domain}: ${candidateCounts.get(domain) ?? 0}`);
  }
  lines.push("");
  lines.push("## Excluded Summary");
  lines.push(`- Excluded total: ${excluded.length}`);
  const reasonCounts = new Map<string, number>();
  for (const entry of excluded) {
    for (const reason of entry.sanitizedReasonCodes) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${reason}: ${count}`);
  }
  lines.push("");
  lines.push("## Accepted Corpus Review (Grouped by Primary Domain)");
  for (const domain of DOMAIN_ORDER) {
    const group = acceptedByPrimary.get(domain) ?? [];
    lines.push(`### ${domain} (${group.length})`);
    if (group.length === 0) {
      lines.push("- none");
      continue;
    }
    for (const entry of group) {
      lines.push(
        `- ${entry.title ?? "(untitled)"} | ${entry.canonicalUrl} | domains=${entry.taxonomyDomains.join(",")} | queries=${entry.discoveryQueryIds.join(",")}`
      );
    }
    lines.push("");
  }
  lines.push("## Recommendation For CG-01E2 Input");
  lines.push(`- Base set: ${accepted.length} sanitized accepted entries.`);
  lines.push("- Plus only explicitly human-approved needs_review entries.");
  lines.push("- Candidate and excluded queues remain out of scope for initial indexing.");
  lines.push("");
  lines.push("## No-Mutation Confirmation");
  lines.push("- No MCP search rerun.");
  lines.push("- No Teams Admin indexing/chunking/FTS/embedding operations.");
  lines.push("- No PowerShell corpus mutation.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildSanitizedManifest(
  source: TeamsAdminDiscoveryRunResult,
  sourceManifestPath: string
): TeamsAdminSanitizedManifest {
  const entries = source.entries.map(sanitizeEntry).sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
  const summary = buildSummary(entries);
  const coverage = buildSanitizedCoverage(source, entries);
  const directRoutingTarget = source.directRoutingValidation.targetCanonicalUrl;
  const directRouting = entries.find((entry) => entry.canonicalUrl === directRoutingTarget);
  return {
    runId: `cg01e1s-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    generatedAt: new Date().toISOString(),
    sanitizationVersion: SANITIZATION_VERSION,
    sourceManifestPath,
    sourceRunId: source.runId,
    sourceManifestVersion: source.manifestVersion,
    sourceTaxonomyVersion: source.taxonomyVersion,
    discoveredTools: [...source.discoveredTools],
    queryCount: source.queryMetrics.length,
    entries,
    summary,
    coverage,
    directRoutingValidation: {
      targetCanonicalUrl: directRoutingTarget,
      acceptedInSanitizedSet: directRouting?.sanitizedStatus === "accepted",
      sanitizedStatus: directRouting?.sanitizedStatus ?? null,
      queryIds: directRouting?.discoveryQueryIds ?? []
    }
  };
}

function computePowerShellSafetyCounts(dbPath: string): {
  documents: number;
  activeChunks: number;
  embeddings: number;
} {
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations")
  });
  store.initializeDatabase();
  try {
    const docs = store.listDocumentsBySource({
      sourceId: "ms-teams-powershell",
      trackId: "ga"
    });
    const chunkIds = new Set<string>();
    let activeChunks = 0;
    for (const doc of docs) {
      const chunks = store.listChunksForDocument({ documentId: doc.documentId });
      activeChunks += chunks.length;
      for (const chunk of chunks) chunkIds.add(chunk.chunkId);
    }
    const embeddings = store
      .listChunkEmbeddings()
      .filter((row) => chunkIds.has(row.chunkId)).length;
    return { documents: docs.length, activeChunks, embeddings };
  } finally {
    store.close();
  }
}

export async function sanitizeExistingManifest(request: {
  inputManifestPath: string;
  outputDir: string;
  dbPath?: string;
  approvalPath?: string;
}): Promise<{
  sanitized: TeamsAdminSanitizedManifest;
  artifactPaths: {
    jsonPath: string;
    jsonlPath: string;
    markdownPath: string;
    approvalPath: string;
  };
  powerShellBefore: { documents: number; activeChunks: number; embeddings: number };
  powerShellAfter: { documents: number; activeChunks: number; embeddings: number };
}> {
  const started = performance.now();
  const inputPath = resolve(request.inputManifestPath);
  const outputDir = resolve(request.outputDir);
  const source = JSON.parse(await readFile(inputPath, "utf8")) as TeamsAdminDiscoveryRunResult;
  const dbPath = resolve(request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() }));
  const powerShellBefore = computePowerShellSafetyCounts(dbPath);
  const sanitized = buildSanitizedManifest(source, request.inputManifestPath);
  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, `${sanitized.runId}.json`);
  const jsonlPath = join(outputDir, `${sanitized.runId}.jsonl`);
  const markdownPath = join(outputDir, `${sanitized.runId}.md`);
  const approvalPath = resolve(request.approvalPath ?? APPROVAL_DOC_PATH);

  await writeFile(jsonPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  await writeFile(
    jsonlPath,
    `${sanitized.entries
      .map((entry) =>
        JSON.stringify({
          runId: sanitized.runId,
          entryId: entry.entryId,
          canonicalUrl: entry.canonicalUrl,
          originalStatus: entry.originalStatus,
          sanitizedStatus: entry.sanitizedStatus,
          changed: entry.changed,
          reasonCodes: entry.sanitizedReasonCodes
        })
      )
      .join("\n")}\n`,
    "utf8"
  );
  const markdownLines: string[] = [];
  markdownLines.push(`# CG-01E1.1 Sanitized Manifest ${sanitized.runId}`);
  markdownLines.push("");
  markdownLines.push(`- Source run: ${sanitized.sourceRunId}`);
  markdownLines.push(`- Source manifest: \`${request.inputManifestPath}\``);
  markdownLines.push(`- Sanitization version: ${sanitized.sanitizationVersion}`);
  markdownLines.push(`- Unique entries: ${sanitized.summary.uniqueCanonicalArticles}`);
  markdownLines.push(
    `- Original counts: accepted=${sanitized.summary.originalCounts.accepted} needs_review=${sanitized.summary.originalCounts.needsReview} candidate=${sanitized.summary.originalCounts.candidate} excluded=${sanitized.summary.originalCounts.excluded}`
  );
  markdownLines.push(
    `- Sanitized counts: accepted=${sanitized.summary.sanitizedCounts.accepted} needs_review=${sanitized.summary.sanitizedCounts.needsReview} candidate=${sanitized.summary.sanitizedCounts.candidate} excluded=${sanitized.summary.sanitizedCounts.excluded}`
  );
  markdownLines.push(
    `- Changed entries: ${sanitized.summary.changedEntries} (accepted->excluded=${sanitized.summary.movedFromAcceptedToExcluded}, accepted->needs_review=${sanitized.summary.movedFromAcceptedToNeedsReview})`
  );
  markdownLines.push(
    `- Excluded as non-article assets: ${sanitized.summary.excludedNonArticleAssets}`
  );
  markdownLines.push("");
  markdownLines.push("## Status Changes");
  const changedEntries = sanitized.entries.filter((entry) => entry.changed);
  if (changedEntries.length === 0) {
    markdownLines.push("- none");
  } else {
    for (const entry of changedEntries) {
      markdownLines.push(
        `- ${entry.entryId} | ${entry.canonicalUrl} | ${entry.originalStatus} -> ${entry.sanitizedStatus} | ${entry.changeReason ?? "status_or_reason_changed"}`
      );
    }
  }
  markdownLines.push("");
  markdownLines.push(`- Duration ms (sanitization): ${(performance.now() - started).toFixed(2)}`);
  await writeFile(markdownPath, `${markdownLines.join("\n")}\n`, "utf8");

  const approvalMarkdown = writeApprovalMarkdown(sanitized);
  await mkdir(dirname(approvalPath), { recursive: true });
  await writeFile(approvalPath, approvalMarkdown, "utf8");

  const powerShellAfter = computePowerShellSafetyCounts(dbPath);
  return {
    sanitized,
    artifactPaths: { jsonPath, jsonlPath, markdownPath, approvalPath },
    powerShellBefore,
    powerShellAfter
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await sanitizeExistingManifest({
    inputManifestPath: args.input,
    outputDir: args.outputDir,
    dbPath: args.dbPath,
    approvalPath: APPROVAL_DOC_PATH
  });
  process.stdout.write(
    `[CG-01E1.1] run=${result.sanitized.runId} accepted=${result.sanitized.summary.sanitizedCounts.accepted} needs_review=${result.sanitized.summary.sanitizedCounts.needsReview} candidate=${result.sanitized.summary.sanitizedCounts.candidate} excluded=${result.sanitized.summary.sanitizedCounts.excluded} nonArticleExcluded=${result.sanitized.summary.excludedNonArticleAssets}\n`
  );
  process.stdout.write(
    `[CG-01E1.1] artifacts json=${result.artifactPaths.jsonPath} jsonl=${result.artifactPaths.jsonlPath} md=${result.artifactPaths.markdownPath}\n`
  );
  process.stdout.write(
    `[CG-01E1.1] approvalDoc=${result.artifactPaths.approvalPath} powershellBefore=${result.powerShellBefore.documents}/${result.powerShellBefore.activeChunks}/${result.powerShellBefore.embeddings} powershellAfter=${result.powerShellAfter.documents}/${result.powerShellAfter.activeChunks}/${result.powerShellAfter.embeddings}\n`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `[CG-01E1.1] sanitation failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
