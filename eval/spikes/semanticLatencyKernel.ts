import { decodeFloat32Vector, encodeFloat32Vector } from "../../src/main/services/knowledgeV2/store/embeddingCodec";

export interface ScoredCandidate {
  id: string;
  score: number;
}

export function generateDeterministicVector(
  seed: number,
  dimensions: number
): Float32Array {
  let state = seed >>> 0;
  const out = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

export function normalizeVector(values: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    norm += value * value;
  }
  if (norm === 0) {
    throw new Error("Cannot normalize zero vector.");
  }
  const scale = 1 / Math.sqrt(norm);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = (values[i] ?? 0) * scale;
  }
  return out;
}

export function cosineSimilarityNormalized(
  left: Float32Array,
  right: Float32Array
): number {
  if (left.length !== right.length) {
    throw new Error(
      `Vector dimension mismatch: ${left.length} vs ${right.length}.`
    );
  }
  let dot = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += (left[i] ?? 0) * (right[i] ?? 0);
  }
  return dot;
}

export function scoreCandidates(
  queryVector: Float32Array,
  candidates: Array<{ id: string; vector: Float32Array }>
): ScoredCandidate[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    score: cosineSimilarityNormalized(queryVector, candidate.vector)
  }));
}

export function selectTopK(
  scored: ScoredCandidate[],
  topK: number
): ScoredCandidate[] {
  if (topK <= 0) return [];
  const out: ScoredCandidate[] = [];
  for (const item of scored) {
    let inserted = false;
    for (let i = 0; i < out.length; i += 1) {
      const current = out[i];
      if (!current) continue;
      if (item.score > current.score || (item.score === current.score && item.id < current.id)) {
        out.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    if (!inserted && out.length < topK) {
      out.push(item);
    }
    if (inserted && out.length > topK) {
      out.pop();
    } else if (!inserted && out.length > topK) {
      out.length = topK;
    }
  }
  return out;
}

export function encodeNormalizedVectorBlob(
  vector: Float32Array
): Uint8Array {
  const normalized = normalizeVector(vector);
  return new Uint8Array(encodeFloat32Vector(Array.from(normalized)));
}

export function decodeNormalizedVectorBlob(
  blob: Uint8Array,
  dimensions: number
): Float32Array {
  return decodeFloat32Vector(blob, dimensions);
}
