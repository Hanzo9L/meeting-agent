import { performance } from "node:perf_hooks";
import type {
  QueryAnswerType,
  QueryDomain,
  QueryIntent,
  QueryIntentExtractionResult
} from "./queryIntent";

const CMDLET_PATTERN = /\b[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+\b/g;

const DIRECT_ROUTING_TERMS = [
  "direct routing",
  "voice routing",
  "operator connect",
  "sbc",
  "pstn"
] as const;

const FRESHNESS_TERMS = [
  "current",
  "latest",
  "still supported",
  "supported",
  "deprecated",
  "available",
  "availability",
  "licensing",
  "license",
  "rollout",
  "ga",
  "general availability"
] as const;

const BETA_TERMS = ["beta", "preview", "prerelease", "pre release"] as const;

const AMBIGUOUS_ENTITY_TERMS = ["this feature", "the feature", "this policy", "the policy"] as const;

const MULTIWORD_TECHNICAL_CONCEPTS = [
  "meeting policy",
  "meeting policies",
  "meeting settings",
  "voice routing policy",
  "calling policy",
  "messaging policy",
  "external access",
  "guest access",
  "direct routing",
  "calling plans",
  "service principal",
  "app registration",
  "site permissions",
  "sharing link",
  "restricted content discovery",
  "restricted access control",
  "data access governance",
  "sharepoint oversharing",
  "sharepoint advanced management",
  "enterprise voice",
  "phone number",
  "csv export",
  "object construction",
  "per-user iteration",
  "pscustomobject",
  "auto attendant",
  "call queue",
  "resource account",
  "call quality dashboard",
  "call analytics",
  "media bypass",
  "emergency calling",
  "teams rooms",
  "conditional access"
] as const;

/**
 * Multiword SharePoint admin/governance signals scoped to the K2 knowledge
 * pack (site/sharing/governance/Copilot-content-discovery concerns). Kept
 * narrow and deliberate: bare "copilot" must never resolve SharePoint on its
 * own (see COPILOT_SHAREPOINT_CONTEXT_TERMS below).
 */
const SHAREPOINT_MULTIWORD_SIGNALS = [
  "sharepoint online",
  "site permissions",
  "sharing link",
  "restricted content discovery",
  "data access governance",
  "sharepoint oversharing",
  "sharepoint advanced management"
] as const;

/**
 * Microsoft 365 Copilot only acts as a SharePoint-domain signal when it
 * co-occurs with content/data/access/permission/governance semantics (or
 * another genuinely SharePoint-resolving signal handled elsewhere). A bare
 * "copilot" mention must never resolve the sharepoint domain by itself.
 */
const COPILOT_SHAREPOINT_CONTEXT_TERMS = [
  "content",
  "data",
  "access",
  "permission",
  "governance"
] as const;

/**
 * V1 — deterministic "multi-output workflow" request shape: the question
 * enumerates a population (all/each/every ... users/accounts/etc.) AND asks
 * for the combined result to be produced/reported (export/report/output/
 * csv). Used by the answerV2 aspect-derivation layer to keep independently
 * requested technical values as separate required-output aspects instead of
 * merging them into one compound noun-phrase subject. Deliberately a
 * general population+reporting shape, not a hard-coded literal phrase list.
 */
const POPULATION_ENUMERATION_PATTERN =
  /\b(?:all|each|every)\b[^.?!]{0,60}\b(?:users?|accounts?|members?|mailboxes?|devices?|employees?)\b/i;
const OUTPUT_REPORTING_PATTERN =
  /\bexports?\b|\bexported\b|\bexporting\b|\bcsv\b|\breports?\b|\breporting\b|\breported\b|\boutputs?\b/i;

export function questionEnumeratesPopulationWithReporting(question: string): boolean {
  return (
    POPULATION_ENUMERATION_PATTERN.test(question) &&
    OUTPUT_REPORTING_PATTERN.test(question)
  );
}

/** Deterministic signal for an explicit output/export/report transformation request. */
export function detectOutputTransformationRequest(question: string): {
  requested: boolean;
  label: string;
} {
  if (/\bcsv\b/i.test(question)) return { requested: true, label: "CSV export" };
  if (/\bexports?\b|\bexported\b|\bexporting\b/i.test(question)) {
    return { requested: true, label: "export/output" };
  }
  return { requested: false, label: "" };
}

const OPERATION_PATTERNS: Array<{ operation: string; pattern: RegExp }> = [
  { operation: "grant", pattern: /\b(grant|grants|granted|granting|assign|assigns|assigned|assigning)\b/i },
  { operation: "set", pattern: /\b(set|change|modify|update|configure)\b/i },
  {
    operation: "get",
    pattern:
      /\b(get|show|list|view|retrieve|verify|check|identify|identifies|identifying|determine|determines|determining|report|reports|reporting)\b/i
  },
  { operation: "remove", pattern: /\b(remove|delete|unassign|revoke)\b/i },
  { operation: "new", pattern: /\b(create|new|add|provision)\b/i },
  { operation: "enable", pattern: /\b(enable|disable|turn on|turn off)\b/i },
  { operation: "test", pattern: /\b(test|validate|diagnose|troubleshoot)\b/i }
];

/**
 * General punctuation/hyphen-variance normalization for phrase matching.
 * Hyphens (ascii and common unicode dash variants) are treated as word
 * separators so `voice-routing policy` and `voice routing policy` resolve
 * to the same normalized phrase for entity/technology/domain detection.
 * This is deliberately a general rule rather than literal duplicate
 * vocabulary entries, and it never touches cmdlet extraction (which runs
 * against the raw, unnormalized question via CMDLET_PATTERN).
 */
function normalizeQuestion(question: string): string {
  return question
    .trim()
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[?!]+$/g, "")
    .toLowerCase();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function extractCmdlets(question: string): string[] {
  const matches = question.match(CMDLET_PATTERN) ?? [];
  return uniqueSorted(matches);
}

/**
 * Deterministic cmdlet-module-prefix -> domain routing. A cmdlet's noun
 * segment (the part after the verb-hyphen) carries the module identity by
 * PowerShell convention (e.g. "CsOnlineVoiceUser", "SPOSite"). Unknown
 * prefixes intentionally return null: an unrecognized cmdlet module must
 * never be silently assumed to be Teams PowerShell (see K2 cmdlet-routing
 * prerequisite).
 */
function cmdletDomain(cmdlet: string): QueryDomain | null {
  if (
    /^(?:Export-Csv|ForEach-Object|Where-Object)$/i.test(cmdlet)
  ) {
    return "powershell_core";
  }
  const match = /^[A-Za-z]+-([A-Za-z][A-Za-z0-9]*)$/.exec(cmdlet);
  const noun = match?.[1] ?? "";
  if (/^Cs[A-Z]/.test(noun)) return "teams_powershell";
  if (/^SPO[A-Z]/.test(noun)) return "sharepoint";
  return null;
}

function classifyCmdlets(cmdlets: string[]): {
  domains: QueryDomain[];
  hasUnresolvedCmdlet: boolean;
} {
  const domains = new Set<QueryDomain>();
  let hasUnresolvedCmdlet = false;
  for (const cmdlet of cmdlets) {
    const domain = cmdletDomain(cmdlet);
    if (domain) {
      domains.add(domain);
    } else {
      hasUnresolvedCmdlet = true;
    }
  }
  return { domains: [...domains], hasUnresolvedCmdlet };
}

function classifyAnswerType(
  normalized: string,
  cmdlets: string[]
): QueryAnswerType {
  if (
    normalized.includes("difference between") ||
    normalized.startsWith("compare ") ||
    normalized.includes("compare ") ||
    normalized.includes("vs ")
  ) {
    return "comparison";
  }
  if (
    normalized.startsWith("why ") ||
    normalized.includes("not routing") ||
    normalized.includes("not working") ||
    normalized.includes("error") ||
    normalized.includes("fail")
  ) {
    return "troubleshooting";
  }
  if (
    cmdlets.length > 0 ||
    normalized.startsWith("what does ") ||
    normalized.includes(" cmdlet ")
  ) {
    return "reference";
  }
  if (
    normalized.startsWith("how do i ") ||
    normalized.startsWith("how to ") ||
    normalized.includes("steps")
  ) {
    return "procedural";
  }
  if (
    normalized.includes("configure") ||
    normalized.includes("policy") ||
    normalized.includes("enable")
  ) {
    return "configuration";
  }
  return "conceptual";
}

function detectDomains(
  normalized: string,
  cmdlets: string[]
): QueryDomain[] {
  const domains = new Set<QueryDomain>();
  const { domains: cmdletDomains } = classifyCmdlets(cmdlets);
  const hasKnownPowerShellCmdlet = cmdletDomains.includes("teams_powershell");
  const hasKnownSharePointCmdlet = cmdletDomains.includes("sharepoint");
  const hasKnownCoreCmdlet = cmdletDomains.includes("powershell_core");

  const hasTeams =
    normalized.includes("teams") ||
    normalized.includes("calling plan") ||
    normalized.includes("auto attendant") ||
    normalized.includes("call queue") ||
    normalized.includes("cqd") ||
    normalized.includes("call quality dashboard") ||
    DIRECT_ROUTING_TERMS.some((term) => normalized.includes(term));
  const hasGraph = normalized.includes("graph");
  const hasEntra =
    normalized.includes("entra") ||
    normalized.includes("conditional access") ||
    normalized.includes("azure ad") ||
    normalized.includes("identity") ||
    normalized.includes("service principal") ||
    normalized.includes("app registration") ||
    normalized.includes("locked out") ||
    normalized.includes("lockout");
  const hasM365 =
    normalized.includes("microsoft 365") ||
    normalized.includes("m365") ||
    normalized.includes("tenant");
  const hasDev =
    normalized.includes("sdk") ||
    normalized.includes("manifest") ||
    normalized.includes("bot") ||
    normalized.includes("tab app");
  const hasCopilot = normalized.includes("copilot");
  const hasCopilotSharePointContext =
    hasCopilot &&
    COPILOT_SHAREPOINT_CONTEXT_TERMS.some((term) => normalized.includes(term));
  const hasSharePoint =
    normalized.includes("sharepoint") ||
    /\bspo\b/.test(normalized) ||
    SHAREPOINT_MULTIWORD_SIGNALS.some((term) => normalized.includes(term)) ||
    hasKnownSharePointCmdlet ||
    hasCopilotSharePointContext;
  // Cmdlet shape alone no longer implies Teams PowerShell: only a genuine
  // Cs*-prefixed cmdlet, or explicit generic PowerShell/cmdlet phrasing with
  // no other resolved cmdlet module, resolves it. Generic phrasing (the
  // words "cmdlet"/"powershell") must never override a genuinely resolved
  // cmdlet-module domain (e.g. a SharePoint SPO* cmdlet) with the
  // historical Teams-only PowerShell default.
  const hasGenericPowerShellPhrasing =
    normalized.includes("powershell") ||
    normalized.includes("cmdlet") ||
    normalized.includes("which command");
  const hasBoundedPowerShellCoreSignal =
    hasKnownCoreCmdlet ||
    normalized.includes("export csv") ||
    normalized.includes("csv export") ||
    normalized.includes("foreach object") ||
    normalized.includes("where object") ||
    normalized.includes("pscustomobject") ||
    normalized.includes("object construction") ||
    /\bcsv\b/.test(normalized);

  if (hasTeams) domains.add("teams_admin");
  if (hasKnownPowerShellCmdlet) {
    domains.add("teams_powershell");
  } else if (
    hasGenericPowerShellPhrasing &&
    hasTeams &&
    !hasKnownSharePointCmdlet
  ) {
    domains.add("teams_powershell");
  }
  if (hasBoundedPowerShellCoreSignal) domains.add("powershell_core");
  if (hasGraph) domains.add("graph");
  if (hasEntra) domains.add("entra");
  if (hasM365) domains.add("m365");
  if (hasDev) domains.add("teams_dev");
  if (hasSharePoint) domains.add("sharepoint");

  // No implicit default domain: an unrecognized subject must remain
  // unresolved rather than silently becoming a Teams Admin question.
  // See detectAmbiguity's "domain_unresolved" marker.
  return [...domains];
}

function detectTechnologies(normalized: string, cmdlets: string[]): string[] {
  const technologies = new Set<string>();
  if (normalized.includes("teams")) technologies.add("Microsoft Teams");
  if (
    normalized.includes("powershell") ||
    normalized.includes("cmdlet") ||
    normalized.includes("which command") ||
    cmdlets.length > 0
  ) {
    technologies.add("PowerShell");
  }
  if (normalized.includes("graph")) technologies.add("Microsoft Graph");
  if (normalized.includes("conditional access")) technologies.add("Conditional Access");
  if (normalized.includes("direct routing")) technologies.add("Direct Routing");
  if (normalized.includes("operator connect")) technologies.add("Operator Connect");
  if (normalized.includes("voice routing")) technologies.add("Voice Routing");
  if (normalized.includes("sbc")) technologies.add("SBC");
  if (
    normalized.includes("cqd") ||
    normalized.includes("call quality dashboard")
  ) {
    technologies.add("CQD");
  }
  if (normalized.includes("call analytics")) {
    technologies.add("Call Analytics");
  }
  return uniqueSorted(technologies);
}

function detectEntities(
  normalized: string,
  cmdlets: string[]
): { entities: string[]; policyNames: string[] } {
  const entities = new Set<string>();
  const policies = new Set<string>();
  for (const cmdlet of cmdlets) {
    entities.add(cmdlet);
  }
  for (const term of DIRECT_ROUTING_TERMS) {
    if (normalized.includes(term)) entities.add(term);
  }
  if (normalized.includes("conditional access")) entities.add("conditional access");
  if (normalized.includes("unmanaged devices")) entities.add("unmanaged devices");
  if (normalized.includes("cqd")) entities.add("cqd");
  if (normalized.includes("one-way audio") || normalized.includes("one way audio")) {
    entities.add("one-way audio");
  }

  const policyMatches = normalized.match(/\b([a-z0-9-]*policy|dial ?plan)\b/gi) ?? [];
  for (const policy of policyMatches) {
    const cleaned = policy.trim();
    entities.add(cleaned);
    policies.add(cleaned);
  }
  for (const concept of MULTIWORD_TECHNICAL_CONCEPTS) {
    if (!normalized.includes(concept)) continue;
    entities.add(concept);
    if (concept.includes("polic")) {
      policies.add(concept.replace("policies", "policy"));
    }
  }
  return {
    entities: uniqueSorted(entities),
    policyNames: uniqueSorted(policies)
  };
}

function detectProducts(normalized: string): string[] {
  const products = new Set<string>();
  if (normalized.includes("teams")) products.add("Microsoft Teams");
  if (normalized.includes("graph")) products.add("Microsoft Graph");
  if (
    normalized.includes("entra") ||
    normalized.includes("conditional access") ||
    normalized.includes("service principal") ||
    normalized.includes("app registration")
  ) {
    products.add("Microsoft Entra");
  }
  if (normalized.includes("microsoft 365") || normalized.includes("m365")) {
    products.add("Microsoft 365");
  }
  if (normalized.includes("sharepoint")) products.add("SharePoint");
  if (normalized.includes("teams rooms") || normalized.includes("teams room")) {
    products.add("Teams Rooms");
  }
  return uniqueSorted(products);
}

function buildRetrievalHints(params: {
  domains: QueryDomain[];
  cmdlets: string[];
  entities: string[];
  operationIntents: string[];
  requiresFreshnessCheck: boolean;
  allowsBetaSources: boolean;
  expectedAnswerType: QueryAnswerType;
}): string[] {
  const hints = new Set<string>();
  for (const domain of params.domains) {
    hints.add(`domain:${domain}`);
  }
  for (const cmdlet of params.cmdlets) {
    hints.add(`cmdlet:${cmdlet.toLowerCase()}`);
  }
  for (const entity of params.entities) {
    hints.add(`entity:${entity.toLowerCase()}`);
  }
  for (const operation of params.operationIntents) {
    hints.add(`operation:${operation}`);
  }
  hints.add(`answer_type:${params.expectedAnswerType}`);
  if (params.requiresFreshnessCheck) hints.add("freshness:required");
  if (params.allowsBetaSources) hints.add("preview:allowed");
  return uniqueSorted(hints);
}

function detectOperationIntents(question: string, normalized: string): string[] {
  const operations = new Set<string>();
  const implicitCmdletSignals =
    /\bwhich cmdlet\b/i.test(question) ||
    /\bpowershell command\b/i.test(question) ||
    /\bpowershell cmdlet\b/i.test(question) ||
    /\bwhich command\b/i.test(question);
  for (const entry of OPERATION_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      operations.add(entry.operation);
    }
  }
  if (implicitCmdletSignals && operations.size === 0) {
    operations.add("get");
  }
  return uniqueSorted(operations);
}

