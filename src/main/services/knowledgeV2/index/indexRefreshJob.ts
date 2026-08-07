import type { EmbeddingProvider } from "../embeddings";
import type { EmbeddingResult } from "../embeddings";
import { encodeFloat32Vector } from "../store";
import type { KnowledgeStore } from "../store";
import { assessChunkEmbeddingState } from "./reembedPlanner";
import type { DesiredEmbeddingIdentity, ReembedDecision, ReembedReason } from "./reembedPlanner";

export interface ReembedPlanItem {
  chunkId: string;
  decision: ReembedDecision;
}

export interface ReembedRunItemResult {
  chunkId: string;
  status: "reused" | "generated" | "failed" | "cancelled";
  reason: ReembedReason | "provider_failure" | "cancelled";
  error?: string;
}

export interface ReembedRunSummary {
  examinedCount: number;
  reusedCount: number;
  generatedCount: number;
  failedCount: number;
  cancelledCount: number;
  reasonCounts: Record<string, number>;
  providerRequestCount: number;
  providerInputTokens: number;
  durationMs: number;
  cancelled: boolean;
}

export interface ReembedRunResult {
  summary: ReembedRunSummary;
  items: ReembedRunItemResult[];
}

export interface ReembedJobOptions {
  store: KnowledgeStore;
  provider: EmbeddingProvider;
  desired: DesiredEmbeddingIdentity;
  batchSize?: number;
}

