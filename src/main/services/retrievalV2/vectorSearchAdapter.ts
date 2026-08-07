export interface SemanticScoredItem<TMeta = unknown> {
  id: string;
  score: number;
  meta: TMeta;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new Error(`semantic_dimension_mismatch:${left.length}:${right.length}`);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const lv = left[index] ?? 0;
    const rv = right[index] ?? 0;
    dot += lv * rv;
    leftNorm += lv * lv;
    rightNorm += rv * rv;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function selectTopKDeterministic<TMeta>(
  scored: SemanticScoredItem<TMeta>[],
  topK: number
): SemanticScoredItem<TMeta>[] {
  if (topK <= 0) return [];
  return [...scored]
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.id.localeCompare(right.id);
    })
    .slice(0, topK);
}

