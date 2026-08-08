import { performance } from "node:perf_hooks";
import type {
  AnswerPlan,
  AnswerPlanSectionId,
  EvidenceBundle,
  EvidenceItem,
  EvidenceSupportType,
  PlannedClaim,
  PlannedClaimType,
  RequiredCaveat,
  UnsupportedAspect
} from "./types";

type SectionTemplate = {
  format: "bullets" | "steps" | "short_paragraphs";
  sections: AnswerPlanSectionId[];
};

const STRUCTURE_TEMPLATES: Record<EvidenceBundle["intent"]["expectedAnswerType"], SectionTemplate> = {
  conceptual: {
    format: "short_paragraphs",
    sections: ["direct_answer", "key_components", "relationships", "caveats"]
  },
  procedural: {
    format: "steps",
    sections: ["prerequisites", "steps", "validation", "caveats"]
  },
  troubleshooting: {
    format: "bullets",
    sections: ["context", "checks", "corrective_actions", "limitations", "caveats"]
  },
  configuration: {
    format: "steps",
    sections: ["prerequisites", "configuration", "validation", "caveats"]
  },
  comparison: {
    format: "bullets",
    sections: ["direct_answer", "compared_dimensions", "caveats"]
  },
  reference: {
    format: "bullets",
    sections: ["purpose", "behavior", "parameters", "examples", "caveats"]
  }
};

const SUPPORT_PRIORITY: Record<EvidenceSupportType, number> = {
  cmdlet_semantics: 100,
  parameter_semantics: 90,
  procedure: 85,
  prerequisite: 80,
  concept_definition: 70,
  configuration_behavior: 65,
  troubleshooting_guidance: 60,
  comparison_dimension: 55,
  licensing_or_status: 50,
  contextual: 40
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = normalized.split(/[.!?]/);
  const sentence = (parts[0] ?? normalized).trim();
  return sentence.length > 180 ? `${sentence.slice(0, 180).trim()}...` : sentence;
}

function requestedConcepts(bundle: EvidenceBundle): string[] {
  const concepts = new Set<string>();
  for (const cmdlet of bundle.intent.commandNames ?? []) concepts.add(normalize(cmdlet));
  for (const entity of bundle.intent.entities) {
    const value = normalize(entity);
    if (value.length >= 4) concepts.add(value);
  }
  for (const policy of bundle.intent.policyNames ?? []) {
    const value = normalize(policy);
    if (value.length >= 4) concepts.add(value);
  }
  return [...concepts];
}

function evidenceSupportsConcept(evidence: EvidenceItem, concept: string): boolean {
  const body = normalize(`${evidence.source.title} ${evidence.text} ${evidence.source.canonicalUrl}`);
  return body.includes(concept);
}

function supportTypeToClaimType(type: EvidenceSupportType): PlannedClaimType {
  if (type === "contextual") return "concept_definition";
  return type;
}

function supportTypeToSection(params: {
  supportType: EvidenceSupportType;
  answerType: EvidenceBundle["intent"]["expectedAnswerType"];
}): AnswerPlanSectionId {
  if (params.answerType === "reference") {
    if (params.supportType === "cmdlet_semantics") return "purpose";
    if (params.supportType === "parameter_semantics") return "parameters";
    if (params.supportType === "procedure") return "examples";
    return "behavior";
  }
  if (params.answerType === "procedural" || params.answerType === "configuration") {
    if (params.supportType === "prerequisite") return "prerequisites";
    if (params.supportType === "procedure") return "steps";
    if (params.supportType === "configuration_behavior") return "configuration";
    return "validation";
  }
  if (params.answerType === "troubleshooting") {
    if (params.supportType === "troubleshooting_guidance") return "checks";
    if (params.supportType === "procedure") return "corrective_actions";
    return "context";
  }
  if (params.answerType === "comparison") {
    if (params.supportType === "comparison_dimension") return "compared_dimensions";
    return "direct_answer";
  }
  if (params.supportType === "procedure") return "relationships";
  if (params.supportType === "concept_definition") return "direct_answer";
  if (params.supportType === "configuration_behavior") return "key_components";
  return "key_components";
}

function selectPrimarySupportType(evidence: EvidenceItem): EvidenceSupportType {
  const sorted = [...evidence.supportTypes].sort(
    (left, right) => (SUPPORT_PRIORITY[right] ?? 0) - (SUPPORT_PRIORITY[left] ?? 0)
  );
  return sorted[0] ?? "contextual";
}

