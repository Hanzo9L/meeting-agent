import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  bindAnswerPlanIdentity,
  hashSourceSpanContent,
  makeClaimSourceSpanId,
  type AnswerPlanState
} from "./answerPlanIntegrity";
import { snapshotBinding } from "./groundingDecisionSnapshot";
import type {
  AnswerPlan,
  AnswerPlanSectionId,
  ClaimSourceSpan,
  EvidenceAspect,
  EvidenceBundle,
  EvidenceItem,
  EvidenceSupportFacet,
  PlannedClaim,
  PlannedClaimType,
  RequiredCaveat,
  UnsupportedAspect
} from "./types";

type SectionTemplate = {
  format: "bullets" | "steps" | "short_paragraphs";
  sections: AnswerPlanSectionId[];
};

type SpanCandidate = {
  span: ClaimSourceSpan;
  evidence: EvidenceItem;
  normalized: string;
  procedureStep: number | null;
};

type DraftClaim = Omit<
  PlannedClaim,
  "claimId" | "groundingSnapshotId" | "groundingSnapshotHash" | "ordering"
> & {
  procedureStep: number | null;
  sourceOrder: number;
  spanOrder: number;
};

const STRUCTURE_TEMPLATES: Record<
  EvidenceBundle["intent"]["expectedAnswerType"],
  SectionTemplate
