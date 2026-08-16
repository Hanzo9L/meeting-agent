import type { QueryIntent } from "./queryIntent";
import type { ExactMatchDirective } from "./domainRouter";
import {
  cmdletOperationPrefixes,
  compact,
  isWorkflowPowerShellAnchoringQuestion,
  operationPrefixAligned
} from "./implicitCmdletSignals";

const POWERSHELL_AUTHORITY_ROLE = "teams_powershell_cmdlet_primary";
const TEAMS_ADMIN_AUTHORITY_ROLE = "teams_admin_primary";
const POWERSHELL_CORE_AUTHORITY_ROLE = "powershell_core_primary";
const POWERSHELL_CORE_WORKFLOW_DIRECTIVES = new Set([
  "foreach-object",
  "where-object",
  "about_pscustomobject",
  "export-csv"
]);
const MIN_CONCEPT_COMPACT_LENGTH = 6;
const WORKFLOW_READ_PROPERTY_ALIASES: Record<string, string[]> = {
  "enterprise voice": ["EnterpriseVoiceEnabled"],
  "phone number": [
    "TelephoneNumber",
    "LineURI",
    "TelephoneNumbers",
    "AssignedPstnTargetId"
  ],
  "voice routing policy": [
    "OnlineVoiceRoutingPolicy",
    "EffectivePolicyAssignments",
    "Get-CsUserPolicyAssignment"
  ],
  "dial plan": [
    "Get-CsEffectiveTenantDialPlan",
    "EffectiveTenantDialPlanName",
    "TenantDialPlan"
  ],
  "calling policy": [
    "TeamsCallingPolicy",
    "EffectivePolicyAssignments",
    "Get-CsUserPolicyAssignment"
  ]
};
const WORKFLOW_RETURNED_VALUE_ALIASES: Record<string, string[]> = {
  "enterprise voice": ["EnterpriseVoiceEnabled"],
  "phone number": ["LineURI", "TelephoneNumber", "TelephoneNumbers"],
  "voice routing policy": ["OnlineVoiceRoutingPolicy"],
  "dial plan": ["EffectiveTenantDialPlanName", "TenantDialPlan"],
  "calling policy": ["TeamsCallingPolicy"]
};
const WORKFLOW_READ_EVIDENCE_TERMS: Record<string, string[]> = {
  "enterprise voice": ["filter", "returns only users"],
  "phone number": [
    "filters the returned results based on the user",
    "returns information about the phone number assigned to",
    "output field",
    "in the output"
  ],
  "voice routing policy": ["select", "effective", "assigned", "policyname"],
  "dial plan": ["effective", "effectivetenantdialplanname"],
  "calling policy": ["effective", "assignment", "policyname", "policysource"]
};
const READ_PRIMITIVE_PREFIXES = [
  "get-",
  "show-",
  "test-",
  "find-",
  "search-",
  "measure-",
  "select-",
  "compare-"
];

export function workflowReadPropertyAliases(intent: QueryIntent): string[] {
  if (!isWorkflowPowerShellAnchoringQuestion(intent)) return [];
  if (!cmdletOperationPrefixes(intent).includes("get-")) return [];
  const groups = [...intent.entities, ...(intent.policyNames ?? [])]
    .map(
      (value) =>
        WORKFLOW_READ_PROPERTY_ALIASES[value.trim().toLowerCase()] ?? []
    )
    .filter((group) => group.length > 0);
  const aliases: string[] = intent.domains.includes("powershell_core")
    ? [
        "ForEach-Object",
        "pscustomobject",
        "Where-Object",
        "Export-Csv",
        "NoTypeInformation"
      ]
    : [];
  const maxGroupLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxGroupLength; index += 1) {
    for (const group of groups) {
      const alias = group[index];
      if (alias && !aliases.includes(alias)) aliases.push(alias);
    }
  }
  return aliases;
}

/**
 * V1.2 — minimal structural shape this module needs from a fused candidate.
 * Declared locally (rather than imported from hybridRetriever) so this
 * module has no dependency on the orchestrator; hybridRetriever's
 * `FusedRetrievalCandidate` satisfies this interface structurally.
 */
