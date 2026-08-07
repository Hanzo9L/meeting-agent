import { performance } from "node:perf_hooks";
import {
  getDefaultSourceRegistry,
  getSourcePriorityChainForDomain,
  type KnowledgeSourceDefinition,
  type SourceAuthorityRole,
  type SourceContentTrack,
  type SourceDomain
} from "../knowledgeV2";
import type { QueryIntent } from "./queryIntent";
import type {
  DomainRouteResult,
  DomainRouter,
  ExactMatchDirective,
  RetrievalScope,
  ScopeMode,
  SourceRouteScope
} from "./domainRouter";

type BudgetProfile = "narrow" | "cross_domain" | "broad";

const VOICE_SIGNAL_ENTITIES = new Set([
  "direct routing",
  "voice routing",
  "operator connect",
  "sbc",
  "pstn"
]);

const GENERIC_EXACT_POLICY_TERMS = new Set([
  "policy",
  "policies",
  "routing policy",
  "voice routing policy",
  "meeting policy",
  "meeting policies",
  "calling policy",
  "messaging policy",
  "voice policy",
  "meeting",
  "voice",
  "calling",
  "routing",
  "settings",
  "configuration",
  "report",
  "reports",
  "user",
  "users",
  "dial plan"
]);

const DOMAIN_BUDGETS: Record<
  BudgetProfile,
  { lexical: number; semantic: number; warning: number }
> = {
  narrow: { lexical: 1600, semantic: 900, warning: 2500 },
  cross_domain: { lexical: 2400, semantic: 1300, warning: 3500 },
  broad: { lexical: 3200, semantic: 1500, warning: 4000 }
};

function hasVoiceSignals(intent: QueryIntent): boolean {
  return intent.entities.some((entity) =>
    VOICE_SIGNAL_ENTITIES.has(entity.toLowerCase())
  );
}

function hasConditionalAccessSignals(intent: QueryIntent): boolean {
  return intent.entities.some((entity) =>
    entity.toLowerCase().includes("conditional access")
  );
}

function hasDeveloperSignals(intent: QueryIntent): boolean {
  return (
    intent.domains.includes("teams_dev") ||
    intent.technologies.some((tech) =>
      ["sdk", "manifest", "bot", "tab"].some((hint) =>
        tech.toLowerCase().includes(hint)
      )
    )
  );
}

function isImplicitCmdletIntent(intent: QueryIntent): boolean {
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
  const hasTechnicalTarget = intent.entities.some((entity) =>
    ["policy", "routing", "voice", "meeting", "calling", "external access", "guest access"].some((hint) =>
      entity.toLowerCase().includes(hint)
    )
  );
  return hasTechnicalTarget && (hasCmdletSignal || (hasPowerShellWord && hasOp));
}

function inferPrimaryDomain(intent: QueryIntent): SourceDomain {
  if (intent.commandNames && intent.commandNames.length > 0) {
    return "teams_powershell";
  }
  if (isImplicitCmdletIntent(intent)) {
    return "teams_powershell";
  }
  if (intent.domains.includes("graph")) {
    return "graph";
  }
  if (hasConditionalAccessSignals(intent) || intent.domains.includes("entra")) {
    return "entra";
  }
  if (hasDeveloperSignals(intent)) {
    return "teams_dev";
  }
  return "teams_admin";
}

function buildSelectedDomains(intent: QueryIntent, primary: SourceDomain): SourceDomain[] {
  const ordered: SourceDomain[] = [primary];
  for (const domain of intent.domains) {
    if (!ordered.includes(domain as SourceDomain)) {
      ordered.push(domain as SourceDomain);
    }
  }
  if (hasVoiceSignals(intent) && !ordered.includes("teams_powershell")) {
    ordered.push("teams_powershell");
  }
  if (hasConditionalAccessSignals(intent) && !ordered.includes("teams_admin")) {
    ordered.push("teams_admin");
  }
  const voiceCmdletDetected = (intent.commandNames ?? []).some(
    (cmdlet) => /voice|routing|pstn/i.test(cmdlet)
  );
  if (voiceCmdletDetected && !ordered.includes("teams_admin")) {
    ordered.push("teams_admin");
  }
  if (isImplicitCmdletIntent(intent) && !ordered.includes("teams_powershell")) {
    ordered.push("teams_powershell");
  }
  return ordered;
}

