import Database from "better-sqlite3";
import type { SourceAuthorityRole, SourceDomain } from "../knowledgeV2";
import {
  detectOutputTransformationRequest,
  questionEnumeratesPopulationWithReporting
} from "../retrievalV2";
import type {
  FusedRetrievalCandidate,
  HybridRetrievalResult,
  QueryIntent
} from "../retrievalV2";
import { operationMatchesText } from "./operationMatching";
import type {
  EvidenceAspect,
  EvidenceAspectAnswerObject,
  EvidenceAspectAuthorityRequirement,
  EvidenceAspectBreadth,
  EvidenceAspectRelationship,
  EvidenceAspectSubject,
  EvidenceAspectSubjectKind,
  EvidenceAspectSupport,
  EvidenceAspectSupportStrength,
  EvidenceMethodConstraint,
  EvidenceMethodConstraintKind,
  EvidenceSupportFacet,
  EvidenceSupportType
} from "./types";

export const GENERIC_SUBJECT_TERMS = new Set([
  "microsoft",
  "teams",
  "admin",
  "administration",
  "user",
  "users"
]);

const QUESTION_STOP_TERMS = new Set([
  "about",
  "affect",
  "does",
  "from",
  "have",
  "help",
  "how",
  "into",
  "what",
  "when",
  "where",
  "which",
  "with",
  "work",
  "works",
  "would"
]);

const RELATION_PREDICATES: Array<{ predicate: string; pattern: RegExp }> = [
  { predicate: "affects", pattern: /\baffect(?:s|ing)?\b/i },
  { predicate: "impacts", pattern: /\bimpact(?:s|ing)?\b/i },
  { predicate: "applies_to", pattern: /\bappl(?:y|ies|ying)\b/i }
];

