import type { FusedRetrievalCandidate } from "../retrievalV2";
import { GENERIC_SUBJECT_TERMS, normalizeEvidenceText } from "./evidenceAspectPolicy";
import type { EvidenceAspect } from "./types";

/**
 * U1 — Concept-Distinct Evidence Selection for Broad Answers.
 *
 * Deterministic breadth + concept-distinctness contract used by
 * evidenceBundleBuilder.ts to decide when a mandatory aspect may accept more
 * than one "direct" candidate, and whether an additional candidate actually
 * contributes a materially different concept rather than restating the
 * primary selection.
 */

/** Small bounded maximum of distinct-concept items a single broad aspect may contribute. */
export const BROAD_ASPECT_CONCEPT_CAP = 4;

const CONCEPT_REDUNDANCY_JACCARD_THRESHOLD = 0.5;
/** Near-verbatim body text is a strong, independent redundancy signal even
 * when two titles/headings differ (e.g. a title-only copy/variant). Kept
 * much higher than the title threshold since ordinary prose from the same
 * authoritative domain naturally shares many common words. */
const TEXT_REDUNDANCY_JACCARD_THRESHOLD = 0.8;

const CONCEPT_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "by",
  "from",
  "is",
  "are",
  "your",
  "you",
  "this",
  "that",
  "these",
  "those",
  "how",
  "what",
  "overview",
  "about",
  "step",
  "steps"
]);

export interface ConceptSignature {
  documentId: string;
  sectionId: string;
  /** Distinctive, aspect-agnostic terms derived from title + heading path. */
  terms: string[];
  /** Distinctive terms derived from the candidate's own body text, used only
   * to detect near-verbatim duplicate/adjacent content. */
  textTerms: string[];
}

/**
 * A broad-selection aspect is one whose single coarse required facet cannot
 * be assumed to represent the full breadth of what the question needs,
 * because the derivation could not bind a specific, non-generic subject at
 * all: either an "unresolved" fallback subject, or a subject whose only
 * terms are generic scaffolding words like "Microsoft"/"Teams"/"admin". In
 * that case the question is inherently domain/topic-level rather than a
 * lookup for one named entity, so multiple authoritative concepts may
 * legitimately coexist in the answer.
 *
 * Deliberately does NOT key off `EvidenceAspect.breadth === "broad"`. That
 * existing flag is set by a much coarser "how does X work" phrasing
 * heuristic used elsewhere to require both a `purpose` and `mechanism`
 * facet, and it fires just as readily for narrow single-entity lookups
 * ("How do Microsoft Teams Calling Plans work?", "How does Direct Routing
 * voice routing work?") as it would for genuinely multi-concept questions.
 * Reusing it here would inflate exactly the compact, already-good answers
 * this slice must not regress. The generic/unresolved-subject signal below
 * is the one that actually distinguishes "this question never bound to one
 * specific named thing" from "this question is about one specific named
 * thing, just phrased as how it works".
 *
 * Identity, relationship, and comparison aspects are excluded: those answer
 * objects are about precisely identifying/relating specific things, where
 * breadth would dilute rather than help the answer.
 */
export function isBroadSelectionAspect(aspect: EvidenceAspect): boolean {
  if (aspect.requirement !== "mandatory") return false;
  if (
    aspect.answerObject === "cmdlet_identifier" ||
    aspect.answerObject === "cmdlet_semantics" ||
    aspect.answerObject === "relationship" ||
    aspect.answerObject === "comparison"
  ) {
    return false;
  }
  if (aspect.subjects.length === 0) return false;
  return aspect.subjects.every((subject) => {
    if (subject.kind === "unresolved") return true;
    if (subject.terms.length === 0) return false;
    return subject.terms.every((term) => GENERIC_SUBJECT_TERMS.has(term));
  });
}

function conceptTermSet(value: string): string[] {
  return normalizeEvidenceText(value)
    .split(" ")
    .filter((term) => term.length >= 3 && !CONCEPT_STOPWORDS.has(term));
}

/**
 * Derives a lightweight, deterministic "what does this candidate add" fingerprint
 * from signals already available on the candidate (document/section identity,
 * title, heading path) minus the terms already implied by the aspect's own
 * subject (which every candidate for this aspect shares, so they aren't
 * distinguishing). No embeddings, no additional model/provider calls.
 */
export function computeConceptSignature(
  candidate: FusedRetrievalCandidate,
  aspect: EvidenceAspect
): ConceptSignature {
  const excluded = new Set(aspect.subjectTerms.map((term) => term.toLowerCase()));
  const headingText = candidate.headingPath.join(" ");
  const raw = conceptTermSet(`${candidate.title} ${headingText}`);
  const terms = [...new Set(raw.filter((term) => !excluded.has(term)))].sort();
  const textTerms = [
    ...new Set(conceptTermSet(candidate.text).filter((term) => !excluded.has(term)))
  ].sort();
  return {
    documentId: candidate.documentId,
    sectionId: candidate.sectionId,
    terms,
    textTerms
  };
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 1;
  const rightSet = new Set(right);
  const intersection = left.filter((term) => rightSet.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : intersection / union;
}

/**
 * True when `candidate` does not contribute a materially distinct concept
 * relative to any already-accepted signature for the same aspect: either it
 * is the same document section (a literal duplicate/adjacent chunk), it has
 * no distinctive terms of its own once the shared subject is removed, or its
 * distinctive-term overlap with an existing signature is high enough that it
 * is describing the same mechanism/topic again.
 */
export function areConceptsRedundant(
  candidate: ConceptSignature,
  alreadyAccepted: ConceptSignature[]
): boolean {
  if (alreadyAccepted.length === 0) return false;
  if (candidate.terms.length === 0) return true;
  return alreadyAccepted.some((existing) => {
    if (
      existing.documentId === candidate.documentId &&
      existing.sectionId === candidate.sectionId
    ) {
      return true;
    }
    if (
      jaccardSimilarity(candidate.terms, existing.terms) >=
      CONCEPT_REDUNDANCY_JACCARD_THRESHOLD
    ) {
      return true;
    }
    return (
      jaccardSimilarity(candidate.textTerms, existing.textTerms) >=
      TEXT_REDUNDANCY_JACCARD_THRESHOLD
    );
  });
}
