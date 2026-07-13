const QUESTION_STARTERS = [
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
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
  "will"
];

export function looksLikeQuestion(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return false;
  if (text.includes("?")) return true;

  const firstWord = text.split(/\s+/)[0] ?? "";
  return QUESTION_STARTERS.includes(firstWord);
}
