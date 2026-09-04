import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  bindAnswerPlanIdentity,
  hashSourceSpanContent,
  makeClaimSourceSpanId,
  type AnswerPlanState
} from "./answerPlanIntegrity";
import {
  areConceptsRedundant,
  type ConceptSignature
} from "./evidenceConceptDistinctness";
import type { InterviewQuestionShape } from "./interviewQuestionShape";
import {
  canBindPerUserEvidence,
  canonicalSubjectPhraseAppears,
  evidenceEstablishesPowerShellSyntax,
  evidenceEstablishesReturnedUserValue,
  evidenceEstablishesUserTarget,
  OUTPUT_TRANSFORMATION_RULE_ID
} from "./evidenceAspectPolicy";
import { snapshotBinding } from "./groundingDecisionSnapshot";
import { operationMatchesText } from "./operationMatching";
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
// V1.1 — mirrors evidenceAspectPolicy.ts's READ_CMDLET_VERB_PATTERN: a
// Get-/Show-/Test-/Find-/Search- style cmdlet is a read/reporting primitive
// by its own verb, regardless of the exact synopsis wording used.
const READ_CMDLET_PATTERN =
  /\b(?:Get|Show|Test|Find|Search|Measure|Select|Compare)-[A-Za-z0-9]+\b/;

function normalize(value: string): string {
  return value
    .toLowerCase()
    // Hyphens must resolve as word separators, not literal characters:
    // "voice-routing policy" (as authored in prose) and "voice routing
    // policy" (as authored in the subject/question) must tokenize
    // identically, matching R2's normalizeEvidenceText contract. Preserving
    // hyphens here made phrase containment checks (subjectPresent) fail for
    // otherwise on-topic hyphenated prose, producing an R2/R3 mismatch.
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
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

  if (aspect.requiredFacets.includes("syntax")) {
    const subject = aspect.subject.toLowerCase();
    const pattern =
      subject === "per-user iteration"
        ? /\b(?:[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+\s*\|\s*)?ForEach-Object\s*\{[^}]*\$_[^}]*\}/gi
        : subject === "policy assignment filtering"
          ? /\b(?:[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+\s*\|\s*)?Where-Object\s*\{[^}]*\$_[^}]*\}/gi
          : subject === "output object construction"
            ? /\[pscustomobject\]\s*@\{[^}]+\}/gi
            : subject === "csv export"
              ? /\bExport-Csv\b[^\r\n]*\s-Path\b[^\r\n]*\s-NoTypeInformation\b[^\r\n]*/gi
              : null;
    if (pattern) {
      let syntaxMatch: RegExpExecArray | null;
      while ((syntaxMatch = pattern.exec(evidence.text)) !== null) {
        const text = syntaxMatch[0].trim();
        const startOffset =
          (syntaxMatch.index ?? 0) +
          (syntaxMatch[0].match(/^\s*/)?.[0].length ?? 0);
        const span = createSpan({
          evidence,
          aspect,
          sourceField: "text",
          fieldIndex: null,
          sentenceIndex,
          startOffset,
          endOffset: startOffset + text.length,
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
        }
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
    const perUserFacetLine =
      aspect.requiredFacets.includes("user_target") &&
      aspect.requiredFacets.includes("returned_value") &&
      (evidenceEstablishesUserTarget(trimmedLine) ||
        evidenceEstablishesReturnedUserValue(
          trimmedLine,
          aspect.subject
        ));
    if (perUserFacetLine) {
      const leading = line.match(/^\s*/)?.[0].length ?? 0;
      const startOffset = (lineMatch.index ?? 0) + leading;
      const span = createSpan({
        evidence,
        aspect,
        sourceField: "text",
        fieldIndex: null,
        sentenceIndex,
        startOffset,
        endOffset: startOffset + trimmedLine.length,
        text: trimmedLine,
        sourceOrder
      });
      if (span) {
        candidates.push({
          span,
          evidence,
          normalized: normalize(trimmedLine),
          procedureStep: null
        });
        sentenceIndex += 1;
      }
      continue;
    }
    // Keep "Step N. ..." / "N. ..." lines intact so the marker is not split away.
    const stepLine = /^(?:step|phase)\s+\d+[.)]\s+\S+/i.test(trimmedLine)
      || /^(?:[-*]\s*)?\d+[.)]\s+\S+/.test(trimmedLine)
      || /^[-*]\s*(?:step|phase)\s+\d+[.)]\s+\S+/i.test(trimmedLine);
    const sentencePattern = inCodeBlock || stepLine
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
          // Only per-line step markers. Heading labels like "Step 1: ..." must not
          // stamp every child span as the same procedureStep (breaks order validation).
          procedureStep: procedureStepFrom(text)
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
  const contextTokens = context.split(" ").filter(Boolean);
  return aspect.subjects.some((subject) => {
    if (canonicalSubjectPhraseAppears(context, subject)) return true;
    if (subject.kind === "policy") return false;
    return (
      subject.terms.length > 0 &&
      subject.terms.every((term) => contextTokens.includes(normalize(term)))
    );
  });
}

