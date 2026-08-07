import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type {
  TeamsAdminDiscoveryStatus,
  TeamsAdminDomainId,
  TeamsAdminReasonCode,
  TeamsAdminSanitizedManifest
} from "./types";

interface TargetedResultEntry {
  canonicalUrl: string;
  articlePath: string;
  title: string | null;
  status: TeamsAdminDiscoveryStatus;
  statuses: TeamsAdminDiscoveryStatus[];
  reasons: TeamsAdminReasonCode[];
  queryIds: string[];
  topics: string[];
  existingInManifest: boolean;
}

interface TargetedDiscoveryRun {
  runId: string;
  sourceManifest: string;
  summary: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    uniqueCanonicalResults: number;
    newCanonicalNotInManifest: number;
    newlyQualifiedCount: number;
  };
  uniqueResults: TargetedResultEntry[];
  newlyQualified: TargetedResultEntry[];
}

type HumanApprovalReason =
  | "sanitized_deterministic_accept"
  | "previous_human_general_approval"
  | "calling_plans_targeted_accept"
  | "calling_plans_needs_review_human_include"
  | "human_approved_classifier_override";

interface FinalManifestEntry {
  entryId: string;
  canonicalUrl: string;
  articlePath: string;
  title: string | null;
  taxonomyDomains: TeamsAdminDomainId[];
  sourceIds: string[];
  discoveryQueryIds: string[];
  discoveryTopics: string[];
  discoveryRunIds: string[];
  classification: {
    baseOriginalStatus: TeamsAdminDiscoveryStatus | null;
    baseSanitizedStatus: TeamsAdminDiscoveryStatus | null;
    baseOriginalReasonCodes: TeamsAdminReasonCode[];
    baseSanitizedReasonCodes: TeamsAdminReasonCode[];
    targetedStatus: TeamsAdminDiscoveryStatus | null;
    targetedStatuses: TeamsAdminDiscoveryStatus[];
    targetedReasonCodes: TeamsAdminReasonCode[];
  };
  humanApproval: {
    include: true;
    reasons: HumanApprovalReason[];
    notes: string[];
  };
}

interface FinalCoverage {
  category: string;
  rating: "strong" | "adequate" | "weak" | "absent";
  evidenceUrls: string[];
}

function makeEntryId(canonicalUrl: string): string {
  return `ta-${createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16)}`;
}

function parseArgs(argv: string[]): {
  baseManifestPath: string;
  targetedManifestPath: string;
  outputDir: string;
} {
  const readFlag = (flag: string): string | undefined => {
    const idx = argv.findIndex((arg) => arg === flag);
    if (idx < 0) return undefined;
    return argv[idx + 1];
  };
  return {
    baseManifestPath:
      readFlag("--base") ?? "eval/runs/discovery/cg01e1s-2026-08-07T19-08-55-854Z.json",
    targetedManifestPath:
      readFlag("--targeted") ?? "eval/runs/discovery/cg01e1cp-2026-08-07T19-19-36-783Z.json",
    outputDir: readFlag("--output-dir") ?? "eval/runs/discovery"
  };
}

function targetedTopicsToDomains(topics: string[]): TeamsAdminDomainId[] {
  const domains = new Set<TeamsAdminDomainId>();
  for (const topic of topics) {
    if (topic.includes("calling") || topic.includes("port") || topic.includes("emergency")) {
      domains.add("voice_calling");
      continue;
    }
    if (topic.includes("call_queues_auto_attendants")) {
      domains.add("voice_calling");
      domains.add("messaging_teams_management");
      continue;
    }
  }
  if (domains.size === 0) domains.add("voice_calling");
  return [...domains];
}