export interface PreservationCandidate {
  candidateId: string;
  chunkId: string;
  documentId: string;
  title: string;
  text: string;
  headingPath: string[];
  provenance: { canonicalUrl: string };
  authority: { authorityRoles: string[] };
  fusion: { score: number };
}

export interface WorkflowOutputPreservationDiagnostics {
  triggered: boolean;
  consideredDirectives: string[];
  alreadySatisfiedDirectives: string[];
  preservedDirectives: Array<{ directiveValue: string; chunkId: string; title: string }>;
  noUpstreamCandidateDirectives: string[];
  evictedCandidateIds: string[];
}

function noPreservationDiagnostics(): WorkflowOutputPreservationDiagnostics {
  return {
    triggered: false,
    consideredDirectives: [],
    alreadySatisfiedDirectives: [],
    preservedDirectives: [],
    noUpstreamCandidateDirectives: [],
    evictedCandidateIds: []
  };
}

/**
 * A candidate is "topically relevant" to a requested workflow-output
 * directive (e.g. "enterprise voice", "calling policy") when either:
 *   1. the literal directive phrase appears (case-insensitive, whole
 *      phrase) in the candidate's text or heading path — this is the same
 *      weak-substring philosophy the exact-match retriever already uses
 *      for entity directives against chunk text/headings, or
 *   2. the directive's compacted (alphanumeric-only) form appears inside
 *      the candidate's compacted title, heading path, or canonical URL —
 *      this catches PascalCase cmdlet names and parameter headings (e.g.
 *      heading "-EnterpriseVoiceEnabled" for directive "enterprise voice",
 *      or title "Get-CsTeamsCallingPolicy" for directive "calling policy")
 *      without requiring a literal space-separated match.
 * The compact check is deliberately scoped to title/heading/URL (short,
 * structured strings) rather than full chunk body text, to avoid
 * concatenation false positives (e.g. "...the enterprise. Voice..." would
 * compact to "...enterprisevoice...").
 */
export function directiveTopicallyMatchesCandidate(
  directiveValue: string,
  candidate: Pick<PreservationCandidate, "title" | "text" | "headingPath" | "provenance">
): boolean {
  const literalPhrase = directiveValue.trim().toLowerCase();
  if (literalPhrase.length > 0) {
    const haystackLiteral = `${candidate.title} ${candidate.headingPath.join(" ")} ${candidate.text}`.toLowerCase();
    if (haystackLiteral.includes(literalPhrase)) return true;
  }
  const compactConcept = compact(directiveValue);
  if (compactConcept.length < MIN_CONCEPT_COMPACT_LENGTH) return false;
  const haystackCompact = compact(
    `${candidate.title} ${candidate.headingPath.join(" ")} ${candidate.provenance.canonicalUrl}`
  );
  return haystackCompact.includes(compactConcept);
}

function isPowerShellAuthoritative(candidate: PreservationCandidate): boolean {
  if (
    candidate.authority.authorityRoles.includes(POWERSHELL_AUTHORITY_ROLE) ||
    candidate.authority.authorityRoles.includes(
      POWERSHELL_CORE_AUTHORITY_ROLE
    )
  ) {
    return true;
  }
  return (
    candidate.authority.authorityRoles.includes(TEAMS_ADMIN_AUTHORITY_ROLE) &&
    /\b(?:Get|Show|Test|Find|Search|Select)-Cs[A-Za-z0-9]+\b/.test(
      candidate.text
    )
  );
}

