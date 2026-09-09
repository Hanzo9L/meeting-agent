import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseDocument as parseYamlDocument } from "yaml";
import {
  HostedOpenAiEmbeddingProvider,
  resolveEmbeddingRuntimeConfig,
  resolveKnowledgeV2DatabasePath,
  type EmbeddingProvider
} from "../index";
import { DocumentIndexingJob } from "../indexing/documentIndexingJob";
import type { IndexingDocumentResult } from "../indexing/types";
import type { AcquiredDocumentInput } from "../parse";

const DEFAULT_SOURCE_ID = "networking_beginner";
const TRACK_ID = "ga";
const DEFAULT_CORPUS_ROOT = "data/corpus/networking";
const DEFAULT_ARTIFACTS_DIR = "eval/runs/indexing";

export interface LocalMarkdownCorpusJobRequest {
  mode: "plan" | "execute";
  dbPath?: string;
  artifactsDir?: string;
  parserVersion: string;
  chunkerVersion: string;
  signal?: AbortSignal;
}

export interface LocalMarkdownFileDecision {
  relativePath: string;
  status: "included" | "excluded" | "skipped";
  reason: string;
  canonicalUrl: string | null;
  contentHash: string | null;
}

export interface LocalMarkdownCorpusRunResult {
  runId: string;
  mode: "plan" | "execute";
  databasePath: string;
  durationMs: number;
  source: {
    sourceId: string;
    trackId: typeof TRACK_ID;
    corpusRoot: string;
    ingestRoots: string[];
    excludeFromIngest: string[];
    counts: {
      included: number;
      excluded: number;
      skipped: number;
    };
  };
  files: LocalMarkdownFileDecision[];
  execution: {
    attempted: number;
    succeeded: number;
    failed: number;
  } | null;
  indexingDocuments: IndexingDocumentResult[];
  artifactPaths: {
    jsonPath: string;
    markdownPath: string;
  };
  warnings: string[];
}

interface SourceDefinition {
  ingestRoots: string[];
  excludeFromIngest: string[];
}

interface Dependencies {
  sourceId?: string;
  corpusRoot?: string;
  createEmbeddingProvider?: () => {
    provider: EmbeddingProvider;
    dimensions: number;
    credentialAvailable: boolean;
  };
}

export class LocalMarkdownCorpusJob {
  private readonly sourceId: string;
  private readonly corpusRoot: string;
  private readonly createEmbeddingProvider: NonNullable<
    Dependencies["createEmbeddingProvider"]
  >;

  constructor(deps: Dependencies = {}) {
    this.sourceId = deps.sourceId ?? DEFAULT_SOURCE_ID;
    this.corpusRoot = deps.corpusRoot ?? DEFAULT_CORPUS_ROOT;
    this.createEmbeddingProvider =
      deps.createEmbeddingProvider ?? createHostedEmbeddingProvider;
  }

