import type {
  EvidenceAspect,
  EvidenceAspectCoverage,
  EvidenceAspectSubject,
  EvidenceAspectSubjectKind
} from "./types";

export function makeTestSubject(
  kind: EvidenceAspectSubjectKind,
  value: string,
  terms?: string[]
): EvidenceAspectSubject {
  const resolvedTerms =
    terms ??
    value
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length >= 3);
  return {
    kind,
    value,
    terms: resolvedTerms,
    aliases: [value.toLowerCase()],
    questionSpans: [value]
  };
}

export function makeTestAspect(
  overrides: Partial<EvidenceAspect> = {}
): EvidenceAspect {
  const subject = overrides.subject ?? "direct routing";
  const terms = overrides.subjectTerms ?? ["direct", "routing"];
  return {
    aspectId: overrides.aspectId ?? "mandatory:entity:direct-routing:general",
    requirement: overrides.requirement ?? "mandatory",
    subject,
    subjectTerms: terms,
    subjects: overrides.subjects ?? [makeTestSubject("entity", subject, terms)],
    operation: overrides.operation ?? null,
    methodConstraints: overrides.methodConstraints ?? [],
    answerObject: overrides.answerObject ?? "mechanism",
    relationship: overrides.relationship ?? null,
    breadth: overrides.breadth ?? "broad",
    requiredFacets: overrides.requiredFacets ?? ["purpose", "mechanism"],
    authorityRequirement: overrides.authorityRequirement ?? {
      requiredRoles: ["teams_admin_primary"],
      requiredDomains: ["teams_admin"],
      requireCanonicalIdentity: false,
      identityType: null
    },
    minimumSupportStrength: "direct",
    supportType: overrides.supportType ?? "concept_definition",
    canonicalIdentifier: overrides.canonicalIdentifier ?? null,
    derivation: overrides.derivation ?? {
      ruleIds: ["test_fixture"],
      questionSpans: [subject],
      unresolved: false
    }
  };
}

export function makeTestAspectCoverage(params?: {
  aspects?: EvidenceAspect[];
  evidenceIds?: string[];
}): EvidenceAspectCoverage {
  const aspects = params?.aspects ?? [makeTestAspect()];
  const evidenceIds = params?.evidenceIds ?? ["evidence:chunk-1"];
  const evidenceByAspect: Record<string, string[]> = {};
  const supportByAspect: EvidenceAspectCoverage["supportByAspect"] = {};
  for (const aspect of aspects) {
    evidenceByAspect[aspect.aspectId] = evidenceIds;
    supportByAspect[aspect.aspectId] = [];
  }
  return {
    aspects,
    evidenceByAspect,
    supportByAspect,
    supportedMandatoryAspectIds: aspects
      .filter((aspect) => aspect.requirement === "mandatory")
      .map((aspect) => aspect.aspectId),
    unsupportedMandatoryAspectIds: [],
    authorityLimitedAspectIds: [],
    supportingOnlyAspectIds: [],
    contextualOnlyAspectIds: [],
    supportedOptionalAspectIds: []
  };
}
