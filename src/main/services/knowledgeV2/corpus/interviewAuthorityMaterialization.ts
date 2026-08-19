export const SUPERSEDED_CALL_QUALITY_URLS = [
  "https://learn.microsoft.com/en-us/microsoftteams/use-call-analytics-to-troubleshoot-poor-call-quality",
  "https://learn.microsoft.com/en-us/microsoftteams/use-real-time-telemetry-to-troubleshoot-poor-meeting-quality"
] as const;

export type InterviewMaterializationTarget = {
  sourceId: "ms-teams-admin" | "ms-sharepoint-docs" | "ms-entra-docs" | "ms-m365-docs";
  trackId: "ga";
  transport: "learn_mcp";
};

export function classifyInterviewMaterializationTarget(
  canonicalUrl: string
): InterviewMaterializationTarget | { unsupported: true; reason: string } {
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    return { unsupported: true, reason: "invalid_url" };
  }
  const path = url.pathname
    .replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/")
    .toLowerCase();
  if (
    SUPERSEDED_CALL_QUALITY_URLS.some((excluded) =>
      canonicalUrl.toLowerCase().includes(
        new URL(excluded).pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/")
      )
    )
  ) {
    return { unsupported: true, reason: "superseded_excluded" };
  }
  if (
    path.startsWith("/microsoftteams/") ||
    path.startsWith("/troubleshoot/microsoftteams/")
  ) {
    return {
      sourceId: "ms-teams-admin",
      trackId: "ga",
      transport: "learn_mcp"
    };
  }
  if (path.startsWith("/sharepoint/")) {
    return {
      sourceId: "ms-sharepoint-docs",
      trackId: "ga",
      transport: "learn_mcp"
    };
  }
  if (path.startsWith("/entra/")) {
    return {
      sourceId: "ms-entra-docs",
      trackId: "ga",
      transport: "learn_mcp"
    };
  }
  if (
    path.startsWith("/microsoft-365/") ||
    path.startsWith("/copilot/") ||
    path.startsWith("/purview/")
  ) {
    return {
      sourceId: "ms-m365-docs",
      trackId: "ga",
      transport: "learn_mcp"
    };
  }
  return { unsupported: true, reason: "outside_existing_microsoft_sources" };
}

export function markdownLooksRetiredOrSuperseded(markdown: string): boolean {
  const frontMatter = markdown.slice(0, 800);
  if (
    /ms\.custom:\s*[^\n]*(retired|deprecated|redirect)/i.test(frontMatter)
  ) {
    return true;
  }
  return (
    /this (article|page|guidance) (is|has been) (retired|deprecated|replaced)/i.test(
      markdown
    ) ||
    /this (article|page) applies to an earlier/i.test(markdown)
  );
}