> = {
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

const BOILERPLATE_LINE =
  /^(?:document|heading path):|^```|^\|?\s*(?:---|:---|---:)(?:\s*\|.*)?$/i;
const SUBSTANTIVE_WORD = /[a-z]{3,}/i;
const CMDLET_PATTERN = /\b[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+\b/;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalProposition(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function authorityRoleFor(
  evidence: EvidenceItem,
  aspect: EvidenceAspect
): EvidenceItem["source"]["authorityRoles"][number] | null {
  return (
    evidence.source.authorityRoles.find((role) =>
      aspect.authorityRequirement.requiredRoles.includes(role)
    ) ??
    evidence.source.authorityRoles[0] ??
    null
  );
}

function procedureStepFrom(text: string): number | null {
  const normalized = text.trim();
  const match =
    normalized.match(/^(?:step|phase)\s+(\d+)\b/i) ??
    normalized.match(/^(?:[-*]\s*)?(\d+)[.)]\s+/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function createSpan(params: {
  evidence: EvidenceItem;
  aspect: EvidenceAspect;
  sourceField: ClaimSourceSpan["sourceField"];
  fieldIndex: number | null;
  sentenceIndex: number | null;
  startOffset: number;
  endOffset: number;
  text: string;
  sourceOrder: number;
}): ClaimSourceSpan | null {
  const authorityRole = authorityRoleFor(params.evidence, params.aspect);
  if (!authorityRole || !params.text.trim()) return null;
  const contentHash = hashSourceSpanContent(params.text);
  const draft = {
    evidenceId: params.evidence.evidenceId,
    sourceField: params.sourceField,
    fieldIndex: params.fieldIndex,
    startOffset: params.startOffset,
    endOffset: params.endOffset,
    contentHash
  };
  return {
    spanId: makeClaimSourceSpanId(draft),
    evidenceId: params.evidence.evidenceId,
    chunkId: params.evidence.chunkId,
    documentId: params.evidence.documentId,
    sourceId: params.evidence.source.sourceId,
    sourcePath: params.evidence.source.sourcePath,
    sectionId: params.evidence.location.sectionId,
    headingPath: [...params.evidence.location.headingPath],
    sourceField: params.sourceField,
    fieldIndex: params.fieldIndex,
    sentenceIndex: params.sentenceIndex,
    startOffset: params.startOffset,
    endOffset: params.endOffset,
    text: params.text,
    contentHash,
    authorityRole,
    sourceOrder: params.sourceOrder
  };
}

function sentenceSpans(
  evidence: EvidenceItem,
  aspect: EvidenceAspect,
  sourceOrder: number
): SpanCandidate[] {
  const candidates: SpanCandidate[] = [];
  let sentenceIndex = 0;
  const listBlockRanges: Array<{ start: number; end: number }> = [];
  if (!aspect.requiredFacets.includes("procedure")) {
    const listBlockPattern =
      /^[^\r\n]+:\s*\r?\n(?:\s*\r?\n)?(?:\s*[-*]\s+[^\r\n]+(?:\r?\n|$))+/gm;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = listBlockPattern.exec(evidence.text)) !== null) {
      const raw = blockMatch[0];
      const firstLine = raw.split(/\r?\n/, 1)[0] ?? raw;
      const sentenceBoundary = Math.max(
        firstLine.lastIndexOf(". "),
        firstLine.lastIndexOf("? "),
        firstLine.lastIndexOf("! ")
      );
      const prefixLength = sentenceBoundary >= 0 ? sentenceBoundary + 2 : 0;
      const blockRaw = raw.slice(prefixLength);
      const leading = blockRaw.match(/^\s*/)?.[0].length ?? 0;
      const trailing = blockRaw.match(/\s*$/)?.[0].length ?? 0;
      const text = blockRaw.slice(
        leading,
        Math.max(leading, blockRaw.length - trailing)
      );
      const startOffset =
        (blockMatch.index ?? 0) + prefixLength + leading;
      const endOffset = startOffset + text.length;
      const span = createSpan({
        evidence,
        aspect,
        sourceField: "text",
        fieldIndex: null,
        sentenceIndex,
        startOffset,
        endOffset,
        text,
        sourceOrder
      });
      if (span) {
        candidates.push({
          span,
          evidence,
          normalized: normalize(text),
          procedureStep: null
        });
        sentenceIndex += 1;
        listBlockRanges.push({
          start: (blockMatch.index ?? 0) + prefixLength,
          end: (blockMatch.index ?? 0) + raw.length
        });
      }
    }
  }

  const linePattern = /[^\r\n]+/g;
  let lineMatch: RegExpExecArray | null;
  let inCodeBlock = false;
  while ((lineMatch = linePattern.exec(evidence.text)) !== null) {
    const line = lineMatch[0];
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (BOILERPLATE_LINE.test(trimmedLine)) continue;
    if (
      listBlockRanges.some(
        (range) =>
          (lineMatch?.index ?? 0) >= range.start &&
          (lineMatch?.index ?? 0) < range.end
      )
    ) {
      continue;
    }
    const sentencePattern = inCodeBlock
      ? /.+/g
      : /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g;
    let sentenceMatch: RegExpExecArray | null;
    while ((sentenceMatch = sentencePattern.exec(line)) !== null) {
      const raw = sentenceMatch[0];
      const leading = raw.match(/^\s*/)?.[0].length ?? 0;
      const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
      const text = raw.slice(leading, Math.max(leading, raw.length - trailing));
      if (
        text.length < 8 ||
        !SUBSTANTIVE_WORD.test(text) ||
        BOILERPLATE_LINE.test(text)
      ) {
        continue;
      }
      const startOffset =
        (lineMatch.index ?? 0) + (sentenceMatch.index ?? 0) + leading;
      const endOffset = startOffset + text.length;
      if (
        listBlockRanges.some(
          (range) => startOffset >= range.start && startOffset < range.end
        )
      ) {
        continue;
      }
      const span = createSpan({
        evidence,
        aspect,
        sourceField: "text",
        fieldIndex: null,
        sentenceIndex,
        startOffset,
        endOffset,
        text,
        sourceOrder
      });
      if (span) {
        candidates.push({
          span,
          evidence,
          normalized: normalize(text),
          procedureStep:
            procedureStepFrom(text) ??
            procedureStepFrom(
              evidence.location.headingPath[evidence.location.headingPath.length - 1] ??
                ""
            )
        });
        sentenceIndex += 1;
      }
    }
  }

  const titleSpan = createSpan({
    evidence,
    aspect,
    sourceField: "title",
    fieldIndex: null,
    sentenceIndex: null,
    startOffset: 0,
    endOffset: evidence.source.title.length,
    text: evidence.source.title,
    sourceOrder
  });
  if (titleSpan) {
    candidates.push({
      span: titleSpan,
      evidence,
      normalized: normalize(titleSpan.text),
      procedureStep: procedureStepFrom(titleSpan.text)
    });
  }
  evidence.location.headingPath.forEach((heading, fieldIndex) => {
    if (!heading.trim() || heading === evidence.source.title) return;
    const span = createSpan({
      evidence,
      aspect,
      sourceField: "heading",
      fieldIndex,
      sentenceIndex: null,
      startOffset: 0,
      endOffset: heading.length,
      text: heading,
      sourceOrder
    });
    if (!span) return;
    candidates.push({
      span,
      evidence,
      normalized: normalize(span.text),
      procedureStep: procedureStepFrom(span.text)
    });
  });
  return candidates;
}

function subjectPresent(candidate: SpanCandidate, aspect: EvidenceAspect): boolean {
  const context = normalize(
    `${candidate.evidence.source.title} ${candidate.evidence.location.headingPath.join(
      " "
    )} ${candidate.span.text}`
  );
  return aspect.subjects.some((subject) => {
    const value = normalize(subject.value);
    if (value && context.includes(value)) return true;
    return (
      subject.terms.length > 0 &&
      subject.terms.every((term) => context.includes(normalize(term)))
    );
  });
}

function operationPresent(text: string, operation: string | null): boolean {
  if (!operation) return false;
  const normalized = normalize(text);
  const value = normalize(operation);
  if (normalized.includes(value)) return true;
  const stem = value.replace(/(?:ing|ed|es|s)$/, "");
  return stem.length >= 3 && normalized.includes(stem);
}

function facetScore(
  candidate: SpanCandidate,
  aspect: EvidenceAspect,
  facet: EvidenceSupportFacet
): number {
  const text = candidate.normalized;
  const isText = candidate.span.sourceField === "text";
  const isStructuredList = /\r?\n\s*[-*]\s+/.test(candidate.span.text);
  const topical = subjectPresent(candidate, aspect);
  if (!topical && facet !== "identifier") return Number.NEGATIVE_INFINITY;
  if (
    aspect.breadth === "broad" &&
    isStructuredList &&
    (facet === "purpose" || facet === "mechanism")
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = isText ? 20 : 2;
  if (topical) score += 25;
  if (candidate.evidence.source.routePriority === "primary") score += 4;
  if (candidate.evidence.retrieval.exactMatch) score += 6;
  score -= candidate.span.sentenceIndex ?? 0;

  switch (facet) {
    case "purpose":
      if (!isText) return Number.NEGATIVE_INFINITY;
      if (
        /\b(?:is|are|enables?|allows?|provides?|lets|used to|designed to|purpose)\b/.test(
          text
        )
      ) {
        score += 50;
      } else {
        return Number.NEGATIVE_INFINITY;
      }
      break;
    case "mechanism":
      if (!isText) return Number.NEGATIVE_INFINITY;
      if (
        /\b(?:works? by|maps?|routes?|configures?|assigns?|applies?|controls?|determines?|sends?|selects?|piped?)\b/.test(
          text
        )
      ) {
        score += 65;
      } else if (
        /\b(?:uses?|using|connects?|requires?|through|by)\b/.test(text)
      ) {
        score += 45;
      } else {
        return Number.NEGATIVE_INFINITY;
      }
      break;
    case "behavior":
      if (!isText) return Number.NEGATIVE_INFINITY;
      if (CMDLET_PATTERN.test(candidate.span.text)) score += 25;
      score += 20;
      break;
    case "operation":
      if (!isText || !operationPresent(text, aspect.operation)) {
        return Number.NEGATIVE_INFINITY;
      }
      score += 60;
      break;
    case "identifier": {
      const expected =
        aspect.canonicalIdentifier?.value ??
        candidate.evidence.source.title;
      const hasIdentifier =
        expected.trim().length > 0
          ? normalize(candidate.span.text).includes(normalize(expected))
          : CMDLET_PATTERN.test(candidate.span.text);
      if (!hasIdentifier) return Number.NEGATIVE_INFINITY;
      score += candidate.span.sourceField === "title" ? 35 : 70;
      break;
    }
    case "relationship": {
      if (!isText || !aspect.relationship) {
        return Number.NEGATIVE_INFINITY;
      }
      const participantsPresent = aspect.relationship.participants.every(
        (participant) =>
          normalize(participant.subject.value)
            .split(" ")
            .filter(Boolean)
            .every((term) => text.includes(term))
      );
      const predicatePresent =
        text.includes(normalize(aspect.relationship.predicate)) ||
        /\b(?:affect|impact|appl|depend|control|require)\w*\b/.test(text);
      if (!participantsPresent || !predicatePresent) {
        return Number.NEGATIVE_INFINITY;
      }
      score += 80;
      break;
    }
    case "procedure":
      if (!isText) return Number.NEGATIVE_INFINITY;
      if (
        candidate.procedureStep !== null ||
        /\b(?:step|first|next|then|finally|run|select|open|go to|use|configure|assign|create|enable|disable)\b/.test(
          text
        )
      ) {
        score += 55;
      } else {
        return Number.NEGATIVE_INFINITY;
      }
      break;
    case "configuration":
      if (
        !isText ||
        !/\b(?:configure|set|assign|enable|disable|allow|block|policy|setting)\w*\b/.test(
          text
        )
      ) {
        return Number.NEGATIVE_INFINITY;
      }
      score += 50;
      break;
  }
  return score;
}

function claimTypeForFacets(
  aspect: EvidenceAspect,
  facets: EvidenceSupportFacet[]
): PlannedClaimType {
  if (
    aspect.answerObject === "cmdlet_identifier" ||
    (facets.includes("identifier") && facets.includes("operation"))
  ) {
    return "identifier_operation";
  }
  if (aspect.answerObject === "cmdlet_semantics") {
    return "cmdlet_semantics";
  }
  if (facets.includes("relationship")) return "relationship";
  if (facets.includes("procedure")) return "procedure_step";
  if (facets.includes("configuration")) return "configuration";
  if (facets.includes("purpose")) return "purpose";
  if (facets.includes("mechanism")) return "mechanism";
  if (facets.includes("behavior")) return "behavior";
  if (facets.includes("identifier")) return "cmdlet_semantics";
  return "concept_definition";
}

function sectionForFacets(
  bundle: EvidenceBundle,
  facets: EvidenceSupportFacet[]
): AnswerPlanSectionId {
  if (facets.includes("relationship")) return "relationships";
  if (facets.includes("procedure")) return "steps";
  if (facets.includes("configuration")) return "configuration";
  if (bundle.intent.expectedAnswerType === "reference") {
    if (facets.includes("identifier") || facets.includes("purpose")) {
      return "purpose";
    }
    return "behavior";
  }
  if (bundle.intent.expectedAnswerType === "comparison") {
    return "compared_dimensions";
  }
  if (facets.includes("purpose")) return "direct_answer";
  return "key_components";
}

function uniqueSpans(spans: ClaimSourceSpan[]): ClaimSourceSpan[] {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  return [...byId.values()].sort(
    (left, right) =>
      left.sourceOrder - right.sourceOrder ||
      (left.sentenceIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.sentenceIndex ?? Number.MAX_SAFE_INTEGER) ||
      left.startOffset - right.startOffset
  );
}

function corroboratingSpans(
  primary: SpanCandidate,
  candidates: SpanCandidate[]
): ClaimSourceSpan[] {
  return uniqueSpans(
    candidates
      .filter(
        (candidate) =>
          candidate.span.sourceField === "text" &&
          candidate.normalized === primary.normalized
      )
      .map((candidate) => candidate.span)
  );
}

function makeDraftClaim(params: {
  bundle: EvidenceBundle;
  aspect: EvidenceAspect;
  facets: EvidenceSupportFacet[];
  spans: ClaimSourceSpan[];
  proposition?: string;
  procedureStep?: number | null;
}): DraftClaim {
  const spans = uniqueSpans(params.spans);
  const evidenceById = new Map(
    params.bundle.evidence.map((evidence) => [evidence.evidenceId, evidence])
  );
  const evidenceIds = [...new Set(spans.map((span) => span.evidenceId))];
  const evidence = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is EvidenceItem => Boolean(item));
  return {
    requiredAspectId: params.aspect.aspectId,
    coveredFacets: [...new Set(params.facets)],
    claimType: claimTypeForFacets(params.aspect, params.facets),
    sectionId: sectionForFacets(params.bundle, params.facets),
    proposition:
      params.proposition ??
      spans.map((span) => canonicalProposition(span.text)).join(" — "),
    evidenceIds,
    sourceSpans: spans,
    supportStrength: "direct",
    status: "mandatory",
    mandatory: true,
    requiresCaveat: false,
    caveatCodes: [],
    unsupportedAspectIds: [],
    procedureStep: params.procedureStep ?? null,
    sourceOrder: Math.min(...spans.map((span) => span.sourceOrder)),
    spanOrder: Math.min(
      ...spans.map((span) => span.sentenceIndex ?? Number.MAX_SAFE_INTEGER)
    ),
    authorityContext: {
      sourceIds: [...new Set(evidence.map((item) => item.source.sourceId))],
      routePriorities: [
        ...new Set(evidence.map((item) => item.source.routePriority))
      ],
      authorityRoles: [...new Set(spans.map((span) => span.authorityRole))]
    }
  };
}

function bestCandidateForFacet(
  candidates: SpanCandidate[],
  aspect: EvidenceAspect,
  facet: EvidenceSupportFacet
): SpanCandidate | null {
  return (
    [...candidates]
      .map((candidate) => ({
        candidate,
        score: facetScore(candidate, aspect, facet)
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.span.sourceOrder -
            right.candidate.span.sourceOrder ||
          (left.candidate.span.sentenceIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.candidate.span.sentenceIndex ?? Number.MAX_SAFE_INTEGER)
      )[0]?.candidate ?? null
  );
}

function deriveCmdletClaim(params: {
  bundle: EvidenceBundle;
  aspect: EvidenceAspect;
  candidates: SpanCandidate[];
}): DraftClaim[] {
  const identifier = bestCandidateForFacet(
    params.candidates,
    params.aspect,
    "identifier"
  );
  const behaviorFacet = params.aspect.requiredFacets.includes("operation")
    ? "operation"
    : "behavior";
  const behavior = bestCandidateForFacet(
    params.candidates,
    params.aspect,
    behaviorFacet
  );
  if (!identifier || !behavior) return [];
  const spans = uniqueSpans([identifier.span, behavior.span]);
  const operationText = canonicalProposition(behavior.span.text);
  const identifierText = canonicalProposition(identifier.span.text);
  const proposition =
    normalize(operationText).includes(normalize(identifierText)) ||
    identifier.span.spanId === behavior.span.spanId
      ? operationText
      : `${identifierText} — ${operationText}`;
  return [
    makeDraftClaim({
      bundle: params.bundle,
      aspect: params.aspect,
      facets: [...params.aspect.requiredFacets],
      spans,
      proposition
    })
  ];
}

function deriveProcedureClaims(params: {
  bundle: EvidenceBundle;
  aspect: EvidenceAspect;
  candidates: SpanCandidate[];
}): DraftClaim[] {
  const structured = params.candidates
    .filter(
      (candidate) =>
        candidate.span.sourceField === "text" &&
        (candidate.procedureStep !== null ||
          facetScore(candidate, params.aspect, "procedure") > 60)
    )
    .sort(
      (left, right) =>
        (left.procedureStep ?? Number.MAX_SAFE_INTEGER) -
          (right.procedureStep ?? Number.MAX_SAFE_INTEGER) ||
        left.span.sourceOrder - right.span.sourceOrder ||
        (left.span.sentenceIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.span.sentenceIndex ?? Number.MAX_SAFE_INTEGER)
    );
  const selected =
    structured.length > 0
      ? structured
      : [
          bestCandidateForFacet(
            params.candidates,
            params.aspect,
            "procedure"
          )
        ].filter((item): item is SpanCandidate => Boolean(item));
  const claims: DraftClaim[] = [];
  const seen = new Set<string>();
  for (const candidate of selected) {
    if (seen.has(candidate.normalized)) continue;
    seen.add(candidate.normalized);
    const facets: EvidenceSupportFacet[] = ["procedure"];
    if (
      params.aspect.requiredFacets.includes("operation") &&
      operationPresent(candidate.span.text, params.aspect.operation)
    ) {
      facets.push("operation");
    }
    claims.push(
      makeDraftClaim({
        bundle: params.bundle,
        aspect: params.aspect,
        facets,
        spans: corroboratingSpans(candidate, params.candidates),
        procedureStep: candidate.procedureStep
      })
    );
  }
  if (
    params.aspect.requiredFacets.includes("operation") &&
    !claims.some((claim) => claim.coveredFacets.includes("operation"))
  ) {
    const operation = bestCandidateForFacet(
      params.candidates,
      params.aspect,
      "operation"
    );
    if (operation) {
      claims.push(
        makeDraftClaim({
          bundle: params.bundle,
          aspect: params.aspect,
          facets: ["operation"],
          spans: corroboratingSpans(operation, params.candidates)
        })
      );
    }
  }
  return claims;
}

function deriveFacetClaims(params: {
  bundle: EvidenceBundle;
  aspect: EvidenceAspect;
  candidates: SpanCandidate[];
}): DraftClaim[] {
  if (
    params.aspect.answerObject === "cmdlet_identifier" ||
    params.aspect.answerObject === "cmdlet_semantics"
  ) {
    return deriveCmdletClaim(params);
  }
  if (params.aspect.requiredFacets.includes("procedure")) {
    return deriveProcedureClaims(params);
  }

  const selected = new Map<string, {
    candidate: SpanCandidate;
    facets: EvidenceSupportFacet[];
  }>();
  for (const facet of params.aspect.requiredFacets) {
    const candidate = bestCandidateForFacet(
      params.candidates,
      params.aspect,
      facet
    );
    if (!candidate) continue;
    const existing = selected.get(candidate.span.spanId);
    if (existing) {
      existing.facets.push(facet);
    } else {
      selected.set(candidate.span.spanId, {
        candidate,
        facets: [facet]
      });
    }
  }
  return [...selected.values()].map(({ candidate, facets }) =>
    makeDraftClaim({
      bundle: params.bundle,
      aspect: params.aspect,
      facets,
      spans: corroboratingSpans(candidate, params.candidates)
    })
  );
}

function mergeDuplicateClaims(claims: DraftClaim[]): {
  claims: DraftClaim[];
  collapsed: number;
} {
  const grouped = new Map<string, DraftClaim>();
  let collapsed = 0;
  for (const claim of claims) {
    const key = `${claim.requiredAspectId}:${normalize(claim.proposition)}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, claim);
      continue;
    }
    collapsed += 1;
    const spans = uniqueSpans([
      ...existing.sourceSpans,
      ...claim.sourceSpans
    ]);
    grouped.set(key, {
      ...existing,
      coveredFacets: [
        ...new Set([...existing.coveredFacets, ...claim.coveredFacets])
      ],
      evidenceIds: [...new Set(spans.map((span) => span.evidenceId))],
      sourceSpans: spans,
      authorityContext: {
        sourceIds: [
          ...new Set([
            ...existing.authorityContext.sourceIds,
            ...claim.authorityContext.sourceIds
          ])
        ],
        routePriorities: [
          ...new Set([
            ...existing.authorityContext.routePriorities,
            ...claim.authorityContext.routePriorities
          ])
        ],
        authorityRoles: [
          ...new Set([
            ...existing.authorityContext.authorityRoles,
            ...claim.authorityContext.authorityRoles
          ])
        ]
      }
    });
  }
  return { claims: [...grouped.values()], collapsed };
}

