const WH_WORDS = new Set([
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

const SECOND_WORD_TARGETS = new Set([
  "you",
  "we",
  "i",
  "it",
  "this",
  "that",
  "there",
  "they",
  "he",
  "she"
]);

const NON_QUESTION_PREFIXES = [
  "i think",
  "i believe",
  "we think",
  "we believe",
  "this is",
  "that is",
  "it is",
  "we are",
  "i am"
];

const REQUEST_VERBS = new Set([
  "provide",
  "share",
  "explain",
  "describe",
  "walk",
  "tell",
  "help",
  "show",
  "give",
  "review",
  "summarize",
  "clarify"
]);

const LEADING_FILLER_WORDS = new Set([
  "hey",
  "hi",
  "hello",
  "so",
  "well",
  "okay",
  "ok",
  "alright",
  "please"
]);

export function looksLikeQuestion(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return false;
  if (text.endsWith("?")) return true;
  if (NON_QUESTION_PREFIXES.some((prefix) => text.startsWith(prefix))) return false;

  const words = text
    .replace(/[.,!;:()[\]"]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 3) return false;

  let startIndex = 0;
  while (startIndex < words.length && LEADING_FILLER_WORDS.has(words[startIndex] ?? "")) {
    startIndex += 1;
  }

  const normalizedWords = words.slice(startIndex);
  if (normalizedWords.length < 2) return false;

  const firstWord = normalizedWords[0] ?? "";
  const secondWord = normalizedWords[1] ?? "";

  if (WH_WORDS.has(firstWord)) return true;

  if (AUXILIARY_OPENERS.has(firstWord) && SECOND_WORD_TARGETS.has(secondWord)) {
    return true;
  }

  // In calls, many "questions" are phrased as requests without a question mark.
  if (REQUEST_VERBS.has(firstWord) && normalizedWords.length >= 3) {
    return true;
  }

  // Common polite prompt styles, e.g., "can you...", "could we...", "please explain..."
  if (words.includes("please") && normalizedWords.length >= 3) {
    return true;
  }

  return false;
}