function detectAmbiguity(
  normalized: string,
  entities: string[],
  domains: QueryDomain[]
): string[] {
  const ambiguity: string[] = [];
  if (entities.length === 0) {
    ambiguity.push("no_explicit_entity");
  }
  if (domains.length === 0) {
    ambiguity.push("domain_unresolved");
  }
  if (
    normalized.includes("feature") &&
    !normalized.includes("direct routing") &&
    !normalized.includes("operator connect") &&
    !normalized.includes("teams data")
  ) {
    ambiguity.push("ambiguous_feature_or_policy_reference");
  }
  if (AMBIGUOUS_ENTITY_TERMS.some((term) => normalized.includes(term))) {
    ambiguity.push("ambiguous_feature_or_policy_reference");
  }
  if (normalized.includes("supported") && !normalized.includes("feature")) {
    ambiguity.push("supported_without_specific_feature");
  }
  return uniqueSorted(ambiguity);
}

export function extractQueryIntent(question: string): QueryIntentExtractionResult {
  const started = performance.now();
  const originalQuestion = question;
  const normalizedQuestion = normalizeQuestion(question);
  const cmdlets = extractCmdlets(originalQuestion);
  const domains = detectDomains(normalizedQuestion, cmdlets);
  const products = detectProducts(normalizedQuestion);
  const technologies = detectTechnologies(normalizedQuestion, cmdlets);
  const { entities, policyNames } = detectEntities(normalizedQuestion, cmdlets);
  const operationIntents = detectOperationIntents(originalQuestion, normalizedQuestion);
  const requiresFreshnessCheck = FRESHNESS_TERMS.some((term) =>
    normalizedQuestion.includes(term)
  );
  const allowsBetaSources = BETA_TERMS.some((term) =>
    normalizedQuestion.includes(term)
  );
  const expectedAnswerType = classifyAnswerType(normalizedQuestion, cmdlets);
  const unresolvedAmbiguity = detectAmbiguity(normalizedQuestion, entities, domains);
  const retrievalHints = buildRetrievalHints({
    domains,
    cmdlets,
    entities,
    operationIntents,
    requiresFreshnessCheck,
    allowsBetaSources,
    expectedAnswerType
  });

  const intent: QueryIntent = {
    originalQuestion,
    normalizedQuestion,
    domains,
    products,
    technologies,
    entities,
    operationIntents: operationIntents.length > 0 ? operationIntents : undefined,
    commandNames: cmdlets.length > 0 ? cmdlets : undefined,
    policyNames: policyNames.length > 0 ? policyNames : undefined,
    requiresFreshnessCheck,
    allowsBetaSources,
    expectedAnswerType,
    retrievalHints,
    unresolvedAmbiguity
  };

  return {
    intent,
    latencyMs: performance.now() - started
  };
}