function aggregateBatchUsage(results: EmbeddingResult[]): {
  providerRequestCount: number;
  providerInputTokens: number;
} {
  const usageRows = results
    .map((result) => result.usage)
    .filter(
      (usage): usage is NonNullable<EmbeddingResult["usage"]> =>
        usage !== undefined && usage.batchSize > 0 && usage.requestCount > 0
    );
  if (usageRows.length === 0) {
    return { providerRequestCount: 0, providerInputTokens: 0 };
  }

  const grouped = new Map<string, { count: number; requestCount: number; batchSize: number; inputTokens: number }>();
  for (const usage of usageRows) {
    const inputTokens = usage.inputTokens ?? 0;
    const key = `${usage.requestCount}|${usage.batchSize}|${inputTokens}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        count: 1,
        requestCount: usage.requestCount,
        batchSize: usage.batchSize,
        inputTokens
      });
      continue;
    }
    current.count += 1;
  }

  let providerRequestCount = 0;
  let providerInputTokens = 0;
  for (const group of grouped.values()) {
    const requestMultiplier = Math.max(1, Math.round(group.count / group.batchSize));
    providerRequestCount += group.requestCount * requestMultiplier;
    providerInputTokens += group.inputTokens * requestMultiplier;
  }

  return { providerRequestCount, providerInputTokens };
}

export class ReembeddingIndexRefreshJob {
  private readonly store: KnowledgeStore;
  private readonly provider: EmbeddingProvider;
  private readonly desired: DesiredEmbeddingIdentity;
  private readonly batchSize: number;

  constructor(options: ReembedJobOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.desired = options.desired;
    this.batchSize = Math.max(1, options.batchSize ?? 25);
    if (this.desired.providerId !== this.provider.providerId) {
      throw new Error(
        `Desired provider (${this.desired.providerId}) does not match provider instance (${this.provider.providerId}).`
      );
    }
  }

  createPlan(params?: { chunkIds?: string[]; limit?: number; offset?: number }): ReembedPlanItem[] {
    const chunks = this.store.listChunkInputs(params);
    const embeddings = this.store.listChunkEmbeddings();
    return chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      decision: assessChunkEmbeddingState({
        chunk,
        existingEmbeddings: embeddings,
        desired: this.desired
      })
    }));
  }

  async execute(params?: {
    chunkIds?: string[];
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
  }): Promise<ReembedRunResult> {
    const started = Date.now();
    const signal = params?.signal;
    const plan = this.createPlan({
      chunkIds: params?.chunkIds,
      limit: params?.limit,
      offset: params?.offset
    });
    const chunkMap = new Map(this.store.listChunkInputs({
      chunkIds: plan.map((item) => item.chunkId)
    }).map((item) => [item.chunkId, item]));

    const items: ReembedRunItemResult[] = [];
    let providerRequestCount = 0;
    let providerInputTokens = 0;

    for (let i = 0; i < plan.length; i += this.batchSize) {
      if (signal?.aborted) {
        for (const remaining of plan.slice(i)) {
          items.push({
            chunkId: remaining.chunkId,
            status: "cancelled",
            reason: "cancelled"
          });
        }
        break;
      }

      const batch = plan.slice(i, i + this.batchSize);
      const toGenerate = batch.filter((entry) => entry.decision.status === "generate");
      for (const reused of batch.filter((entry) => entry.decision.status === "reused")) {
        items.push({
          chunkId: reused.chunkId,
          status: "reused",
          reason: reused.decision.reason
        });
      }

      if (toGenerate.length === 0) continue;

      const providerInputs = toGenerate
        .map((entry) => {
          const chunk = chunkMap.get(entry.chunkId);
          if (!chunk) return null;
          return { id: chunk.chunkId, text: chunk.text.trim() };
        })
        .filter((item): item is { id: string; text: string } => item !== null);

      try {
        if (signal?.aborted) {
          throw new Error("aborted");
        }
        const result = await this.provider.embedDocuments(providerInputs, {
          model: this.desired.model,
          embeddingSchemaVersion: this.desired.embeddingSchemaVersion,
          maxBatchSize: this.batchSize,
          signal
        });
        const usageTotals = aggregateBatchUsage(result);
        if (usageTotals.providerRequestCount > 0) {
          providerRequestCount += usageTotals.providerRequestCount;
          providerInputTokens += usageTotals.providerInputTokens;
        } else {
          // Backward-compatible fallback for providers that omit usage metadata.
          providerRequestCount += 1;
        }

        const resultById = new Map(result.map((entry) => [entry.inputId, entry]));
        for (const generated of toGenerate) {
          const embedding = resultById.get(generated.chunkId);
          if (!embedding) {
            items.push({
              chunkId: generated.chunkId,
              status: "failed",
              reason: "provider_failure",
              error: "missing_embedding_result"
            });
            continue;
          }
          const blob = encodeFloat32Vector(Array.from(embedding.vector));
          try {
            this.store.saveChunkEmbedding({
              chunkId: generated.chunkId,
              providerId: embedding.providerId,
              model: embedding.model,
              dimensions: embedding.dimensions,
              embeddingSchemaVersion: embedding.embeddingSchemaVersion,
              inputContentHash: embedding.inputContentHash,
              vectorBlob: new Uint8Array(blob),
              usage: embedding.usage
                ? {
                    requestCount: embedding.usage.requestCount,
                    batchSize: embedding.usage.batchSize,
                    inputTokens: embedding.usage.inputTokens
                  }
                : undefined
            });
            items.push({
              chunkId: generated.chunkId,
              status: "generated",
              reason: generated.decision.reason
            });
          } catch (error) {
            items.push({
              chunkId: generated.chunkId,
              status: "failed",
              reason: "provider_failure",
              error: error instanceof Error ? error.message : "embedding_persist_failed"
            });
          }
        }
      } catch (error) {
        const aborted = signal?.aborted || (error instanceof Error && error.message === "aborted");
        for (const generated of toGenerate) {
          items.push({
            chunkId: generated.chunkId,
            status: aborted ? "cancelled" : "failed",
            reason: aborted ? "cancelled" : "provider_failure",
            error: aborted
              ? undefined
              : error instanceof Error
                ? error.message
                : "provider_batch_failed"
          });
        }
        if (aborted) {
          for (const remaining of plan.slice(i + batch.length)) {
            items.push({
              chunkId: remaining.chunkId,
              status: "cancelled",
              reason: "cancelled"
            });
          }
          break;
        }
      }
    }

    const reasonCounts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.reason] = (acc[item.reason] ?? 0) + 1;
      return acc;
    }, {});
    const summary: ReembedRunSummary = {
      examinedCount: plan.length,
      reusedCount: items.filter((item) => item.status === "reused").length,
      generatedCount: items.filter((item) => item.status === "generated").length,
      failedCount: items.filter((item) => item.status === "failed").length,
      cancelledCount: items.filter((item) => item.status === "cancelled").length,
      reasonCounts,
      providerRequestCount,
      providerInputTokens,
      durationMs: Date.now() - started,
      cancelled: items.some((item) => item.status === "cancelled")
    };

    return {
      summary,
      items
    };
  }
}