function buildProposition(evidence: EvidenceItem, claimType: PlannedClaimType): string {
  const sentence = firstSentence(evidence.text);
  if (sentence.length > 0) return sentence;
  if (claimType === "cmdlet_semantics") return `${evidence.source.title} documented cmdlet behavior.`;
  if (claimType === "parameter_semantics") return `${evidence.source.title} parameter behavior.`;
  if (claimType === "procedure") return `${evidence.source.title} documented procedure.`;
  if (claimType === "prerequisite") return `${evidence.source.title} prerequisites.`;
  if (claimType === "comparison_dimension") return `${evidence.source.title} comparison details.`;
  return `${evidence.source.title} documented behavior.`;
}

function buildRequiredCaveats(bundle: EvidenceBundle): RequiredCaveat[] {
  const caveats: RequiredCaveat[] = [];
  if (bundle.answerability === "partial") {
    caveats.push({
      code: "partial_coverage",
      detail: "Only supported portions should be answered."
    });
  }
  const previewUsed = bundle.evidence.some(
    (item) => item.source.sourceStatus === "beta" || item.source.sourceStatus === "preview"
  );
  if (previewUsed) {
    caveats.push({
      code: "preview_evidence_used",
      detail: "Preview/beta evidence requires explicit labeling in final response."
    });
  }
  if (bundle.freshness.state === "verification_required") {
    caveats.push({
      code: "freshness_verification_required",
      detail: "Freshness must be verified before final answer."
    });
  }
  if (bundle.conflicts.length > 0) {
    caveats.push({
      code: "unresolved_conflict",
      detail: "Evidence conflicts exist; final response must avoid choosing a side silently."
    });
  }
  if (bundle.authorityCoverage.missingDomains.length > 0) {
    caveats.push({
      code: "missing_adjacent_authority",
      detail: `Missing authoritative domain coverage: ${bundle.authorityCoverage.missingDomains.join(", ")}`
    });
  }
  if (!bundle.exactIdentifierValidation.verified && bundle.exactIdentifierValidation.required) {
    caveats.push({
      code: "exact_identifier_unverified",
      detail: "Required technical identifier could not be verified from accepted evidence."
    });
  }
  return caveats;
}

function buildUnsupportedAspects(bundle: EvidenceBundle, omittedConcepts: string[]): UnsupportedAspect[] {
  const items: UnsupportedAspect[] = [];
  if (bundle.authorityCoverage.missingDomains.length > 0) {
    items.push({
      aspectId: "unsupported:missing_authority",
      reason: "missing_authority",
      detail: `Missing authority domains: ${bundle.authorityCoverage.missingDomains.join(", ")}`
    });
  }
  if (!bundle.exactIdentifierValidation.verified && bundle.exactIdentifierValidation.required) {
    items.push({
      aspectId: "unsupported:exact_identifier",
      reason: "exact_identifier_unverified",
      detail: `Unverified identifier(s): ${bundle.exactIdentifierValidation.missingRequiredDirectives
        .map((entry) => entry.value)
        .join(", ")}`
    });
  }
  if (bundle.freshness.state === "verification_required") {
    items.push({
      aspectId: "unsupported:freshness",
      reason: "freshness_verification_required",
      detail: "Freshness verification is required before asserting mutable details."
    });
  }
  if (bundle.conflicts.length > 0) {
    items.push({
      aspectId: "unsupported:conflict",
      reason: "conflict_unresolved",
      detail: "Unresolved evidence conflicts remain."
    });
  }
  if (omittedConcepts.length > 0) {
    items.push({
      aspectId: "unsupported:concepts",
      reason: "insufficient_evidence",
      detail: `Unsupported requested concepts: ${omittedConcepts.join(", ")}`
    });
  }
  if (bundle.answerability === "insufficient_evidence" && items.length === 0) {
    items.push({
      aspectId: "unsupported:general",
      reason: "insufficient_evidence",
      detail: "Authoritative evidence is insufficient for reliable factual claims."
    });
  }
  return items;
}

