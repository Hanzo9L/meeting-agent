import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildKnowledgeChunks } from "./indexer";
import { ensureSparseRepoSync } from "./gitSync";
import { retrieveBestChunks } from "./retriever";
import type {
  KnowledgeBaseSettings,
  KnowledgeBaseStatus,
  KnowledgeChunk,
  RetrievedContextChunk
} from "./types";

type IndexCache = {
  repoUrl: string;
  branch: string;
  docCount: number;
  lastSyncedAt: number | null;
  chunks: KnowledgeChunk[];
};

export class KnowledgeBaseService {
  private settings: KnowledgeBaseSettings;
  private readonly storageRoot: string;
  private readonly cacheFile: string;
  private chunks: KnowledgeChunk[] = [];
  private status: KnowledgeBaseStatus;

  constructor(storageRoot: string, settings: KnowledgeBaseSettings) {
    this.storageRoot = storageRoot;
    this.cacheFile = join(storageRoot, "index-cache.json");
    this.settings = settings;
    this.status = {
      ready: false,
      syncing: false,
      docCount: 0,
      lastSyncedAt: null,
      error: null,
      localPath: join(storageRoot, "msteams-docs", "msteams-platform")
    };
  }

  async initialize(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    await this.loadCache();
  }

  updateSettings(settings: KnowledgeBaseSettings): void {
    this.settings = settings;
  }

  getSettings(): KnowledgeBaseSettings {
    return this.settings;
  }

  getStatus(): KnowledgeBaseStatus {
    return { ...this.status };
  }

  async sync(): Promise<KnowledgeBaseStatus> {
    if (!this.settings.enabled) {
      this.status = {
        ...this.status,
        syncing: false,
        ready: false,
        error: "Knowledge base is disabled in settings."
      };
      return this.getStatus();
    }

    this.status = {
      ...this.status,
      syncing: true,
      error: null
    };

    try {
      const repoDir = await ensureSparseRepoSync({
        baseDir: this.storageRoot,
        repoUrl: this.settings.repoUrl,
        branch: this.settings.branch
      });
      const docsRoot = join(repoDir, "msteams-platform");
      const { chunks, docCount } = await buildKnowledgeChunks(docsRoot);
      this.chunks = chunks;

      this.status = {
        ...this.status,
        syncing: false,
        ready: chunks.length > 0,
        docCount,
        lastSyncedAt: Date.now(),
        error: null,
        localPath: docsRoot
      };

      await this.saveCache();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Knowledge sync failed";
      this.status = {
        ...this.status,
        syncing: false,
        ready: this.chunks.length > 0,
        error: message
      };
    }

    return this.getStatus();
  }

  retrieve(question: string): RetrievedContextChunk[] {
    if (!this.settings.enabled || this.chunks.length === 0) return [];
    return retrieveBestChunks(question, this.chunks, 4);
  }

  private async loadCache(): Promise<void> {
    try {
      const raw = await readFile(this.cacheFile, "utf8");
      const parsed = JSON.parse(raw) as IndexCache;
      if (
        parsed.repoUrl !== this.settings.repoUrl ||
        parsed.branch !== this.settings.branch ||
        !Array.isArray(parsed.chunks)
      ) {
        return;
      }

      this.chunks = parsed.chunks;
      this.status = {
        ...this.status,
        ready: parsed.chunks.length > 0,
        docCount: parsed.docCount ?? 0,
        lastSyncedAt: parsed.lastSyncedAt ?? null,
        error: null
      };
    } catch {
      // Cache is optional; ignore parse/missing errors.
    }
  }

  private async saveCache(): Promise<void> {
    const payload: IndexCache = {
      repoUrl: this.settings.repoUrl,
      branch: this.settings.branch,
      docCount: this.status.docCount,
      lastSyncedAt: this.status.lastSyncedAt,
      chunks: this.chunks
    };
    await writeFile(this.cacheFile, JSON.stringify(payload), "utf8");
  }
}