function upsertEntry(
  map: Map<string, FinalManifestEntry>,
  next: FinalManifestEntry
): void {
  const existing = map.get(next.canonicalUrl);
  if (!existing) {
    map.set(next.canonicalUrl, next);
    return;
  }
  if (!existing.title && next.title) existing.title = next.title;
  existing.taxonomyDomains = [...new Set([...existing.taxonomyDomains, ...next.taxonomyDomains])];
  existing.sourceIds = [...new Set([...existing.sourceIds, ...next.sourceIds])];
  existing.discoveryQueryIds = [...new Set([...existing.discoveryQueryIds, ...next.discoveryQueryIds])];
  existing.discoveryTopics = [...new Set([...existing.discoveryTopics, ...next.discoveryTopics])];
  existing.discoveryRunIds = [...new Set([...existing.discoveryRunIds, ...next.discoveryRunIds])];
  existing.classification.baseOriginalStatus =
    existing.classification.baseOriginalStatus ?? next.classification.baseOriginalStatus;
  existing.classification.baseSanitizedStatus =
    existing.classification.baseSanitizedStatus ?? next.classification.baseSanitizedStatus;
  existing.classification.baseOriginalReasonCodes = [
    ...new Set([
      ...existing.classification.baseOriginalReasonCodes,
      ...next.classification.baseOriginalReasonCodes
    ])
  ];
  existing.classification.baseSanitizedReasonCodes = [
    ...new Set([
      ...existing.classification.baseSanitizedReasonCodes,
      ...next.classification.baseSanitizedReasonCodes
    ])
  ];
  existing.classification.targetedStatus =
    existing.classification.targetedStatus ?? next.classification.targetedStatus;
  existing.classification.targetedStatuses = [
    ...new Set([...existing.classification.targetedStatuses, ...next.classification.targetedStatuses])
  ];
  existing.classification.targetedReasonCodes = [
    ...new Set([...existing.classification.targetedReasonCodes, ...next.classification.targetedReasonCodes])
  ];
  existing.humanApproval.reasons = [
    ...new Set([...existing.humanApproval.reasons, ...next.humanApproval.reasons])
  ];
  existing.humanApproval.notes = [...new Set([...existing.humanApproval.notes, ...next.humanApproval.notes])];
}

function withUrl(entries: FinalManifestEntry[], contains: string): string[] {
  return entries
    .filter((entry) => entry.canonicalUrl.includes(contains))
    .map((entry) => entry.canonicalUrl);
}