  async run(
    request: LocalMarkdownCorpusJobRequest
  ): Promise<LocalMarkdownCorpusRunResult> {
    const startedAt = new Date();
    const started = performance.now();
    const runId = `${this.sourceId}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
    const dbPath = resolve(
      request.dbPath ?? resolveKnowledgeV2DatabasePath({ cwd: process.cwd() })
    );
    const artifactsDir = resolve(request.artifactsDir ?? DEFAULT_ARTIFACTS_DIR);
    const artifactPaths = {
      jsonPath: join(artifactsDir, `${runId}.json`),
      markdownPath: join(artifactsDir, `${runId}.md`)
    };
    await mkdir(dirname(artifactPaths.jsonPath), { recursive: true });

    const corpusRoot = resolve(process.cwd(), this.corpusRoot);
    const definition = await loadSourceDefinition(
      resolve(process.cwd(), this.corpusRoot, "INTEGRATION/source-definition.json")
    );
    const retrievedAt = startedAt.toISOString();
    const { files, acquiredDocuments } = await collectDocuments({
      sourceId: this.sourceId,
      relativeCorpusRoot: this.corpusRoot,
      corpusRoot,
      definition,
      retrievedAt
    });

    const warnings: string[] = [];
    const indexingDocuments: IndexingDocumentResult[] = [];
    let execution: LocalMarkdownCorpusRunResult["execution"] = null;

    if (request.mode === "execute") {
      const runtime = resolveEmbeddingRuntimeConfig();
      const { provider, dimensions, credentialAvailable } =
        this.createEmbeddingProvider();
      if (!credentialAvailable) {
        warnings.push(
          "OPENAI_API_KEY missing; semantic embedding generation skipped."
        );
      }
      const job = new DocumentIndexingJob({
        storeDatabasePath: dbPath,
        migrationsDir: resolve(
          "src/main/services/knowledgeV2/store/migrations"
        ),
        parserVersion: request.parserVersion,
        chunkerVersion: request.chunkerVersion,
        embeddingIdentity: {
          providerId: "openai",
          model: runtime.model,
          dimensions,
          embeddingSchemaVersion: runtime.embeddingSchemaVersion
        },
        skipEmbeddingGeneration: !credentialAvailable,
        embeddingProvider: provider
      });
      const indexed = await job.run({
        mode: "execute",
        acquiredDocuments,
        signal: request.signal
      });
      indexingDocuments.push(...indexed.documents);
      execution = {
        attempted: acquiredDocuments.length,
        succeeded: indexed.summary.processedCount - indexed.summary.failedCount,
        failed: indexed.summary.failedCount
      };
    }

    const result: LocalMarkdownCorpusRunResult = {
      runId,
      mode: request.mode,
      databasePath: dbPath,
      durationMs: performance.now() - started,
      source: {
        sourceId: this.sourceId,
        trackId: TRACK_ID,
        corpusRoot: this.corpusRoot,
        ingestRoots: definition.ingestRoots,
        excludeFromIngest: definition.excludeFromIngest,
        counts: {
          included: files.filter((file) => file.status === "included").length,
          excluded: files.filter((file) => file.status === "excluded").length,
          skipped: files.filter((file) => file.status === "skipped").length
        }
      },
      files,
      execution,
      indexingDocuments,
      artifactPaths,
      warnings
    };
    await writeArtifacts(result);
    return result;
  }
}

async function collectDocuments(params: {
  sourceId: string;
  relativeCorpusRoot: string;
  corpusRoot: string;
  definition: SourceDefinition;
  retrievedAt: string;
}): Promise<{
  files: LocalMarkdownFileDecision[];
  acquiredDocuments: AcquiredDocumentInput[];
}> {
  const decisions = new Map<string, LocalMarkdownFileDecision>();
  const acquiredDocuments: AcquiredDocumentInput[] = [];

  for (const ingestRoot of params.definition.ingestRoots) {
    const rootDir = resolve(params.corpusRoot, ingestRoot);
    const markdownFiles = await listMarkdownFiles(rootDir);
    for (const absolutePath of markdownFiles) {
      const relativePath = toPosix(relative(params.corpusRoot, absolutePath));
      if (decisions.has(relativePath)) continue;
      const rawMarkdown = await readFile(absolutePath, "utf8");
      const excludePattern = matchingExcludePattern(
        relativePath,
        params.definition.excludeFromIngest
      );
      if (excludePattern) {
        decisions.set(relativePath, {
          relativePath,
          status: "excluded",
          reason: `excludeFromIngest:${excludePattern}`,
          canonicalUrl: null,
          contentHash: null
        });
        continue;
      }
      const ingest = readIngestFlag(rawMarkdown);
      if (ingest === false) {
        decisions.set(relativePath, {
          relativePath,
          status: "skipped",
          reason: "frontmatter ingest:false",
          canonicalUrl: null,
          contentHash: null
        });
        continue;
      }
      const canonicalUrl = `local://${params.sourceId}/${relativePath}`;
      const contentHash = sha256(rawMarkdown);
      acquiredDocuments.push({
        sourceId: params.sourceId,
        trackId: TRACK_ID,
        transport: "local",
        canonicalUrl,
        rawMarkdown,
        revision: {
          transport: "local",
          sourceRoot: params.relativeCorpusRoot,
          relativePath,
          contentHash,
          retrievedAt: params.retrievedAt
        }
      });
      decisions.set(relativePath, {
        relativePath,
        status: "included",
        reason: ingest === true ? "ingest:true" : "in ingestRoots",
        canonicalUrl,
        contentHash
      });
    }
  }

  await recordExcludeMatches({
    corpusRoot: params.corpusRoot,
    patterns: params.definition.excludeFromIngest,
    decisions
  });

  const files = [...decisions.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  return { files, acquiredDocuments };
}

