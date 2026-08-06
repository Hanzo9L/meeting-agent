import type { KnowledgeChunk, RetrievedContextChunk } from "./types";

const MAX_BODY_HITS_PER_TOKEN = 3;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function countOccurrences(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = haystack.match(new RegExp(escaped, "g"));
  return matches?.length ?? 0;
}

function scoreChunk(chunk: KnowledgeChunk, tokens: string[], phrase: string): number {
  let score = 0;
  const title = chunk.title.toLowerCase();
  const description = chunk.description.toLowerCase();
  const heading = chunk.heading.toLowerCase();
  const path = chunk.path.toLowerCase();
  const body = chunk.text.toLowerCase();

  if (phrase && chunk.searchText.includes(phrase)) score += 15;

  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    if (description.includes(token)) score += 5;
    if (heading.includes(token)) score += 6;
    if (path.includes(token)) score += 4;
    if (chunk.msTopic.toLowerCase().includes(token)) score += 3;
    score += Math.min(MAX_BODY_HITS_PER_TOKEN, countOccurrences(body, token));
  }

  return score;
}

export function retrieveBestChunks(
  question: string,
  chunks: KnowledgeChunk[],
  limit = 4
): RetrievedContextChunk[] {
  if (!question.trim() || chunks.length === 0) return [];

  const phrase = question.toLowerCase().trim().replace(/\s+/g, " ");
  const tokens = tokenize(question);
  if (tokens.length === 0) return [];

  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, tokens, phrase) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ chunk }) => ({
    title: chunk.heading ? `${chunk.title} — ${chunk.heading}` : chunk.title,
    path: chunk.path,
    text: chunk.text
  }));
}

