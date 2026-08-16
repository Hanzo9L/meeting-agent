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
import {
  isImplicitCmdletIntent,
  isWorkflowPowerShellAnchoringQuestion
} from "./implicitCmdletSignals";

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

/**
 * V1 — Teams voice-reporting concepts that are recognized requested outputs
 * (see queryIntentRules' MULTIWORD_TECHNICAL_CONCEPTS) but whose canonical
 * PowerShell reference docs were never entering the exact-match candidate
 * pool: `buildExactMatchDirectives` intentionally excludes generic policy
 * terminology like "calling policy"/"dial plan"/"voice routing policy" from
 * the strict cmdlet/canonical-object exact-match path (see
 * GENERIC_EXACT_POLICY_TERMS) to avoid over-anchoring ordinary policy
 * questions onto cmdlet reference text. That exclusion is correct for
 * regular admin/conceptual questions, but a request that also explicitly
 * requires PowerShell as the method has a genuine, scoped need for the
 * corresponding canonical Teams PowerShell evidence to be retrievable.
 * Anchoring is deliberately narrow: only these named concepts, and only
 * when PowerShell is a detected technology for the question (never a
 * blanket boost of all policy cmdlets).
 */
const TEAMS_VOICE_REPORTING_ANCHOR_TERMS = new Set([
  "calling policy",
  "dial plan",
  "voice routing policy",
  "enterprise voice",
  "phone number"
]);

export function requestsPowerShellMethod(intent: QueryIntent): boolean {
  return intent.technologies.includes("PowerShell");
}

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

/**
 * Returns the genuinely detected primary domain, or null when no domain
 * signal was resolved from the question. Unlike earlier behavior, this
 * function must never guess "teams_admin" as an arbitrary default -- an
 * unresolved domain must stay unresolved through routing (see
 * shouldIncludeSource / buildSourceRouteScopes) so an unmodeled subject
 * (e.g. SharePoint, Copilot, Exchange) cannot be silently treated as a
 * Teams Admin question.
 */
