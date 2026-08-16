import type { QueryIntent } from "./queryIntent";
import type { RetrievalCandidate } from "./retrievalCandidates";
import { questionEnumeratesPopulationWithReporting } from "./queryIntentRules";
import {
  cmdletOperationPrefixes,
  extractObjectKeys,
  isCanonicalCmdletDocument,
  isCmdletDiscoveryQuestion,
  isModuleIndexDocument,
  isWorkflowPowerShellAnchoringQuestion,
  objectAligned,
  operationPrefixAligned
} from "./implicitCmdletSignals";

export const HYBRID_FUSION_POLICY = {
  finalCandidateCap: 24,
  maxPerDocument: 4,
  exactScoreWeight: 90,
  lexicalRankWeight: 26,
  semanticRankWeight: 24,
  methodAgreementBonus: 8,
  primarySourceBonus: 7,
  supportingSourceBonus: 2,
  matchingAuthorityRoleBonus: 6,
  nonMatchingAuthorityRoleBonus: 1,
  betaExplicitIntentBonus: 5,
  betaGeneralPenalty: -3,
  implicitCmdletSpecificityBonus: 12,
  implicitCmdletModulePenalty: -6
} as const;

export interface CandidateMethodSignals {
  methods: Array<"exact" | "lexical" | "semantic">;
  exact: {
    matched: boolean;
    score: number | null;
    rank: number | null;
  };
  lexical: {
    score: number | null;
    rank: number | null;
  };
  semantic: {
    similarity: number | null;
    rank: number | null;
  };
}

export interface FusionContributionBreakdown {
  exactScore: number;
  lexicalRank: number;
  semanticRank: number;
  methodAgreement: number;
  routePriority: number;
  authorityRole: number;
  betaPolicy: number;
  implicitCmdletSpecificity: number;
  total: number;
}

export interface HybridPolicyWarning {
  code: string;
  message: string;
}

function reciprocalContribution(rank: number | null, weight: number): number {
  if (rank === null || rank <= 0) return 0;
  return weight * (1 / (rank + 1));
}

function hasExplicitBetaIntent(intent: QueryIntent): boolean {
  if (intent.allowsBetaSources) return true;
  const q = intent.normalizedQuestion.toLowerCase();
  return q.includes(" beta ") || q.endsWith(" beta") || q.includes(" preview ");
}

function inferExpectedAuthorityRoleHints(intent: QueryIntent): string[] {
  const implicitCmdletSignal =
    (intent.commandNames ?? []).length === 0 &&
    (intent.normalizedQuestion.includes("which cmdlet") ||
      intent.normalizedQuestion.includes("powershell command") ||
      intent.normalizedQuestion.includes("powershell cmdlet")) &&
    (intent.operationIntents ?? []).length > 0;
  if ((intent.commandNames ?? []).length > 0) {
    return ["teams_powershell_cmdlet_primary"];
  }
  if (implicitCmdletSignal) {
    return ["teams_powershell_cmdlet_primary", "teams_admin_primary"];
  }
  if (
    intent.technologies.includes("PowerShell") &&
    questionEnumeratesPopulationWithReporting(intent.originalQuestion)
  ) {
    return ["teams_powershell_cmdlet_primary", "teams_admin_primary"];
  }
  if (intent.domains.includes("graph")) {
    return ["graph_api_primary"];
  }
  if (
    intent.domains.includes("entra") ||
    intent.entities.some((entity) => entity.toLowerCase().includes("conditional access"))
  ) {
    return ["entra_identity_primary"];
  }
  if (intent.domains.includes("teams_dev")) {
    return ["teams_dev_specialized"];
  }
  return ["teams_admin_primary"];
}

