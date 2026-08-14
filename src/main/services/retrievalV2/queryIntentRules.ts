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

const BETA_TERMS = ["beta", "preview", "prerelease", "pre-release"] as const;

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
  "app registration"
] as const;

const OPERATION_PATTERNS: Array<{ operation: string; pattern: RegExp }> = [
  { operation: "grant", pattern: /\b(grant|grants|granted|granting|assign|assigns|assigned|assigning)\b/i },
  { operation: "set", pattern: /\b(set|change|modify|update|configure)\b/i },
  { operation: "get", pattern: /\b(get|show|list|view|retrieve|verify|check)\b/i },
  { operation: "remove", pattern: /\b(remove|delete|unassign|revoke)\b/i },
  { operation: "new", pattern: /\b(create|new|add|provision)\b/i },
  { operation: "enable", pattern: /\b(enable|disable|turn on|turn off)\b/i },
  { operation: "test", pattern: /\b(test|validate|diagnose|troubleshoot)\b/i }
];

function normalizeQuestion(question: string): string {
  return question
    .trim()
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
  const hasTeams =
    normalized.includes("teams") ||
    normalized.includes("calling plan") ||
    DIRECT_ROUTING_TERMS.some((term) => normalized.includes(term));
  const hasGraph = normalized.includes("graph");
  const hasEntra =
    normalized.includes("entra") ||
    normalized.includes("conditional access") ||
    normalized.includes("azure ad") ||
    normalized.includes("identity") ||
    normalized.includes("service principal") ||
    normalized.includes("app registration");
  const hasM365 =
    normalized.includes("microsoft 365") ||
    normalized.includes("m365") ||
    normalized.includes("tenant");
  const hasDev =
    normalized.includes("sdk") ||
    normalized.includes("manifest") ||
    normalized.includes("bot") ||
    normalized.includes("tab app");
  const hasPowerShell =
    normalized.includes("powershell") ||
    normalized.includes("cmdlet") ||
    normalized.includes("which command") ||
    cmdlets.length > 0 ||
    /\bcs[a-z]/i.test(normalized);

  if (hasTeams) domains.add("teams_admin");
  if (hasPowerShell) domains.add("teams_powershell");
  if (hasGraph) domains.add("graph");
  if (hasEntra) domains.add("entra");
  if (hasM365) domains.add("m365");
  if (hasDev) domains.add("teams_dev");

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
  if (normalized.includes("teams data")) entities.add("teams data");

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
