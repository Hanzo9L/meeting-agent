import { performance } from "node:perf_hooks";
import type { QueryAnswerType } from "../retrievalV2/queryIntent";
import { areConceptsRedundant, type ConceptSignature } from "./evidenceConceptDistinctness";
import { classifyInterviewQuestionShape } from "./interviewQuestionShape";
import type {
  AnswerPlan,
  ExtractiveAssemblyProvenance,
  GroundedAnswer
} from "./types";
import type {
  ExplanationContextBlock,
  ContextReference
} from "./explanationContextTypes";
import {
  CONTEXT_TYPE_SECTION,
  type AnswerPresentationPlan,
  type AnswerPresentationProfile,
  type DualPresentedAnswers,
  type PresentationCaveatRef,
  type PresentationProofFactRef,
  type PresentationSection,
  type PresentationSectionId,
  type PresentationUnsupportedGap,
  type PresentedAnswer
} from "./answerPresentationTypes";

function interviewFactUseful(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 6 || words.length > 45) return false;
  if (
    /^(?:this article|for more information|important|note|tip|warning|updates in )\b/i.test(
      text.trim()
    )
  ) {
    return false;
  }
  return /[a-z]{3,}/i.test(text);
}

function signatureFromFact(fact: PresentationProofFactRef): ConceptSignature {
  const terms = [
    ...new Set(
      fact.renderedText
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((token) => token.length >= 3)
    )
  ];
  return {
    documentId: fact.claimId,
    sectionId: fact.claimId,
    terms,
    textTerms: terms
  };
}

function questionTermOverlap(text: string, question: string): number {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "would",
    "you",
    "how",
    "what",
    "when",
    "your"
  ]);
  const questionTerms = new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 4 && !stop.has(token))
  );
  if (questionTerms.size === 0) return 0;
  const textTerms = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 4);
  return textTerms.filter((token) => questionTerms.has(token)).length;
}

function selectInterviewQuickFacts(
  proofFacts: PresentationProofFactRef[],
  intent: AnswerPlan["intent"]
): PresentationProofFactRef[] {
  const shape = classifyInterviewQuestionShape(intent);
  const useful = proofFacts.filter((fact) =>
    interviewFactUseful(fact.renderedText)
  );
  const pool = [...(useful.length > 0 ? useful : proofFacts)];
  pool.sort((left, right) => {
    const overlapDelta =
      questionTermOverlap(right.renderedText, intent.originalQuestion) -
      questionTermOverlap(left.renderedText, intent.originalQuestion);
    if (overlapDelta !== 0) return overlapDelta;
    if (shape === "troubleshooting") {
      const diagnostic =
        /\b(?:check|verify|confirm|review|inspect|logs?|telemetry|trace|firewall|certificate)\b/i;
      const diagnosticDelta =
        Number(diagnostic.test(right.renderedText)) -
        Number(diagnostic.test(left.renderedText));
      if (diagnosticDelta !== 0) return diagnosticDelta;
    }
    if (shape === "powershell") {
      return (
        Number(/\bGet-Cs/i.test(right.renderedText)) -
        Number(/\bGet-Cs/i.test(left.renderedText))
      );
    }
    return 0;
  });
  const selected: PresentationProofFactRef[] = [];
  const accepted: ConceptSignature[] = [];
  let words = 0;
  for (const fact of pool) {
    if (selected.length >= 5) break;
    const factWords = fact.renderedText.trim().split(/\s+/).filter(Boolean)
      .length;
    if (selected.length > 0 && words + factWords > 110) break;
    const signature = signatureFromFact(fact);
    if (areConceptsRedundant(signature, accepted)) continue;
    selected.push(fact);
    accepted.push(signature);
    words += factWords;
  }
  return selected.length > 0 ? selected : pool.slice(0, 1);
}

