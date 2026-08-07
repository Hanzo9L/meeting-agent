import type {
  TeamsAdminAuthorityClassification,
  TeamsAdminDiscoveryStatus,
  TeamsAdminDomainId,
  TeamsAdminReasonCode
} from "./types";

export interface EntryClassificationInput {
  articlePath: string;
  canonicalUrl: string;
  title: string | null;
  snippet: string | null;
  taxonomyDomains: TeamsAdminDomainId[];
}

export interface EntryClassificationOutput {
  status: TeamsAdminDiscoveryStatus;
  reasonCodes: TeamsAdminReasonCode[];
  authorityClassification: TeamsAdminAuthorityClassification;
  adjacentDomainHints: string[];
}

const DEVELOPER_TERMS = [
  "developer",
  "teams app development",
  "build tabs",
  "app manifest",
  "manifest",
  "sdk",
  "bot",
  "tabs",
  "webhook",
  "graph api",
  "submission"
];
const END_USER_TERMS = ["chat with", "user help", "for users", "end user", "personal settings"];
const MARKETING_TERMS = ["what is", "overview", "learn more", "discover", "why teams"];
const ADMIN_TERMS = [
  "admin",
  "administrator",
  "policy",
  "configure",
  "manage",
  "tenant",
  "settings",
  "it pro",
  "voice",
  "routing",
  "call-queue",
  "auto-attendant",
  "meeting-policies",
  "external-access",
  "guest-access"
];
const CROSS_PRODUCT_TERMS = [
  "entra",
  "intune",
  "purview",
  "defender",
  "graph",
  "microsoft 365",
  "azure ad"
];

function hasAny(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

const NON_ARTICLE_FILE_SUFFIXES = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".css",
  ".js",
  ".json",
  ".ico",
  ".pdf",
  ".zip"
];

function isNonArticleAssetPath(articlePath: string): boolean {
  const path = articlePath.toLowerCase();
  if (path.includes("/media/")) return true;
  return NON_ARTICLE_FILE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

export function classifyTeamsAdminEntry(input: EntryClassificationInput): EntryClassificationOutput {
  const combined = `${input.title ?? ""}\n${input.snippet ?? ""}\n${input.articlePath}`.toLowerCase();
  const reasonCodes: TeamsAdminReasonCode[] = [];
  const adjacentDomainHints: string[] = [];

  if (!input.articlePath.startsWith("/microsoftteams/")) {
    return {
      status: "excluded",
      reasonCodes: ["excluded_unrelated_namespace"],
      authorityClassification: "out_of_scope",
      adjacentDomainHints
    };
  }
  if (isNonArticleAssetPath(input.articlePath)) {
    return {
      status: "excluded",
      reasonCodes: ["excluded_non_article_asset"],
      authorityClassification: "out_of_scope",
      adjacentDomainHints
    };
  }

  if (hasAny(combined, DEVELOPER_TERMS)) {
    return {
      status: "excluded",
      reasonCodes: ["excluded_developer_material"],
      authorityClassification: "out_of_scope",
      adjacentDomainHints
    };
  }
  if (hasAny(combined, END_USER_TERMS)) {
    return {
      status: "excluded",
      reasonCodes: ["excluded_end_user_help"],
      authorityClassification: "out_of_scope",
      adjacentDomainHints
    };
  }
  if (hasAny(combined, MARKETING_TERMS) && !hasAny(combined, ADMIN_TERMS)) {
    return {
      status: "excluded",
      reasonCodes: ["excluded_marketing_content"],
      authorityClassification: "out_of_scope",
      adjacentDomainHints
    };
  }

  const hasAdminSignal = hasAny(combined, ADMIN_TERMS);
  const hasCrossProductSignal = hasAny(combined, CROSS_PRODUCT_TERMS);
  if (hasCrossProductSignal) {
    for (const hint of CROSS_PRODUCT_TERMS) {
      if (combined.includes(hint)) adjacentDomainHints.push(hint);
    }
  }

  if (hasAdminSignal && !hasCrossProductSignal) {
    reasonCodes.push("accepted_teams_admin_namespace", "accepted_admin_terminology");
    return {
      status: "accepted",
      reasonCodes,
      authorityClassification: "teams_admin_primary",
      adjacentDomainHints
    };
  }
  if (hasAdminSignal && hasCrossProductSignal) {
    reasonCodes.push("needs_review_cross_product_authority");
    return {
      status: "needs_review",
      reasonCodes,
      authorityClassification: "teams_admin_cross_product_supporting",
      adjacentDomainHints
    };
  }

  return {
    status: "candidate",
    reasonCodes: ["candidate_insufficient_admin_signal"],
    authorityClassification: "teams_admin_primary",
    adjacentDomainHints
  };
}
