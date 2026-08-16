import type { QueryIntent } from "./queryIntent";
import type { ExactMatchDirective } from "./domainRouter";
import {
  cmdletOperationPrefixes,
  compact,
  isWorkflowPowerShellAnchoringQuestion,
  operationPrefixAligned
} from "./implicitCmdletSignals";

const POWERSHELL_AUTHORITY_ROLE = "teams_powershell_cmdlet_primary";
const MIN_CONCEPT_COMPACT_LENGTH = 6;
const WORKFLOW_READ_PROPERTY_ALIASES: Record<string, string[]> = {
  "enterprise voice": ["EnterpriseVoiceEnabled"],
  "phone number": ["AssignedPstnTargetId", "LineURI", "TelephoneNumber"]
};
const WORKFLOW_READ_EVIDENCE_TERMS: Record<string, string[]> = {
  "enterprise voice": ["filter", "returns only users"],
  "phone number": [
    "filters the returned results based on the user",
    "returns information about the phone number assigned to",
    "output field",
    "in the output"
  ]
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
  return [
    ...new Set(
      [...intent.entities, ...(intent.policyNames ?? [])].flatMap(
        (value) =>
          WORKFLOW_READ_PROPERTY_ALIASES[value.trim().toLowerCase()] ?? []
      )
    )
  ];
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
  return candidate.authority.authorityRoles.includes(POWERSHELL_AUTHORITY_ROLE);
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

function singularizeBodyWord(word: string): string {
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

function directiveAppearsInCandidateBody(
  directiveValue: string,
  candidate: Pick<PreservationCandidate, "text">
): boolean {
  const directiveWords = directiveValue
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularizeBodyWord);
  const bodyWords = candidate.text
    // Lowercase before tokenization so PascalCase identifiers remain one
    // token. A property/cmdlet name alone is not proof that the body
    // describes the requested user state.
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularizeBodyWord);
  return Number.isFinite(
    contiguousWordMatchPenalty(directiveWords, bodyWords)
  );
}

function statePropertyEvidenceScore(
  directiveValue: string,
  candidate: Pick<PreservationCandidate, "text">
): number {
  const directiveKey = directiveValue.trim().toLowerCase();
  const aliases =
    WORKFLOW_READ_PROPERTY_ALIASES[directiveKey] ?? [];
  if (aliases.length === 0) return 0;
  const body = candidate.text.toLowerCase();
  if (!aliases.some((alias) => body.includes(alias.toLowerCase()))) return 0;
  const evidenceTerms = WORKFLOW_READ_EVIDENCE_TERMS[directiveKey] ?? [];
  return evidenceTerms.some((term) => body.includes(term)) ? 2 : 1;
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
    );

  // For every directive still needing coverage, find the best upstream
  // (pre-cap) PowerShell-authoritative candidate not already selected.
  const toPreserve: T[] = [];
  const preservedChunkIds = new Set<string>();
  for (const directive of outputDirectives) {
    const alreadySatisfied = params.selected.some(
      (candidate) =>
        isPowerShellAuthoritative(candidate) &&
        directiveTopicallyMatchesCandidate(directive.value, candidate) &&
        operationAligned(candidate) &&
        ((WORKFLOW_READ_PROPERTY_ALIASES[
          directive.value.trim().toLowerCase()
        ]?.length ?? 0) === 0 ||
          statePropertyEvidenceScore(
            directive.value,
            candidate
          ) > 0) &&
        directiveAppearsInCandidateBody(directive.value, candidate)
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
        directiveTopicallyMatchesCandidate(directive.value, candidate)
    );
    // Prefer the most word-precise (least "extra modifier words") match
    // over raw fusion score, so a differently-named-but-overlapping object
    // (e.g. "Emergency Calling Policy") does not out-rank the directive's
    // actual canonical object (e.g. "Calling Policy") merely because it
    // happened to also pick up an exact-match score bonus upstream.
    const bestUpstream = [...eligibleUpstream].sort((a, b) => {
      const aAligned = operationAligned(a);
      const bAligned = operationAligned(b);
      if (aAligned !== bAligned) return aAligned ? -1 : 1;
      const aPropertyScore = statePropertyEvidenceScore(
        directive.value,
        a
      );
      const bPropertyScore = statePropertyEvidenceScore(
        directive.value,
        b
      );
      if (aPropertyScore !== bPropertyScore) {
        return bPropertyScore - aPropertyScore;
      }
      const aBodyMatch = directiveAppearsInCandidateBody(directive.value, a);
      const bBodyMatch = directiveAppearsInCandidateBody(directive.value, b);
      if (aBodyMatch !== bBodyMatch) return aBodyMatch ? -1 : 1;
      const aPenalty = wordAdjacencyPenalty(directive.value, a);
      const bPenalty = wordAdjacencyPenalty(directive.value, b);
      if (Number.isFinite(aPenalty) !== Number.isFinite(bPenalty)) {
        return Number.isFinite(aPenalty) ? -1 : 1;
      }
      if (aPenalty !== bPenalty) {
        return aPenalty - bPenalty;
      }
      return b.fusion.score - a.fusion.score;
    })[0];
    if (!bestUpstream) {
      diagnostics.noUpstreamCandidateDirectives.push(directive.value);
      continue;
    }
    toPreserve.push(bestUpstream);
    preservedChunkIds.add(bestUpstream.chunkId);
    diagnostics.preservedDirectives.push({
      directiveValue: directive.value,
      chunkId: bestUpstream.chunkId,
      title: bestUpstream.title
    });
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
    const relevant = params.selected.filter((candidate) =>
      directiveTopicallyMatchesCandidate(directive.value, candidate)
    );
    if (relevant.length === 1) soleCoverageIds.add(relevant[0]!.chunkId);
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