function finalizeClaims(params: {
  bundle: EvidenceBundle;
  claims: DraftClaim[];
  template: SectionTemplate;
  requiredCaveats: RequiredCaveat[];
}): PlannedClaim[] {
  const sectionOrder = new Map(
    params.template.sections.map((section, index) => [section, index])
  );
  const sorted = [...params.claims].sort((left, right) => {
    const sectionDelta =
      (sectionOrder.get(left.sectionId) ?? Number.MAX_SAFE_INTEGER) -
      (sectionOrder.get(right.sectionId) ?? Number.MAX_SAFE_INTEGER);
    if (sectionDelta !== 0) return sectionDelta;
    if (
      left.procedureStep !== null &&
      right.procedureStep !== null &&
      left.procedureStep !== right.procedureStep
    ) {
      return left.procedureStep - right.procedureStep;
    }
    return (
      left.sourceOrder - right.sourceOrder ||
      left.spanOrder - right.spanOrder ||
      left.proposition.localeCompare(right.proposition)
    );
  });
  return sorted.map((claim, index) => {
    const claimId = `claim:${stableHash(
      [
        params.bundle.decisionSnapshot.snapshotId,
        claim.requiredAspectId,
        claim.claimType,
        [...claim.coveredFacets].sort().join(","),
        claim.proposition,
        claim.sourceSpans.map((span) => span.contentHash).join(",")
      ].join("|")
    ).slice(0, 24)}`;
    return {
      claimId,
      groundingSnapshotId: params.bundle.decisionSnapshot.snapshotId,
      groundingSnapshotHash: params.bundle.decisionSnapshot.snapshotHash,
      requiredAspectId: claim.requiredAspectId,
      coveredFacets: [...new Set(claim.coveredFacets)],
      claimType: claim.claimType,
      sectionId: claim.sectionId,
      proposition: claim.proposition,
      evidenceIds: claim.evidenceIds,
      sourceSpans: claim.sourceSpans,
      supportStrength: claim.supportStrength,
      status: claim.status,
      mandatory: claim.mandatory,
      requiresCaveat: params.requiredCaveats.length > 0,
      caveatCodes: params.requiredCaveats.map((caveat) => caveat.code),
      unsupportedAspectIds: claim.unsupportedAspectIds,
      ordering: {
        sequence: index + 1,
        procedureStep: claim.procedureStep,
        sourceOrder: claim.sourceOrder,
        spanOrder: claim.spanOrder
      },
      authorityContext: claim.authorityContext
    };
  });
}