/** Shared R2/R3 semantics — null operation never matches. */
function operationPresent(text: string, operation: string | null): boolean {
  return operationMatchesText(text, operation);
}

function prefersMethodCommandSpan(
  aspect: EvidenceAspect,
  text: string
): boolean {
  const wantsPowerShell = aspect.methodConstraints.some(
    (constraint) =>
      constraint.required &&
      (constraint.kind === "powershell" || constraint.kind === "pnp_powershell")
  );
  if (!wantsPowerShell) return false;
  return CMDLET_PATTERN.test(text);
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
  if (
    !topical &&
    facet !== "identifier" &&
    facet !== "user_target" &&
    facet !== "returned_value"
  ) {
    return Number.NEGATIVE_INFINITY;
  }
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
    case "state": {
      if (!isText) return Number.NEGATIVE_INFINITY;
      const readCmdlet = READ_CMDLET_PATTERN.test(candidate.evidence.source.title);
      const readOperationLanguage = operationMatchesText(text, "get");
      if (!readCmdlet && !readOperationLanguage) {
        return Number.NEGATIVE_INFINITY;
      }
      score += readCmdlet ? 55 : 45;
      break;
    }
    case "user_target":
      if (
        !isText ||
        !evidenceEstablishesUserTarget(candidate.span.text)
      ) {
        return Number.NEGATIVE_INFINITY;
      }
      score += 70;
      break;
    case "returned_value":
      if (
        !isText ||
        !evidenceEstablishesReturnedUserValue(
          candidate.span.text,
          aspect.subject
        )
      ) {
        return Number.NEGATIVE_INFINITY;
      }
      score += 75;
      break;
    case "syntax":
      if (
        !isText ||
        !evidenceEstablishesPowerShellSyntax(
          candidate.span.text,
          aspect.subject
        )
      ) {
        return Number.NEGATIVE_INFINITY;
      }
      score += 90;
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
  if (facets.includes("syntax")) return "procedure_step";
  if (facets.includes("configuration")) return "configuration";
  if (facets.includes("state")) return "configuration";
  if (
    facets.includes("user_target") ||
    facets.includes("returned_value")
  ) {
    return "configuration";
  }
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
  if (facets.includes("syntax")) return "steps";
  if (facets.includes("configuration")) return "configuration";
  // "state" claims are placed in the same section as "configuration" claims
  // (rather than e.g. "key_components", which is absent from the
  // "configuration" expectedAnswerType template and would be silently
  // dropped from rendering) since both describe the properties of the same
  // configuration object, just via read vs. write evidence.
  if (facets.includes("state")) return "configuration";
  if (
    facets.includes("user_target") ||
    facets.includes("returned_value")
  ) {
    return "configuration";
  }
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

/**
 * Heading-corroborated operation facet closure (P2).
 *
 * R2 may establish the requested operation from aggregated context that
 * includes heading labels (a common Microsoft Learn authoring pattern:
 * "Configure X", "Grant Y"). R3's per-sentence facet scoring intentionally
 * excludes non-body spans for every facet except `identifier`, so an
 * operation signal that lives only in a heading can never be planned by the
 * normal facet-claim derivation. This corroboration step closes that gap
 * narrowly: a heading span may supplement (never originate) the `operation`
 * facet on a claim that already has substantive, independently-derived body
 * evidence for the same aspect and the same evidence item.
 *
 * Invariant: heading signal + substantive body evidence => facet coverage.
 *            heading signal + no substantive body evidence => still unplanned.
 */
function isSubstantiveProceduralOrConfigurationClaim(claim: DraftClaim): boolean {
  return (
    (claim.coveredFacets.includes("procedure") ||
      claim.coveredFacets.includes("configuration")) &&
    claim.sourceSpans.some((span) => span.sourceField === "text")
  );
}

function headingOperationCorroborationSpan(params: {
  aspect: EvidenceAspect;
  candidates: SpanCandidate[];
  evidenceIds: Set<string>;
}): ClaimSourceSpan | null {
  // Note: no independent subjectPresent() re-check here. evidenceIds already
  // scopes candidates to the same evidence item that produced the base claim
  // (which itself only exists because a body span passed subjectPresent for
  // this aspect), so this heading span is already known to belong to an
  // on-topic evidence item. A second subjectPresent() call adds no real
  // per-span discrimination — its context is title + the evidence item's
  // full (shared) headingPath, identical for every heading span of that
  // item — and can spuriously fail when the subject phrase is naturally
  // split across title/heading ("Meeting policies") and body ("...according
  // to policy...") with ordinary singular/plural variance. The genuine
  // corroboration signal is operationPresent on the heading text itself.
  const matches = params.candidates
    .filter(
      (candidate) =>
        candidate.span.sourceField === "heading" &&
        params.evidenceIds.has(candidate.span.evidenceId) &&
        operationPresent(candidate.normalized, params.aspect.operation)
    )
    .sort(
      (left, right) =>
        (left.span.fieldIndex ?? 0) - (right.span.fieldIndex ?? 0) ||
        left.span.spanId.localeCompare(right.span.spanId)
    );
  return matches[0]?.span ?? null;
}

export function applyHeadingOperationCorroboration(params: {
  aspect: EvidenceAspect;
  candidates: SpanCandidate[];
  claims: DraftClaim[];
}): DraftClaim[] {
  if (!params.aspect.requiredFacets.includes("operation")) return params.claims;
  if (params.claims.some((claim) => claim.coveredFacets.includes("operation"))) {
    return params.claims;
  }

  for (let index = 0; index < params.claims.length; index += 1) {
    const claim = params.claims[index]!;
    if (!isSubstantiveProceduralOrConfigurationClaim(claim)) continue;
    const evidenceIds = new Set(claim.sourceSpans.map((span) => span.evidenceId));
    const headingSpan = headingOperationCorroborationSpan({
      aspect: params.aspect,
      candidates: params.candidates,
      evidenceIds
    });
    if (!headingSpan) continue;
    const spans = uniqueSpans([...claim.sourceSpans, headingSpan]);
    const updated: DraftClaim = {
      ...claim,
      coveredFacets: [...new Set([...claim.coveredFacets, "operation" as const])],
      sourceSpans: spans,
      evidenceIds: [...new Set(spans.map((span) => span.evidenceId))],
      authorityContext: {
        ...claim.authorityContext,
        authorityRoles: [
          ...new Set([...claim.authorityContext.authorityRoles, headingSpan.authorityRole])
        ]
      }
    };
    const result = [...params.claims];
    result[index] = updated;
    return result;
  }
  return params.claims;
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
  const steps = params.candidates.filter(
    (candidate) =>
      candidate.span.sourceField === "text" &&
      candidate.procedureStep !== null
  );
  const structured = (
    steps.length > 0
      ? steps
      : params.candidates.filter(
          (candidate) =>
            candidate.span.sourceField === "text" &&
            facetScore(candidate, params.aspect, "procedure") > 60
        )
  ).sort(
      (left, right) =>
        (left.procedureStep ?? Number.MAX_SAFE_INTEGER) -
          (right.procedureStep ?? Number.MAX_SAFE_INTEGER) ||
        left.span.sourceOrder - right.span.sourceOrder ||
        (left.span.sentenceIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.span.sentenceIndex ?? Number.MAX_SAFE_INTEGER) ||
        // Prefer method-satisfying command spans only within the same procedure order.
        Number(prefersMethodCommandSpan(params.aspect, right.span.text)) -
          Number(prefersMethodCommandSpan(params.aspect, left.span.text))
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

function derivePerUserStateClaim(params: {
  bundle: EvidenceBundle;
  aspect: EvidenceAspect;
  candidates: SpanCandidate[];
}): DraftClaim[] {
  const targets = params.candidates
    .filter(
      (candidate) =>
        candidate.span.sourceField === "text" &&
        evidenceEstablishesUserTarget(candidate.span.text)
    )
    .map((candidate) => ({
      candidate,
      score:
        90 -
        (candidate.span.sentenceIndex ?? 0) +
        (subjectPresent(candidate, params.aspect) ? 25 : 0)
    }));
  const values = params.candidates
    .filter(
      (candidate) =>
        candidate.span.sourceField === "text" &&
        evidenceEstablishesReturnedUserValue(
          candidate.span.text,
          params.aspect.subject
        )
    )
    .map((candidate) => ({
      candidate,
      score:
        95 -
        (candidate.span.sentenceIndex ?? 0) +
        (subjectPresent(candidate, params.aspect) ? 25 : 0)
    }));

  const pairs = targets.flatMap((target) =>
    values
      .filter((value) =>
        canBindPerUserEvidence(
          {
            candidateId: target.candidate.evidence.evidenceId,
            documentId: target.candidate.evidence.documentId,
            sectionId: target.candidate.evidence.location.sectionId,
            title: target.candidate.evidence.source.title
          },
          {
            candidateId: value.candidate.evidence.evidenceId,
            documentId: value.candidate.evidence.documentId,
            sectionId: value.candidate.evidence.location.sectionId,
            title: value.candidate.evidence.source.title
          }
        )
      )
      .map((value) => ({
        target: target.candidate,
        value: value.candidate,
        score:
          target.score +
          value.score +
          (target.candidate.span.spanId === value.candidate.span.spanId
            ? 40
            : target.candidate.evidence.evidenceId ===
                value.candidate.evidence.evidenceId
              ? 20
              : 10)
      }))
  );
  const best = pairs.sort(
    (left, right) =>
      right.score - left.score ||
      left.target.span.sourceOrder - right.target.span.sourceOrder ||
      left.value.span.sourceOrder - right.value.span.sourceOrder
  )[0];
  if (!best) return [];

  return [
    makeDraftClaim({
      bundle: params.bundle,
      aspect: params.aspect,
      facets: ["user_target", "returned_value"],
      spans: uniqueSpans([best.target.span, best.value.span])
    })
  ];
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
  if (
    params.aspect.requiredFacets.includes("user_target") &&
    params.aspect.requiredFacets.includes("returned_value")
  ) {
    return derivePerUserStateClaim(params);
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
    const isGenericOutputTransformation = Boolean(
      aspect?.derivation.ruleIds.includes(OUTPUT_TRANSFORMATION_RULE_ID)
    );
    const methodLimited =
      bundle.aspectCoverage.methodLimitedAspectIds?.includes(aspectId) ??
      false;
    items.push({
      aspectId,
      reason: isGenericOutputTransformation
        ? "missing_authority"
        : methodLimited
          ? "required_method_unsatisfied"
          : bundle.aspectCoverage.authorityLimitedAspectIds.includes(aspectId)
            ? "missing_authority"
            : "insufficient_evidence",
      detail: isGenericOutputTransformation
        ? `The Teams-side data retrieval for this workflow is authoritatively covered where supported; ${
            aspect?.subject ?? "this output"
          } is a generic PowerShell step not currently covered by Relay's authoritative corpus.`
        : methodLimited
          ? `Authoritative factual evidence exists for ${
              aspect?.subject ?? "this output"
            }, but it does not satisfy the required ${
              aspect?.methodConstraints
                .filter((constraint) => constraint.required)
                .map((constraint) => constraint.label)
                .join(" and ") || "method"
            } constraint.`
          : aspect
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
        ...applyHeadingOperationCorroboration({
          aspect,
          candidates,
          claims: deriveFacetClaims({
            bundle,
            aspect,
            candidates
          })
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

const INTERVIEW_BOILERPLATE =
  /^(?:this article|for more information|important|note|tip|warning|updates in |see also)\b/i;

function interviewSpanUseful(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 6 || words.length > 40) return false;
  if (INTERVIEW_BOILERPLATE.test(text.trim())) return false;
  if (BOILERPLATE_LINE.test(text.trim())) return false;
  return SUBSTANTIVE_WORD.test(text);
}

function conceptHits(text: string, concepts: string[]): number {
  const normalized = normalize(text);
  return concepts.filter((concept) => {
    const tokens = normalize(concept)
      .split(" ")
      .filter((token) => token.length >= 3);
    if (tokens.length === 0) return false;
    const hits = tokens.filter((token) => normalized.includes(token)).length;
    return hits >= Math.max(1, Math.ceil(tokens.length / 2));
  }).length;
}

function signatureFromText(id: string, text: string): ConceptSignature {
  const terms = [...new Set(normalize(text).split(" ").filter((token) => token.length >= 3))];
  return {
    documentId: id,
    sectionId: id,
    terms,
    textTerms: terms
  };
}

/**
 * Interview Quick-only claim expansion. Keeps the original R3 facet claims
 * (so G1/G2 Detailed and integrity stay intact) and adds a small set of
 * concept-distinct extractive claims from already-selected evidence.
 */
export function expandInterviewQuickClaims(params: {
  bundle: EvidenceBundle;
  plan: AnswerPlan;
  concepts: string[];
  shape: InterviewQuestionShape;
}): AnswerPlan {
  if (params.plan.answerability === "insufficient_evidence") {
    return params.plan;
  }
  const started = performance.now();
  const evidenceById = new Map(
    params.bundle.evidence.map((evidence, index) => [
      evidence.evidenceId,
      { evidence, sourceOrder: index }
    ])
  );
  const supportedMandatory = new Set(
    params.bundle.aspectCoverage.supportedMandatoryAspectIds
  );
  const mandatoryAspects = params.bundle.aspectCoverage.aspects.filter(
    (aspect) =>
      aspect.requirement === "mandatory" &&
      supportedMandatory.has(aspect.aspectId)
  );
  const accepted: ConceptSignature[] = params.plan.plannedClaims.map((claim) =>
    signatureFromText(claim.claimId, claim.proposition)
  );
  const seenNormalized = new Set(
    params.plan.plannedClaims.map((claim) => normalize(claim.proposition))
  );
  const extraDrafts: DraftClaim[] = [];
  const ranked: Array<{
    draft: DraftClaim;
    score: number;
    hits: number;
  }> = [];

  for (const aspect of mandatoryAspects) {
    const candidates = (
      params.bundle.aspectCoverage.evidenceByAspect[aspect.aspectId] ?? []
    ).flatMap((evidenceId) => {
      const entry = evidenceById.get(evidenceId);
      return entry
        ? sentenceSpans(entry.evidence, aspect, entry.sourceOrder)
        : [];
    });
    for (const candidate of candidates) {
      if (candidate.span.sourceField !== "text") continue;
      if (!interviewSpanUseful(candidate.span.text)) continue;
      const normalized = normalize(candidate.span.text);
      if (seenNormalized.has(normalized)) continue;
      const hits = conceptHits(candidate.span.text, params.concepts);
      if (params.concepts.length > 0 && hits === 0) continue;
      const signature = signatureFromText(
        candidate.span.spanId,
        candidate.span.text
      );
      if (areConceptsRedundant(signature, accepted)) continue;
      const facets: EvidenceSupportFacet[] = aspect.requiredFacets.includes(
        "behavior"
      )
        ? ["behavior"]
        : aspect.requiredFacets.slice(0, 1);
      const draft = makeDraftClaim({
        bundle: params.bundle,
        aspect,
        facets,
        spans: [candidate.span],
        procedureStep: candidate.procedureStep
      });
      let score =
        hits * 20 +
        Math.min(candidate.span.text.split(/\s+/).length, 24) +
        conceptHits(candidate.span.text, [params.bundle.question]) * 15;
      if (params.shape === "troubleshooting") {
        if (
          /\b(?:check|verify|confirm|review|inspect|logs?|telemetry|trace)\b/i.test(
            candidate.span.text
          )
        ) {
          score += 12;
        }
      }
      if (params.shape === "powershell") {
        if (READ_CMDLET_PATTERN.test(candidate.span.text)) score += 16;
        if (/deprecated|no longer populated/i.test(candidate.span.text)) {
          score -= 40;
        }
      }
      ranked.push({ draft, score, hits });
    }
  }

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      right.hits - left.hits ||
      left.draft.proposition.localeCompare(right.draft.proposition)
  );

  const maxExtras = Math.max(0, 5 - params.plan.plannedClaims.length);
  for (const entry of ranked) {
    if (extraDrafts.length >= Math.max(maxExtras, 4)) break;
    const normalized = normalize(entry.draft.proposition);
    if (seenNormalized.has(normalized)) continue;
    const signature = signatureFromText(
      entry.draft.proposition,
      entry.draft.proposition
    );
    if (areConceptsRedundant(signature, accepted)) continue;
    extraDrafts.push(entry.draft);
    seenNormalized.add(normalized);
    accepted.push(signature);
  }

  if (extraDrafts.length === 0) return params.plan;

  const extraClaims = finalizeClaims({
    bundle: params.bundle,
    claims: extraDrafts,
    template: STRUCTURE_TEMPLATES[params.bundle.intent.expectedAnswerType],
    requiredCaveats: params.plan.requiredCaveats
  });
  const plannedClaims = [...params.plan.plannedClaims, ...extraClaims].map(
    (claim, index) => ({
      ...claim,
      ordering: {
        ...claim.ordering,
        sequence: index + 1
      }
    })
  );
  const { planIdentity: _ignored, ...state } = params.plan;
  return bindAnswerPlanIdentity({
    ...state,
    plannedClaims,
    diagnostics: {
      ...state.diagnostics,
      latencyMs: state.diagnostics.latencyMs + (performance.now() - started),
      duplicateClaimsCollapsed: state.diagnostics.duplicateClaimsCollapsed
    }
  });
}