export function scoreHybridCandidate(params: {
  candidate: RetrievalCandidate;
  intent: QueryIntent;
  methodSignals: CandidateMethodSignals;
}): {
  contributions: FusionContributionBreakdown;
  warnings: HybridPolicyWarning[];
} {
  const expectedAuthorityRoles = inferExpectedAuthorityRoleHints(params.intent);
  const expectedRoleMatched = params.candidate.authority.authorityRoles.some((role) =>
    expectedAuthorityRoles.includes(role)
  );
  const explicitBetaIntent = hasExplicitBetaIntent(params.intent);
  const sourceStatus = params.candidate.authority.sourceStatus;
  const cmdletDiscovery =
    isCmdletDiscoveryQuestion(params.intent) ||
    isWorkflowPowerShellAnchoringQuestion(params.intent);
  const prefixes = cmdletOperationPrefixes(params.intent);
  const objectKeys = extractObjectKeys(params.intent);

  const exactScore =
    params.methodSignals.exact.score === null
      ? 0
      : params.methodSignals.exact.score * HYBRID_FUSION_POLICY.exactScoreWeight;
  const lexicalRank = reciprocalContribution(
    params.methodSignals.lexical.rank,
    HYBRID_FUSION_POLICY.lexicalRankWeight
  );
  const semanticRank = reciprocalContribution(
    params.methodSignals.semantic.rank,
    HYBRID_FUSION_POLICY.semanticRankWeight
  );
  const methodAgreement =
    Math.max(0, params.methodSignals.methods.length - 1) *
    HYBRID_FUSION_POLICY.methodAgreementBonus;
  const routePriority =
    params.candidate.authority.routePriority === "primary"
      ? HYBRID_FUSION_POLICY.primarySourceBonus
      : HYBRID_FUSION_POLICY.supportingSourceBonus;
  const authorityRole = expectedRoleMatched
    ? HYBRID_FUSION_POLICY.matchingAuthorityRoleBonus
    : HYBRID_FUSION_POLICY.nonMatchingAuthorityRoleBonus;
  let betaPolicy = 0;
  if (sourceStatus === "beta" || sourceStatus === "preview") {
    betaPolicy = explicitBetaIntent
      ? HYBRID_FUSION_POLICY.betaExplicitIntentBonus
      : HYBRID_FUSION_POLICY.betaGeneralPenalty;
  }
  let implicitCmdletSpecificity = 0;
  if (cmdletDiscovery) {
    const title = params.candidate.title ?? "";
    const url = params.candidate.provenance.canonicalUrl;
    const canonicalCmdlet = isCanonicalCmdletDocument(title, url);
    const opAligned = operationPrefixAligned(prefixes, title, url);
    const objectMatch = objectAligned(objectKeys, title, url);
    const moduleIndex = isModuleIndexDocument(title, url);
    if (
      params.candidate.authority.sourceId === "ms-teams-powershell" &&
      canonicalCmdlet &&
      opAligned &&
      objectMatch
    ) {
      implicitCmdletSpecificity = HYBRID_FUSION_POLICY.implicitCmdletSpecificityBonus;
    } else if (
      params.candidate.authority.sourceId === "ms-teams-powershell" &&
      moduleIndex
    ) {
      implicitCmdletSpecificity = HYBRID_FUSION_POLICY.implicitCmdletModulePenalty;
    }
  }

  const total =
    exactScore +
    lexicalRank +
    semanticRank +
    methodAgreement +
    routePriority +
    authorityRole +
    betaPolicy +
    implicitCmdletSpecificity;

  const warnings: HybridPolicyWarning[] = [];
  if (params.candidate.authority.routePriority === "primary" && exactScore === 0 && lexicalRank === 0 && semanticRank === 0) {
    warnings.push({
      code: "primary_authority_without_relevance_signal",
      message: "Primary authority candidate had no exact/lexical/semantic signal contribution."
    });
  }

  return {
    contributions: {
      exactScore,
      lexicalRank,
      semanticRank,
      methodAgreement,
      routePriority,
      authorityRole,
      betaPolicy,
      implicitCmdletSpecificity,
      total
    },
    warnings
  };
}
