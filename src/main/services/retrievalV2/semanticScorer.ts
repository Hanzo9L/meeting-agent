import { performance } from "node:perf_hooks";
import { decodeFloat32Vector } from "../knowledgeV2";
import {
  cosineSimilarity,
  selectTopKDeterministic,
  type SemanticScoredItem
} from "./vectorSearchAdapter";

export interface DecodedSemanticVectorRow<TMeta = unknown> {
  id: string;
  vectorBlob: Uint8Array;
  dimensions: number;
  meta: TMeta;
}

export interface SemanticScoringResult<TMeta = unknown> {
  scored: SemanticScoredItem<TMeta>[];
  topK: SemanticScoredItem<TMeta>[];
  corruptCount: number;
  decodeLatencyMs: number;
  scoringLatencyMs: number;
  topKLatencyMs: number;
}

export function scoreSemanticVectors<TMeta>(params: {
  queryVector: Float32Array;
  rows: DecodedSemanticVectorRow<TMeta>[];
  topK: number;
}): SemanticScoringResult<TMeta> {
  const decodeStarted = performance.now();
  const decoded: Array<{ id: string; vector: Float32Array; meta: TMeta }> = [];
  let corruptCount = 0;
  for (const row of params.rows) {
    try {
      decoded.push({
        id: row.id,
        vector: decodeFloat32Vector(row.vectorBlob, row.dimensions),
        meta: row.meta
      });
    } catch {
      corruptCount += 1;
    }
  }
  const decodeLatencyMs = performance.now() - decodeStarted;

  const scoringStarted = performance.now();
  const scored = decoded.map((item) => ({
    id: item.id,
    score: cosineSimilarity(params.queryVector, item.vector),
    meta: item.meta
  }));
  const scoringLatencyMs = performance.now() - scoringStarted;

  const topKStarted = performance.now();
  const topK = selectTopKDeterministic(scored, params.topK);
  const topKLatencyMs = performance.now() - topKStarted;

  return {
    scored,
    topK,
    corruptCount,
    decodeLatencyMs,
    scoringLatencyMs,
    topKLatencyMs
  };
}