function buildCoverage(entries: FinalManifestEntry[]): FinalCoverage[] {
  const byCategory: FinalCoverage[] = [
    {
      category: "Core Teams administration",
      rating: "adequate",
      evidenceUrls: withUrl(entries, "/microsoftteams/using-admin-roles")
    },
    {
      category: "Teams Phone / Calling Plans",
      rating: "strong",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/calling-plans-for-office-365"),
        ...withUrl(entries, "/microsoftteams/set-up-calling-plans"),
        ...withUrl(entries, "/microsoftteams/setting-up-your-phone-system"),
        ...withUrl(entries, "/microsoftteams/teams-phone-licensing")
      ]
    },
    {
      category: "Direct Routing",
      rating: "strong",
      evidenceUrls: withUrl(entries, "/microsoftteams/direct-routing-landing-page")
    },
    {
      category: "Operator Connect",
      rating: "adequate",
      evidenceUrls: withUrl(entries, "/microsoftteams/operator-connect-")
    },
    {
      category: "phone number management",
      rating: "strong",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/getting-phone-numbers-for-your-users"),
        ...withUrl(entries, "/microsoftteams/phone-number-calling-plans/port-order-overview"),
        ...withUrl(entries, "/microsoftteams/phone-number-calling-plans/transfer-phone-numbers-to-teams")
      ]
    },
    {
      category: "emergency calling",
      rating: "strong",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/what-are-emergency-locations-addresses-and-call-routing"),
        ...withUrl(entries, "/microsoftteams/add-change-remove-emergency-location-organization"),
        ...withUrl(entries, "/microsoftteams/considerations-calling-plan")
      ]
    },
    {
      category: "call queues / auto attendants",
      rating: "strong",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/create-a-phone-system-call-queue"),
        ...withUrl(entries, "/microsoftteams/create-a-phone-system-auto-attendant"),
        ...withUrl(entries, "/microsoftteams/aa-cq-plan-overview")
      ]
    },
    {
      category: "meetings",
      rating: "adequate",
      evidenceUrls: withUrl(entries, "/microsoftteams/meeting-policies-overview")
    },
    {
      category: "external/guest access",
      rating: "adequate",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/manage-external-access"),
        ...withUrl(entries, "/microsoftteams/guest-access")
      ]
    },
    {
      category: "Teams/channel management",
      rating: "strong",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/manage-teams-with-policies"),
        ...withUrl(entries, "/microsoftteams/manage-channel-moderation-in-teams")
      ]
    },
    {
      category: "devices",
      rating: "adequate",
      evidenceUrls: withUrl(entries, "/microsoftteams/rooms/")
    },
    {
      category: "reporting/analytics",
      rating: "adequate",
      evidenceUrls: [
        ...withUrl(entries, "/microsoftteams/teams-analytics-and-reports/teams-reporting-reference"),
        ...withUrl(entries, "/microsoftteams/teams-analytics-and-reports/pstn-usage-report")
      ]
    }
  ];
  return byCategory.map((row) => ({
    ...row,
    evidenceUrls: [...new Set(row.evidenceUrls)]
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = JSON.parse(
    await readFile(resolve(args.baseManifestPath), "utf8")
  ) as TeamsAdminSanitizedManifest;
  const targeted = JSON.parse(
    await readFile(resolve(args.targetedManifestPath), "utf8")
  ) as TargetedDiscoveryRun;

  const entries = new Map<string, FinalManifestEntry>();
  const baseAccepted = base.entries.filter((entry) => entry.sanitizedStatus === "accepted");
  const previousHumanGeneralApprovals: string[] = [
    "https://learn.microsoft.com/en-us/microsoftteams/custom-meeting-templates-overview",
    "https://learn.microsoft.com/en-us/microsoftteams/operator-connect-conferencing-plan",
    "https://learn.microsoft.com/en-us/microsoftteams/operator-connect-configure",
    "https://learn.microsoft.com/en-us/microsoftteams/operator-connect-mobile-configure-numbers",
    "https://learn.microsoft.com/en-us/microsoftteams/phones/phones-for-teams",
    "https://learn.microsoft.com/en-us/microsoftteams/plan-teams-governance",
    "https://learn.microsoft.com/en-us/microsoftteams/shared-channels-errors",
    "https://learn.microsoft.com/en-us/microsoftteams/teams-analytics-and-reports/teams-premium-usage-report",
    "https://learn.microsoft.com/en-us/microsoftteams/teams-analytics-and-reports/teams-reporting-reference"
  ];

  for (const entry of baseAccepted) {
    upsertEntry(entries, {
      entryId: entry.entryId,
      canonicalUrl: entry.canonicalUrl,
      articlePath: entry.articlePath,
      title: entry.title,
      taxonomyDomains: [...entry.taxonomyDomains],
      sourceIds: ["ms-teams-admin"],
      discoveryQueryIds: [...entry.discoveryQueryIds],
      discoveryTopics: [],
      discoveryRunIds: [base.sourceRunId],
      classification: {
        baseOriginalStatus: entry.originalStatus,
        baseSanitizedStatus: entry.sanitizedStatus,
        baseOriginalReasonCodes: [...entry.originalReasonCodes],
        baseSanitizedReasonCodes: [...entry.sanitizedReasonCodes],
        targetedStatus: null,
        targetedStatuses: [],
        targetedReasonCodes: []
      },
      humanApproval: {
        include: true,
        reasons: ["sanitized_deterministic_accept"],
        notes: []
      }
    });
  }

  for (const canonicalUrl of previousHumanGeneralApprovals) {
    const baseEntry = base.entries.find((entry) => entry.canonicalUrl === canonicalUrl);
    if (!baseEntry) continue;
    upsertEntry(entries, {
      entryId: baseEntry.entryId,
      canonicalUrl: baseEntry.canonicalUrl,
      articlePath: baseEntry.articlePath,
      title: baseEntry.title,
      taxonomyDomains: [...baseEntry.taxonomyDomains],
      sourceIds: ["ms-teams-admin"],
      discoveryQueryIds: [...baseEntry.discoveryQueryIds],
      discoveryTopics: [],
      discoveryRunIds: [base.sourceRunId],
      classification: {
        baseOriginalStatus: baseEntry.originalStatus,
        baseSanitizedStatus: baseEntry.sanitizedStatus,
        baseOriginalReasonCodes: [...baseEntry.originalReasonCodes],
        baseSanitizedReasonCodes: [...baseEntry.sanitizedReasonCodes],
        targetedStatus: null,
        targetedStatuses: [],
        targetedReasonCodes: []
      },
      humanApproval: {
        include: true,
        reasons: ["previous_human_general_approval"],
        notes: ["Included from prior human general review decision set."]
      }
    });
  }

  const targetedAccepted = targeted.newlyQualified.filter(
    (entry) => entry.status === "accepted" && !entry.existingInManifest
  );
  for (const entry of targetedAccepted) {
    upsertEntry(entries, {
      entryId: makeEntryId(entry.canonicalUrl),
      canonicalUrl: entry.canonicalUrl,
      articlePath: entry.articlePath,
      title: entry.title,
      taxonomyDomains: targetedTopicsToDomains(entry.topics),
      sourceIds: ["ms-teams-admin"],
      discoveryQueryIds: [...entry.queryIds],
      discoveryTopics: [...entry.topics],
      discoveryRunIds: [targeted.runId],
      classification: {
        baseOriginalStatus: null,
        baseSanitizedStatus: null,
        baseOriginalReasonCodes: [],
        baseSanitizedReasonCodes: [],
        targetedStatus: entry.status,
        targetedStatuses: [...entry.statuses],
        targetedReasonCodes: [...entry.reasons]
      },
      humanApproval: {
        include: true,
        reasons: ["calling_plans_targeted_accept"],
        notes: ["Targeted Calling Plans discovery deterministic accepted entry."]
      }
    });
  }

  const explicitlyApprovedNeedsReviewPaths = [
    "/microsoftteams/considerations-calling-plan",
    "/microsoftteams/add-change-remove-emergency-location-organization",
    "/microsoftteams/phone-number-calling-plans/transfer-phone-numbers-to-teams",
    "/microsoftteams/teams-phone-licensing",
    "/microsoftteams/pstn-connectivity"
  ];
  for (const path of explicitlyApprovedNeedsReviewPaths) {
    const entry = targeted.uniqueResults.find((row) => row.articlePath === path);
    if (!entry) continue;
    upsertEntry(entries, {
      entryId: makeEntryId(entry.canonicalUrl),
      canonicalUrl: entry.canonicalUrl,
      articlePath: entry.articlePath,
      title: entry.title,
      taxonomyDomains: targetedTopicsToDomains(entry.topics),
      sourceIds: ["ms-teams-admin"],
      discoveryQueryIds: [...entry.queryIds],
      discoveryTopics: [...entry.topics],
      discoveryRunIds: [targeted.runId],
      classification: {
        baseOriginalStatus: null,
        baseSanitizedStatus: null,
        baseOriginalReasonCodes: [],
        baseSanitizedReasonCodes: [],
        targetedStatus: entry.status,
        targetedStatuses: [...entry.statuses],
        targetedReasonCodes: [...entry.reasons]
      },
      humanApproval: {
        include: true,
        reasons: ["calling_plans_needs_review_human_include"],
        notes: ["Human-approved cross-product dependency with Teams-administered workload."]
      }
    });
  }

  const overridePaths = [
    "/microsoftteams/set-up-calling-plans",
    "/microsoftteams/teams-analytics-and-reports/pstn-usage-report"
  ];
  for (const path of overridePaths) {
    const entry = targeted.uniqueResults.find((row) => row.articlePath === path);
    if (!entry) continue;
    upsertEntry(entries, {
      entryId: makeEntryId(entry.canonicalUrl),
      canonicalUrl: entry.canonicalUrl,
      articlePath: entry.articlePath,
      title: entry.title,
      taxonomyDomains: targetedTopicsToDomains(entry.topics),
      sourceIds: ["ms-teams-admin"],
      discoveryQueryIds: [...entry.queryIds],
      discoveryTopics: [...entry.topics],
      discoveryRunIds: [targeted.runId],
      classification: {
        baseOriginalStatus: null,
        baseSanitizedStatus: null,
        baseOriginalReasonCodes: [],
        baseSanitizedReasonCodes: [],
        targetedStatus: entry.status,
        targetedStatuses: [...entry.statuses],
        targetedReasonCodes: [...entry.reasons]
      },
      humanApproval: {
        include: true,
        reasons: ["human_approved_classifier_override"],
        notes: ["human_approved_classifier_override"]
      }
    });
  }

  const finalEntries = [...entries.values()].sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
  const finalRunId = `cg01e1h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputDir = resolve(args.outputDir);
  const jsonPath = resolve(join(outputDir, `${finalRunId}.json`));
  const mdPath = resolve(join(outputDir, `${finalRunId}.md`));
  await mkdir(outputDir, { recursive: true });

  const coverage = buildCoverage(finalEntries);
  const summary = {
    baseSanitizedAcceptedCount: baseAccepted.length,
    previouslyHumanApprovedGeneralCount: previousHumanGeneralApprovals.length,
    targetedCallingPlansAcceptedCount: targetedAccepted.length,
    callingPlansNeedsReviewApprovedCount: explicitlyApprovedNeedsReviewPaths.length,
    classifierOverrideApprovedCount: overridePaths.length,
    deduplicatedFinalApprovedCount: finalEntries.length,
    environmentProfileHint: "microsoft_calling_plans"
  };

  const payload = {
    runId: finalRunId,
    generatedAt: new Date().toISOString(),
    sourceManifests: {
      baseSanitizedManifest: args.baseManifestPath,
      targetedCallingPlansManifest: args.targetedManifestPath
    },
    authorityRule:
      "Include cross-product dependencies when Teams is the workload being administered; do not widen to generic M365 corpus.",
    environmentProfileHint: {
      targetPstnModel: "microsoft_calling_plans",
      note: "Preference hint for later orchestration only; does not alter source authority."
    },
    summary,
    coverage,
    entries: finalEntries
  };

  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push(`# CG-01E1.2 Final Human-Approved Teams Admin Manifest (${finalRunId})`);
  lines.push("");
  lines.push(`- Base sanitized accepted count: ${summary.baseSanitizedAcceptedCount}`);
  lines.push(`- Previously human-approved general count: ${summary.previouslyHumanApprovedGeneralCount}`);
  lines.push(`- Targeted Calling Plans accepted count: ${summary.targetedCallingPlansAcceptedCount}`);
  lines.push(`- Calling Plans needs-review approved: ${summary.callingPlansNeedsReviewApprovedCount}`);
  lines.push(`- Classifier overrides approved: ${summary.classifierOverrideApprovedCount}`);
  lines.push(`- Deduplicated final approved count: ${summary.deduplicatedFinalApprovedCount}`);
  lines.push(`- Environment profile hint: ${summary.environmentProfileHint}`);
  lines.push("");
  lines.push("## Coverage");
  for (const row of coverage) {
    lines.push(`- ${row.category}: ${row.rating}`);
    for (const evidence of row.evidenceUrls.slice(0, 6)) {
      lines.push(`  - ${evidence}`);
    }
  }
  lines.push("");
  lines.push("## Calling Plans Core Subjects");
  const callingPlansSubjects = [
    "/microsoftteams/calling-plans-for-office-365",
    "/microsoftteams/set-up-calling-plans",
    "/microsoftteams/setting-up-your-phone-system",
    "/microsoftteams/teams-phone-licensing",
    "/microsoftteams/pstn-connectivity",
    "/microsoftteams/getting-phone-numbers-for-your-users",
    "/microsoftteams/phone-number-calling-plans/port-order-overview",
    "/microsoftteams/phone-number-calling-plans/transfer-phone-numbers-to-teams",
    "/microsoftteams/add-change-remove-emergency-location-organization",
    "/microsoftteams/add-change-remove-emergency-place-organization",
    "/microsoftteams/considerations-calling-plan",
    "/microsoftteams/aa-cq-plan-overview",
    "/microsoftteams/create-a-phone-system-call-queue",
    "/microsoftteams/create-a-phone-system-auto-attendant",
    "/microsoftteams/teams-analytics-and-reports/pstn-usage-report"
  ];
  for (const path of callingPlansSubjects) {
    const entry = finalEntries.find((row) => row.articlePath === path);
    lines.push(`- ${path}: ${entry ? "present" : "missing"}`);
  }
  lines.push("");
  await writeFile(mdPath, `${lines.join("\n")}\n`, "utf8");

  process.stdout.write(
    `[CG-01E1.2] run=${finalRunId} finalApproved=${summary.deduplicatedFinalApprovedCount} json=${jsonPath} md=${mdPath}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `[CG-01E1.2] consolidation failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