function inferPrimaryDomain(intent: QueryIntent): SourceDomain | null {
  if (intent.commandNames && intent.commandNames.length > 0) {
    // A detected cmdlet only implies a PowerShell-authoritative domain when
    // its module prefix actually resolved to one (see queryIntentRules'
    // cmdletDomain). An unrecognized cmdlet prefix must not default to
    // Teams PowerShell (K2 cmdlet-routing prerequisite).
    if (intent.domains.includes("sharepoint")) {
      return "sharepoint";
    }
    if (intent.domains.includes("teams_powershell")) {
      return "teams_powershell";
    }
    if (intent.domains.includes("powershell_core")) {
      return "powershell_core";
    }
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
  if (intent.domains.includes("teams_admin")) {
    return "teams_admin";
  }
  if (intent.domains.includes("m365")) {
    return "m365";
  }
  if (intent.domains.includes("sharepoint")) {
    return "sharepoint";
  }
  if (intent.domains.includes("powershell_core")) {
    return "powershell_core";
  }
  return null;
}

function buildSelectedDomains(
  intent: QueryIntent,
  primary: SourceDomain | null
): SourceDomain[] {
  const ordered: SourceDomain[] = primary ? [primary] : [];
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
  if (entitySet.has("service principal") || entitySet.has("app registration")) {
    subdomains.add("app_service_principal");
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
    if (intent.domains.includes("sharepoint")) {
      subdomains.add("admin_powershell");
    }
  }
  if (entitySet.has("site permissions")) {
    subdomains.add("site_permissions");
  }
  if (entitySet.has("sharing link")) {
    subdomains.add("sharing_links");
  }
  if (entitySet.has("restricted content discovery")) {
    subdomains.add("copilot_content_discovery");
  }
  if (
    entitySet.has("data access governance") ||
    entitySet.has("sharepoint oversharing") ||
    entitySet.has("sharepoint advanced management")
  ) {
    subdomains.add("sensitivity_governance");
  }
  if (intent.domains.includes("graph")) {
    subdomains.add("api_reference");
    subdomains.add("teams_graph_dependencies");
  }
  if (intent.domains.includes("powershell_core")) {
    if (entitySet.has("csv export")) subdomains.add("csv_export");
    if (entitySet.has("pscustomobject") || entitySet.has("object construction")) {
      subdomains.add("object_construction");
    }
    if (entitySet.has("per-user iteration")) {
      subdomains.add("pipeline_iteration");
    }
    const commands = new Set(
      (intent.commandNames ?? []).map((command) => command.toLowerCase())
    );
    if (commands.has("export-csv")) subdomains.add("csv_export");
    if (commands.has("foreach-object")) subdomains.add("pipeline_iteration");
    if (commands.has("where-object")) subdomains.add("pipeline_filtering");
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

  if (requestsPowerShellMethod(intent)) {
    const anchored = new Set<string>();
    for (const value of [...(intent.policyNames ?? []), ...intent.entities]) {
      const normalized = value.trim().toLowerCase();
      if (!TEAMS_VOICE_REPORTING_ANCHOR_TERMS.has(normalized) || anchored.has(normalized)) {
        continue;
      }
      anchored.add(normalized);
      // Entity-type directives allow weak substring matching against chunk
      // text/headings (unlike canonical-like policy directives), which is
      // what actually anchors to cmdlet reference prose that describes
      // these concepts without repeating the exact PascalCase cmdlet name.
      directives.push({
        type: "entity",
        value,
        required: false
      });
    }
  }
  if (
    intent.domains.includes("powershell_core") &&
    isWorkflowPowerShellAnchoringQuestion(intent)
  ) {
    for (const value of [
      "ForEach-Object",
      "Where-Object",
      "about_PSCustomObject",
      "Export-Csv"
    ]) {
      directives.push({
        type: "entity",
        value,
        required: false
      });
    }
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

/**
 * SharePoint (unlike Teams) is modeled as a single merged domain covering
 * both admin/governance and PowerShell cmdlet authority, so its static
 * DOMAIN_AUTHORITY_PRIORITY chain cannot itself distinguish "this is a
 * cmdlet-reference question" from "this is a conceptual admin question."
 * When a genuine SPO* cmdlet is detected, the cmdlet-primary source must
 * win the within-domain tie-break, exactly as ms-teams-powershell already
 * does for Cs* cmdlets via its own dedicated domain key.
 */
function reorderForCmdletAuthority(chain: string[], intent: QueryIntent): string[] {
  const hasSharePointCmdlet = (intent.commandNames ?? []).some((cmdlet) =>
    /-SPO[A-Za-z0-9]/i.test(cmdlet)
  );
  if (!hasSharePointCmdlet) return chain;
  const psIndex = chain.indexOf("ms-sharepoint-powershell");
  const docsIndex = chain.indexOf("ms-sharepoint-docs");
  if (psIndex < 0 || docsIndex < 0 || psIndex < docsIndex) return chain;
  const reordered = [...chain];
  reordered[docsIndex] = "ms-sharepoint-powershell";
  reordered[psIndex] = "ms-sharepoint-docs";
  return reordered;
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
  if (params.selectedDomains.length === 0) {
    // Unresolved domain: fail-closed scope, no authoritative region to scan.
    return 0;
  }
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

function buildRationale(
  intent: QueryIntent,
  primaryDomain: SourceDomain | null
): string[] {
  const rationale = new Set<string>();
  rationale.add(
    primaryDomain ? `primary_domain:${primaryDomain}` : "primary_domain:unresolved"
  );
  if (!primaryDomain) {
    rationale.add("domain_unresolved");
  }
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
    // A detected cmdlet only counts here when its module prefix actually
    // resolved to Teams PowerShell; an unrelated (e.g. SharePoint) cmdlet
    // must not make the Teams PowerShell source eligible.
    const teamsCmdletSignal = hasCmdlet && selectedDomains.includes("teams_powershell");
    if (!(teamsCmdletSignal || voiceSignals || implicitCmdlet)) {
      return {
        include: false,
        reason: "powershell_source_requires_cmdlet_voice_or_implicit_cmdlet_signal"
      };
    }
    return { include: true };
  }
  if (source.id === "ms-sharepoint-powershell") {
    const sharePointCmdletSignal = hasCmdlet && selectedDomains.includes("sharepoint");
    if (!(sharePointCmdletSignal || selectedDomains.includes("sharepoint"))) {
      return {
        include: false,
        reason: "sharepoint_powershell_source_requires_sharepoint_signal"
      };
    }
    return { include: true };
  }
  if (source.id === "ms-sharepoint-docs") {
    if (!selectedDomains.includes("sharepoint")) {
      return { include: false, reason: "sharepoint_source_requires_sharepoint_domain" };
    }
    return { include: true };
  }
  if (source.id === "ms-powershell-core") {
    if (!selectedDomains.includes("powershell_core")) {
      return {
        include: false,
        reason: "powershell_core_source_requires_bounded_core_signal"
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
  primaryDomain: SourceDomain | null;
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

  const chain = reorderForCmdletAuthority(
    uniqueOrdered(
      params.selectedDomains.flatMap((domain) =>
        getSourcePriorityChainForDomain(domain).map((source) => source.id)
      )
    ),
    params.intent
  );
  const primaryChain = params.primaryDomain
    ? reorderForCmdletAuthority(
        getSourcePriorityChainForDomain(params.primaryDomain).map((source) => source.id),
        params.intent
      )
    : [];

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
  if (selectedDomains.length === 0) {
    // Fail-closed: no genuinely resolved domain, so no source is treated as
    // authoritative and no candidates are retrieved for this question.
    warnings.push("domain_unresolved_no_authoritative_scope");
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

