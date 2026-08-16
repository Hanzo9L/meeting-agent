import type { QueryIntent } from "./queryIntent";
import { questionEnumeratesPopulationWithReporting } from "./queryIntentRules";

const GENERIC_OBJECT_TERMS = new Set([
  "policy",
  "policies",
  "user",
  "users",
  "teams",
  "settings",
  "configuration",
  "command",
  "cmdlet",
  "voice",
  "meeting",
  "routing",
  "calling"
]);

export function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hasTechnicalTarget(intent: QueryIntent): boolean {
  return intent.entities.some((entity) =>
    ["policy", "routing", "voice", "meeting", "calling", "external access", "guest access"].some(
      (hint) => entity.toLowerCase().includes(hint)
    )
  );
}

export function isImplicitCmdletIntent(intent: QueryIntent): boolean {
  if ((intent.commandNames ?? []).length > 0) return false;
  const hasOp = (intent.operationIntents ?? []).some((op) =>
    ["grant", "set", "get", "remove", "new", "test"].includes(op)
  );
  const hasCmdletSignal =
    intent.normalizedQuestion.includes("which cmdlet") ||
    intent.normalizedQuestion.includes("powershell command") ||
    intent.normalizedQuestion.includes("powershell cmdlet") ||
    intent.normalizedQuestion.includes("which command");
  const hasPowerShellWord = intent.normalizedQuestion.includes("powershell");
  return hasTechnicalTarget(intent) && (hasCmdletSignal || (hasPowerShellWord && hasOp));
}

export function isCmdletDiscoveryQuestion(intent: QueryIntent): boolean {
  if (!isImplicitCmdletIntent(intent)) return false;
  if (
    intent.normalizedQuestion.includes("which cmdlet") ||
    intent.normalizedQuestion.includes("powershell command") ||
    intent.normalizedQuestion.includes("powershell cmdlet") ||
    intent.normalizedQuestion.includes("which command")
  ) {
    return true;
  }
  return (
    intent.normalizedQuestion.startsWith("how do i ") &&
    intent.normalizedQuestion.includes("powershell") &&
    !intent.normalizedQuestion.includes("steps")
  );
}

// A multi-output PowerShell workflow (enumerate a population, collect several
// named technical properties, report/export the result) is not phrased as a
// "which cmdlet" discovery question, but it still needs canonical cmdlet
// documentation to out-rank generic conceptual pages for each requested
// output. Scoped narrowly to workflow-enumeration + explicit PowerShell
// method so unrelated PowerShell questions are not affected.
export function isWorkflowPowerShellAnchoringQuestion(intent: QueryIntent): boolean {
  return (
    isImplicitCmdletIntent(intent) &&
    intent.technologies.includes("PowerShell") &&
    questionEnumeratesPopulationWithReporting(intent.originalQuestion)
  );
}

export function cmdletOperationPrefixes(intent: QueryIntent): string[] {
  const ops = new Set(intent.operationIntents ?? []);
  if (
    intent.normalizedQuestion.includes("which cmdlet") ||
    intent.normalizedQuestion.includes("powershell command") ||
    intent.normalizedQuestion.includes("powershell cmdlet")
  ) {
    ops.add("get");
  }
  const prefixes: string[] = [];
  if (ops.has("grant")) prefixes.push("grant-");
  if (ops.has("set")) prefixes.push("set-");
  if (ops.has("get")) prefixes.push("get-");
  if (ops.has("remove")) prefixes.push("remove-");
  if (ops.has("new")) prefixes.push("new-");
  if (ops.has("enable")) prefixes.push("enable-", "disable-");
  if (ops.has("test")) prefixes.push("test-");
  return [...new Set(prefixes)];
}

export function extractObjectKeys(intent: QueryIntent): string[] {
  const values = [...intent.entities, ...(intent.policyNames ?? [])]
    .map((value) => value.toLowerCase().trim())
    .filter((value) => value.length >= 4);
  const compacts = new Set<string>();
  for (const value of values) {
    if (GENERIC_OBJECT_TERMS.has(value)) continue;
    const compacted = compact(value);
    if (compacted.length >= 8) {
      compacts.add(compacted);
    }
  }
  return [...compacts];
}

export function isCanonicalCmdletDocument(title: string, canonicalUrl: string): boolean {
  const titleLower = title.toLowerCase().trim();
  const urlLower = canonicalUrl.toLowerCase();
  if (/^(get|set|grant|remove|new|test|enable|disable)-cs[a-z0-9]/i.test(title)) return true;
  if (/\/(get|set|grant|remove|new|test|enable|disable)-cs[a-z0-9-]+\.md$/i.test(canonicalUrl)) {
    return true;
  }
  return (
    titleLower.includes("-cs") &&
    (urlLower.includes("/teams/teams-ps/microsoftteams/") || urlLower.includes("/powershell/module/"))
  );
}

export function isModuleIndexDocument(title: string, canonicalUrl: string): boolean {
  const titleLower = title.toLowerCase();
  const urlLower = canonicalUrl.toLowerCase();
  return (
    titleLower.includes("microsoftteams") &&
    titleLower.includes("module") &&
    urlLower.endsWith("/microsoftteams.md")
  );
}

export function operationPrefixAligned(
  prefixes: string[],
  title: string,
  canonicalUrl: string
): boolean {
  if (prefixes.length === 0) return false;
  const titleLower = title.toLowerCase();
  const urlLower = canonicalUrl.toLowerCase();
  return prefixes.some((prefix) => titleLower.startsWith(prefix) || urlLower.includes(`/${prefix}`));
}

export function objectAligned(objectKeys: string[], title: string, canonicalUrl: string): boolean {
  if (objectKeys.length === 0) return false;
  const haystack = compact(`${title} ${canonicalUrl}`);
  return objectKeys.some((objectKey) => haystack.includes(objectKey));
}
