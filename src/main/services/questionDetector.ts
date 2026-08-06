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

  const firstWord = words[0] ?? "";
  const secondWord = words[1] ?? "";

  if (WH_WORDS.has(firstWord)) return true;

  if (AUXILIARY_OPENERS.has(firstWord) && SECOND_WORD_TARGETS.has(secondWord)) {
    return true;
  }

  return false;
}