function buildFocusSubdomains(intent: QueryIntent): string[] {
  const subdomains = new Set<string>();
  const entitySet = new Set(intent.entities.map((entity) => entity.toLowerCase()));
  if (entitySet.has("direct routing") || entitySet.has("voice routing")) {
    subdomains.add("voice");
    subdomains.add("calling");
    subdomains.add("voice_routing");
  }
  if (entitySet.has("operator connect")) {
    subdomains.add("voice");
    subdomains.add("operator_connect");
  }
  if (entitySet.has("sbc")) {
    subdomains.add("voice");
    subdomains.add("sbc");
  }
  if (entitySet.has("conditional access")) {
    subdomains.add("conditional_access");
    subdomains.add("device_access");
  }
  if (entitySet.has("meeting policy") || entitySet.has("meeting policies")) {
    subdomains.add("meeting_policy");
  }
  if (entitySet.has("meeting settings")) {
    subdomains.add("meeting_settings");
  }
  if (entitySet.has("external access")) {
    subdomains.add("external_access");
  }
  if (entitySet.has("guest access")) {
    subdomains.add("guest_access");
  }
  if (intent.commandNames && intent.commandNames.length > 0) {
    subdomains.add("cmdlet_reference");
  }
  if (intent.domains.includes("graph")) {
    subdomains.add("api_reference");
    subdomains.add("teams_graph_dependencies");
  }
  if (hasDeveloperSignals(intent)) {
    subdomains.add("apps");
    subdomains.add("platform");
  }
  return [...subdomains].sort((a, b) => a.localeCompare(b));
}

function buildExactMatchDirectives(intent: QueryIntent): ExactMatchDirective[] {
  const directives: ExactMatchDirective[] = [];
  for (const cmdlet of intent.commandNames ?? []) {
    directives.push({
      type: "cmdlet",
      value: cmdlet,
      required: true
    });
  }
  for (const policyName of intent.policyNames ?? []) {
    const normalized = policyName.trim().toLowerCase();
    const compact = normalized.replace(/[\s_-]+/g, "");
    const canonicalLike =
      compact.endsWith("policy") &&
      compact.length > "policy".length &&
      !GENERIC_EXACT_POLICY_TERMS.has(normalized);
    const explicitObjectLike =
      compact === "onlinevoiceroutingpolicy" ||
      compact === "teamsmeetingpolicy" ||
      compact === "teamscallingpolicy" ||
      compact === "csteamscallingpolicy";
    if (!(canonicalLike || explicitObjectLike)) {
      continue;
    }
    directives.push({
      type: "policy",
      value: policyName,
      required: false
    });
  }
  return directives;
}

function includeTrack(
  track: SourceContentTrack,
  allowsBeta: boolean
): boolean {
  if (track.status === "beta" || track.status === "preview") {
    return allowsBeta;
  }
  return track.defaultRetrievalEligible;
}

function filterEligibleTracks(
  source: KnowledgeSourceDefinition,
  allowsBeta: boolean,
  forceSourceEligibility: boolean
): { eligible: SourceContentTrack[]; excludedBeta: Array<{ sourceId: string; trackId: string }> } {
  const excludedBeta: Array<{ sourceId: string; trackId: string }> = [];
  const eligible = source.contentTracks.filter((track) => {
    if (forceSourceEligibility && track.status === "ga") {
      return true;
    }
    const eligibleForTrack = includeTrack(track, allowsBeta);
    if (!eligibleForTrack && (track.status === "beta" || track.status === "preview")) {
      excludedBeta.push({ sourceId: source.id, trackId: track.id });
    }
    return eligibleForTrack;
  });

  if (!source.defaultRetrievalEligible && !forceSourceEligibility) {
    return { eligible: [], excludedBeta };
  }
  return { eligible, excludedBeta };
}