function selectInterviewQuickCaveats(
  caveats: PresentationCaveatRef[]
): PresentationCaveatRef[] {
  const skipped = new Set([
    "freshness_verification_required",
    "missing_adjacent_authority"
  ]);
  const material = caveats.filter((caveat) => !skipped.has(caveat.code));
  return material.slice(0, 1);
}

function isProcedural(answerType: QueryAnswerType): boolean {
  return (
    answerType === "procedural" ||
    answerType === "configuration" ||
    answerType === "troubleshooting"
  );
}

function isCmdletReference(
  answerType: QueryAnswerType,
  plan: AnswerPlan
): boolean {
  if (answerType === "reference") return true;
  return (plan.intent.commandNames ?? []).length > 0;
}

function collectProofFacts(
  provenance: ExtractiveAssemblyProvenance,
  plan: AnswerPlan
): PresentationProofFactRef[] {
  const claimById = new Map(
    plan.plannedClaims.map((claim) => [claim.claimId, claim])
  );
  return provenance.renderedClaims.map((rendered) => {
    const claim = claimById.get(rendered.claimId);
    return {
      claimId: rendered.claimId,
      renderedText: rendered.renderedText,
      mandatory: claim?.mandatory ?? rendered.status === "mandatory",
      sectionId: rendered.sectionId
    };
  });
}