function establishesCoreWorkflowSyntax(
  directiveValue: string,
  candidate: PreservationCandidate
): boolean {
  if (
    !candidate.authority.authorityRoles.includes(
      POWERSHELL_CORE_AUTHORITY_ROLE
    )
  ) {
    return false;
  }
  const key = directiveValue.toLowerCase();
  if (key === "foreach-object") {
    return (
      candidate.title.toLowerCase() === key &&
      /\bForEach-Object\s*\{[^}]*\$_/i.test(candidate.text) &&
      !/\b-Parallel\b/i.test(candidate.text)
    );
  }
  if (key === "where-object") {
    return (
      candidate.title.toLowerCase() === key &&
      /\bWhere-Object\b/i.test(candidate.text) &&
      /\$_/.test(candidate.text) &&
      /\s-eq\b/i.test(candidate.text)
    );
  }
  if (key === "about_pscustomobject") {
    return (
      candidate.title.toLowerCase() === key &&
      /\[pscustomobject\]\s*@\{/i.test(candidate.text)
    );
  }
  if (key === "export-csv") {
    return (
      candidate.title.toLowerCase() === key &&
      /\bGet-Process\s*\|\s*Export-Csv\b/i.test(candidate.text) &&
      /\s-Path\b/i.test(candidate.text) &&
      /\s-NoTypeInformation\b/i.test(candidate.text) &&
      !/\bFormat-(?:Table|List|Wide|Custom)\b/i.test(candidate.text)
    );
  }
  return false;
}

function splitIntoWords(value: string): string[] {
  return value
    // insert a boundary between a lowercase/digit run and a following
    // uppercase letter, so PascalCase cmdlet names split into words
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function candidateBody(value: string): string {
  return value.replace(
    /^Document:[^\r\n]*\r?\nHeading Path:[^\r\n]*\r?\n+/i,
    ""
  );
}

function workflowStateSignals(
  directiveValue: string,
  candidate: Pick<PreservationCandidate, "text">
): { userTarget: boolean; returnedValue: boolean } {
  const directiveKey = directiveValue.trim().toLowerCase();
  const aliases =
    WORKFLOW_READ_PROPERTY_ALIASES[directiveKey] ?? [];
  const body = candidateBody(candidate.text);
  const normalizedBody = body.toLowerCase();
  if (aliases.length === 0) {
    return { userTarget: false, returnedValue: false };
  }
  const hasValueAlias = aliases.some((alias) =>
    normalizedBody.includes(alias.toLowerCase())
  );
  const evidenceTerms = WORKFLOW_READ_EVIDENCE_TERMS[directiveKey] ?? [];
  const userTarget =
    /\b(?:upn|userprincipalname|objectid|object id|assignedpstntargetid)\b/i.test(
      body
    ) ||
    (/\bidentity\b/i.test(body) && /\buser\b/i.test(body)) ||
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(body) ||
    (/\bfilter\b/i.test(body) && /\busers?\b/i.test(body));
  const returnedAliases =
    WORKFLOW_RETURNED_VALUE_ALIASES[directiveKey] ?? [];
  let returnedValue =
    hasValueAlias &&
    returnedAliases.some((alias) =>
      normalizedBody.includes(alias.toLowerCase())
    ) &&
    (evidenceTerms.some((term) => normalizedBody.includes(term)) ||
      /\b(?:returns?|returned|output|select|effective|enabled|policyname|policysource)\b/i.test(
        body
      ) ||
      /(?:TelephoneNumber|EnterpriseVoiceEnabled|OnlineVoiceRoutingPolicy|EffectiveTenantDialPlanName|TeamsCallingPolicy)\s*:/i.test(
        body
      ));
  if (directiveKey === "dial plan") {
    returnedValue =
      /effectivetenantdialplanname/i.test(body) &&
      /\b(?:effective|returns?|returned|output|property)\b/i.test(body);
  } else if (directiveKey === "calling policy") {
    returnedValue =
      /teamscallingpolicy/i.test(body) &&
      /effectivepolicyassignments|get-csuserpolicyassignment/i.test(body) &&
      /\b(?:effective|assignment|policyname|policysource)\b/i.test(body);
  } else if (directiveKey === "voice routing policy") {
    returnedValue =
      /onlinevoiceroutingpolicy/i.test(body) &&
      /\b(?:select|effective|assigned|output|policyname)\b/i.test(body);
  } else if (directiveKey === "phone number") {
    returnedValue =
      (/telephonenumbers/i.test(body) &&
        /\b(?:output|property|attribute|list|includes?)\b/i.test(body)) ||
      (/lineuri/i.test(body) &&
        /\b(?:output field|represents|same phone number|format list)\b/i.test(
          body
        )) ||
      /telephonenumber\s*:/i.test(body);
  }
  return { userTarget, returnedValue };
}

function statePropertyEvidenceScore(
  directiveValue: string,
  candidate: Pick<PreservationCandidate, "text">
): number {
  const signals = workflowStateSignals(directiveValue, candidate);
  return Number(signals.userTarget) + Number(signals.returnedValue) * 2;
}

function contiguousWordMatchPenalty(directiveWords: string[], words: string[]): number {
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let start = 0; start <= words.length - directiveWords.length; start += 1) {
    const isMatch = directiveWords.every((word, offset) => words[start + offset] === word);
    if (isMatch) {
      const penalty = words.length - directiveWords.length;
      if (penalty < bestPenalty) bestPenalty = penalty;
    }
  }
  return bestPenalty;
}

// A heading-only match (e.g. a parameter like "-EmergencyCallingPolicy" on
// an unrelated cmdlet) is a much weaker identity signal than the
// document's own title/cmdlet name, and heading fragments are inherently
// short, so comparing raw word-count penalties across fields of very
// different lengths would unfairly favor short heading matches over a
// title that is a true, if slightly longer, match for the concept. This
// fixed offset ensures a heading-only match is only preferred over a
// title match when the title does not match the directive at all.
const HEADING_ONLY_MATCH_OFFSET = 10;

/**
 * Raw substring/phrase matching cannot distinguish a directive like
 * "calling policy" from a differently-named-but-textually-overlapping
 * object such as "Emergency Calling Policy" — both contain "calling
 * policy" as a contiguous word sequence, whether in a title ("New-Cs
 * TeamsEmergencyCallingPolicy") or in an unrelated cmdlet's parameter
 * heading ("-EmergencyCallingPolicy"). To prefer the document whose own
 * identity (title) is the most minimal, canonical match for the
 * directive, this scores the title first; a heading-only match is scored
 * as a weaker, offset-penalized fallback signal, used only when the
 * title itself does not contain the directive's words at all (e.g. a
 * parameter heading like "-EnterpriseVoiceEnabled" on a generically named
 * cmdlet such as "Set-CsUser").
 */
function wordAdjacencyPenalty(
  directiveValue: string,
  candidate: Pick<PreservationCandidate, "title" | "headingPath">
): number {
  const directiveWords = splitIntoWords(directiveValue);
  if (directiveWords.length === 0) return Number.POSITIVE_INFINITY;

  const titlePenalty = contiguousWordMatchPenalty(directiveWords, splitIntoWords(candidate.title));
  if (Number.isFinite(titlePenalty)) return titlePenalty;

  let bestHeadingPenalty = Number.POSITIVE_INFINITY;
  for (const heading of candidate.headingPath) {
    const penalty = contiguousWordMatchPenalty(directiveWords, splitIntoWords(heading));
    if (penalty < bestHeadingPenalty) bestHeadingPenalty = penalty;
  }
  return Number.isFinite(bestHeadingPenalty)
    ? bestHeadingPenalty + HEADING_ONLY_MATCH_OFFSET
    : Number.POSITIVE_INFINITY;
}

/**
 * V1.2 — Required-Output Candidate Preservation Through Hybrid Fusion.
 *
 * Extends the V1 reserved-slot/directive mechanism through the final
 * hybrid-fusion truncation boundary. For workflow-shaped, explicitly
 * PowerShell-method questions (the same narrow gate already used for the
 * implicit-cmdlet fusion-score bonus — `isWorkflowPowerShellAnchoringQuestion`),
 * each recognized required-output directive (policy/entity directives
 * produced by `buildExactMatchDirectives`, e.g. "enterprise voice",
 * "calling policy") may reserve at most one slot in the final candidate
 * pool for the best-scoring PowerShell-authoritative candidate that is
 * topically relevant to it, when:
 *   - no PowerShell-authoritative candidate relevant to that directive is
 *     already present in the naturally-selected final pool (an unused
 *     reservation wastes no capacity), and
 *   - such a candidate was actually found upstream (present somewhere in
 *     the full pre-cap fused pool).
 *
 * To keep the final population bounded (never "top 24 to top 50"), one
 * lower-scoring candidate is evicted from the tail for every candidate
 * preserved. Eviction prefers candidates that are not the sole selected
 * candidate for any directive (protecting existing per-output coverage),
 * then falls back to the lowest-scoring remaining candidate.
 */
export function applyWorkflowOutputPreservation<T extends PreservationCandidate>(params: {
  sortedFused: T[];
  selected: T[];
  intent: QueryIntent;
  directives: ExactMatchDirective[];
  maxPerDocument: number;
}): { selected: T[]; diagnostics: WorkflowOutputPreservationDiagnostics } {
  if (!isWorkflowPowerShellAnchoringQuestion(params.intent)) {
    return { selected: params.selected, diagnostics: noPreservationDiagnostics() };
  }

  const outputDirectives = params.directives.filter(
    (directive) => directive.type === "entity" || directive.type === "policy"
  );
  if (outputDirectives.length === 0) {
    return { selected: params.selected, diagnostics: noPreservationDiagnostics() };
  }

  const selectedIds = new Set(params.selected.map((c) => c.chunkId));
  const diagnostics = noPreservationDiagnostics();
  diagnostics.consideredDirectives = outputDirectives.map((d) => d.value);
  // Reuses the same operation-prefix inference already used for the
  // implicit-cmdlet fusion-score bonus, so a workflow that asks to
  // identify/determine/report a value prefers a matching-verb cmdlet
  // (e.g. "Get-") over an equally topical but semantically mismatched one
  // (e.g. "Remove-") when both are otherwise tied on topical precision.
  const inferredPrefixes = cmdletOperationPrefixes(params.intent);
  const hasReadOperation = inferredPrefixes.some((prefix) =>
    READ_PRIMITIVE_PREFIXES.includes(prefix)
  );
  const preferredPrefixes = hasReadOperation
    ? READ_PRIMITIVE_PREFIXES
    : inferredPrefixes;
  const operationAligned = (candidate: T): boolean =>
    operationPrefixAligned(
      preferredPrefixes,
      candidate.title,
      candidate.provenance.canonicalUrl
    ) ||
    (hasReadOperation &&
      /\b(?:Get|Show|Test|Find|Search|Select)-Cs[A-Za-z0-9]+\b/.test(
        candidate.text
      ));

  // For every directive still needing coverage, find the best upstream
  // (pre-cap) PowerShell-authoritative candidate not already selected.
  const toPreserve: T[] = [];
  const preservedChunkIds = new Set<string>();
  for (const directive of outputDirectives) {
    if (
      POWERSHELL_CORE_WORKFLOW_DIRECTIVES.has(
        directive.value.toLowerCase()
      )
    ) {
      const alreadyCoreSatisfied = params.selected.some((candidate) =>
        establishesCoreWorkflowSyntax(directive.value, candidate)
      );
      if (alreadyCoreSatisfied) {
        diagnostics.alreadySatisfiedDirectives.push(directive.value);
        continue;
      }
      const bestCoreCandidate = params.sortedFused
        .filter(
          (candidate) =>
            !selectedIds.has(candidate.chunkId) &&
            !preservedChunkIds.has(candidate.chunkId) &&
            establishesCoreWorkflowSyntax(directive.value, candidate)
        )
        .sort((left, right) => right.fusion.score - left.fusion.score)[0];
      if (!bestCoreCandidate) {
        diagnostics.noUpstreamCandidateDirectives.push(directive.value);
        continue;
      }
      toPreserve.push(bestCoreCandidate);
      preservedChunkIds.add(bestCoreCandidate.chunkId);
      diagnostics.preservedDirectives.push({
        directiveValue: directive.value,
        chunkId: bestCoreCandidate.chunkId,
        title: bestCoreCandidate.title
      });
      continue;
    }
    if (!hasReadOperation) {
      const alreadyWriteSatisfied = params.selected.some(
        (candidate) =>
          isPowerShellAuthoritative(candidate) &&
          directiveTopicallyMatchesCandidate(
            directive.value,
            candidate
          ) &&
          operationAligned(candidate)
      );
      if (alreadyWriteSatisfied) {
        diagnostics.alreadySatisfiedDirectives.push(directive.value);
        continue;
      }
      const bestWriteCandidate = params.sortedFused
        .filter(
          (candidate) =>
            !selectedIds.has(candidate.chunkId) &&
            !preservedChunkIds.has(candidate.chunkId) &&
            isPowerShellAuthoritative(candidate) &&
            directiveTopicallyMatchesCandidate(
              directive.value,
              candidate
            ) &&
            operationAligned(candidate)
        )
        .sort((left, right) => {
          const leftPenalty = wordAdjacencyPenalty(
            directive.value,
            left
          );
          const rightPenalty = wordAdjacencyPenalty(
            directive.value,
            right
          );
          if (leftPenalty !== rightPenalty) {
            return leftPenalty - rightPenalty;
          }
          return right.fusion.score - left.fusion.score;
        })[0];
      if (!bestWriteCandidate) {
        diagnostics.noUpstreamCandidateDirectives.push(directive.value);
        continue;
      }
      toPreserve.push(bestWriteCandidate);
      preservedChunkIds.add(bestWriteCandidate.chunkId);
      diagnostics.preservedDirectives.push({
        directiveValue: directive.value,
        chunkId: bestWriteCandidate.chunkId,
        title: bestWriteCandidate.title
      });
      continue;
    }
    const selectedForDirective = params.selected.filter(
      (candidate) =>
        isPowerShellAuthoritative(candidate) &&
        (directiveTopicallyMatchesCandidate(
          directive.value,
          candidate
        ) ||
          statePropertyEvidenceScore(directive.value, candidate) > 0) &&
        operationAligned(candidate) &&
        statePropertyEvidenceScore(directive.value, candidate) > 0
    );
    const targetCandidates = selectedForDirective.filter(
      (candidate) =>
        workflowStateSignals(directive.value, candidate).userTarget
    );
    const valueCandidates = selectedForDirective.filter(
      (candidate) =>
        workflowStateSignals(directive.value, candidate).returnedValue
    );
    const alreadySatisfied = targetCandidates.some((target) =>
      valueCandidates.some(
        (value) =>
          target.chunkId === value.chunkId ||
          (target.documentId === value.documentId &&
            target.title.toLowerCase() === value.title.toLowerCase())
      )
    );
    if (alreadySatisfied) {
      diagnostics.alreadySatisfiedDirectives.push(directive.value);
      continue;
    }
    const eligibleUpstream = params.sortedFused.filter(
      (candidate) =>
        !selectedIds.has(candidate.chunkId) &&
        !preservedChunkIds.has(candidate.chunkId) &&
        isPowerShellAuthoritative(candidate) &&
        (directiveTopicallyMatchesCandidate(
          directive.value,
          candidate
        ) ||
          statePropertyEvidenceScore(directive.value, candidate) > 0)
    );
    const available = [...params.selected, ...toPreserve, ...eligibleUpstream];
    const directiveCandidates = available.filter(
      (candidate) =>
        isPowerShellAuthoritative(candidate) &&
        (directiveTopicallyMatchesCandidate(
          directive.value,
          candidate
        ) ||
          statePropertyEvidenceScore(directive.value, candidate) > 0) &&
        operationAligned(candidate)
    );
    const targets = directiveCandidates.filter(
      (candidate) =>
        workflowStateSignals(directive.value, candidate).userTarget
    );
    const values = directiveCandidates.filter(
      (candidate) =>
        workflowStateSignals(directive.value, candidate).returnedValue
    );
    const pairs = targets.flatMap((target) =>
      values
        .filter(
          (value) =>
            target.chunkId === value.chunkId ||
            (target.documentId === value.documentId &&
              target.title.toLowerCase() === value.title.toLowerCase())
        )
        .map((value) => {
          const additions = [...new Map(
            [target, value]
              .filter((candidate) => !selectedIds.has(candidate.chunkId))
              .map((candidate) => [candidate.chunkId, candidate])
          ).values()];
          return {
            target,
            value,
            additions,
            stateScore:
              statePropertyEvidenceScore(directive.value, target) +
              statePropertyEvidenceScore(directive.value, value),
            fusionScore: target.fusion.score + value.fusion.score
          };
        })
    );
    const bestPair = pairs.sort(
      (left, right) =>
        left.additions.length - right.additions.length ||
        right.stateScore - left.stateScore ||
        right.fusionScore - left.fusionScore ||
        wordAdjacencyPenalty(directive.value, left.value) -
          wordAdjacencyPenalty(directive.value, right.value)
    )[0];
    if (!bestPair || bestPair.additions.length === 0) {
      diagnostics.noUpstreamCandidateDirectives.push(directive.value);
      continue;
    }
    for (const candidate of bestPair.additions) {
      if (preservedChunkIds.has(candidate.chunkId)) continue;
      toPreserve.push(candidate);
      preservedChunkIds.add(candidate.chunkId);
      diagnostics.preservedDirectives.push({
        directiveValue: directive.value,
        chunkId: candidate.chunkId,
        title: candidate.title
      });
    }
  }

  if (toPreserve.length === 0) {
    return { selected: params.selected, diagnostics };
  }
  diagnostics.triggered = true;

  // Protect the sole selected candidate for any directive from eviction, so
  // making room for a new preserved candidate never discards the only
  // existing coverage for a different requested output.
  const soleCoverageIds = new Set<string>();
  for (const directive of outputDirectives) {
    if (
      POWERSHELL_CORE_WORKFLOW_DIRECTIVES.has(
        directive.value.toLowerCase()
      )
    ) {
      const coreRelevant = params.selected.filter((candidate) =>
        establishesCoreWorkflowSyntax(directive.value, candidate)
      );
      if (coreRelevant.length === 1) {
        soleCoverageIds.add(coreRelevant[0]!.chunkId);
      }
      continue;
    }
    const relevant = params.selected.filter((candidate) =>
      directiveTopicallyMatchesCandidate(directive.value, candidate) ||
      statePropertyEvidenceScore(directive.value, candidate) > 0
    );
    if (!hasReadOperation) {
      if (relevant.length === 1) soleCoverageIds.add(relevant[0]!.chunkId);
      continue;
    }
    const targets = relevant.filter(
      (candidate) =>
        workflowStateSignals(directive.value, candidate).userTarget
    );
    const values = relevant.filter(
      (candidate) =>
        workflowStateSignals(directive.value, candidate).returnedValue
    );
    for (const target of targets) {
      for (const value of values) {
        if (
          target.chunkId === value.chunkId ||
          (target.documentId === value.documentId &&
            target.title.toLowerCase() === value.title.toLowerCase())
        ) {
          soleCoverageIds.add(target.chunkId);
          soleCoverageIds.add(value.chunkId);
        }
      }
    }
  }

  const evictionOrder = [...params.selected]
    .filter((candidate) => !soleCoverageIds.has(candidate.chunkId))
    .sort((a, b) => a.fusion.score - b.fusion.score);

  const evictedIds = new Set<string>();
  for (const candidate of evictionOrder) {
    if (evictedIds.size >= toPreserve.length) break;
    evictedIds.add(candidate.chunkId);
  }
  diagnostics.evictedCandidateIds = [...evictedIds];

  const remaining = params.selected.filter((candidate) => !evictedIds.has(candidate.chunkId));
  const merged = [...remaining, ...toPreserve];

  // Re-enforce the per-document cap: a preserved candidate must not push
  // any single document over the existing max-per-document limit.
  const docCounts = new Map<string, number>();
  const final: T[] = [];
  const overflow: T[] = [];
  const mergedSorted = [...merged].sort((a, b) => b.fusion.score - a.fusion.score);
  for (const candidate of mergedSorted) {
    const count = docCounts.get(candidate.documentId) ?? 0;
    if (count >= params.maxPerDocument) {
      overflow.push(candidate);
      continue;
    }
    final.push(candidate);
    docCounts.set(candidate.documentId, count + 1);
  }
  for (const candidate of overflow) {
    if (final.length >= params.selected.length) break;
    final.push(candidate);
  }

  return {
    selected: final.sort((a, b) => b.fusion.score - a.fusion.score),
    diagnostics
  };
}