const CMDLET_TITLE_PATTERN = /^[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+$/;

// V1.1 — canonical operation labels (see queryIntentRules.ts OPERATION_PATTERNS)
// that represent an actual configuration *change*. Used to keep read/reporting
// workflow aspects (identify/determine/report/list/...) from being coerced into
// a write-shaped clause match purely because a state-descriptive word (e.g.
// "assigned phone number") happens to share a verb form with a write operation.
const WRITE_OPERATIONS = new Set(["grant", "set", "new", "enable", "remove"]);

function isWriteOperation(operation: string | null): boolean {
  return operation !== null && WRITE_OPERATIONS.has(operation);
}

// V1.1 — a Get-/Show-/Test-/Find-/Search- style cmdlet is, by its own verb,
// a read/reporting primitive regardless of the exact prose used in its
// synopsis ("returns", "displays", "retrieves" all occur in the corpus).
const READ_CMDLET_VERB_PATTERN = /^(?:get|show|test|find|search|measure|select|compare)-/i;

export interface CandidateEvidenceMetadata {
  chunkKind?: string;
  exactEntities?: Array<{ type: string; value: string }>;
}

export interface EvaluateCandidateOptions {
  metadataByChunkId?: Map<string, CandidateEvidenceMetadata>;
}

/** @deprecated Prefer EvidenceAspectSupport; retained for transitional call sites. */
export interface CandidateAspectEvaluation {
  aspectId: string;
  topical: boolean;
  direct: boolean;
  authoritative: boolean;
  canonicalIdentityVerified: boolean;
  qualityScore: number;
  support: EvidenceAspectSupport;
}

/**
 * General punctuation/hyphen-variance normalization shared by subject/facet
 * matching. Hyphens (ascii and common unicode dash variants) are treated as
 * word separators so a candidate document written as `voice-routing policy`
 * and a subject derived from `voice routing policy` decompose into the same
 * token sequence. Does not touch normalizeIdentifier (used for exact
 * cmdlet/canonical-identity comparisons), which must stay untouched.
 */
export function normalizeEvidenceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PER_USER_VALUE_ALIASES: Record<string, string[]> = {
  "enterprise voice": ["EnterpriseVoiceEnabled"],
  "phone number": ["TelephoneNumber", "TelephoneNumbers", "LineURI", "LineUri"],
  "voice routing policy": ["OnlineVoiceRoutingPolicy"],
  "dial plan": ["EffectiveTenantDialPlanName", "TenantDialPlan"],
  "calling policy": ["TeamsCallingPolicy"]
};

function evidenceBody(value: string): string {
  return value.replace(
    /^Document:[^\r\n]*\r?\nHeading Path:[^\r\n]*\r?\n+/i,
    ""
  );
}

function perUserValueAliases(subject: string): string[] {
  return PER_USER_VALUE_ALIASES[normalizeEvidenceText(subject)] ?? [subject];
}

export interface PerUserEvidenceBindingCandidate {
  candidateId: string;
  documentId: string;
  sectionId: string;
  title: string;
}

/**
 * G2.1 multi-span binding invariant. Separate target/value evidence may be
 * composed only within the same canonical document/operation. Cross-document
 * material remains corroboration unless a future source model represents an
 * explicit relationship; mere topical overlap is intentionally insufficient.
 */
export function canBindPerUserEvidence(
  target: PerUserEvidenceBindingCandidate,
  value: PerUserEvidenceBindingCandidate
): boolean {
  if (target.candidateId === value.candidateId) return true;
  return (
    target.documentId === value.documentId &&
    normalizeEvidenceText(target.title) === normalizeEvidenceText(value.title)
  );
}

/**
 * G2.1 target-side proof. Generated document/heading envelopes are removed so
 * a cmdlet title containing "User" cannot manufacture user-level semantics.
 */
export function evidenceEstablishesUserTarget(value: string): boolean {
  const body = evidenceBody(value);
  const normalized = normalizeEvidenceText(body);
  const explicitIdentity =
    /\b(?:upn|userprincipalname|objectid|object id|assignedpstntargetid)\b/i.test(
      body
    ) ||
    /\bidentity\b/.test(normalized) &&
      /\buser\b/.test(normalized);
  const explicitAddress =
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(body);
  const filteredPopulation =
    /\bfilter\b/.test(normalized) &&
    /\busers?\b/.test(normalized);
  const boundedOperation =
    /\b(?:filter|return|retrieve|get|select|output|effective|assigned|assignment|identity)\b/.test(
      normalized
    );
  return (
    boundedOperation &&
    (explicitIdentity || explicitAddress || filteredPopulation)
  );
}

/**
 * G2.1 value-side proof. The requested value/property must occur in body text
 * together with read/output/effective-state semantics. A topical Get-* title
 * or a tenant-level definition sentence is insufficient.
 */
export function evidenceEstablishesReturnedUserValue(
  value: string,
  subject: string
): boolean {
  const body = evidenceBody(value);
  const normalized = normalizeEvidenceText(body);
  const aliases = perUserValueAliases(subject);
  const hasValue = aliases.some((alias) =>
    normalizeEvidenceText(body).includes(normalizeEvidenceText(alias))
  );
  if (!hasValue) return false;

  const outputSemantics =
    /\b(?:effective|assigned|assignment|returns?|returned|output|filter|select|property|attribute|enabled|policyname|policysource)\b/.test(
      normalized
    ) ||
    /(?:TelephoneNumber|EnterpriseVoiceEnabled|OnlineVoiceRoutingPolicy|EffectiveTenantDialPlanName|TeamsCallingPolicy)\s*:/i.test(
      body
    );
  if (!outputSemantics) return false;

  const normalizedSubject = normalizeEvidenceText(subject);
  if (normalizedSubject === "voice routing policy") {
    return (
      /\bonlinevoiceroutingpolicy\b/i.test(body) &&
      /\b(?:select|effective|assigned|output|policyname)\b/.test(normalized)
    );
  }
  if (normalizedSubject === "dial plan") {
    return /\beffectivetenantdialplanname\b/i.test(body);
  }
  if (normalizedSubject === "calling policy") {
    return (
      /\bteamscallingpolicy\b/i.test(body) &&
      /\b(?:effective|assignment|policyname|policysource|output)\b/.test(
        normalized
      )
    );
  }
  if (normalizedSubject === "phone number") {
    return (
      (/\btelephonenumbers\b/i.test(body) &&
        /\b(?:output|property|attribute|list|includes?)\b/.test(
          normalized
        )) ||
      (/\blineuri\b/i.test(body) &&
        /\b(?:output field|represents|same phone number|format list)\b/.test(
          normalized
        )) ||
      /\btelephonenumber\s*:/i.test(body)
    );
  }
  return true;
}

export function evidenceEstablishesPowerShellSyntax(
  value: string,
  subject: string
): boolean {
  const normalizedSubject = normalizeEvidenceText(subject);
  if (normalizedSubject === "per user iteration") {
    return (
      /\bForEach-Object\s*\{[^}]*\$_/i.test(value) &&
      !/\b-Parallel\b/i.test(value)
    );
  }
  if (normalizedSubject === "policy assignment filtering") {
    return (
      /\bWhere-Object\b/i.test(value) &&
      /\$_/.test(value) &&
      /\s-eq\b/i.test(value)
    );
  }
  if (normalizedSubject === "output object construction") {
    return /\[pscustomobject\]\s*@\{/i.test(value);
  }
  if (normalizedSubject === "csv export") {
    return (
      /\bExport-Csv\b/i.test(value) &&
      /\s-Path\b/i.test(value) &&
      /\s-NoTypeInformation\b/i.test(value)
    );
  }
  return false;
}

function stableId(value: string): string {
  return normalizeEvidenceText(value).replace(/\s+/g, "-");
}

function tokens(value: string): string[] {
  return normalizeEvidenceText(value).split(" ").filter(Boolean);
}

function distinctiveTerms(value: string): string[] {
  const all = tokens(value);
  const distinctive = all.filter(
    (term) => term.length >= 3 && !GENERIC_SUBJECT_TERMS.has(term)
  );
  return distinctive.length > 0 ? distinctive : all.filter((term) => term.length >= 3);
}

function canonicalSubjectKey(value: string): string {
  return tokens(value)
    .map((term) => {
      if (term.endsWith("ies") && term.length > 4) {
        return `${term.slice(0, -3)}y`;
      }
      if (term.endsWith("s") && !term.endsWith("ss") && term.length > 4) {
        return term.slice(0, -1);
      }
      return term;
    })
    .join(" ");
}

function pathLeaf(value: string): string {
  const clean = value.split(/[?#]/, 1)[0]?.replace(/\\/g, "/") ?? "";
  return clean.split("/").filter(Boolean).pop()?.replace(/\.md$/i, "") ?? "";
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function sourceDomainFromSourceId(sourceId: string): SourceDomain | "unknown" {
  if (sourceId === "ms-teams-admin") return "teams_admin";
  if (sourceId === "ms-teams-powershell") return "teams_powershell";
  if (sourceId === "ms-graph-docs") return "graph";
  if (sourceId === "ms-entra-docs") return "entra";
  if (sourceId === "ms-m365-docs") return "m365";
  if (sourceId === "ms-teams-dev-docs") return "teams_dev";
  if (sourceId === "ms-sharepoint-docs" || sourceId === "ms-sharepoint-powershell") {
    return "sharepoint";
  }
  if (sourceId === "ms-powershell-core") return "powershell_core";
  return "unknown";
}

function domainAuthorityRoles(domain: SourceDomain): SourceAuthorityRole[] {
  if (domain === "teams_admin") return ["teams_admin_primary"];
  if (domain === "teams_powershell") return ["teams_powershell_cmdlet_primary"];
  if (domain === "graph") return ["graph_api_primary"];
  if (domain === "entra") return ["entra_identity_primary"];
  if (domain === "m365") return ["m365_tenant_primary"];
  if (domain === "teams_dev") return ["teams_dev_specialized"];
  if (domain === "sharepoint") {
    return ["sharepoint_admin_primary", "sharepoint_powershell_cmdlet_primary"];
  }
  if (domain === "powershell_core") return ["powershell_core_primary"];
  return [];
}

/** Authority roles that grant genuine PowerShell cmdlet-reference authority, across module families. */
const CMDLET_AUTHORITY_ROLES: SourceAuthorityRole[] = [
  "teams_powershell_cmdlet_primary",
  "sharepoint_powershell_cmdlet_primary",
  "powershell_core_primary"
];

export function hasCmdletAuthority(authority: {
  authorityRoles: SourceAuthorityRole[];
}): boolean {
  return CMDLET_AUTHORITY_ROLES.some((role) => authority.authorityRoles.includes(role));
}

/** Which cmdlet-authoritative domain(s) the query intent actually resolved to (cmdlet-prefix or explicit signal). */
function cmdletDomainsForIntent(intent: QueryIntent): SourceDomain[] {
  const domains = (intent.domains as SourceDomain[]).filter(
    (domain) =>
      domain === "teams_powershell" ||
      domain === "sharepoint" ||
      domain === "powershell_core"
  );
  return domains.length > 0 ? domains : ["teams_powershell"];
}

function supportTypeForAnswerObject(
  answerObject: EvidenceAspectAnswerObject
): Exclude<EvidenceSupportType, "contextual"> {
  if (answerObject === "cmdlet_identifier" || answerObject === "cmdlet_semantics") {
    return "cmdlet_semantics";
  }
  if (answerObject === "procedure") return "procedure";
  if (answerObject === "configuration_behavior") return "configuration_behavior";
  if (answerObject === "configuration_state") return "licensing_or_status";
  if (answerObject === "comparison") return "comparison_dimension";
  if (answerObject === "status") return "licensing_or_status";
  if (answerObject === "relationship") return "configuration_behavior";
  return "concept_definition";
}

type MethodToolDefinition = {
  kind: EvidenceMethodConstraintKind;
  /** Normalized labels that identify this tool as a technology/product seed. */
  technologyLabels: string[];
  questionPatterns: RegExp[];
  domains: SourceDomain[];
  authorityRoles: SourceAuthorityRole[];
  label: string;
};

const METHOD_TOOL_DEFINITIONS: MethodToolDefinition[] = [
  {
    kind: "powershell",
    technologyLabels: ["powershell", "teams powershell"],
    questionPatterns: [/\bpowershell\b/i, /\bcmdlets?\b/i],
    domains: ["teams_powershell"],
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    label: "PowerShell"
  },
  {
    kind: "graph",
    technologyLabels: ["microsoft graph", "graph"],
    questionPatterns: [/\b(?:microsoft\s+)?graph\b/i],
    domains: ["graph"],
    authorityRoles: ["graph_api_primary"],
    label: "Microsoft Graph"
  },
  {
    kind: "teams_admin_center",
    technologyLabels: ["teams admin center", "admin center"],
    questionPatterns: [/\bteams\s+admin\s+center\b/i, /\badmin\s+center\b/i],
    domains: ["teams_admin"],
    authorityRoles: ["teams_admin_primary"],
    label: "Teams Admin Center"
  },
  {
    kind: "pnp_powershell",
    technologyLabels: ["pnp powershell", "pnp"],
    questionPatterns: [/\bpnp\s*powershell\b/i],
    domains: ["teams_powershell"],
    authorityRoles: ["teams_powershell_cmdlet_primary"],
    label: "PnP PowerShell"
  }
];

function deriveSubjectAliases(
  canonical: string,
  question: string,
  span: string,
  kind: EvidenceAspectSubjectKind = "entity"
): { aliases: string[]; questionSpans: string[] } {
  const aliases = new Set<string>();
  const questionSpans = new Set<string>();
  const canonNorm = normalizeEvidenceText(canonical);
  if (canonNorm) aliases.add(canonNorm);
  const spanNorm = normalizeEvidenceText(span);
  if (spanNorm) {
    aliases.add(spanNorm);
    questionSpans.add(span);
  }
  const questionNorm = normalizeEvidenceText(question);
  const canonTokens = tokens(canonical);
  for (let start = 0; start < canonTokens.length; start += 1) {
    for (let end = start + 1; end <= canonTokens.length; end += 1) {
      const slice = canonTokens.slice(start, end).join(" ");
      if (!slice) continue;
      // V1.1 — a single-token sub-slice of a multi-word canonical subject is
      // only safe as a standalone alias when that token is a recognized
      // domain-umbrella term (e.g. "Teams" out of "Microsoft Teams": the
      // whole corpus scope is already Teams, so the word is never a false
      // topicality signal). An arbitrary single-token slice of a narrower
      // multi-word concept (e.g. "voice" out of "Enterprise Voice") is not
      // safe: that single common word also occurs in many unrelated Teams
      // voice/calling documents, producing false topical matches. Multi-word
      // sub-phrase slices remain unrestricted since a real phrase match is
      // inherently distinctive.
      //
      // This precision requirement is intentionally scoped to canonically
      // identified subjects (a specific policy, cmdlet, product, technology,
      // or named entity) where a false single-word match would misattribute
      // support to an unrelated concept. It does not apply to "unresolved"
      // subjects: those are a deliberate decomposition of a broad, no-single-
      // entity question (e.g. "secure SharePoint data ... accessible ...")
      // into its distinctive question words, precisely so that candidates
      // touching on any one of those distinctive words can be recognized as
      // concept-relevant for a broad answer. Suppressing single-word aliases
      // there would collapse broad-aspect recall back to requiring the full,
      // rarely-literal question phrase.
      const isSingleGenericToken =
        kind !== "unresolved" &&
        end - start === 1 &&
        !GENERIC_SUBJECT_TERMS.has(slice) &&
        canonTokens.length > 1;
      if (isSingleGenericToken) continue;
      if (questionNorm.includes(slice)) {
        aliases.add(slice);
        questionSpans.add(slice);
      }
    }
  }
  return {
    aliases: [...aliases],
    questionSpans: [...questionSpans]
  };
}

function makeSubject(
  kind: EvidenceAspectSubjectKind,
  value: string,
  options: { question?: string; span?: string } = {}
): EvidenceAspectSubject {
  const question = options.question ?? value;
  const span = options.span ?? value;
  const { aliases, questionSpans } = deriveSubjectAliases(value, question, span, kind);
  return {
    kind,
    value,
    terms: distinctiveTerms(value),
    aliases,
    questionSpans
  };
}

/** Shared with R3 via operationMatchesText — null never matches. */
function operationSupported(text: string, operation: string | null): boolean {
  return operationMatchesText(text, operation);
}

function fieldContainsTokenSequence(field: string, phrase: string): boolean {
  const fieldTokens = tokens(field);
  const phraseTokens = tokens(phrase);
  if (phraseTokens.length === 0 || fieldTokens.length < phraseTokens.length) {
    return false;
  }
  for (let index = 0; index <= fieldTokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => fieldTokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
}

function singularize(term: string): string {
  if (term.endsWith("ies") && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith("s") && !term.endsWith("ss") && term.length > 4) {
    return term.slice(0, -1);
  }
  return term;
}

const DISTINCT_POLICY_SUBJECTS = [
  "emergency calling policy",
  "voice routing policy",
  "meeting policy"
] as const;

function isUnsafePolicySubphrase(
  fieldTokens: string[],
  matchStart: number,
  matchLength: number,
  subjectTokens: string[]
): boolean {
  const matchEnd = matchStart + matchLength;
  for (const distinctPolicy of DISTINCT_POLICY_SUBJECTS) {
    const distinctTokens = tokens(distinctPolicy).map(singularize);
    if (
      distinctTokens.length <= subjectTokens.length ||
      distinctTokens.join(" ") === subjectTokens.join(" ")
    ) {
      continue;
    }
    for (
      let index = 0;
      index <= fieldTokens.length - distinctTokens.length;
      index += 1
    ) {
      const distinctEnd = index + distinctTokens.length;
      if (
        distinctTokens.every(
          (token, offset) => fieldTokens[index + offset] === token
        ) &&
        matchStart >= index &&
        matchEnd <= distinctEnd
      ) {
        return true;
      }
    }
  }
  return (
    subjectTokens.at(-1) !== "policy" &&
    fieldTokens[matchEnd] === "policy"
  );
}

/**
 * Shared R2/R3 canonical subject identity. Policy subjects allow only
 * adjacent, token-complete singular/plural morphology and reject a match
 * embedded in a different recognized policy name.
 */
export function canonicalSubjectPhraseAppears(
  field: string,
  subject: EvidenceAspectSubject
): boolean {
  const normalized = normalizeEvidenceText(field);
  const phrases = [subject.value, ...subject.aliases];
  if (subject.kind !== "policy") {
    return phrases.some(
      (phrase) =>
        Boolean(normalizeEvidenceText(phrase)) &&
        fieldContainsTokenSequence(normalized, phrase)
    );
  }

  const fieldTokens = tokens(normalized).map(singularize);
  for (const phrase of phrases) {
    const phraseTokens = tokens(phrase).map(singularize);
    if (
      phraseTokens.length === 0 ||
      fieldTokens.length < phraseTokens.length
    ) {
      continue;
    }
    for (
      let index = 0;
      index <= fieldTokens.length - phraseTokens.length;
      index += 1
    ) {
      if (
        phraseTokens.every(
          (token, offset) => fieldTokens[index + offset] === token
        ) &&
        !isUnsafePolicySubphrase(
          fieldTokens,
          index,
          phraseTokens.length,
          phraseTokens
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function fieldContainsSubjectTerms(
  field: string,
  subject: EvidenceAspectSubject
): boolean {
  if (canonicalSubjectPhraseAppears(field, subject)) return true;
  if (subject.terms.length === 0) return false;
  // Named policy objects (e.g. "calling policy", "voice routing policy") are
  // precise, canonically-identified configuration objects, not free-text
  // topics. A "terms present somewhere nearby" fallback is unsafe for them:
  // Teams has multiple distinct, easily confusable policy-shaped concepts
  // that share individual words (e.g. "Calling Plan" vs. "Calling Policy",
  // or "voice routing policy" vs. "dial plan" both mentioning "voice" and
  // "policy" in the same overview paragraph). Require the literal phrase (or
  // a recognized alias) rather than scattered term co-occurrence — but still
  // tolerate ordinary plural/singular authoring variance (e.g. a "Meeting
  // policies" heading for a "meeting policy" subject), since that is a
  // genuine phrase match, not a different concept.
  if (subject.kind === "policy") {
    return false;
  }
  const soleTerm = subject.terms.length === 1 ? subject.terms[0] : undefined;
  if (soleTerm) {
    return tokens(field).includes(soleTerm);
  }
  // V1.1: for multi-term subjects the fallback must not treat scattered,
  // unrelated occurrences of each individual term as topical support (e.g.
  // an unrelated "Enterprise E5 license" mention plus an unrelated "Voice >
  // Phone numbers" nav heading elsewhere in a long chunk should not satisfy
  // an "enterprise voice" subject). Require all distinctive terms to
  // co-occur within a bounded token window instead.
  const fieldTokens = tokens(field);
  const windowSize = 10;
  for (let start = 0; start < fieldTokens.length; start += 1) {
    const windowTerms = new Set(fieldTokens.slice(start, start + windowSize));
    if (subject.terms.every((term) => windowTerms.has(term))) {
      return true;
    }
  }
  return false;
}

function isMethodToolTechnology(value: string): MethodToolDefinition | null {
  const normalized = normalizeEvidenceText(value);
  for (const definition of METHOD_TOOL_DEFINITIONS) {
    if (definition.technologyLabels.some((label) => label === normalized)) {
      return definition;
    }
  }
  return null;
}

function isToolAsSubjectQuestion(intent: QueryIntent, toolLabel: string): boolean {
  const q = intent.normalizedQuestion;
  const toolNorm = normalizeEvidenceText(toolLabel);
  const toolTokens = tokens(toolLabel).filter(
    (term) => term !== "microsoft" && !GENERIC_SUBJECT_TERMS.has(term)
  );
  const mentioned =
    q.includes(toolNorm) || toolTokens.some((term) => q.includes(term));
  if (!mentioned) return false;
  if (/^(?:what|what's)\s+(?:is|are)\b/.test(q)) return true;
  if (/^what\s+does\b/.test(q)) {
    const after = q.replace(/^what\s+does\s+/, "");
    if (
      after.startsWith(toolNorm) ||
      toolTokens.some((term) => after.startsWith(term))
    ) {
      return true;
    }
  }
  if (/\b(?:overview|introduction)\b/.test(q) && toolTokens.some((t) => q.includes(t))) {
    return true;
  }
  return false;
}

function isProceduralOrConfiguration(intent: QueryIntent): boolean {
  return (
    intent.expectedAnswerType === "procedural" ||
    intent.expectedAnswerType === "configuration"
  );
}

function questionFramesToolAsMethod(intent: QueryIntent, toolLabel: string): boolean {
  if (isToolAsSubjectQuestion(intent, toolLabel)) return false;
  const q = intent.normalizedQuestion;
  const toolNorm = normalizeEvidenceText(toolLabel);
  const toolTokens = tokens(toolLabel).filter(
    (term) => term !== "microsoft" && term.length >= 3
  );
  const mentioned =
    q.includes(toolNorm) || toolTokens.some((term) => q.includes(term));
  if (!mentioned) return false;
  if (isProceduralOrConfiguration(intent)) return true;
  // Classifier may miss procedural framing; treat using/with/via/in + tool as method.
  if (
    /\b(?:using|with|via|through)\b/.test(q) ||
    /\bin\s+teams\s+admin\s+center\b/.test(q) ||
    /\bin\s+the\s+admin\s+center\b/.test(q)
  ) {
    return true;
  }
  return false;
}

/**
 * The generic "powershell" method tool covers multiple PowerShell module
 * families (Teams, SharePoint). Its domain/role requirement must follow the
 * domain the query intent actually resolved (via cmdlet prefix or explicit
 * product keywords), not default unconditionally to Teams. When the intent
 * gives no distinguishing signal, Teams remains the default for backward
 * compatibility with existing "using PowerShell" questions.
 */
function resolveMethodToolAuthority(
  definition: MethodToolDefinition,
  intent: QueryIntent
): { domains: SourceDomain[]; authorityRoles: SourceAuthorityRole[] } {
  if (definition.kind !== "powershell") {
    return { domains: [...definition.domains], authorityRoles: [...definition.authorityRoles] };
  }
  const domains = new Set<SourceDomain>();
  const roles = new Set<SourceAuthorityRole>();
  const intentDomains = intent.domains as SourceDomain[];
  if (intentDomains.includes("sharepoint")) {
    domains.add("sharepoint");
    roles.add("sharepoint_powershell_cmdlet_primary");
  }
  if (
    intentDomains.includes("powershell_core") &&
    !intentDomains.includes("teams_powershell") &&
    !intentDomains.includes("sharepoint")
  ) {
    domains.add("powershell_core");
    roles.add("powershell_core_primary");
  }
  if (domains.size === 0 || intentDomains.includes("teams_powershell")) {
    domains.add("teams_powershell");
    roles.add("teams_powershell_cmdlet_primary");
  }
  return { domains: [...domains], authorityRoles: [...roles] };
}

export function detectMethodConstraints(intent: QueryIntent): EvidenceMethodConstraint[] {
  const constraints: EvidenceMethodConstraint[] = [];
  const seen = new Set<EvidenceMethodConstraintKind>();
  const question = intent.originalQuestion;

  for (const technology of intent.technologies) {
    const definition = isMethodToolTechnology(technology);
    if (!definition) continue;
    if (!questionFramesToolAsMethod(intent, technology)) continue;
    if (seen.has(definition.kind)) continue;
    seen.add(definition.kind);
    const resolved = resolveMethodToolAuthority(definition, intent);
    constraints.push({
      kind: definition.kind,
      label: definition.label,
      required: true,
      domains: resolved.domains,
      authorityRoles: resolved.authorityRoles
    });
  }

  for (const definition of METHOD_TOOL_DEFINITIONS) {
    if (seen.has(definition.kind)) continue;
    if (!definition.questionPatterns.some((pattern) => pattern.test(question))) {
      continue;
    }
    if (!questionFramesToolAsMethod(intent, definition.label)) continue;
    seen.add(definition.kind);
    const resolved = resolveMethodToolAuthority(definition, intent);
    constraints.push({
      kind: definition.kind,
      label: definition.label,
      required: true,
      domains: resolved.domains,
      authorityRoles: resolved.authorityRoles
    });
  }

  return constraints;
}

function subjectAppearsInClause(
  clause: string,
  seed: SubjectSeed,
  intent: QueryIntent
): boolean {
  const { aliases } = deriveSubjectAliases(
    seed.value,
    intent.normalizedQuestion,
    seed.span,
    seed.kind
  );
  return aliases.some(
    (alias) => alias.length > 0 && fieldContainsTokenSequence(clause, alias)
  );
}

function isImplicitCmdletQuestion(question: string): boolean {
  return (
    /\bwhich cmdlet\b/i.test(question) ||
    /\bwhat cmdlet\b/i.test(question) ||
    /\bwhich powershell (?:command|cmdlet)\b/i.test(question) ||
    /\bpowershell command\b/i.test(question)
  );
}

function isBroadHowQuestion(normalized: string): boolean {
  return (
    /^how (?:do|does|can|should)\b/.test(normalized) &&
    /\bwork(?:s|ing)?\b/.test(normalized) &&
    !/\bhow (?:do i|to)\b/.test(normalized)
  );
}

function detectRelationship(
  intent: QueryIntent,
  subjects: EvidenceAspectSubject[]
): EvidenceAspectRelationship | null {
  if (subjects.length < 2) return null;
  const predicate = RELATION_PREDICATES.find((entry) =>
    entry.pattern.test(intent.originalQuestion)
  );
  if (!predicate) return null;
  const [source, target] = subjects;
  if (!source || !target) return null;
  return {
    predicate: predicate.predicate,
    participants: [
      { role: "source", subject: source },
      { role: "target", subject: target }
    ]
  };
}

type SubjectSeed = {
  value: string;
  kind: EvidenceAspectSubjectKind;
  requirement: "mandatory" | "optional";
  canonicalIdentifier: EvidenceAspect["canonicalIdentifier"];
  span: string;
  /** Component seeds preserved when a compound subject is bound. */
  components?: SubjectSeed[];
};

const SEPARATE_TREATMENT_BETWEEN =
  /\b(?:and|or|versus|vs|compared|also|then|while|but|plus|as well as)\b/;

const SCOPING_BETWEEN = /^(?:for|in|with|of|on|via|using|the)$/;

function uniqueSpecificSeeds(seeds: SubjectSeed[]): SubjectSeed[] {
  const byNormalized = new Map<string, SubjectSeed>();
  for (const seed of seeds) {
    const normalized = canonicalSubjectKey(seed.value);
    if (!normalized) continue;
    const existing = byNormalized.get(normalized);
    if (!existing || existing.requirement === "optional") {
      byNormalized.set(normalized, seed);
    }
  }
  const sorted = [...byNormalized.entries()].sort(
    (left, right) => right[0].length - left[0].length
  );
  const retained: Array<[string, SubjectSeed]> = [];
  for (const entry of sorted) {
    const [normalized, seed] = entry;
    const contained = retained.some(
      ([other, otherSeed]) =>
        other.includes(normalized) &&
        otherSeed.kind !== "cmdlet" &&
        seed.kind !== "cmdlet"
    );
    if (!contained) retained.push(entry);
  }
  return retained.map(([, seed]) => seed);
}

function shouldSkipCompoundSubjectBinding(intent: QueryIntent): boolean {
  if (intent.expectedAnswerType === "comparison") return true;
  return RELATION_PREDICATES.some((entry) =>
    entry.pattern.test(intent.originalQuestion)
  );
}

function hasSharedDistinctiveTerm(left: SubjectSeed, right: SubjectSeed): boolean {
  const leftTerms = new Set(distinctiveTerms(left.value));
  const rightTerms = new Set(distinctiveTerms(right.value));
  for (const term of leftTerms) {
    if (rightTerms.has(term)) return true;
  }
  return false;
}

function seedKindPriority(kind: EvidenceAspectSubjectKind): number {
  switch (kind) {
    case "cmdlet":
      return 0;
    case "policy":
      return 1;
    case "entity":
      return 2;
    case "technology":
      return 3;
    case "product":
      return 4;
    default:
      return 5;
  }
}

function pickCompositeKind(components: SubjectSeed[]): EvidenceAspectSubjectKind {
  return [...components].sort(
    (left, right) => seedKindPriority(left.kind) - seedKindPriority(right.kind)
  )[0]?.kind ?? "entity";
}

function clauseBoundOperationsForSeed(
  seed: SubjectSeed,
  intent: QueryIntent,
  operations: string[]
): string[] {
  const questionClauses = intent.normalizedQuestion
    .split(/[?;,]|\b(?:and|also|then|while|but)\b/)
    .map((clause) => normalizeEvidenceText(clause))
    .filter(Boolean);
  return operations.filter((operation) =>
    questionClauses.some(
      (clause) =>
        subjectAppearsInClause(clause, seed, intent) &&
        operationSupported(clause, operation)
    )
  );
}

function haveSeparateClauseBoundOperations(
  left: SubjectSeed,
  right: SubjectSeed,
  intent: QueryIntent
): boolean {
  const operations = [
    ...new Set(
      (intent.operationIntents ?? [])
        .map(normalizeEvidenceText)
        .filter(Boolean)
    )
  ];
  if (operations.length === 0) return false;
  const leftOps = new Set(clauseBoundOperationsForSeed(left, intent, operations));
  const rightOps = new Set(clauseBoundOperationsForSeed(right, intent, operations));
  if (leftOps.size === 0 || rightOps.size === 0) return false;
  for (const operation of leftOps) {
    if (!rightOps.has(operation)) return true;
  }
  for (const operation of rightOps) {
    if (!leftOps.has(operation)) return true;
  }
  return false;
}

/**
 * Bind adjacent/overlapping technical concepts into one compound subject when they
 * form a single noun-phrase proposition. Conjunction, comparison, relationship
 * predicates, and separately clause-bound operations prevent binding.
 */
function bindCompoundSubjectSeeds(
  seeds: SubjectSeed[],
  intent: QueryIntent
): SubjectSeed[] {
  if (shouldSkipCompoundSubjectBinding(intent)) return seeds;

  const questionNorm = normalizeEvidenceText(intent.normalizedQuestion);
  const optional = seeds.filter((seed) => seed.requirement === "optional");
  const cmdlets = seeds.filter(
    (seed) => seed.requirement === "mandatory" && seed.kind === "cmdlet"
  );
  const candidates = seeds.filter(
    (seed) => seed.requirement === "mandatory" && seed.kind !== "cmdlet"
  );

  const located = candidates
    .map((seed) => {
      const normalized = normalizeEvidenceText(seed.span || seed.value);
      return {
        seed,
        normalized,
        index: questionNorm.indexOf(normalized)
      };
    })
    .filter((entry) => entry.index >= 0)
    .sort(
      (left, right) =>
        left.index - right.index ||
        right.normalized.length - left.normalized.length
    );
  const unlocated = candidates.filter(
    (seed) =>
      questionNorm.indexOf(normalizeEvidenceText(seed.span || seed.value)) < 0
  );

  const merged: SubjectSeed[] = [];
  let index = 0;
  while (index < located.length) {
    const start = located[index];
    if (!start) break;
    const components: SubjectSeed[] = [start.seed];
    let end = start.index + start.normalized.length;
    let cursor = index + 1;
    while (cursor < located.length) {
      const next = located[cursor];
      if (!next) break;
      if (next.index < end) {
        // Overlapping span: absorb as component when it specializes the current phrase.
        if (
          !haveSeparateClauseBoundOperations(start.seed, next.seed, intent) &&
          (hasSharedDistinctiveTerm(components[components.length - 1]!, next.seed) ||
            next.index < end)
        ) {
          components.push(next.seed);
          end = Math.max(end, next.index + next.normalized.length);
          cursor += 1;
          continue;
        }
        break;
      }
      const between = questionNorm.slice(end, next.index).trim();
      if (SEPARATE_TREATMENT_BETWEEN.test(between)) break;
      if (!(between === "" || SCOPING_BETWEEN.test(between))) break;
      if (haveSeparateClauseBoundOperations(start.seed, next.seed, intent)) break;
      const previous = components[components.length - 1]!;
      const qualifies =
        between === "" ||
        hasSharedDistinctiveTerm(previous, next.seed) ||
        SCOPING_BETWEEN.test(between);
      if (!qualifies) break;
      components.push(next.seed);
      end = next.index + next.normalized.length;
      cursor += 1;
    }

    if (components.length === 1) {
      merged.push(components[0]!);
    } else {
      const value = components.map((component) => component.value).join(" ");
      merged.push({
        value,
        kind: pickCompositeKind(components),
        requirement: "mandatory",
        canonicalIdentifier:
          components.find((component) => component.canonicalIdentifier)
            ?.canonicalIdentifier ?? null,
        span: questionNorm.slice(start.index, end),
        components: components.map((component) => ({
          value: component.value,
          kind: component.kind,
          requirement: component.requirement,
          canonicalIdentifier: component.canonicalIdentifier,
          span: component.span
        }))
      });
    }
    index = Math.max(cursor, index + 1);
  }

  return [...cmdlets, ...merged, ...unlocated, ...optional];
}

function subjectsForSeed(
  seed: SubjectSeed,
  intent: QueryIntent
): EvidenceAspectSubject[] {
  if (seed.components && seed.components.length > 0) {
    return seed.components.map((component) =>
      makeSubject(component.kind, component.value, {
        question: intent.normalizedQuestion,
        span: component.span
      })
    );
  }
  return [
    makeSubject(seed.kind, seed.value, {
      question: intent.normalizedQuestion,
      span: seed.span
    })
  ];
}

function fallbackSubject(intent: QueryIntent): string {
  const terms = tokens(intent.normalizedQuestion)
    .filter(
      (term) =>
        term.length >= 4 &&
        !QUESTION_STOP_TERMS.has(term) &&
        !GENERIC_SUBJECT_TERMS.has(term)
    )
    .slice(0, 4);
  return terms.join(" ") || intent.normalizedQuestion;
}

function authorityFor(
  answerObject: EvidenceAspectAnswerObject,
  intent: QueryIntent,
  requireCanonicalIdentity: boolean,
  identityType: EvidenceAspectAuthorityRequirement["identityType"],
  methodConstraints: EvidenceMethodConstraint[] = []
): EvidenceAspectAuthorityRequirement {
  if (
    answerObject === "cmdlet_identifier" ||
    answerObject === "cmdlet_semantics"
  ) {
    const resolvedDomains = cmdletDomainsForIntent(intent);
    const roles = new Set<SourceAuthorityRole>();
    for (const domain of resolvedDomains) {
      for (const role of domainAuthorityRoles(domain)) {
        if (CMDLET_AUTHORITY_ROLES.includes(role)) roles.add(role);
      }
    }
    return {
      requiredRoles: [...roles],
      requiredDomains: resolvedDomains,
      requireCanonicalIdentity,
      identityType
    };
  }
  const domains = new Set<SourceDomain>(
    (intent.domains as SourceDomain[]).filter(
      (domain) => domain !== "powershell_core"
    )
  );
  const roles = new Set<SourceAuthorityRole>();
  for (const domain of domains) {
    for (const role of domainAuthorityRoles(domain)) roles.add(role);
  }
  // Complementary admin + tool authority on one aspect when a method is requested.
  for (const constraint of methodConstraints) {
    for (const domain of constraint.domains) domains.add(domain);
    for (const role of constraint.authorityRoles) roles.add(role);
  }
  if (
    (answerObject === "procedure" ||
      answerObject === "configuration_behavior" ||
      answerObject === "configuration_state") &&
    (intent.domains.includes("teams_admin") ||
      intent.products.some((product) =>
        normalizeEvidenceText(product).includes("teams")
      ) ||
      intent.technologies.some((technology) =>
        normalizeEvidenceText(technology).includes("teams")
      ))
  ) {
    domains.add("teams_admin");
    for (const role of domainAuthorityRoles("teams_admin")) roles.add(role);
  }
  return {
    requiredRoles: [...roles],
    requiredDomains: [...domains],
    requireCanonicalIdentity,
    identityType
  };
}

function breadthAndFacets(params: {
  answerObject: EvidenceAspectAnswerObject;
  intent: QueryIntent;
  operation: string | null;
  perUserState?: boolean;
}): {
  breadth: EvidenceAspectBreadth;
  requiredFacets: EvidenceSupportFacet[];
} {
  if (params.answerObject === "cmdlet_identifier") {
    return {
      breadth: "narrow",
      requiredFacets: ["identifier", "operation"]
    };
  }
  if (params.answerObject === "cmdlet_semantics") {
    return {
      breadth: "bounded",
      requiredFacets: ["identifier", "behavior"]
    };
  }
  if (params.answerObject === "relationship") {
    return {
      breadth: "bounded",
      requiredFacets: ["relationship"]
    };
  }
  if (params.answerObject === "procedure") {
    return {
      breadth: "bounded",
      // Null operation must not require an unplannable/vacuous operation facet.
      requiredFacets: params.operation
        ? ["procedure", "operation"]
        : ["procedure"]
    };
  }
  if (
    params.answerObject === "mechanism" &&
    isBroadHowQuestion(params.intent.normalizedQuestion)
  ) {
    return {
      breadth: "broad",
      requiredFacets: ["purpose", "mechanism"]
    };
  }
  if (params.answerObject === "configuration_behavior") {
    return {
      breadth: params.operation ? "bounded" : "narrow",
      requiredFacets: params.operation
        ? ["configuration", "operation"]
        : ["configuration"]
    };
  }
  if (params.answerObject === "configuration_state") {
    return {
      breadth: "narrow",
      requiredFacets: params.perUserState
        ? ["user_target", "returned_value"]
        : ["state"]
    };
  }
  return {
    breadth: "bounded",
    requiredFacets: ["behavior"]
  };
}

/** Marks an aspect as a generic output/transformation requirement that no
 * currently-modeled Relay domain can be authoritative for. Kept distinct
 * from `unresolved` (fallback subject) so diagnostics/planner code can
 * render an explicit, specific caveat instead of a generic one. */
export const OUTPUT_TRANSFORMATION_RULE_ID =
  "workflow_output_transformation_powershell_core";
export const WORKFLOW_ORCHESTRATION_RULE_ID =
  "workflow_orchestration_powershell_core";

/**
 * V1 — CSV/output transformation is a requested output of the workflow, not
 * a Teams-authoritative technical fact. It is modeled as its own mandatory
 * aspect (so it is tracked and explicitly caveated rather than silently
 * dropped) with an authority requirement that can never be satisfied by any
 * domain, regardless of which candidates happen to be textually topical for
 * it. This deliberately keeps the gap isolated: it can never "borrow"
 * authority from an unrelated Teams PowerShell/Admin candidate, and it can
 * never invalidate the independently-supported Teams-side aspects.
 */
function buildOutputTransformationAspect(
  intent: QueryIntent,
  label: string
): EvidenceAspect {
  return buildPowerShellCoreWorkflowAspect(intent, {
    label,
    evidenceSubject: "Export-Csv",
    canonicalIdentifier: { type: "cmdlet", value: "Export-Csv" },
    ruleId: OUTPUT_TRANSFORMATION_RULE_ID
  });
}

function buildPowerShellCoreWorkflowAspect(
  intent: QueryIntent,
  params: {
    label: string;
    evidenceSubject: string;
    canonicalIdentifier: NonNullable<EvidenceAspect["canonicalIdentifier"]>;
    ruleId: string;
  }
): EvidenceAspect {
  const subject = makeSubject("entity", params.evidenceSubject, {
    question: intent.normalizedQuestion,
    span: params.evidenceSubject
  });
  return {
    aspectId: [
      "mandatory",
      "entity",
      stableId(params.label),
      "powershell-core"
    ].join(":"),
    requirement: "mandatory",
    subject: params.label,
    subjectTerms: subject.terms,
    subjects: [subject],
    operation: null,
    methodConstraints: [
      {
        kind: "powershell",
        label: "PowerShell",
        required: true,
        domains: ["powershell_core"],
        authorityRoles: ["powershell_core_primary"]
      }
    ],
    answerObject: "mechanism",
    relationship: null,
    breadth: "narrow",
    requiredFacets: ["behavior", "syntax"],
    authorityRequirement: {
      requiredRoles: ["powershell_core_primary"],
      requiredDomains: ["powershell_core"],
      requireCanonicalIdentity: true,
      identityType: params.canonicalIdentifier.type
    },
    minimumSupportStrength: "direct",
    supportType: "concept_definition",
    canonicalIdentifier: params.canonicalIdentifier,
    derivation: {
      ruleIds: [params.ruleId],
      questionSpans: [params.label],
      unresolved: false
    }
  };
}

function questionRequestsPerUserState(
  intent: QueryIntent,
  seed: SubjectSeed
): boolean {
  const question = normalizeEvidenceText(intent.originalQuestion);
  const userScoped =
    /\b(?:user|users|account|accounts|upn|object id|identity)\b/.test(
      question
    );
  const stateScoped =
    /\b(?:assigned|effective|current|identify|determine|read|retrieve|report|show|value)\b/.test(
      question
    );
  return (
    userScoped &&
    stateScoped &&
    subjectAppearsInClause(question, seed, intent)
  );
}

export function deriveEvidenceAspects(
  result: HybridRetrievalResult
): EvidenceAspect[] {
  const intent = result.intent;
  const methodConstraints = detectMethodConstraints(intent);
  const directives = result.scope.exactMatchDirectives.filter(
    (directive) => directive.required
  );
  const commands = intent.commandNames ?? [];
  const hasCommands = commands.length > 0;
  const implicitCmdlet = !hasCommands && isImplicitCmdletQuestion(intent.originalQuestion);
  const seeds: SubjectSeed[] = [];

  for (const command of commands) {
    const directive = directives.find(
      (item) =>
        item.type === "cmdlet" &&
        normalizeEvidenceText(item.value) === normalizeEvidenceText(command)
    );
    seeds.push({
      value: command,
      kind: "cmdlet",
      requirement: "mandatory",
      canonicalIdentifier: {
        type: "cmdlet",
        value: directive?.value ?? command
      },
      span: command
    });
  }

  for (const policy of intent.policyNames ?? []) {
    seeds.push({
      value: policy,
      kind: "policy",
      requirement: hasCommands ? "optional" : "mandatory",
      canonicalIdentifier:
        directives.find(
          (item) =>
            item.type === "policy" &&
            normalizeEvidenceText(item.value) === normalizeEvidenceText(policy)
        ) ?? null,
      span: policy
    });
  }

  for (const entity of intent.entities) {
    seeds.push({
      value: entity,
      kind: "entity",
      requirement: hasCommands ? "optional" : "mandatory",
      canonicalIdentifier:
        directives.find(
          (item) =>
            item.type === "entity" &&
            normalizeEvidenceText(item.value) === normalizeEvidenceText(entity)
        ) ?? null,
      span: entity
    });
  }

  const hasMandatorySubject = seeds.some((seed) => seed.requirement === "mandatory");
  for (const technology of intent.technologies) {
    const methodTool = isMethodToolTechnology(technology);
    if (methodTool && questionFramesToolAsMethod(intent, technology)) {
      // Method/tool constraint — not an independent mandatory aspect.
      continue;
    }
    if (
      hasMandatorySubject &&
      tokens(technology).every((term) => GENERIC_SUBJECT_TERMS.has(term))
    ) {
      continue;
    }
    seeds.push({
      value: technology,
      kind: "technology",
      requirement: hasMandatorySubject ? "optional" : "mandatory",
      canonicalIdentifier: null,
      span: technology
    });
  }
  for (const product of intent.products) {
    const methodTool = isMethodToolTechnology(product);
    if (methodTool && questionFramesToolAsMethod(intent, product)) {
      continue;
    }
    if (
      hasMandatorySubject &&
      tokens(product).every((term) => GENERIC_SUBJECT_TERMS.has(term))
    ) {
      continue;
    }
    seeds.push({
      value: product,
      kind: "product",
      requirement: "optional",
      canonicalIdentifier: null,
      span: product
    });
  }

  for (const directive of directives) {
    const represented = seeds.some(
      (seed) =>
        seed.canonicalIdentifier?.type === directive.type &&
        normalizeEvidenceText(seed.canonicalIdentifier.value) ===
          normalizeEvidenceText(directive.value)
    );
    if (!represented) {
      seeds.push({
        value: directive.value,
        kind: directive.type === "cmdlet" ? "cmdlet" : directive.type,
        requirement: "mandatory",
        canonicalIdentifier: {
          type: directive.type,
          value: directive.value
        },
        span: directive.value
      });
    }
  }

  let uniqueSeeds = uniqueSpecificSeeds(seeds);
  if (!uniqueSeeds.some((seed) => seed.requirement === "mandatory")) {
    uniqueSeeds = [
      {
        value: fallbackSubject(intent),
        kind: "unresolved",
        requirement: "mandatory",
        canonicalIdentifier: null,
        span: intent.originalQuestion
      },
      ...uniqueSeeds
    ];
  }

  // Relationship detection uses pre-binding subjects so relational questions are
  // not collapsed into a single compound noun-phrase aspect.
  const mandatorySubjects = uniqueSeeds
    .filter((seed) => seed.requirement === "mandatory")
    .map((seed) =>
      makeSubject(seed.kind, seed.value, {
        question: intent.normalizedQuestion,
        span: seed.span
      })
    );
  const relationship = detectRelationship(intent, mandatorySubjects);
  const mandatoryOutputSeedCount = uniqueSeeds.filter(
    (seed) => seed.requirement === "mandatory" && seed.kind !== "cmdlet"
  ).length;
  // V1 — a request that enumerates a population and asks for the combined
  // result to be reported/exported is a single multi-output workflow: each
  // independently requested technical value must remain its own required
  // aspect. The general adjacent-noun-phrase binder below exists to merge
  // modifiers of ONE concept (e.g. "Conditional Access policy") and would
  // otherwise collapse a comma-separated list of distinct requested outputs
  // into one compound subject, which is the opposite of what this request
  // shape needs.
  const isWorkflowEnumeration =
    mandatoryOutputSeedCount >= 3 &&
    questionEnumeratesPopulationWithReporting(intent.originalQuestion);
  if (!relationship && !isWorkflowEnumeration) {
    uniqueSeeds = bindCompoundSubjectSeeds(uniqueSeeds, intent);
  }
  const operations = [
    ...new Set(
      (intent.operationIntents ?? [])
        .map(normalizeEvidenceText)
        .filter(Boolean)
    )
  ];
  const aspectMethodConstraints = methodConstraints;

  if (implicitCmdlet) {
    const primarySubject =
      uniqueSeeds.find(
        (seed) =>
          seed.requirement === "mandatory" &&
          (seed.kind === "policy" || seed.kind === "entity")
      ) ?? uniqueSeeds.find((seed) => seed.requirement === "mandatory");
    const operation =
      operations.find((item) => item === "grant" || item === "assign") ??
      operations[0] ??
      null;
    if (!primarySubject || !operation) {
      return [
        {
          aspectId: "mandatory:unresolved:cmdlet-identifier:general",
          requirement: "mandatory",
          subject: primarySubject?.value ?? fallbackSubject(intent),
          subjectTerms: distinctiveTerms(
            primarySubject?.value ?? fallbackSubject(intent)
          ),
          subjects: primarySubject
            ? [
                makeSubject(primarySubject.kind, primarySubject.value, {
                  question: intent.normalizedQuestion,
                  span: primarySubject.span
                })
              ]
            : [
                makeSubject("unresolved", fallbackSubject(intent), {
                  question: intent.normalizedQuestion,
                  span: intent.originalQuestion
                })
              ],
          operation: null,
          methodConstraints: aspectMethodConstraints,
          answerObject: "cmdlet_identifier",
          relationship: null,
          breadth: "narrow",
          requiredFacets: ["identifier", "operation"],
          authorityRequirement: authorityFor(
            "cmdlet_identifier",
            intent,
            true,
            "cmdlet",
            aspectMethodConstraints
          ),
          minimumSupportStrength: "direct",
          supportType: "cmdlet_semantics",
          canonicalIdentifier: null,
          derivation: {
            ruleIds: ["implicit_cmdlet_answer_object", "unresolved_operation_binding"],
            questionSpans: [intent.originalQuestion],
            unresolved: true
          }
        }
      ];
    }
    const subject = makeSubject(primarySubject.kind, primarySubject.value, {
      question: intent.normalizedQuestion,
      span: primarySubject.span
    });
    const { breadth, requiredFacets } = breadthAndFacets({
      answerObject: "cmdlet_identifier",
      intent,
      operation
    });
    return [
      {
        aspectId: [
          "mandatory",
          "cmdlet-identifier",
          stableId(primarySubject.value),
          stableId(operation)
        ].join(":"),
        requirement: "mandatory",
        subject: primarySubject.value,
        subjectTerms: subject.terms,
        subjects: [subject],
        operation,
        methodConstraints: aspectMethodConstraints,
        answerObject: "cmdlet_identifier",
        relationship: null,
        breadth,
        requiredFacets,
        authorityRequirement: authorityFor(
          "cmdlet_identifier",
          intent,
          true,
          "cmdlet",
          aspectMethodConstraints
        ),
        minimumSupportStrength: "direct",
        supportType: "cmdlet_semantics",
        canonicalIdentifier: null,
        derivation: {
          ruleIds: [
            "implicit_cmdlet_answer_object",
            "clause_bound_operation",
            "powershell_primary_authority"
          ],
          questionSpans: [primarySubject.span, operation],
          unresolved: false
        }
      }
    ];
  }

  if (relationship) {
    const { breadth, requiredFacets } = breadthAndFacets({
      answerObject: "relationship",
      intent,
      operation: null
    });
    const subjectLabel = relationship.participants
      .map((participant) => participant.subject.value)
      .join(" / ");
    const relationshipAspects: EvidenceAspect[] = [
      {
        aspectId: [
          "mandatory",
          "relationship",
          relationship.predicate,
          ...relationship.participants.map((participant) =>
            stableId(participant.subject.value)
          )
        ].join(":"),
        requirement: "mandatory",
        subject: subjectLabel,
        subjectTerms: distinctiveTerms(subjectLabel),
        subjects: relationship.participants.map(
          (participant) => participant.subject
        ),
        operation: null,
        methodConstraints: aspectMethodConstraints,
        answerObject: "relationship",
        relationship,
        breadth,
        requiredFacets,
        authorityRequirement: authorityFor(
          "relationship",
          intent,
          false,
          null,
          aspectMethodConstraints
        ),
        minimumSupportStrength: "direct",
        supportType: supportTypeForAnswerObject("relationship"),
        canonicalIdentifier: null,
        derivation: {
          ruleIds: ["directed_relationship_predicate", "compound_participants"],
          questionSpans: relationship.participants.map(
            (participant) => participant.subject.value
          ),
          unresolved: false
        }
      }
    ];
    for (const seed of uniqueSeeds.filter(
      (item) => item.requirement === "optional"
    )) {
      const subject = makeSubject(seed.kind, seed.value, {
        question: intent.normalizedQuestion,
        span: seed.span
      });
      relationshipAspects.push({
        aspectId: ["optional", seed.kind, stableId(seed.value), "general"].join(
          ":"
        ),
        requirement: "optional",
        subject: seed.value,
        subjectTerms: subject.terms,
        subjects: [subject],
        operation: null,
        methodConstraints: [],
        answerObject: "fact",
        relationship: null,
        breadth: "narrow",
        requiredFacets: ["behavior"],
        authorityRequirement: authorityFor("fact", intent, false, null),
        minimumSupportStrength: "direct",
        supportType: "concept_definition",
        canonicalIdentifier: seed.canonicalIdentifier,
        derivation: {
          ruleIds: ["optional_supporting_subject"],
          questionSpans: [seed.span],
          unresolved: false
        }
      });
    }
    return relationshipAspects.sort((left, right) =>
      left.aspectId.localeCompare(right.aspectId)
    );
  }

  const questionClauses = intent.normalizedQuestion
    .split(/[?;,]|\b(?:and|also|then|while|but)\b/)
    .map((clause) => normalizeEvidenceText(clause))
    .filter(Boolean);
  const mandatoryNonCommandCount = uniqueSeeds.filter(
    (seed) => seed.requirement === "mandatory" && seed.kind !== "cmdlet"
  ).length;
  const aspects: EvidenceAspect[] = [];

  for (const seed of uniqueSeeds) {
    const rawClauseBoundOperations = operations.filter((operation) =>
      questionClauses.some(
        (clause) =>
          subjectAppearsInClause(clause, seed, intent) &&
          operationSupported(clause, operation)
      )
    );
    // V1.1 — within a population-enumeration + reporting workflow, a clause
    // like "determines their assigned phone number" is a read/reporting
    // request even though "assigned" incidentally shares a verb form with
    // the write operation "grant". A write-operation clause match is
    // dropped for these mandatory per-output seeds (falling through to an
    // unbound/null operation, same as the workflow's other reporting
    // outputs) rather than mis-classifying the aspect as a configuration
    // change. This never applies outside the enumeration+reporting shape, so
    // a genuine write question ("assign a phone number to this user") is
    // completely unaffected.
    const clauseBoundOperations =
      isWorkflowEnumeration && seed.requirement === "mandatory" && seed.kind !== "cmdlet"
        ? rawClauseBoundOperations.filter((operation) => !isWriteOperation(operation))
        : rawClauseBoundOperations;
    const applicableOperations =
      clauseBoundOperations.length > 0
        ? clauseBoundOperations
        : mandatoryNonCommandCount === 1
          ? operations
          : [];
    const seedOperations =
      seed.requirement === "mandatory" &&
      seed.kind !== "cmdlet" &&
      applicableOperations.length > 0
        ? applicableOperations
        : [null];

    for (const operation of seedOperations) {
      let answerObject: EvidenceAspectAnswerObject = "mechanism";
      if (seed.kind === "cmdlet") answerObject = "cmdlet_semantics";
      else if (intent.expectedAnswerType === "procedural") answerObject = "procedure";
      else if (intent.expectedAnswerType === "comparison") answerObject = "comparison";
      else if (
        intent.expectedAnswerType === "configuration" ||
        Boolean(operation)
      ) {
        // V1.1 — a mandatory per-output seed inside a population-enumeration
        // + reporting workflow (isWorkflowEnumeration), whose bound operation
        // (if any) is not itself a write operation, is a read/reporting
        // request for the current value/state of a configuration object —
        // not a request to change it. This is scoped strictly to the
        // workflow-enumeration shape so ordinary "configure/enable/assign"
        // questions keep requiring "configuration_behavior" unchanged.
        answerObject =
          isWorkflowEnumeration && !isWriteOperation(operation)
            ? "configuration_state"
            : "configuration_behavior";
      } else if (isBroadHowQuestion(intent.normalizedQuestion)) {
        answerObject = "mechanism";
      } else {
        answerObject = "fact";
      }

      const subjects = subjectsForSeed(seed, intent);
      const subjectTerms = [
        ...new Set(subjects.flatMap((subject) => subject.terms))
      ];
      const perUserState =
        answerObject === "configuration_state" &&
        seed.requirement === "mandatory" &&
        (isWorkflowEnumeration || questionRequestsPerUserState(intent, seed));
      const { breadth, requiredFacets } = breadthAndFacets({
        answerObject,
        intent,
        operation,
        perUserState
      });
      const unresolved = seed.kind === "unresolved";
      const compound = Boolean(seed.components && seed.components.length > 1);
      const seedMethodConstraints =
        seed.requirement === "mandatory"
          ? aspectMethodConstraints.map((constraint) =>
              perUserState && constraint.kind === "powershell"
                ? {
                    ...constraint,
                    domains: [
                      ...new Set([...constraint.domains, "teams_admin" as const])
                    ],
                    authorityRoles: [
                      ...new Set([
                        ...constraint.authorityRoles,
                        "teams_admin_primary" as const
                      ])
                    ]
                  }
                : constraint
            )
          : [];
      aspects.push({
        aspectId: [
          seed.requirement,
          seed.kind,
          stableId(seed.value),
          operation ? stableId(operation) : "general"
        ].join(":"),
        requirement: seed.requirement,
        subject: seed.value,
        subjectTerms,
        subjects,
        operation,
        methodConstraints: seedMethodConstraints,
        answerObject,
        relationship: null,
        breadth,
        requiredFacets,
        authorityRequirement: authorityFor(
          answerObject,
          intent,
          Boolean(seed.canonicalIdentifier),
          seed.canonicalIdentifier?.type ?? null,
          seedMethodConstraints
        ),
        minimumSupportStrength: "direct",
        supportType: supportTypeForAnswerObject(answerObject),
        canonicalIdentifier: seed.canonicalIdentifier,
        derivation: {
          ruleIds: [
            "subject_seed",
            ...(compound ? (["compound_subject_binding"] as const) : []),
            operation ? "clause_bound_operation" : "general_subject",
            ...(seedMethodConstraints.length > 0
              ? (["method_constraint_attached"] as const)
              : []),
            ...(perUserState
              ? (["per_user_state_required"] as const)
              : []),
            `answer_object:${answerObject}`,
            `breadth:${breadth}`
          ],
          questionSpans: [
            ...(compound
              ? (seed.components ?? []).map((component) => component.span)
              : [seed.span]),
            seed.span,
            ...(operation ? [operation] : [])
          ].filter((span, spanIndex, spans) => spans.indexOf(span) === spanIndex),
          unresolved
        }
      });
    }
  }

  if (isWorkflowEnumeration) {
    aspects.push(
      buildPowerShellCoreWorkflowAspect(intent, {
        label: "per-user iteration",
        evidenceSubject: "ForEach-Object",
        canonicalIdentifier: { type: "cmdlet", value: "ForEach-Object" },
        ruleId: WORKFLOW_ORCHESTRATION_RULE_ID
      }),
      buildPowerShellCoreWorkflowAspect(intent, {
        label: "policy assignment filtering",
        evidenceSubject: "Where-Object",
        canonicalIdentifier: { type: "cmdlet", value: "Where-Object" },
        ruleId: WORKFLOW_ORCHESTRATION_RULE_ID
      }),
      buildPowerShellCoreWorkflowAspect(intent, {
        label: "output object construction",
        evidenceSubject: "about_PSCustomObject",
        canonicalIdentifier: {
          type: "entity",
          value: "about_PSCustomObject"
        },
        ruleId: WORKFLOW_ORCHESTRATION_RULE_ID
      })
    );
    const outputTransformation = detectOutputTransformationRequest(intent.originalQuestion);
    if (outputTransformation.requested) {
      aspects.push(buildOutputTransformationAspect(intent, outputTransformation.label));
    }
  }

  return aspects.sort((left, right) => left.aspectId.localeCompare(right.aspectId));
}

export function candidateHasCanonicalIdentity(
  candidate: FusedRetrievalCandidate,
  identifier: NonNullable<EvidenceAspect["canonicalIdentifier"]>
): boolean {
  const expected = normalizeIdentifier(identifier.value);
  if (!expected) return false;
  const title = normalizeIdentifier(candidate.title);
  const sourcePath = normalizeIdentifier(pathLeaf(candidate.provenance.sourcePath));
  const canonicalUrl = normalizeIdentifier(pathLeaf(candidate.provenance.canonicalUrl));
  const identityMatches =
    title === expected || sourcePath === expected || canonicalUrl === expected;
  if (!identityMatches) return false;
  if (identifier.type !== "cmdlet") return true;
  return hasCmdletAuthority(candidate.authority);
}

function discoveredCmdletIdentity(
  candidate: FusedRetrievalCandidate
): string | null {
  if (!CMDLET_TITLE_PATTERN.test(candidate.title.trim())) return null;
  if (!hasCmdletAuthority(candidate.authority)) return null;
  return candidate.title.trim();
}

function isContextualStructure(
  candidate: FusedRetrievalCandidate,
  metadata?: CandidateEvidenceMetadata
): boolean {
  const title = normalizeEvidenceText(candidate.title);
  const url = normalizeEvidenceText(candidate.provenance.canonicalUrl);
  const path = normalizeEvidenceText(candidate.provenance.sourcePath);
  const heading = normalizeEvidenceText(candidate.headingPath.join(" "));
  const text = normalizeEvidenceText(candidate.text);
  const chunkKind = normalizeEvidenceText(metadata?.chunkKind ?? "");
  if (
    url.includes("landing-page") ||
    path.includes("landing-page") ||
    title.includes("landing page") ||
    title.includes("settings and policies reference")
  ) {
    return true;
  }
  if (
    heading.includes("related articles") ||
    text.includes("related articles") ||
    heading.includes("core deployment decisions") ||
    heading.includes("additional deployment decisions")
  ) {
    return true;
  }
  if (chunkKind.includes("related") || chunkKind.includes("navigation")) {
    return true;
  }
  if (
    text.includes("ask yourself") &&
    text.includes("action") &&
    candidate.headingPath.length <= 2
  ) {
    return true;
  }
  return false;
}

function isNarrowSubsection(
  candidate: FusedRetrievalCandidate,
  aspect: EvidenceAspect
): boolean {
  if (aspect.breadth !== "broad") return false;
  const title = normalizeEvidenceText(candidate.title);
  const heading = normalizeEvidenceText(candidate.headingPath.join(" "));
  const subject = normalizeEvidenceText(aspect.subject);
  const topicLevelTitle =
    title === subject ||
    title.includes(`${subject} overview`) ||
    title.startsWith(subject);
  const narrowSignals =
    heading.includes("takes precedence") ||
    heading.includes("audio") ||
    heading.includes("video") ||
    heading.includes("parameter") ||
    heading.includes("example") ||
    heading.includes("step ") ||
    /policy settings for/.test(title) ||
    /settings for/.test(title);
  if (narrowSignals && !topicLevelTitle) return true;
  if (
    candidate.headingPath.length >= 3 &&
    !/overview|how .* work|introduction|about/.test(heading) &&
    !topicLevelTitle
  ) {
    return true;
  }
  return false;
}

function isConfigurationOrProcedureArtifact(
  candidate: FusedRetrievalCandidate,
  metadata?: CandidateEvidenceMetadata
): boolean {
  const chunkKind = normalizeEvidenceText(metadata?.chunkKind ?? "");
  const title = normalizeEvidenceText(candidate.title);
  const heading = normalizeEvidenceText(candidate.headingPath.join(" "));
  return (
    chunkKind === "configuration" ||
    chunkKind === "procedure" ||
    /^(?:configure|set up|deploy|install)\b/.test(title) ||
    /\bhow to\b/.test(title) ||
    /^(?:configure|configuration|procedure|steps?)\b/.test(heading)
  );
}

/** Content/span signals that can establish purpose/mechanism for broad aspects. */
function contentEstablishesConceptualFacets(
  candidate: FusedRetrievalCandidate
): boolean {
  const title = normalizeEvidenceText(candidate.title);
  const heading = normalizeEvidenceText(candidate.headingPath.join(" "));
  const text = normalizeEvidenceText(candidate.text);
  if (/overview|introduction|about|concept|how .{0,40} work/.test(title)) {
    return true;
  }
  if (/overview|introduction|about|concept|how .{0,40} work/.test(heading)) {
    return true;
  }
  return /\b(?:enables?|allows?|provides?|lets|routes?|works by|used to|purpose|is a|are a|mechanism)\b/.test(
    text
  );
}

function matchedFacetsForCandidate(params: {
  aspect: EvidenceAspect;
  candidate: FusedRetrievalCandidate;
  allContext: string;
  strongContext: string;
  metadata?: CandidateEvidenceMetadata;
  canonicalIdentityVerified: boolean;
  discoveredCmdlet: string | null;
}): EvidenceSupportFacet[] {
  const matched = new Set<EvidenceSupportFacet>();
  const { aspect, candidate, allContext, strongContext, metadata } = params;
  const chunkKind = normalizeEvidenceText(metadata?.chunkKind ?? "");
  const heading = normalizeEvidenceText(candidate.headingPath.join(" "));
  const title = normalizeEvidenceText(candidate.title);

  if (
    aspect.answerObject === "configuration_state" &&
    (aspect.requiredFacets.includes("user_target") ||
      aspect.requiredFacets.includes("returned_value"))
  ) {
    if (evidenceEstablishesUserTarget(candidate.text)) {
      matched.add("user_target");
    }
    if (
      evidenceEstablishesReturnedUserValue(candidate.text, aspect.subject)
    ) {
      matched.add("returned_value");
    }
    return [...matched];
  }

  const subjectPresent = aspect.subjects.some(
    (subject) =>
      fieldContainsSubjectTerms(strongContext, subject) ||
      fieldContainsSubjectTerms(candidate.text, subject)
  );
  if (!subjectPresent && aspect.answerObject !== "cmdlet_identifier") {
    return [];
  }

  if (
    aspect.requiredFacets.includes("syntax") &&
    evidenceEstablishesPowerShellSyntax(candidate.text, aspect.subject)
  ) {
    matched.add("syntax");
  }

  if (aspect.answerObject === "cmdlet_identifier") {
    if (params.discoveredCmdlet) matched.add("identifier");
    if (operationSupported(allContext, aspect.operation)) matched.add("operation");
    if (
      aspect.subjects.some((subject) =>
        fieldContainsSubjectTerms(allContext, subject)
      )
    ) {
      matched.add("behavior");
    }
    return [...matched];
  }

  if (aspect.answerObject === "cmdlet_semantics") {
    if (params.canonicalIdentityVerified) matched.add("identifier");
    if (subjectPresent) matched.add("behavior");
    return [...matched];
  }

  if (aspect.answerObject === "configuration_state") {
    // V1.1 — cmdlet-reference authority rule: canonical Get-/Show-/Test-
    // style cmdlet-reference evidence directly supports a read/reporting
    // aspect once it is topically about the requested subject (subjectPresent,
    // already gated above). A candidate that is not itself a discovered
    // read-verb cmdlet can still qualify if its own prose uses read/reporting
    // language (get/view/retrieve/list/show/check) — this keeps Teams Admin
    // prose eligible for "direct" support when it genuinely describes
    // reading/checking a value, without ever treating an unrelated or
    // write-shaped (Set-/Grant-/New-/Remove-) PowerShell page as sufficient
    // merely because it is authoritative.
    const readCmdlet =
      Boolean(params.discoveredCmdlet) &&
      READ_CMDLET_VERB_PATTERN.test(params.discoveredCmdlet as string);
    const readOperationLanguage = operationSupported(allContext, "get");
    if (readCmdlet || readOperationLanguage) {
      matched.add("state");
    }
    return [...matched];
  }

  if (aspect.answerObject === "relationship" && aspect.relationship) {
    const participantsPresent = aspect.relationship.participants.every(
      (participant) => fieldContainsSubjectTerms(allContext, participant.subject)
    );
    const predicatePresent =
      allContext.includes(normalizeEvidenceText(aspect.relationship.predicate)) ||
      /\baffect|\bimpact|\bappl/.test(allContext) ||
      aspect.relationship.participants.some((participant) =>
        fieldContainsSubjectTerms(heading, participant.subject)
      );
    if (participantsPresent && predicatePresent) matched.add("relationship");
    return [...matched];
  }

  const subject = normalizeEvidenceText(aspect.subject);
  const conceptualTitle =
    /overview|introduction|about|concept|how .{0,40} work/.test(title);
  const allComponentsInTitle =
    aspect.subjects.length > 1 &&
    aspect.subjects.every((entry) => fieldContainsSubjectTerms(title, entry));
  const topicLevelTitle =
    Boolean(subject) &&
    (title === subject ||
      title.startsWith(subject) ||
      title.includes(subject) ||
      (allComponentsInTitle && conceptualTitle));
  const topicLevelHeading =
    /overview|introduction|about|how .* work|concept/.test(heading) ||
    conceptualTitle ||
    chunkKind === "conceptual";
  const narrowHeading =
    /takes precedence|parameter|example|step |audio|video|settings for/.test(
      heading
    ) || /policy settings for|settings for/.test(title);

  const conceptualContent = contentEstablishesConceptualFacets(candidate);

  if (aspect.breadth === "broad") {
    // Configuration/procedure metadata alone cannot establish broad purpose/mechanism.
    // The selected span/content must establish those facets.
    if (conceptualContent && !narrowHeading) {
      if (
        topicLevelTitle &&
        (topicLevelHeading || candidate.headingPath.length <= 2)
      ) {
        matched.add("purpose");
        matched.add("mechanism");
      } else if (topicLevelHeading) {
        matched.add("purpose");
        matched.add("mechanism");
      } else if (
        /\b(?:enables?|allows?|provides?|lets|routes?|works by|used to|purpose|mechanism)\b/.test(
          normalizeEvidenceText(candidate.text)
        )
      ) {
        matched.add("purpose");
        matched.add("mechanism");
      }
    }
  } else if (topicLevelHeading && !narrowHeading) {
    matched.add("purpose");
    matched.add("mechanism");
  }
  if (subjectPresent) matched.add("behavior");
  if (operationSupported(allContext, aspect.operation)) matched.add("operation");
  if (
    chunkKind === "procedure" ||
    /step|procedure|how to/.test(heading) ||
    /step|procedure|how to/.test(allContext)
  ) {
    matched.add("procedure");
  }
  if (
    chunkKind === "configuration" ||
    /configure|configuration|policy setting/.test(heading) ||
    // A procedure that performs the requested operation is, by definition,
    // configuration content even when it never uses the literal word
    // "configure" (e.g. numbered admin-center click-through steps).
    (matched.has("procedure") && matched.has("operation"))
  ) {
    matched.add("configuration");
  }
  if (params.canonicalIdentityVerified || params.discoveredCmdlet) {
    matched.add("identifier");
  }
  return [...matched];
}

function authoritySatisfied(
  candidate: FusedRetrievalCandidate,
  aspect: EvidenceAspect
): boolean {
  const roles = new Set(candidate.authority.authorityRoles);
  const roleOk =
    aspect.authorityRequirement.requiredRoles.length === 0 ||
    aspect.authorityRequirement.requiredRoles.some((role) => roles.has(role));
  const domain = sourceDomainFromSourceId(candidate.authority.sourceId);
  // An aspect with no required domain has no resolved authoritative subject
  // (e.g. an unresolved/fallback aspect for an unmodeled question), so it
  // must never be treated as satisfied by whichever domain retrieval
  // happened to return. Authority must come from a genuinely resolved
  // domain requirement, never from the candidate's domain alone.
  const domainOk =
    aspect.authorityRequirement.requiredDomains.length > 0 &&
    domain !== "unknown" &&
    aspect.authorityRequirement.requiredDomains.includes(domain);
  return (
    roleOk &&
    domainOk &&
    candidate.authority.authorityTier === "tier1" &&
    candidate.authority.authorityRoles.length > 0
  );
}

export function evaluateCandidateAspectSupport(
  _result: HybridRetrievalResult,
  candidate: FusedRetrievalCandidate,
  aspect: EvidenceAspect,
  options: EvaluateCandidateOptions = {}
): EvidenceAspectSupport {
  const metadata = options.metadataByChunkId?.get(candidate.chunkId);
  const strongContext = [
    candidate.title,
    candidate.headingPath.join(" "),
    candidate.sectionId
  ].join(" ");
  const allContext = `${strongContext} ${candidate.text}`;
  const discoveredCmdlet = discoveredCmdletIdentity(candidate);
  const knownIdentity = aspect.canonicalIdentifier;
  const canonicalIdentityVerified = knownIdentity
    ? candidateHasCanonicalIdentity(candidate, knownIdentity)
    : aspect.answerObject === "cmdlet_identifier"
      ? Boolean(discoveredCmdlet)
      : false;

  const reasonCodes: string[] = [];
  if (isContextualStructure(candidate, metadata)) {
    reasonCodes.push("contextual_structure");
  }
  if (isNarrowSubsection(candidate, aspect)) {
    reasonCodes.push("narrow_subsection_for_broad_aspect");
  }
  if (
    aspect.breadth === "broad" &&
    isConfigurationOrProcedureArtifact(candidate, metadata) &&
    !contentEstablishesConceptualFacets(candidate)
  ) {
    reasonCodes.push("config_metadata_insufficient_for_broad");
  }

  const matchedFacets = matchedFacetsForCandidate({
    aspect,
    candidate,
    allContext,
    strongContext,
    metadata,
    canonicalIdentityVerified,
    discoveredCmdlet
  });
  const missingFacets = aspect.requiredFacets.filter(
    (facet) => !matchedFacets.includes(facet)
  );
  const topical =
    matchedFacets.length > 0 ||
    aspect.subjects.some(
      (subject) =>
        fieldContainsSubjectTerms(strongContext, subject) ||
        fieldContainsSubjectTerms(candidate.text, subject)
    );
  const authoritative = authoritySatisfied(candidate, aspect);

  let strength: EvidenceAspectSupportStrength = "contextual";
  if (reasonCodes.includes("contextual_structure") || !topical) {
    strength = "contextual";
    if (!topical) reasonCodes.push("not_topical");
  } else if (!authoritative) {
    strength = "supporting";
    reasonCodes.push("authority_not_satisfied");
  } else if (missingFacets.length > 0) {
    strength = "supporting";
    reasonCodes.push("missing_required_facets");
  } else if (reasonCodes.includes("narrow_subsection_for_broad_aspect")) {
    strength = "supporting";
  } else if (reasonCodes.includes("config_metadata_insufficient_for_broad")) {
    strength = "supporting";
  } else if (
    aspect.answerObject === "cmdlet_identifier" &&
    (!discoveredCmdlet ||
      !operationSupported(allContext, aspect.operation) ||
      !aspect.subjects.some((subject) =>
        fieldContainsSubjectTerms(allContext, subject)
      ))
  ) {
    strength = "supporting";
    reasonCodes.push("cmdlet_identifier_incomplete");
  } else {
    strength = "direct";
    reasonCodes.push("direct_proposition_support");
  }

  // Authority/rank cannot upgrade supporting/contextual to direct.
  if (strength !== "direct" && authoritative) {
    reasonCodes.push("authority_does_not_upgrade_strength");
  }

  // A facet's quality-score bonus only reflects genuine answer quality when
  // the aspect actually requires that facet. Otherwise a candidate can
  // out-rank genuinely more relevant evidence purely by incidentally
  // pattern-matching a facet nobody asked for — e.g. an unrelated "Overview"
  // section earning the same +40 purpose/mechanism bonus as a document that
  // is actually about the requested subject, or a cmdlet-shaped title
  // earning an identifier bonus on a plain conceptual question. Gate every
  // bonus the same way "identifier" already was.
  const identifierFacetRequired = aspect.requiredFacets.includes("identifier");
  const purposeFacetRequired = aspect.requiredFacets.includes("purpose");
  const mechanismFacetRequired = aspect.requiredFacets.includes("mechanism");
  const relationshipFacetRequired = aspect.requiredFacets.includes("relationship");
  const operationFacetRequired = aspect.requiredFacets.includes("operation");

  let qualityScore = 0;
  if (strength === "direct") {
    if ((canonicalIdentityVerified || discoveredCmdlet) && identifierFacetRequired) {
      qualityScore += 100;
    }
    if (matchedFacets.includes("purpose") && purposeFacetRequired) qualityScore += 20;
    if (matchedFacets.includes("mechanism") && mechanismFacetRequired) qualityScore += 20;
    if (matchedFacets.includes("relationship") && relationshipFacetRequired) qualityScore += 24;
    if (matchedFacets.includes("identifier") && identifierFacetRequired) qualityScore += 30;
    if (matchedFacets.includes("operation") && operationFacetRequired) qualityScore += 16;
    if (matchedFacets.includes("state") && aspect.requiredFacets.includes("state")) {
      // V1.1 — evidence-selection expectation: when several candidates all
      // reach "direct" for a read/reporting aspect, canonical PowerShell
      // cmdlet-reference material (verified read-verb cmdlet identity) must
      // outrank generic admin prose that only incidentally contains a
      // read-language word (e.g. "checks") elsewhere in a much larger,
      // otherwise procedural/write-shaped passage. The prose fallback still
      // wins when no cmdlet-reference evidence exists for the aspect.
      qualityScore +=
        discoveredCmdlet && READ_CMDLET_VERB_PATTERN.test(discoveredCmdlet) ? 70 : 18;
    }
    if (
      matchedFacets.includes("user_target") &&
      matchedFacets.includes("returned_value") &&
      aspect.requiredFacets.includes("user_target") &&
      aspect.requiredFacets.includes("returned_value")
    ) {
      qualityScore +=
        discoveredCmdlet &&
        READ_CMDLET_VERB_PATTERN.test(discoveredCmdlet)
          ? 70
          : 18;
    }
    if (candidate.authority.sourceStatus === "ga") qualityScore += 6;
    if (candidate.authority.routePriority === "primary") qualityScore += 4;
    qualityScore += Math.min(candidate.methods.length, 3);
    qualityScore += Math.max(0, 20 - candidate.fusion.rank) / 20;
  }

  return {
    aspectId: aspect.aspectId,
    candidateId: candidate.candidateId,
    strength,
    matchedFacets,
    missingFacets,
    authoritySatisfied: authoritative,
    canonicalIdentityVerified,
    topical,
    reasonCodes: [...new Set(reasonCodes)],
    qualityScore
  };
}

export function evaluateCandidateForAspect(
  result: HybridRetrievalResult,
  candidate: FusedRetrievalCandidate,
  aspect: EvidenceAspect,
  options: EvaluateCandidateOptions = {}
): CandidateAspectEvaluation {
  const support = evaluateCandidateAspectSupport(
    result,
    candidate,
    aspect,
    options
  );
  return {
    aspectId: aspect.aspectId,
    topical: support.topical,
    direct: support.strength === "direct",
    authoritative: support.authoritySatisfied,
    canonicalIdentityVerified: support.canonicalIdentityVerified,
    qualityScore: support.qualityScore,
    support
  };
}

export function loadCandidateEvidenceMetadata(params: {
  databasePath?: string;
  chunkIds: string[];
}): Map<string, CandidateEvidenceMetadata> {
  const metadata = new Map<string, CandidateEvidenceMetadata>();
  if (!params.databasePath || params.chunkIds.length === 0) return metadata;
  try {
    // Resolver-local read of already-indexed metadata. Retrieval is unchanged.
    const db = new Database(params.databasePath, {
      readonly: true,
      fileMustExist: true
    });
    try {
      const chunkStmt = db.prepare(
        "SELECT chunk_id, chunk_kind FROM knowledge_chunks WHERE chunk_id = ?"
      );
      const entityStmt = db.prepare(
        "SELECT entity_type, entity_value FROM chunk_entities WHERE chunk_id = ? ORDER BY entity_index ASC"
      );
      for (const chunkId of params.chunkIds) {
        const chunk = chunkStmt.get(chunkId) as
          | { chunk_id: string; chunk_kind: string }
          | undefined;
        const entities = entityStmt.all(chunkId) as Array<{
          entity_type: string;
          entity_value: string;
        }>;
        metadata.set(chunkId, {
          chunkKind: chunk?.chunk_kind,
          exactEntities: entities.map((entity) => ({
            type: entity.entity_type,
            value: entity.entity_value
          }))
        });
      }
    } finally {
      db.close();
    }
  } catch {
    // Missing DB or metadata is non-fatal; directness stays capped by available signals.
  }
  return metadata;
}