function collectCaveats(
  answer: GroundedAnswer,
  provenance: ExtractiveAssemblyProvenance
): PresentationCaveatRef[] {
  const fromPolicy = provenance.policyUnits
    .filter((unit) => unit.kind === "caveat" || unit.kind === "limitation")
    .map((unit) => ({
      code: unit.code,
      text: unit.text,
      mandatory: true
    }));
  const fromAnswer = answer.caveats.map((caveat) => ({
    code: caveat.code,
    text: caveat.text,
    mandatory: true
  }));
  const seen = new Set<string>();
  const merged: PresentationCaveatRef[] = [];
  for (const caveat of [...fromPolicy, ...fromAnswer]) {
    const key = `${caveat.code}:${caveat.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(caveat);
  }
  return merged;
}

function collectUnsupportedGaps(
  plan: AnswerPlan,
  provenance: ExtractiveAssemblyProvenance
): PresentationUnsupportedGap[] {
  const fromPlan = plan.unsupportedAspects.map((aspect) => ({
    aspectId: aspect.aspectId,
    detail: aspect.detail
  }));
  const fromPolicy = provenance.policyUnits
    .filter((unit) => unit.kind === "unsupported_aspect")
    .map((unit) => ({
      aspectId: unit.code,
      detail: unit.text
    }));
  const seen = new Set<string>();
  const gaps: PresentationUnsupportedGap[] = [];
  for (const gap of [...fromPlan, ...fromPolicy]) {
    if (seen.has(gap.aspectId)) continue;
    seen.add(gap.aspectId);
    gaps.push(gap);
  }
  return gaps;
}

function contextAllowedForGaps(
  block: ExplanationContextBlock,
  unsupportedAspectIds: Set<string>
): boolean {
  if (block.relatedAspectIds.length === 0) return true;
  return block.relatedAspectIds.every(
    (aspectId) => !unsupportedAspectIds.has(aspectId)
  );
}

function prioritizeContext(
  blocks: ExplanationContextBlock[],
  answerType: QueryAnswerType,
  plan: AnswerPlan
): ExplanationContextBlock[] {
  const procedural = isProcedural(answerType);
  const cmdlet = isCmdletReference(answerType, plan);
  const rank = (block: ExplanationContextBlock): number => {
    if (procedural) {
      if (block.contextType === "command") return 0;
      if (block.contextType === "cmdlet_reference") return 1;
      if (block.contextType === "procedure") return 2;
      if (block.contextType === "prerequisite") return 3;
      if (block.contextType === "verification") return 4;
      return 10;
    }
    if (cmdlet) {
      if (block.contextType === "cmdlet_reference") return 0;
      if (block.contextType === "command") return 1;
      if (block.contextType === "parameter_reference") return 2;
      if (block.contextType === "definition") return 3;
      return 10;
    }
    if (block.contextType === "definition") return 0;
    if (block.contextType === "conceptual_explanation") return 1;
    if (block.contextType === "supporting_context") return 2;
    return 10;
  };
  return [...blocks].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      left.ordering.sourceOrder - right.ordering.sourceOrder ||
      left.ordering.sequence - right.ordering.sequence
  );
}

function toContextReference(
  block: ExplanationContextBlock
): ContextReference {
  return {
    contextBlockId: block.contextBlockId,
    evidenceId: block.evidenceId,
    documentId: block.documentId,
    chunkId: block.chunkId,
    sourceTitle: block.sourceTitle,
    canonicalUrl: block.canonicalUrl,
    sourceId: block.sourceId,
    authorityRole: block.authorityRole,
    headingPath: [...block.headingPath],
    sectionId: block.sectionId,
    sourceStartOffset: block.startOffset,
    sourceEndOffset: block.endOffset,
    sourceContentHash: block.contentHash,
    contextType: block.contextType,
    preview: false
  };
}

function buildSections(params: {
  profile: AnswerPresentationProfile;
  proofFacts: PresentationProofFactRef[];
  contextBlocks: ExplanationContextBlock[];
  caveats: PresentationCaveatRef[];
  gaps: PresentationUnsupportedGap[];
  answerType: QueryAnswerType;
}): PresentationSection[] {
  const sections: PresentationSection[] = [];
  const push = (
    sectionId: PresentationSectionId,
    title: string,
    body: Omit<PresentationSection, "sectionId" | "title">
  ): void => {
    if (
      body.proofFactClaimIds.length === 0 &&
      body.contextBlockIds.length === 0 &&
      body.caveatCodes.length === 0 &&
      body.unsupportedAspectIds.length === 0
    ) {
      return;
    }
    sections.push({ sectionId, title, ...body });
  };

  if (params.profile === "live_assist_quick") {
    push("summary", "Summary", {
      proofFactClaimIds: params.proofFacts.map((fact) => fact.claimId),
      contextBlockIds: [],
      caveatCodes: [],
      unsupportedAspectIds: []
    });
    push("caveats", "Caveats", {
      proofFactClaimIds: [],
      contextBlockIds: [],
      caveatCodes: selectInterviewQuickCaveats(params.caveats).map(
        (caveat) => caveat.code
      ),
      unsupportedAspectIds: []
    });
    return sections;
  }

  push("summary", "Summary", {
    proofFactClaimIds: params.proofFacts.map((fact) => fact.claimId),
    contextBlockIds: [],
    caveatCodes: [],
    unsupportedAspectIds: []
  });

  const bySection = new Map<PresentationSectionId, string[]>();
  for (const block of params.contextBlocks) {
    const sectionId =
      CONTEXT_TYPE_SECTION[block.contextType] ?? "summary";
    if (sectionId === "summary") continue;
    const existing = bySection.get(sectionId) ?? [];
    existing.push(block.contextBlockId);
    bySection.set(sectionId, existing);
  }

  const detailedOrder: Array<[PresentationSectionId, string]> = [
    ["prerequisites", "Prerequisites"],
    ["what_to_do", "What to do"],
    ["commands", "PowerShell / Commands"],
    ["what_to_verify", "What to verify"]
  ];
  for (const [sectionId, title] of detailedOrder) {
    push(sectionId, title, {
      proofFactClaimIds: [],
      contextBlockIds: bySection.get(sectionId) ?? [],
      caveatCodes: [],
      unsupportedAspectIds: []
    });
  }

  // Conceptual explanatory context (not dumped into summary proof voice)
  const explanatory = params.contextBlocks
    .filter(
      (block) =>
        block.contextType === "definition" ||
        block.contextType === "conceptual_explanation" ||
        block.contextType === "supporting_context"
    )
    .map((block) => block.contextBlockId);
  if (
    !isProcedural(params.answerType) &&
    explanatory.length > 0 &&
    params.proofFacts.length > 0
  ) {
    // Attach as supporting source-bound context under a non-assertive section
    push("what_to_do", "Authoritative context", {
      proofFactClaimIds: [],
      contextBlockIds: explanatory.slice(0, 3),
      caveatCodes: [],
      unsupportedAspectIds: []
    });
  }

  push("unsupported_gaps", "Unsupported gaps", {
    proofFactClaimIds: [],
    contextBlockIds: [],
    caveatCodes: [],
    unsupportedAspectIds: params.gaps.map((gap) => gap.aspectId)
  });
  push("caveats", "Caveats / limitations", {
    proofFactClaimIds: [],
    contextBlockIds: [],
    caveatCodes: params.caveats.map((caveat) => caveat.code),
    unsupportedAspectIds: []
  });
  push("sources", "Sources", {
    proofFactClaimIds: [],
    contextBlockIds: params.contextBlocks.map(
      (block) => block.contextBlockId
    ),
    caveatCodes: [],
    unsupportedAspectIds: []
  });
  return sections;
}

export function buildAnswerPresentationPlan(params: {
  profile: AnswerPresentationProfile;
  plan: AnswerPlan;
  answer: GroundedAnswer;
  provenance: ExtractiveAssemblyProvenance;
  contextBlocks: ExplanationContextBlock[];
}): AnswerPresentationPlan {
  const proofFacts = collectProofFacts(params.provenance, params.plan);
  let caveats = collectCaveats(params.answer, params.provenance);
  if (params.profile === "live_assist_quick") {
    caveats = selectInterviewQuickCaveats(caveats);
  }
  const gaps = collectUnsupportedGaps(params.plan, params.provenance);
  const unsupportedAspectIds = new Set(gaps.map((gap) => gap.aspectId));

  const eligibleContext = params.contextBlocks.filter((block) =>
    contextAllowedForGaps(block, unsupportedAspectIds)
  );
  const ranked = prioritizeContext(
    eligibleContext,
    params.plan.answerType,
    params.plan
  );

  let selectedProofFacts = proofFacts;
  let selectedContext = ranked;
  if (params.profile === "live_assist_quick") {
    const mandatory = proofFacts.filter((fact) => fact.mandatory);
    const candidates = mandatory.length > 0 ? mandatory : proofFacts;
    selectedProofFacts = selectInterviewQuickFacts(
      candidates,
      params.plan.intent
    );
    selectedContext = [];
  } else {
    // Cap context dump while remaining deterministic.
    selectedContext = ranked.slice(0, 8);
  }

  if (params.answer.answerability === "insufficient_evidence") {
    selectedProofFacts = [];
    selectedContext = [];
  }

  const sections = buildSections({
    profile: params.profile,
    proofFacts: selectedProofFacts,
    contextBlocks: selectedContext,
    caveats,
    gaps,
    answerType: params.plan.answerType
  });

  return {
    profile: params.profile,
    answerability: params.answer.answerability,
    answerType: params.plan.answerType,
    sections,
    selectedProofFacts,
    selectedContextBlockIds: selectedContext.map(
      (block) => block.contextBlockId
    ),
    selectedCaveats: caveats,
    unsupportedGaps: gaps,
    sourceContextBlockIds: selectedContext.map(
      (block) => block.contextBlockId
    )
  };
}

function renderContextBlock(block: ExplanationContextBlock): string {
  const heading =
    block.headingPath.length > 0
      ? block.headingPath.join(" › ")
      : block.sourceTitle;
  return [
    `[Microsoft documentation context — ${block.contextType}]`,
    heading,
    block.exactText,
    `Source: ${block.sourceTitle}`,
    block.canonicalUrl
  ].join("\n");
}

export function renderPresentedAnswer(params: {
  presentationPlan: AnswerPresentationPlan;
  contextBlocks: ExplanationContextBlock[];
}): PresentedAnswer {
  const started = performance.now();
  const byId = new Map(
    params.contextBlocks.map((block) => [block.contextBlockId, block])
  );
  const proofById = new Map(
    params.presentationPlan.selectedProofFacts.map((fact) => [
      fact.claimId,
      fact
    ])
  );
  const caveatByCode = new Map(
    params.presentationPlan.selectedCaveats.map((caveat) => [
      caveat.code,
      caveat
    ])
  );
  const gapById = new Map(
    params.presentationPlan.unsupportedGaps.map((gap) => [
      gap.aspectId,
      gap
    ])
  );

  const parts: Array<{
    text: string;
    proofFactRanges: Array<{
      claimId: string;
      startOffset: number;
      endOffset: number;
    }>;
  }> = [];
  const usedBlocks: ExplanationContextBlock[] = [];

  if (
    params.presentationPlan.answerability === "insufficient_evidence" &&
    params.presentationPlan.selectedProofFacts.length === 0
  ) {
    parts.push({
      text: "Unable to provide a factual answer from the approved evidence.",
      proofFactRanges: []
    });
  }

  for (const section of params.presentationPlan.sections) {
    const body: Array<{
      text: string;
      proofFactClaimId?: string;
      proofTextOffset?: number;
    }> = [];
    const quick = params.presentationPlan.profile === "live_assist_quick";
    for (const [index, claimId] of section.proofFactClaimIds.entries()) {
      const fact = proofById.get(claimId);
      if (!fact?.renderedText) continue;
      const bullet = quick && section.sectionId === "summary" && index > 0;
      body.push({
        text: bullet ? `- ${fact.renderedText}` : fact.renderedText,
        proofFactClaimId: claimId,
        proofTextOffset: bullet ? 2 : 0
      });
    }
    for (const contextBlockId of section.contextBlockIds) {
      if (section.sectionId === "sources") continue;
      const block = byId.get(contextBlockId);
      if (!block) continue;
      usedBlocks.push(block);
      body.push({ text: renderContextBlock(block) });
    }
    for (const code of section.caveatCodes) {
      const caveat = caveatByCode.get(code);
      if (caveat) body.push({ text: caveat.text });
    }
    for (const aspectId of section.unsupportedAspectIds) {
      const gap = gapById.get(aspectId);
      if (gap) {
        body.push({
          text: `Not established from available authoritative evidence (${gap.aspectId}): ${gap.detail}`
        });
      }
    }
    if (section.sectionId === "sources") {
      const urls = new Map<string, string>();
      for (const contextBlockId of section.contextBlockIds) {
        const block = byId.get(contextBlockId);
        if (!block) continue;
        usedBlocks.push(block);
        urls.set(
          block.canonicalUrl,
          `${block.sourceTitle} — ${block.canonicalUrl}`
        );
      }
      body.push(
        ...[...urls.values()].map((text) => ({ text }))
      );
    }
    if (body.length === 0) continue;
    const prefix =
      params.presentationPlan.profile === "helpdesk_detailed"
        ? `${section.title}\n`
        : "";
    let bodyText = "";
    const proofFactRanges: Array<{
      claimId: string;
      startOffset: number;
      endOffset: number;
    }> = [];
    for (const item of body) {
      if (bodyText.length > 0) bodyText += "\n\n";
      const startOffset = prefix.length + bodyText.length;
      bodyText += item.text;
      if (item.proofFactClaimId) {
        const proofStart = startOffset + (item.proofTextOffset ?? 0);
        proofFactRanges.push({
          claimId: item.proofFactClaimId,
          startOffset: proofStart,
          endOffset: startOffset + item.text.length
        });
      }
    }
    parts.push({ text: `${prefix}${bodyText}`, proofFactRanges });
  }

  const uniqueBlocks = [
    ...new Map(
      usedBlocks.map((block) => [block.contextBlockId, block])
    ).values()
  ];

  let untrimmed = "";
  const untrimmedProofFactRanges: PresentedAnswer["proofFactRanges"] = [];
  for (const part of parts) {
    if (untrimmed.length > 0) untrimmed += "\n\n";
    const partStart = untrimmed.length;
    untrimmed += part.text;
    untrimmedProofFactRanges.push(
      ...part.proofFactRanges.map((range) => ({
        ...range,
        startOffset: partStart + range.startOffset,
        endOffset: partStart + range.endOffset
      }))
    );
  }
  const leadingTrimLength =
    untrimmed.length - untrimmed.trimStart().length;
  const answerText = untrimmed.trim();
  const proofFactRanges = untrimmedProofFactRanges.map((range) => ({
    ...range,
    startOffset: range.startOffset - leadingTrimLength,
    endOffset: range.endOffset - leadingTrimLength
  }));

  return {
    profile: params.presentationPlan.profile,
    answerText,
    proofFactRanges,
    plan: params.presentationPlan,
    contextBlocksUsed: uniqueBlocks,
    contextReferences: uniqueBlocks.map(toContextReference),
    diagnostics: {
      latencyMs: performance.now() - started,
      sectionCount: params.presentationPlan.sections.length,
      proofFactCount:
        params.presentationPlan.selectedProofFacts.length,
      contextBlockCount: uniqueBlocks.length,
      providerRequestCount: 0
    }
  };
}

export function presentGroundedAnswer(params: {
  plan: AnswerPlan;
  answer: GroundedAnswer;
  provenance: ExtractiveAssemblyProvenance;
  contextBlocks: ExplanationContextBlock[];
}): DualPresentedAnswers {
  const planningStarted = performance.now();
  const detailedPlan = buildAnswerPresentationPlan({
    profile: "helpdesk_detailed",
    ...params
  });
  const quickPlan = buildAnswerPresentationPlan({
    profile: "live_assist_quick",
    ...params
  });
  const planningLatencyMs = performance.now() - planningStarted;

  const renderingStarted = performance.now();
  const helpdeskDetailed = renderPresentedAnswer({
    presentationPlan: detailedPlan,
    contextBlocks: params.contextBlocks
  });
  const liveAssistQuick = renderPresentedAnswer({
    presentationPlan: quickPlan,
    contextBlocks: params.contextBlocks
  });
  const renderingLatencyMs = performance.now() - renderingStarted;

  return {
    helpdeskDetailed,
    liveAssistQuick,
    planningLatencyMs,
    renderingLatencyMs
  };
}

/**
 * Integrity check: presented Summary proof lines must equal R4 rendered
 * claim texts; context blocks must remain exact source text.
 */
export function assertPresentationDoesNotAlterProofFacts(params: {
  factualAnswerText: string;
  provenance: ExtractiveAssemblyProvenance;
  presented: PresentedAnswer;
}): string[] {
  const issues: string[] = [];
  for (const fact of params.presented.plan.selectedProofFacts) {
    if (!params.factualAnswerText.includes(fact.renderedText)) {
      issues.push(
        `Presented proof fact missing from R4 factual text: ${fact.claimId}`
      );
    }
    const rendered = params.provenance.renderedClaims.find(
      (claim) => claim.claimId === fact.claimId
    );
    if (rendered && rendered.renderedText !== fact.renderedText) {
      issues.push(
        `Presented proof fact altered from R4 render: ${fact.claimId}`
      );
    }
  }
  for (const block of params.presented.contextBlocksUsed) {
    if (!params.presented.answerText.includes(block.exactText)) {
      issues.push(
        `Context block text missing from presentation: ${block.contextBlockId}`
      );
    }
  }
  return issues;
}