function mergeClaims(claims: PlannedClaim[]): { claims: PlannedClaim[]; collapsed: number } {
  const grouped = new Map<string, PlannedClaim>();
  let collapsed = 0;
  for (const claim of claims) {
    const key = `${claim.claimType}:${normalize(claim.proposition)}:${claim.sectionId}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, claim);
      continue;
    }
    collapsed += 1;
    const evidenceIds = [...new Set([...existing.evidenceIds, ...claim.evidenceIds])];
    const sourceIds = [...new Set([...existing.authorityContext.sourceIds, ...claim.authorityContext.sourceIds])];
    const routePriorities = [
      ...new Set([...existing.authorityContext.routePriorities, ...claim.authorityContext.routePriorities])
    ];
    grouped.set(key, {
      ...existing,
      evidenceIds,
      authorityContext: {
        sourceIds,
        routePriorities
      },
      supportStrength:
        existing.supportStrength === "direct" || claim.supportStrength === "direct"
          ? "direct"
          : "supporting",
      mandatory: existing.mandatory || claim.mandatory,
      requiresCaveat: existing.requiresCaveat || claim.requiresCaveat
    });
  }
  return {
    claims: [...grouped.values()],
    collapsed
  };
}

export function buildAnswerPlan(bundle: EvidenceBundle): AnswerPlan {
  const started = performance.now();
  const template = STRUCTURE_TEMPLATES[bundle.intent.expectedAnswerType];
  const requiredCaveats = buildRequiredCaveats(bundle);
  const concepts = requestedConcepts(bundle);
  const supportedConcepts = concepts.filter((concept) =>
    bundle.evidence.some((evidence) => evidenceSupportsConcept(evidence, concept))
  );
  const omittedConcepts = concepts.filter((concept) => !supportedConcepts.includes(concept));

  let rawClaims: PlannedClaim[] = [];
  if (bundle.answerability !== "insufficient_evidence") {
    rawClaims = bundle.evidence.map((evidence, index) => {
      const supportType = selectPrimarySupportType(evidence);
      const claimType = supportTypeToClaimType(supportType);
      const sectionId = supportTypeToSection({
        supportType,
        answerType: bundle.intent.expectedAnswerType
      });
      return {
        claimId: `claim:${index + 1}:${evidence.evidenceId}`,
        claimType,
        sectionId,
        proposition: buildProposition(evidence, claimType),
        evidenceIds: [evidence.evidenceId],
        supportStrength:
          evidence.source.routePriority === "primary" || evidence.retrieval.exactMatch !== null
            ? "direct"
            : "supporting",
        mandatory: sectionId !== "caveats",
        requiresCaveat:
          requiredCaveats.length > 0 ||
          evidence.source.sourceStatus === "beta" ||
          evidence.source.sourceStatus === "preview",
        authorityContext: {
          sourceIds: [evidence.source.sourceId],
          routePriorities: [evidence.source.routePriority]
        }
      };
    });
  }

  const merged = mergeClaims(rawClaims);
  const sectionOrder = new Map(template.sections.map((section, index) => [section, index]));
  const plannedClaims = merged.claims.sort((left, right) => {
    const sectionDelta =
      (sectionOrder.get(left.sectionId) ?? Number.MAX_SAFE_INTEGER) -
      (sectionOrder.get(right.sectionId) ?? Number.MAX_SAFE_INTEGER);
    if (sectionDelta !== 0) return sectionDelta;
    return left.claimId.localeCompare(right.claimId);
  });

  const sectionsWithClaims = new Set(plannedClaims.map((claim) => claim.sectionId));
  const orderedSections = template.sections.filter(
    (section) => section === "caveats" || sectionsWithClaims.has(section)
  );

  const unsupportedAspects = buildUnsupportedAspects(bundle, omittedConcepts);
  const usedEvidenceIds = [...new Set(plannedClaims.flatMap((claim) => claim.evidenceIds))];
  const unusedEvidenceIds = bundle.evidence
    .map((evidence) => evidence.evidenceId)
    .filter((evidenceId) => !usedEvidenceIds.includes(evidenceId));
  const missingCanonical = bundle.evidence
    .filter((evidence) => evidence.source.canonicalUrl.trim().length === 0)
    .map((evidence) => evidence.evidenceId);

  return {
    question: bundle.question,
    intent: bundle.intent,
    answerability: bundle.answerability,
    answerType: bundle.intent.expectedAnswerType,
    plannedClaims,
    requiredCaveats,
    unsupportedAspects,
    evidenceReferences: {
      usedEvidenceIds,
      unusedEvidenceIds
    },
    freshnessInstructions: {
      mustVerifyBeforeFinalAnswer: bundle.freshness.state === "verification_required",
      reasons: [...bundle.freshness.reasons]
    },
    previewInstructions: {
      previewEvidenceUsed: bundle.evidence.some(
        (evidence) => evidence.source.sourceStatus === "beta" || evidence.source.sourceStatus === "preview"
      ),
      requiredLabel: requiredCaveats.some((caveat) => caveat.code === "preview_evidence_used")
    },
    exactIdentifierState: bundle.exactIdentifierValidation,
    recommendedStructure: {
      format: template.format,
      orderedSections
    },
    diagnostics: {
      latencyMs: performance.now() - started,
      decomposition: {
        requestedConcepts: concepts,
        supportedConcepts,
        omittedConcepts
      },
      duplicateClaimsCollapsed: merged.collapsed,
      canonicalUrlCoverage: {
        complete: missingCanonical.length === 0,
        missingEvidenceIds: missingCanonical,
        note:
          missingCanonical.length > 0
            ? "Known WB-18 canonical URL coverage defect persists; citation stage must address before final rendering."
            : "Canonical URL coverage complete for selected evidence."
      }
    }
  };
}