function toReasonablePriority(
  sourceId: string,
  primaryChain: string[]
): "primary" | "supporting" {
  return primaryChain.slice(0, 2).includes(sourceId) ? "primary" : "supporting";
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function estimateCandidatePopulation(params: {
  selectedDomains: SourceDomain[];
  focusSubdomains: string[];
  exactMatchDirectives: ExactMatchDirective[];
  scopeMode: ScopeMode;
}): number {
  if (params.exactMatchDirectives.some((directive) => directive.type === "cmdlet")) {
    return 1200;
  }
  if (params.focusSubdomains.includes("voice_routing")) {
    return params.scopeMode === "cross_domain" ? 3600 : 2800;
  }
  if (params.focusSubdomains.includes("conditional_access")) {
    return 4100;
  }
  if (params.selectedDomains.includes("graph")) {
    return 2600;
  }
  if (params.scopeMode === "broad_due_to_ambiguity") {
    return 6200;
  }
  return 3200;
}

function buildScopeMode(intent: QueryIntent, selectedDomains: SourceDomain[]): ScopeMode {
  if (intent.unresolvedAmbiguity.length > 0) {
    return "broad_due_to_ambiguity";
  }
  if (selectedDomains.length > 1) {
    return "cross_domain";
  }
  return "narrow";
}

function budgetForMode(mode: ScopeMode): BudgetProfile {
  if (mode === "broad_due_to_ambiguity") return "broad";
  if (mode === "cross_domain") return "cross_domain";
  return "narrow";
}

function buildRationale(intent: QueryIntent, primaryDomain: SourceDomain): string[] {
  const rationale = new Set<string>();
  rationale.add(`primary_domain:${primaryDomain}`);
  rationale.add(`answer_type:${intent.expectedAnswerType}`);
  if (intent.commandNames && intent.commandNames.length > 0) {
    rationale.add("exact_cmdlet_detected");
  }
  if (hasVoiceSignals(intent)) {
    rationale.add("voice_routing_signals_detected");
  }
  if (hasConditionalAccessSignals(intent)) {
    rationale.add("conditional_access_signals_detected");
  }
  if (intent.requiresFreshnessCheck) {
    rationale.add("freshness_check_required");
  }
  if (intent.allowsBetaSources) {
    rationale.add("beta_tracks_enabled_by_intent");
  }
  if (intent.unresolvedAmbiguity.length > 0) {
    rationale.add("scope_broadened_due_to_ambiguity");
  }
  return [...rationale].sort((a, b) => a.localeCompare(b));
}

function shouldIncludeSource(params: {
  source: KnowledgeSourceDefinition;
  intent: QueryIntent;
  selectedDomains: SourceDomain[];
}): { include: boolean; reason?: string } {
  const { source, intent, selectedDomains } = params;
  const voiceSignals = hasVoiceSignals(intent);
  const conditionalAccess = hasConditionalAccessSignals(intent);
  const developerSignals = hasDeveloperSignals(intent);
  const hasCmdlet = (intent.commandNames ?? []).length > 0;
  const implicitCmdlet = isImplicitCmdletIntent(intent);

  if (source.id === "ms-teams-dev-docs") {
    if (!developerSignals) {
      return { include: false, reason: "developer_source_requires_platform_intent" };
    }
    return { include: true };
  }
  if (source.id === "ms-teams-powershell") {
    if (!(hasCmdlet || voiceSignals || implicitCmdlet)) {
      return {
        include: false,
        reason: "powershell_source_requires_cmdlet_voice_or_implicit_cmdlet_signal"
      };
    }
    return { include: true };
  }
  if (source.id === "ms-graph-docs") {
    if (!selectedDomains.includes("graph")) {
      return { include: false, reason: "graph_source_requires_graph_domain" };
    }
    return { include: true };
  }
  if (source.id === "ms-entra-docs") {
    if (!(selectedDomains.includes("entra") || conditionalAccess)) {
      return { include: false, reason: "entra_source_requires_identity_signal" };
    }
    return { include: true };
  }
  if (source.id === "ms-m365-docs" && !selectedDomains.includes("m365")) {
    return { include: false, reason: "m365_source_requires_m365_domain" };
  }
  return { include: true };
}

function buildSourceRouteScopes(params: {
  selectedDomains: SourceDomain[];
  primaryDomain: SourceDomain;
  intent: QueryIntent;
  allowsBetaSources: boolean;
  focusSubdomains: string[];
}): {
  eligibleSources: SourceRouteScope[];
  excludedSources: Array<{ sourceId: string; reason: string }>;
  sourcePriorityChain: string[];
  excludedBetaTracks: Array<{ sourceId: string; trackId: string }>;
} {
  const registry = getDefaultSourceRegistry();
  const sourceById = new Map(registry.sources.map((source) => [source.id, source]));

  const chain = uniqueOrdered(
    params.selectedDomains.flatMap((domain) =>
      getSourcePriorityChainForDomain(domain).map((source) => source.id)
    )
  );
  const primaryChain = getSourcePriorityChainForDomain(params.primaryDomain).map(
    (source) => source.id
  );

  const eligibleSources: SourceRouteScope[] = [];
  const excludedSources: Array<{ sourceId: string; reason: string }> = [];
  const excludedBetaTracks: Array<{ sourceId: string; trackId: string }> = [];

  for (const sourceId of chain) {
    const source = sourceById.get(sourceId);
    if (!source) {
      continue;
    }
    const isDomainMatch = source.domains.some((domain) =>
      params.selectedDomains.includes(domain)
    );
    if (!isDomainMatch) {
      excludedSources.push({ sourceId, reason: "not_applicable_to_selected_domains" });
      continue;
    }
    const sourceEligibility = shouldIncludeSource({
      source,
      intent: params.intent,
      selectedDomains: params.selectedDomains
    });
    if (!sourceEligibility.include) {
      excludedSources.push({
        sourceId,
        reason: sourceEligibility.reason ?? "excluded_by_routing_policy"
      });
      continue;
    }
    const forceSourceEligibility =
      source.id === "ms-teams-dev-docs" && params.selectedDomains.includes("teams_dev");
    const { eligible, excludedBeta } = filterEligibleTracks(
      source,
      params.allowsBetaSources,
      forceSourceEligibility
    );
    excludedBetaTracks.push(...excludedBeta);

    if (eligible.length === 0) {
      excludedSources.push({
        sourceId,
        reason: source.defaultRetrievalEligible
          ? "no_tracks_eligible_after_policy_filtering"
          : "source_not_default_retrieval_eligible"
      });
      continue;
    }

    const sourceSubdomains = source.subdomains.filter((subdomain) =>
      params.focusSubdomains.some((hint) => subdomain.includes(hint) || hint.includes(subdomain))
    );

    const route: SourceRouteScope = {
      sourceId,
      priority: toReasonablePriority(sourceId, primaryChain),
      authorityRoles: [...source.authorityRoles] as SourceAuthorityRole[],
      eligibleTrackIds: eligible.map((track) => track.id),
      eligibleTrackStatuses: eligible.map((track) => track.status),
      rationale: [
        `domain_match:${params.selectedDomains
          .filter((domain) => source.domains.includes(domain))
          .join(",")}`,
        `priority:${toReasonablePriority(sourceId, primaryChain)}`,
        `authority:${source.authorityRoles.join(",")}`
      ],
      subdomainHints: sourceSubdomains
    };
    eligibleSources.push(route);
  }

  eligibleSources.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority === "primary" ? -1 : 1;
    }
    return chain.indexOf(left.sourceId) - chain.indexOf(right.sourceId);
  });

  return {
    eligibleSources,
    excludedSources,
    sourcePriorityChain: chain,
    excludedBetaTracks
  };
}

