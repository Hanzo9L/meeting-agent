import { getSourceById } from "../knowledgeV2";
import type { EvidenceItem } from "./types";
import type { CanonicalCitationUrlResolution } from "./citationTypes";

function revisionString(
  revision: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = revision[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeLearnUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== "learn.microsoft.com"
    ) {
      return null;
    }
    parsed.hash = "";
    parsed.hostname = "learn.microsoft.com";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return null;
  }
}

function expectedLearnPath(
  sourceId: string,
  pathname: string
): boolean {
  const path = pathname.toLowerCase();
  switch (sourceId) {
    case "ms-teams-admin":
      return /\/microsoftteams\//.test(path);
    case "ms-teams-powershell":
      return /\/powershell\/module\/microsoftteams\//.test(path);
    case "ms-entra-docs":
      return /\/entra\//.test(path);
    case "ms-graph-docs":
      return /\/graph\//.test(path);
    case "ms-m365-docs":
      return /\/microsoft-365\//.test(path);
    case "ms-teams-dev-docs":
      return /\/microsoftteams\/platform\//.test(path);
    default:
      return false;
  }
}

function persistedRevisionCanonicalUrl(
  evidence: EvidenceItem
): CanonicalCitationUrlResolution | null {
  const value = revisionString(
    evidence.source.sourceRevision,
    "canonicalUrl",
    "canonical_url"
  );
  if (!value) return null;
  const normalized = normalizeLearnUrl(value);
  if (!normalized) {
    return {
      canonicalUrl: null,
      source: null,
      failureReason: "canonical_url_untrusted"
    };
  }
  const parsed = new URL(normalized);
  if (!expectedLearnPath(evidence.source.sourceId, parsed.pathname)) {
    return {
      canonicalUrl: null,
      source: null,
      failureReason: "canonical_url_untrusted"
    };
  }
  return {
    canonicalUrl: normalized,
    source: "persisted_revision",
    failureReason: null
  };
}

/**
 * Reconstructs a trusted Learn canonical URL for GitHub-transport sources whose
 * repo-path-to-Learn-URL mapping is declared and verified in the source registry
 * (`learnMapping.githubCanonicalUrl`). The URL is derived only from the persisted
 * acquisition revision path (never from title, retrieval display text, or web
 * lookups), so an unmapped or malformed path fails closed with no fallback guess.
 */
function sourceRegistryGithubLearnUrl(
  evidence: EvidenceItem
): CanonicalCitationUrlResolution | null {
  const source = getSourceById(evidence.source.sourceId);
  if (!source || source.acquisition.transport !== "github") return null;
  const mapping = source.learnMapping?.githubCanonicalUrl;
  if (!mapping) return null;

  const revision = evidence.source.sourceRevision;
  const revisionTransport = revisionString(revision, "transport").toLowerCase();
  if (revisionTransport && revisionTransport !== "github") return null;

  const revisionPath = revisionString(revision, "path").replace(/\\/g, "/");
  const sourcePath = evidence.source.sourcePath.replace(/\\/g, "/");
  if (
    revisionPath &&
    sourcePath &&
    revisionPath.toLowerCase() !== sourcePath.toLowerCase()
  ) {
    return null;
  }
  const path = (revisionPath || sourcePath).replace(/^\/+/, "");
  if (!path) return null;

  const prefix = mapping.repoPathPrefix;
  if (!path.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  if (!path.toLowerCase().endsWith(".md")) return null;

  const rest = path.slice(prefix.length).replace(/\.md$/i, "");
  if (!rest || rest.includes("..") || rest.startsWith("/")) return null;

  const candidate = `${mapping.learnBaseUrl.replace(/\/+$/, "")}/${rest}`;
  const normalized = normalizeLearnUrl(candidate);
  if (!normalized) return null;

  const parsed = new URL(normalized);
  const expectedPattern = new RegExp(mapping.expectedPathPattern, "i");
  if (
    !expectedPattern.test(parsed.pathname) ||
    !expectedLearnPath(evidence.source.sourceId, parsed.pathname)
  ) {
    return null;
  }

  return {
    canonicalUrl: normalized,
    source: "source_registry_learn_mapping",
    failureReason: null
  };
}

function powershellDocumentIdentity(
  evidence: EvidenceItem
): CanonicalCitationUrlResolution | null {
  if (evidence.source.sourceId !== "ms-teams-powershell") return null;
  const revision = evidence.source.sourceRevision;
  const transport = revisionString(revision, "transport").toLowerCase();
  const repository = revisionString(revision, "repository").toLowerCase();
  const revisionPath = revisionString(revision, "path").replace(/\\/g, "/");
  const sourcePath = evidence.source.sourcePath.replace(/\\/g, "/");
  const path = revisionPath || sourcePath;
  const fileName = path.split("/").at(-1) ?? "";
  const stem = fileName.replace(/\.md$/i, "");
  const title = evidence.source.title.trim();
  const canonicalCmdlet = /^(?:Get|Set|Grant|Remove|New|Test|Enable|Disable)-Cs[A-Za-z0-9]+$/.test(
    title
  );
  const officialRepository =
    repository === "microsoftdocs/office-docs-powershell";
  const modulePath =
    /^teams\/teams-ps\/microsoftteams\/[^/]+\.md$/i.test(path);
  const pathConsistent =
    revisionPath.length === 0 ||
    sourcePath.length === 0 ||
    revisionPath.toLowerCase() === sourcePath.toLowerCase();
  if (
    transport !== "github" ||
    !officialRepository ||
    !modulePath ||
    !pathConsistent ||
    !canonicalCmdlet ||
    stem.toLowerCase() !== title.toLowerCase()
  ) {
    return null;
  }
  return {
    canonicalUrl: `https://learn.microsoft.com/powershell/module/microsoftteams/${title.toLowerCase()}`,
    source: "powershell_document_identity",
    failureReason: null
  };
}

export function resolveCanonicalCitationUrl(
  evidence: EvidenceItem
): CanonicalCitationUrlResolution {
  const persisted = persistedRevisionCanonicalUrl(evidence);
  if (persisted) return persisted;
  const registryMapped = sourceRegistryGithubLearnUrl(evidence);
  if (registryMapped) return registryMapped;
  const powershell = powershellDocumentIdentity(evidence);
  if (powershell) return powershell;
  return {
    canonicalUrl: null,
    source: null,
    failureReason: evidence.source.canonicalUrl.trim()
      ? "canonical_url_untrusted"
      : "canonical_url_missing"
  };
}