function buildRequiredCaveats(bundle: EvidenceBundle): RequiredCaveat[] {
  const caveats: RequiredCaveat[] = [];
  if (bundle.answerability === "partial") {
    caveats.push({
      code: "partial_coverage",
      detail: "Only supported portions should be answered."
    });
  }
  if (
    bundle.evidence.some(
      (item) =>
        item.source.sourceStatus === "beta" ||
        item.source.sourceStatus === "preview"
    )
  ) {
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
      detail:
        "Evidence conflicts exist; final response must avoid choosing a side silently."
    });
  }
  if (bundle.authorityCoverage.missingDomains.length > 0) {
    caveats.push({
      code: "missing_adjacent_authority",
      detail: `Missing authoritative domain coverage: ${bundle.authorityCoverage.missingDomains.join(
        ", "
      )}`
    });
  }
  if (
    !bundle.exactIdentifierValidation.verified &&
    bundle.exactIdentifierValidation.required
  ) {
    caveats.push({
      code: "exact_identifier_unverified",
      detail:
        "Required technical identifier could not be verified from accepted evidence."
    });
  }
  return caveats;
}

function buildUnsupportedAspects(params: {
  bundle: EvidenceBundle;
  missingFacetAspectIds: Set<string>;
}): UnsupportedAspect[] {
  const { bundle } = params;
  const byId = new Map(
    bundle.aspectCoverage.aspects.map((aspect) => [aspect.aspectId, aspect])
  );
  const items: UnsupportedAspect[] = [];
  for (const aspectId of bundle.aspectCoverage.unsupportedMandatoryAspectIds) {
    const aspect = byId.get(aspectId);
    items.push({
      aspectId,
      reason: bundle.aspectCoverage.authorityLimitedAspectIds.includes(aspectId)
        ? "missing_authority"
        : "insufficient_evidence",
      detail: aspect
        ? `Unsupported required aspect: ${aspect.subject}; required facets: ${aspect.requiredFacets.join(
            ", "
          )}.`
        : `Unsupported required aspect: ${aspectId}.`
    });
  }
  for (const aspectId of params.missingFacetAspectIds) {
    const aspect = byId.get(aspectId);
    items.push({
      aspectId,
      reason: "source_span_unavailable",
      detail: aspect
        ? `No exact source span could be planned for all required facets of ${aspect.subject}.`
        : `No exact source span could be planned for ${aspectId}.`
    });
  }
  if (
    !bundle.exactIdentifierValidation.verified &&
    bundle.exactIdentifierValidation.required
  ) {
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
  if (bundle.answerability === "insufficient_evidence" && items.length === 0) {
    items.push({
      aspectId: "unsupported:general",
      reason: "insufficient_evidence",
      detail: "Authoritative evidence is insufficient for reliable factual claims."
    });
  }
  const unique = new Map(
    items.map((item) => [`${item.aspectId}:${item.reason}`, item])
  );
  return [...unique.values()];
}

export function buildAnswerPlan(bundle: EvidenceBundle): AnswerPlan {
  const started = performance.now();
  const template = STRUCTURE_TEMPLATES[bundle.intent.expectedAnswerType];
  const requiredCaveats = buildRequiredCaveats(bundle);
  const evidenceById = new Map(
    bundle.evidence.map((evidence, index) => [
      evidence.evidenceId,
      { evidence, sourceOrder: index }
    ])
  );
  const supportedMandatory = new Set(
    bundle.aspectCoverage.supportedMandatoryAspectIds
  );
  const mandatoryAspects = bundle.aspectCoverage.aspects.filter(
    (aspect) =>
      aspect.requirement === "mandatory" &&
      supportedMandatory.has(aspect.aspectId)
  );

  let draftClaims: DraftClaim[] = [];
  if (bundle.answerability !== "insufficient_evidence") {
    for (const aspect of mandatoryAspects) {
      const candidates = (
        bundle.aspectCoverage.evidenceByAspect[aspect.aspectId] ?? []
      ).flatMap((evidenceId) => {
        const entry = evidenceById.get(evidenceId);
        return entry
          ? sentenceSpans(entry.evidence, aspect, entry.sourceOrder)
          : [];
      });
      draftClaims.push(
        ...deriveFacetClaims({
          bundle,
          aspect,
          candidates
        })
      );
    }
  }

  const merged = mergeDuplicateClaims(draftClaims);
  const plannedClaims = finalizeClaims({
    bundle,
    claims: merged.claims,
    template,
    requiredCaveats
  });
  const facetCoverage = mandatoryAspects.map((aspect) => {
    const plannedFacets = [
      ...new Set(
        plannedClaims
          .filter((claim) => claim.requiredAspectId === aspect.aspectId)
          .flatMap((claim) => claim.coveredFacets)
      )
    ];
    return {
      aspectId: aspect.aspectId,
      requiredFacets: [...aspect.requiredFacets],
      plannedFacets,
      missingFacets: aspect.requiredFacets.filter(
        (facet) => !plannedFacets.includes(facet)
      )
    };
  });
  const missingFacetAspectIds = new Set(
    facetCoverage
      .filter((coverage) => coverage.missingFacets.length > 0)
      .map((coverage) => coverage.aspectId)
  );
  const unsupportedAspects = buildUnsupportedAspects({
    bundle,
    missingFacetAspectIds
  });
  for (const claim of plannedClaims) {
    claim.unsupportedAspectIds = unsupportedAspects.map(
      (unsupported) => unsupported.aspectId
    );
  }

  const usedEvidenceIds = [
    ...new Set(plannedClaims.flatMap((claim) => claim.evidenceIds))
  ];
  const unusedEvidenceIds = bundle.evidence
    .map((evidence) => evidence.evidenceId)
    .filter((evidenceId) => !usedEvidenceIds.includes(evidenceId));
  const missingCanonical = bundle.evidence
    .filter((evidence) => evidence.source.canonicalUrl.trim().length === 0)
    .map((evidence) => evidence.evidenceId);
  const sectionsWithClaims = new Set(
    plannedClaims.map((claim) => claim.sectionId)
  );
  const orderedSections = template.sections.filter(
    (section) => section === "caveats" || sectionsWithClaims.has(section)
  );
  const requestedConcepts = bundle.aspectCoverage.aspects
    .filter((aspect) => aspect.requirement === "mandatory")
    .map((aspect) => normalize(aspect.subject));
  const supportedConcepts = bundle.aspectCoverage.aspects
    .filter((aspect) => supportedMandatory.has(aspect.aspectId))
    .map((aspect) => normalize(aspect.subject));
  const omittedConcepts = bundle.aspectCoverage.aspects
    .filter(
      (aspect) =>
        aspect.requirement === "mandatory" &&
        !supportedMandatory.has(aspect.aspectId)
    )
    .map((aspect) => normalize(aspect.subject));

  const state: AnswerPlanState = {
    snapshotBinding: snapshotBinding(bundle.decisionSnapshot),
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
      mustVerifyBeforeFinalAnswer:
        bundle.freshness.state === "verification_required",
      reasons: [...bundle.freshness.reasons]
    },
    previewInstructions: {
      previewEvidenceUsed: bundle.evidence.some(
        (evidence) =>
          evidence.source.sourceStatus === "beta" ||
          evidence.source.sourceStatus === "preview"
      ),
      requiredLabel: requiredCaveats.some(
        (caveat) => caveat.code === "preview_evidence_used"
      )
    },
    exactIdentifierState: bundle.exactIdentifierValidation,
    recommendedStructure: {
      format: template.format,
      orderedSections
    },
    diagnostics: {
      latencyMs: performance.now() - started,
      decomposition: {
        requestedConcepts,
        supportedConcepts,
        omittedConcepts
      },
      duplicateClaimsCollapsed: merged.collapsed,
      facetCoverage,
      evidenceWithoutIndependentClaims: unusedEvidenceIds,
      canonicalUrlCoverage: {
        complete: missingCanonical.length === 0,
        missingEvidenceIds: missingCanonical,
        note:
          missingCanonical.length > 0
            ? "Selected evidence is missing canonical URLs."
            : "Canonical URL coverage complete for selected evidence."
      }
    }
  };
  return bindAnswerPlanIdentity(state);
}
