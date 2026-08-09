import Database from "better-sqlite3";
import type { SourceAuthorityRole, SourceDomain } from "../knowledgeV2";
import type {
  FusedRetrievalCandidate,
  HybridRetrievalResult,
  QueryIntent
} from "../retrievalV2";
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

const OPERATION_ALIASES: Record<string, string[]> = {
  assign: ["assign", "grant", "apply"],
  grant: ["grant", "assign", "apply"],
  remove: ["remove", "unassign", "clear", "delete"],
  get: ["get", "view", "retrieve", "list", "show"],
  set: ["set", "configure", "update", "change"],
  configure: ["configure", "set", "update", "change"],
  create: ["create", "add", "new"],
  enable: ["enable", "allow", "turn on"],
  disable: ["disable", "block", "turn off"],
  troubleshoot: ["troubleshoot", "diagnose", "resolve", "fix"]
};

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
  return "unknown";
}

function domainAuthorityRoles(domain: SourceDomain): SourceAuthorityRole[] {
  if (domain === "teams_admin") return ["teams_admin_primary"];
  if (domain === "teams_powershell") return ["teams_powershell_cmdlet_primary"];
  if (domain === "graph") return ["graph_api_primary"];
  if (domain === "entra") return ["entra_identity_primary"];
  if (domain === "m365") return ["m365_tenant_primary"];
  if (domain === "teams_dev") return ["teams_dev_specialized"];
  return [];
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

function makeSubject(
  kind: EvidenceAspectSubjectKind,
  value: string
): EvidenceAspectSubject {
  return {
    kind,
    value,
    terms: distinctiveTerms(value)
  };
}

function operationSupported(text: string, operation: string | null): boolean {
  if (!operation) return true;
  const normalized = normalizeEvidenceText(text);
  const aliases = OPERATION_ALIASES[operation] ?? [operation];
  return aliases.some((alias) => {
    const normalizedAlias = normalizeEvidenceText(alias);
    if (normalized.includes(normalizedAlias)) return true;
    const aliasStem = normalizedAlias.replace(/e$/, "");
    return tokens(normalized).some(
      (term) => aliasStem.length >= 4 && term.startsWith(aliasStem)
    );
  });
}

function fieldContainsSubjectTerms(
  field: string,
  subject: EvidenceAspectSubject
): boolean {
  const normalized = normalizeEvidenceText(field);
  const subjectText = normalizeEvidenceText(subject.value);
  if (subjectText && normalized.includes(subjectText)) return true;
  const fieldTerms = new Set(tokens(field));
  return (
    subject.terms.length > 0 &&
    subject.terms.every((term) => fieldTerms.has(term))
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
};

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
  identityType: EvidenceAspectAuthorityRequirement["identityType"]
): EvidenceAspectAuthorityRequirement {
  if (
    answerObject === "cmdlet_identifier" ||
    answerObject === "cmdlet_semantics"
  ) {
    return {
      requiredRoles: ["teams_powershell_cmdlet_primary"],
      requiredDomains: ["teams_powershell"],
      requireCanonicalIdentity,
      identityType
    };
  }
  const domains = [...intent.domains] as SourceDomain[];
  const roles = domains.flatMap((domain) => domainAuthorityRoles(domain));
  return {
    requiredRoles: [...new Set(roles)],
    requiredDomains: domains,
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
      requiredFacets: ["procedure", "operation"]
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

  const mandatorySubjects = uniqueSeeds
    .filter((seed) => seed.requirement === "mandatory")
    .map((seed) => makeSubject(seed.kind, seed.value));
  const relationship = detectRelationship(intent, mandatorySubjects);
  const operations = [
    ...new Set(
      (intent.operationIntents ?? [])
        .map(normalizeEvidenceText)
        .filter(Boolean)
    )
  ];

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
            ? [makeSubject(primarySubject.kind, primarySubject.value)]
            : [makeSubject("unresolved", fallbackSubject(intent))],
          operation: null,
          answerObject: "cmdlet_identifier",
          relationship: null,
          breadth: "narrow",
          requiredFacets: ["identifier", "operation"],
          authorityRequirement: authorityFor(
            "cmdlet_identifier",
            intent,
            true,
            "cmdlet"
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
    const subject = makeSubject(primarySubject.kind, primarySubject.value);
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
        answerObject: "cmdlet_identifier",
        relationship: null,
        breadth,
        requiredFacets,
        authorityRequirement: authorityFor(
          "cmdlet_identifier",
          intent,
          true,
          "cmdlet"
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
        answerObject: "relationship",
        relationship,
        breadth,
        requiredFacets,
        authorityRequirement: authorityFor("relationship", intent, false, null),
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
      const subject = makeSubject(seed.kind, seed.value);
      relationshipAspects.push({
        aspectId: ["optional", seed.kind, stableId(seed.value), "general"].join(
          ":"
        ),
        requirement: "optional",
        subject: seed.value,
        subjectTerms: subject.terms,
        subjects: [subject],
        operation: null,
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
    const normalizedSubject = normalizeEvidenceText(seed.value);
    const clauseBoundOperations = operations.filter((operation) =>
      questionClauses.some(
        (clause) =>
          clause.includes(normalizedSubject) &&
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

      const subject = makeSubject(seed.kind, seed.value);
      const { breadth, requiredFacets } = breadthAndFacets({
        answerObject,
        intent,
        operation
      });
      const unresolved = seed.kind === "unresolved";
      aspects.push({
        aspectId: [
          seed.requirement,
          seed.kind,
          stableId(seed.value),
          operation ? stableId(operation) : "general"
        ].join(":"),
        requirement: seed.requirement,
        subject: seed.value,
        subjectTerms: subject.terms,
        subjects: [subject],
        operation,
        answerObject,
        relationship: null,
        breadth,
        requiredFacets,
        authorityRequirement: authorityFor(
          answerObject,
          intent,
          Boolean(seed.canonicalIdentifier),
          seed.canonicalIdentifier?.type ?? null
        ),
        minimumSupportStrength: "direct",
        supportType: supportTypeForAnswerObject(answerObject),
        canonicalIdentifier: seed.canonicalIdentifier,
        derivation: {
          ruleIds: [
            "subject_seed",
            operation ? "clause_bound_operation" : "general_subject",
            `answer_object:${answerObject}`,
            `breadth:${breadth}`
          ],
          questionSpans: [seed.span, ...(operation ? [operation] : [])],
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
  return (
    candidate.authority.sourceId === "ms-teams-powershell" &&
    candidate.authority.authorityRoles.includes(
      "teams_powershell_cmdlet_primary"
    )
  );
}

function discoveredCmdletIdentity(
  candidate: FusedRetrievalCandidate
): string | null {
  if (!CMDLET_TITLE_PATTERN.test(candidate.title.trim())) return null;
  if (
    candidate.authority.sourceId !== "ms-teams-powershell" ||
    !candidate.authority.authorityRoles.includes(
      "teams_powershell_cmdlet_primary"
    )
  ) {
    return null;
  }
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
  const topicLevelTitle =
    Boolean(subject) &&
    (title === subject ||
      title.startsWith(subject) ||
      title.includes(subject));
  const topicLevelHeading =
    /overview|introduction|about|how .* work|concept/.test(heading) ||
    /overview|how .* work|introduction|about|concept/.test(title) ||
    chunkKind === "conceptual";
  const narrowHeading =
    /takes precedence|parameter|example|step |audio|video|settings for/.test(
      heading
    ) || /policy settings for|settings for/.test(title);

  if (
    aspect.breadth === "broad" &&
    topicLevelTitle &&
    !narrowHeading &&
    (topicLevelHeading || candidate.headingPath.length <= 2)
  ) {
    matched.add("purpose");
    matched.add("mechanism");
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
  const domainOk =
    aspect.authorityRequirement.requiredDomains.length === 0 ||
    (domain !== "unknown" &&
      aspect.authorityRequirement.requiredDomains.includes(domain));
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