async function recordExcludeMatches(params: {
  corpusRoot: string;
  patterns: string[];
  decisions: Map<string, LocalMarkdownFileDecision>;
}): Promise<void> {
  const allMarkdown = await listMarkdownFiles(params.corpusRoot);
  for (const absolutePath of allMarkdown) {
    const relativePath = toPosix(relative(params.corpusRoot, absolutePath));
    if (params.decisions.has(relativePath)) continue;
    const excludePattern = matchingExcludePattern(
      relativePath,
      params.patterns
    );
    if (!excludePattern) continue;
    params.decisions.set(relativePath, {
      relativePath,
      status: "excluded",
      reason: `excludeFromIngest:${excludePattern}`,
      canonicalUrl: null,
      contentHash: null
    });
  }
}

function matchingExcludePattern(
  relativePath: string,
  patterns: string[]
): string | null {
  for (const pattern of patterns) {
    if (matchesGlob(relativePath, pattern)) return pattern;
  }
  return null;
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  const path = toPosix(relativePath);
  const glob = toPosix(pattern);
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (!glob.includes("/")) {
    return path === glob || path.endsWith(`/${glob}`);
  }
  return path === glob;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function readIngestFlag(rawMarkdown: string): boolean | undefined {
  const normalized = rawMarkdown.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  try {
    const parsed = parseYamlDocument(match[1] ?? "", { uniqueKeys: false });
    const data = (parsed.toJSON() ?? {}) as Record<string, unknown>;
    if (data.ingest === false) return false;
    if (data.ingest === true) return true;
    return undefined;
  } catch {
    return undefined;
  }
}

async function loadSourceDefinition(path: string): Promise<SourceDefinition> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as {
    ingestRoots?: unknown;
    excludeFromIngest?: unknown;
  };
  if (
    !Array.isArray(parsed.ingestRoots) ||
    !parsed.ingestRoots.every((entry) => typeof entry === "string")
  ) {
    throw new Error("invalid_source_definition_ingestRoots");
  }
  if (
    !Array.isArray(parsed.excludeFromIngest) ||
    !parsed.excludeFromIngest.every((entry) => typeof entry === "string")
  ) {
    throw new Error("invalid_source_definition_excludeFromIngest");
  }
  return {
    ingestRoots: parsed.ingestRoots,
    excludeFromIngest: parsed.excludeFromIngest
  };
}

async function writeArtifacts(result: LocalMarkdownCorpusRunResult): Promise<void> {
  await writeFile(
    result.artifactPaths.jsonPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  const md: string[] = [
    `# ${result.runId}`,
    "",
    `- mode: ${result.mode}`,
    `- included: ${result.source.counts.included}`,
    `- excluded: ${result.source.counts.excluded}`,
    `- skipped: ${result.source.counts.skipped}`,
    "",
    "| status | path | reason |",
    "| --- | --- | --- |"
  ];
  for (const file of result.files) {
    md.push(`| ${file.status} | ${file.relativePath} | ${file.reason} |`);
  }
  await writeFile(result.artifactPaths.markdownPath, `${md.join("\n")}\n`, "utf8");
}

function createHostedEmbeddingProvider(): {
  provider: EmbeddingProvider;
  dimensions: number;
  credentialAvailable: boolean;
} {
  const runtime = resolveEmbeddingRuntimeConfig();
  const apiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
  return {
    provider: new HostedOpenAiEmbeddingProvider({
      apiKey,
      defaultModel: runtime.model,
      embeddingSchemaVersion: runtime.embeddingSchemaVersion,
      maxBatchSize: runtime.maxBatchSize
    }),
    dimensions:
      runtime.model === "text-embedding-3-large"
        ? 3072
        : Number(process.env["KNOWLEDGE_V2_EMBEDDING_DIMENSIONS"] || "1536"),
    credentialAvailable: apiKey.length > 0
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}
