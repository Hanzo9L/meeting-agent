/**
 * Deterministic completeness gate for Live Assist question promotion.
 *
 * Deepgram/assembler answers "did the speaker stop?"
 * This gate answers "is the completed utterance complete enough to become
 * a durable question?" without LLM/NLU.
 *
 * Reject only clearly incomplete interrogative fragments. Short questions
 * ending in "?" and non-interrogative speech pass through for the existing
 * question-detector / trigger policy.
 */

const WH_OPENERS = new Set([
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "whom",
  "whose",
  "which"
]);

const AUXILIARY_OPENERS = new Set([
  "can",
  "could",
  "would",
  "should",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "will",
  "have",
  "has",
  "am",
  "may"
]);

const DANGLING_TRAILING_TOKENS = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "for",
  "with",
  "from",
  "by",
  "in",
  "on",
  "at",
  "into",
  "about",
  "and",
  "or",
  "but",
  "vs",
  "versus",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "can",
  "could",
  "would",
  "should",
  "will",
  "have",
  "has",
  "had",
  "am",
  "my",
  "your",
  "our",
  "their",
  "its",
  "this",
  "that",
  "these",
  "those",
  "any",
  "some",
  "how",
  "what",
  "which",
  "when",
  "where",
  "who",
  "why",
  "whom",
  "whose"
]);

/**
 * Transitive verbs that commonly appear mid-question before their object.
 * Ending on one of these without a following object is treated as truncated.
 */
const TRAILING_TRANSITIVE_WITHOUT_OBJECT = new Set([
  "control",
  "controls",
  "assign",
  "assigns",
  "set",
  "sets",
  "configure",
  "configures",
  "enable",
  "enables",
  "disable",
  "disables",
  "need",
  "needs",
  "require",
  "requires",
  "support",
  "supports",
  "allow",
  "allows",
  "provide",
  "provides",
  "manage",
  "manages",
  "handle",
  "handles",
  "grant",
  "grants",
  "remove",
  "removes",
  "create",
  "creates",
  "update",
  "updates",
  "change",
  "changes",
  "modify",
  "modifies",
  "use",
  "uses"
]);

/**
 * Content predicates that finish common WH-auxiliary questions
 * ("how do X work", "what does Y mean").
 */
const CONTENT_PREDICATES = new Set([
  "work",
  "works",
  "mean",
  "means",
  "differ",
  "differs",
  "happen",
  "happens",
  "apply",
  "applies",
  "look",
  "looks",
  "seem",
  "seems",
  "compare",
  "compares",
  "operate",
  "operates",
  "behave",
  "behaves",
  "function",
  "functions",
  "relate",
  "relates",
  "affect",
  "affects",
  "help",
  "helps",
  "do",
  "does",
  "did"
]);

export const INCOMPLETE_UTTERANCE_STATUS =
  "incomplete utterance — waiting for next question";

export type CompletenessReason =
  | "terminal_question_mark"
  | "non_interrogative_pass"
  | "trailing_function_word"
  | "trailing_transitive_without_object"
  | "wh_auxiliary_missing_predicate"
  | "copular_incomplete"
  | "complete_enough";

export interface CompletenessAssessment {
  complete: boolean;
  reason: CompletenessReason;
}

function tokenize(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/\?+$/g, ""))
    .filter(Boolean);
}

function isInterrogativeShape(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const first = tokens[0] ?? "";
  if (WH_OPENERS.has(first)) return true;
  if (
    AUXILIARY_OPENERS.has(first) &&
    tokens.length >= 2
  ) {
    return true;
  }
  return false;
}

function hasContentPredicate(tokens: string[]): boolean {
  return tokens.some((token) => CONTENT_PREDICATES.has(token));
}

function assessWhAuxiliaryFrame(
  tokens: string[]
): CompletenessAssessment | null {
  if (tokens.length < 2) return null;
  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";
  if (!WH_OPENERS.has(first)) return null;
  if (
    !["do", "does", "did", "can", "could", "would", "should", "will"].includes(
      second
    )
  ) {
    return null;
  }
  const remainder = tokens.slice(2);
  if (remainder.length === 0) {
    return {
      complete: false,
      reason: "wh_auxiliary_missing_predicate"
    };
  }
  if (!hasContentPredicate(remainder)) {
    return {
      complete: false,
      reason: "wh_auxiliary_missing_predicate"
    };
  }
  return { complete: true, reason: "complete_enough" };
}

function assessCopularFrame(
  tokens: string[]
): CompletenessAssessment | null {
  if (tokens.length < 2) return null;
  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";
  if (!["what", "who", "where", "when"].includes(first)) return null;
  if (!["is", "are", "was", "were"].includes(second)) return null;
  const remainder = tokens.slice(2);
  if (remainder.length === 0) {
    return { complete: false, reason: "copular_incomplete" };
  }
  if (
    remainder.length === 1 &&
    DANGLING_TRAILING_TOKENS.has(remainder[0] ?? "")
  ) {
    return { complete: false, reason: "copular_incomplete" };
  }
  // "What is X" / "What is a Calling Plan" are complete enough once a
  // non-dangling complement is present.
  return { complete: true, reason: "complete_enough" };
}

export function assessQuestionCompleteness(
  input: string
): CompletenessAssessment {
  const trimmed = input.trim();
  if (!trimmed) {
    return { complete: false, reason: "copular_incomplete" };
  }
  if (trimmed.endsWith("?")) {
    return { complete: true, reason: "terminal_question_mark" };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return { complete: false, reason: "copular_incomplete" };
  }

  if (!isInterrogativeShape(tokens)) {
    return { complete: true, reason: "non_interrogative_pass" };
  }

  const last = tokens[tokens.length - 1] ?? "";
  if (DANGLING_TRAILING_TOKENS.has(last)) {
    return { complete: false, reason: "trailing_function_word" };
  }
  if (TRAILING_TRANSITIVE_WITHOUT_OBJECT.has(last)) {
    return {
      complete: false,
      reason: "trailing_transitive_without_object"
    };
  }

  const whAux = assessWhAuxiliaryFrame(tokens);
  if (whAux) return whAux;

  const copular = assessCopularFrame(tokens);
  if (copular) return copular;

  return { complete: true, reason: "complete_enough" };
}

export function isCompleteEnoughForPromotion(input: string): boolean {
  return assessQuestionCompleteness(input).complete;
}
