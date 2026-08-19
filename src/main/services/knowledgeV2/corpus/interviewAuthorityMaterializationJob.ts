import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildLearnMcpClient,
  DocumentIndexingJob,
  getSourceById,
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath,
  selectToolName,
  type AcquiredDocumentInput
} from "../index";
import { normalizeLearnUrl } from "../discovery/urlNormalization";
import {
  classifyInterviewMaterializationTarget,
  markdownLooksRetiredOrSuperseded
} from "./interviewAuthorityMaterialization";

const DEFAULT_ARTIFACTS_DIR = "eval/runs/indexing";

type FetchClient = {
  initialize: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string }>>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type InterviewMaterializationResult = {
  mode: "plan" | "execute";
  missingBefore: string[];
  fetched: number;
  indexed: number;
  skippedRetired: string[];
  unsupported: Array<{ canonicalUrl: string; reason: string }>;
  failures: Array<{ canonicalUrl: string; message: string }>;
  artifactPath: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inferEmbeddingDimensions(model: string): number {
  if (model === "text-embedding-3-large") return 3072;
  if (model === "text-embedding-3-small") return 1536;
  return Number(process.env["KNOWLEDGE_V2_EMBEDDING_DIMENSIONS"] || "1536");
}

function extractMarkdown(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) {
    const textParts = payload
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const rec = item as Record<string, unknown>;
          if (typeof rec["text"] === "string") return rec["text"];
          if (typeof rec["markdown"] === "string") return rec["markdown"];
        }
        return null;
      })
      .filter((value): value is string => typeof value === "string");
    if (textParts.length > 0) return textParts.join("\n\n");
  }
  if (typeof payload === "object" && payload !== null) {
    const rec = payload as Record<string, unknown>;
    if (typeof rec["markdown"] === "string") return rec["markdown"];
    if (typeof rec["text"] === "string") return rec["text"];
  }
  return JSON.stringify(payload, null, 2);
}

export class InterviewAuthorityMaterializationJob {
  constructor(
    private readonly fetchClientFactory: (endpoint: string) => FetchClient = (
      endpoint
    ) => buildLearnMcpClient(endpoint)
  ) {}

  async run(request: {
    mode: "plan" | "execute";
    canonicalUrls: string[];
    dbPath?: string;
    artifactsDir?: string;
    parserVersion?: string;
    chunkerVersion?: string;
    signal?: AbortSignal;
  }): Promise<InterviewMaterializationResult> {
    const dbPath = resolve(
      request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() })
    );
    const uniqueMissing = [...new Set(request.canonicalUrls)];
    const skippedRetired: string[] = [];
    const unsupported: Array<{ canonicalUrl: string; reason: string }> = [];
    const failures: Array<{ canonicalUrl: string; message: string }> = [];
    const acquired: AcquiredDocumentInput[] = [];

    const teamsAdmin = getSourceById("ms-teams-admin");
    if (!teamsAdmin || teamsAdmin.acquisition.transport !== "learn_mcp") {
      throw new Error("ms-teams-admin must use learn_mcp transport.");
    }
    const fetchClient = this.fetchClientFactory(teamsAdmin.acquisition.endpoint);
    await fetchClient.initialize();
    const tools = await fetchClient.listTools();
    const fetchTool = selectToolName(
      tools.map((tool) => ({ name: tool.name })),
      (name) => name.includes("fetch")
    );

    for (const canonicalUrl of uniqueMissing) {
      if (request.signal?.aborted) break;
      const target = classifyInterviewMaterializationTarget(canonicalUrl);
      if ("unsupported" in target) {
        unsupported.push({ canonicalUrl, reason: target.reason });
        continue;
      }
      try {
        const payload = await fetchClient.callTool(fetchTool, {
          url: canonicalUrl
        });
        const markdown = extractMarkdown(payload);
        if (markdownLooksRetiredOrSuperseded(markdown)) {
          skippedRetired.push(canonicalUrl);
          continue;
        }
        const normalized = normalizeLearnUrl(canonicalUrl);
        if (!normalized) {
          failures.push({ canonicalUrl, message: "invalid_canonical_url" });
          continue;
        }
        acquired.push({
          sourceId: target.sourceId,
          trackId: target.trackId,
          transport: "learn_mcp",
          canonicalUrl: normalized.canonicalUrl,
          rawMarkdown: markdown,
          revision: {
            transport: "learn_mcp",
            canonicalUrl: normalized.canonicalUrl,
            locale: normalized.locale ?? "en-us",
            retrievedAt: new Date().toISOString(),
            contentHash: sha256(markdown),
            sourcePath: normalized.articlePath.replace(/^\/+/, "")
          }
        });
      } catch (error) {
        failures.push({
          canonicalUrl,
          message: error instanceof Error ? error.message : "fetch_failed"
        });
      }
    }

    const runtime = resolveEmbeddingRuntimeConfig();
    const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
    const provider = new HostedOpenAiEmbeddingProvider({
      apiKey,
      defaultModel: runtime.model,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion,
      maxBatchSize: runtime.maxBatchSize
    });
    const job = new DocumentIndexingJob({
      storeDatabasePath: dbPath,
      migrationsDir: resolve("src/main/services/knowledgeV2/store/migrations"),
      parserVersion: request.parserVersion ?? "cg01c-parser-v1",
      chunkerVersion: request.chunkerVersion ?? "cg01a-v1",
      embeddingIdentity: {
        providerId: provider.providerId,
        model: runtime.model,
        dimensions: inferEmbeddingDimensions(runtime.model),
        embeddingSchemaVersion: runtime.embeddingSchemaVersion
      },
      embeddingBatchSize: runtime.maxBatchSize,
      embeddingProvider:
        request.mode === "plan"
          ? {
              providerId: "plan-only",
              async embedDocuments() {
                throw new Error("plan_mode_no_embedding_calls");
              },
              async embedQuery() {
                throw new Error("plan_mode_no_embedding_calls");
              }
            }
          : provider
    });
    const indexed = await job.run({
      mode: request.mode,
      acquiredDocuments: acquired,
      signal: request.signal
    });

    const artifactsDir = resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR);
    const artifactPath = join(
      artifactsDir,
      `interview-i3-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    await mkdir(dirname(artifactPath), { recursive: true });
    const result: InterviewMaterializationResult = {
      mode: request.mode,
      missingBefore: uniqueMissing,
      fetched: acquired.length,
      indexed: indexed.documents.filter((doc) => doc.readiness !== "failed")
        .length,
      skippedRetired,
      unsupported,
      failures,
      artifactPath
    };
    await writeFile(
      artifactPath,
      `${JSON.stringify(
        {
          ...result,
          documents: indexed.documents.map((doc) => ({
            canonicalUrl: doc.canonicalUrl,
            readiness: doc.readiness,
            chunks: doc.chunks.newCount
          }))
        },
        null,
        2
      )}\n`
    );
    return result;
  }
}
