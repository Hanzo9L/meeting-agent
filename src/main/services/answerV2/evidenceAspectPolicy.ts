import Database from "better-sqlite3";
import type { SourceAuthorityRole, SourceDomain } from "../knowledgeV2";
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

const GENERIC_SUBJECT_TERMS = new Set([
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

export function normalizeEvidenceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return [];
}

/** Authority roles that grant genuine PowerShell cmdlet-reference authority, across module families. */
const CMDLET_AUTHORITY_ROLES: SourceAuthorityRole[] = [
  "teams_powershell_cmdlet_primary",
  "sharepoint_powershell_cmdlet_primary"
];

export function hasCmdletAuthority(authority: {
  authorityRoles: SourceAuthorityRole[];
}): boolean {
  return CMDLET_AUTHORITY_ROLES.some((role) => authority.authorityRoles.includes(role));
}

/** Which cmdlet-authoritative domain(s) the query intent actually resolved to (cmdlet-prefix or explicit signal). */
function cmdletDomainsForIntent(intent: QueryIntent): SourceDomain[] {
  const domains = (intent.domains as SourceDomain[]).filter(
    (domain) => domain === "teams_powershell" || domain === "sharepoint"
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
  span: string
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
  const { aliases, questionSpans } = deriveSubjectAliases(value, question, span);
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

function fieldContainsSubjectTerms(
  field: string,
  subject: EvidenceAspectSubject
): boolean {
  const normalized = normalizeEvidenceText(field);
  const subjectText = normalizeEvidenceText(subject.value);
  if (subjectText && fieldContainsTokenSequence(normalized, subjectText)) {
    return true;
  }
  for (const alias of subject.aliases) {
    if (alias && fieldContainsTokenSequence(normalized, alias)) return true;
  }
  const fieldTerms = new Set(tokens(field));
  return (
    subject.terms.length > 0 &&
    subject.terms.every((term) => fieldTerms.has(term))
  );
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
    seed.span
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
  const domains = new Set<SourceDomain>([...intent.domains] as SourceDomain[]);
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
    (answerObject === "procedure" || answerObject === "configuration_behavior") &&
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
  return {
    breadth: "bounded",
    requiredFacets: ["behavior"]
  };
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
  if (!relationship) {
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
    const clauseBoundOperations = operations.filter((operation) =>
      questionClauses.some(
        (clause) =>
          subjectAppearsInClause(clause, seed, intent) &&
          operationSupported(clause, operation)
      )
    );
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
        answerObject = "configuration_behavior";
      } else if (isBroadHowQuestion(intent.normalizedQuestion)) {
        answerObject = "mechanism";
      } else {
        answerObject = "fact";
      }

      const subjects = subjectsForSeed(seed, intent);
      const subjectTerms = [
        ...new Set(subjects.flatMap((subject) => subject.terms))
      ];
      const { breadth, requiredFacets } = breadthAndFacets({
        answerObject,
        intent,
        operation
      });
      const unresolved = seed.kind === "unresolved";
      const compound = Boolean(seed.components && seed.components.length > 1);
      const seedMethodConstraints =
        seed.requirement === "mandatory" ? aspectMethodConstraints : [];
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

  const subjectPresent = aspect.subjects.some(
    (subject) =>
      fieldContainsSubjectTerms(strongContext, subject) ||
      fieldContainsSubjectTerms(candidate.text, subject)
  );
  if (!subjectPresent && aspect.answerObject !== "cmdlet_identifier") {
    return [];
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
    /configure|configuration|policy setting/.test(heading)
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

  let qualityScore = 0;
  if (strength === "direct") {
    if (canonicalIdentityVerified || discoveredCmdlet) qualityScore += 100;
    if (matchedFacets.includes("purpose")) qualityScore += 20;
    if (matchedFacets.includes("mechanism")) qualityScore += 20;
    if (matchedFacets.includes("relationship")) qualityScore += 24;
    if (matchedFacets.includes("identifier")) qualityScore += 30;
    if (matchedFacets.includes("operation")) qualityScore += 16;
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