export function routeQueryIntent(intent: QueryIntent): DomainRouteResult {
  const started = performance.now();
  const primaryDomain = inferPrimaryDomain(intent);
  const selectedDomains = buildSelectedDomains(intent, primaryDomain);
  const focusSubdomains = buildFocusSubdomains(intent);
  const scopeMode = buildScopeMode(intent, selectedDomains);
  const exactMatchDirectives = buildExactMatchDirectives(intent);

  const sourceScope = buildSourceRouteScopes({
    selectedDomains,
    primaryDomain,
    intent,
    allowsBetaSources: intent.allowsBetaSources,
    focusSubdomains
  });

  const profile = budgetForMode(scopeMode);
  const budget = DOMAIN_BUDGETS[profile];
  const estimatedCandidatePopulation = estimateCandidatePopulation({
    selectedDomains,
    focusSubdomains,
    exactMatchDirectives,
    scopeMode
  });
  const warnings: string[] = [];
  if (estimatedCandidatePopulation >= 5000) {
    warnings.push("candidate_population_above_preferred_target");
  }
  if (estimatedCandidatePopulation >= 10000) {
    warnings.push("candidate_population_approaches_whole_corpus_scan_risk");
  }
  if (scopeMode === "broad_due_to_ambiguity") {
    warnings.push("scope_broadened_due_to_unresolved_ambiguity");
  }

  const strategy = {
    exact: exactMatchDirectives.length > 0,
    lexical: true,
    semantic: true,
    semanticPreference: exactMatchDirectives.length > 0 ? "secondary" : "primary"
  } as const;

  const freshnessReasons = intent.requiresFreshnessCheck
    ? [
        "query_intent_requires_freshness",
        ...(intent.unresolvedAmbiguity.includes("ambiguous_feature_or_policy_reference")
          ? ["freshness_with_ambiguous_entity_requires_later_verification"]
          : [])
      ]
    : [];

  const scope: RetrievalScope = {
    intent,
    selectedDomains,
    focusSubdomains,
    eligibleSources: sourceScope.eligibleSources,
    excludedSources: sourceScope.excludedSources,
    sourcePriorityChain: sourceScope.sourcePriorityChain,
    strategy,
    exactMatchDirectives,
    candidateBudget: {
      maxLexicalCandidates: budget.lexical,
      maxSemanticCandidates: budget.semantic,
      broadScopeWarningThreshold: budget.warning
    },
    scopeMode,
    freshnessVerification: {
      required: intent.requiresFreshnessCheck,
      reasons: freshnessReasons
    },
    betaPolicy: {
      allowsBeta: intent.allowsBetaSources,
      excludedBetaTracks: sourceScope.excludedBetaTracks
    },
    estimatedCandidatePopulation,
    routingWarnings: warnings,
    routingRationale: buildRationale(intent, primaryDomain)
  };

  return {
    scope,
    latencyMs: performance.now() - started
  };
}

export class DeterministicDomainRouter implements DomainRouter {
  route(intent: QueryIntent): DomainRouteResult {
    return routeQueryIntent(intent);
  }
}

