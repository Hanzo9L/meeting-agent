import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { KnowledgeChunk } from "../chunking";
import type { KnowledgeDocument, ParseDiagnostic } from "../parse";
import type { SourceRevision } from "../sourceTypes";
import { getSchemaVersion, runMigrations } from "./migrationRunner";
import type {
  ChunkEmbeddingLookup,
  ChunkEmbeddingRecord,
  ChunkLifecycleInspection,
  ChunkSeedRecord,
  DocumentParseStatus,
  FindDocumentIdentityQuery,
  KnowledgeStore,
  KnowledgeStoreInspection,
  LoadedChunkEmbedding,
  PersistedChunkEmbeddingRecord,
  PersistedKnowledgeChunkRecord,
  ReplaceDocumentChunksResult,
  PersistedChunkInputRecord,
  SaveDocumentOptions,
  SaveDocumentResult,
  StoredDocumentRecord,
  SyncCheckpointQuery,
  SyncCheckpointRecord
} from "./types";

type SqliteDatabase = Database.Database;

export interface KnowledgeV2SqliteStoreOptions {
  databasePath: string;
  migrationsDir: string;
}

type DocumentIdentityRow = {
  document_id: string;
  current_revision_fingerprint?: string;
};

type DocumentRow = {
  document_id: string;
  source_id: string;
  track_id: string;
  transport: "github" | "learn_mcp";
  canonical_url: string;
  source_path: string;
  content_hash: string;
  parse_status: DocumentParseStatus;
  warning_count: number;
  error_count: number;
  title: string | null;
  description: string | null;
  product: string | null;
  service: string | null;
  subservice: string | null;
  audience: string | null;
  topic: string | null;
  document_type: string | null;
  applicable_products_json: string;
  author: string | null;
  ms_author: string | null;
  created_date: string | null;
  updated_date: string | null;
  deprecation_status: string | null;
  preview_status: string | null;
  parser_version: string;
  chunker_version: string | null;
  embedding_version: string | null;
  created_at: string;
  updated_at: string;
  tombstoned_at: string | null;
};

type DocumentContentRow = {
  raw_markdown: string;
  raw_front_matter: string | null;
  front_matter_json: string;
  sections_json: string;
  source_revision_json: string;
};

type DiagnosticRow = {
  severity: "warning" | "error";
  code: ParseDiagnostic["code"];
  message: string;
  section_path_json: string;
  node_type: string | null;
};

type SyncCheckpointRow = {
  source_id: string;
  track_id: string;
  transport: "github" | "learn_mcp";
  status: "idle" | "ok" | "error";
  last_revision_fingerprint: string;
  last_synced_at: string;
  last_error: string | null;
  checkpoint_payload_json: string;
};

type ChunkRow = {
  chunk_id: string;
  document_id: string;
  section_id: string;
  heading_path_json: string;
  chunk_kind: string;
  source_order: number;
  chunk_text: string;
  content_hash: string;
  provenance_json: string;
  metadata_json: string;
  chunker_version: string | null;
  created_at: string;
  updated_at: string;
  tombstoned_at: string | null;
};

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function fromOptionalArrayJson(value: string): string[] | undefined {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return undefined;
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildSafeFtsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .replace(/["']/g, " ")
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .slice(0, 20);
  if (terms.length === 0) return "";
  return [...new Set(terms)].join(" OR ");
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildDocumentLogicalIdentity(document: KnowledgeDocument): string {
  if (document.sourceRevision.transport === "github") {
    return [
      document.sourceId,
      document.trackId,
      "github",
      document.canonicalUrl.toLowerCase(),
      document.sourcePath.toLowerCase()
    ].join("|");
  }
  return [
    document.sourceId,
    document.trackId,
    "learn_mcp",
    document.sourceRevision.canonicalUrl.toLowerCase(),
    document.sourceRevision.locale.toLowerCase()
  ].join("|");
}

function buildIdentityFromQuery(query: FindDocumentIdentityQuery): string {
  if (query.transport === "github") {
    return [
      query.sourceId,
      query.trackId,
      "github",
      query.canonicalUrl.toLowerCase(),
      query.sourcePath.toLowerCase()
    ].join("|");
  }
  return [
    query.sourceId,
    query.trackId,
    "learn_mcp",
    query.canonicalUrl.toLowerCase(),
    (query.locale ?? "en-us").toLowerCase()
  ].join("|");
}

function computeParseStatus(diagnostics: ParseDiagnostic[]): DocumentParseStatus {
  const warningCount = diagnostics.filter((diag) => diag.severity === "warning").length;
  const errorCount = diagnostics.filter((diag) => diag.severity === "error").length;
  if (errorCount > 0) return "failed";
  if (warningCount > 0) return "warning";
  return "success";
}

function toStoredDocumentRecord(row: DocumentRow): StoredDocumentRecord {
  return {
    documentId: row.document_id,
    sourceId: row.source_id,
    trackId: row.track_id,
    transport: row.transport,
    canonicalUrl: row.canonical_url,
    sourcePath: row.source_path,
    contentHash: row.content_hash,
    parseStatus: row.parse_status,
    warningCount: row.warning_count,
    errorCount: row.error_count,
    parserVersion: row.parser_version,
    chunkerVersion: row.chunker_version,
    embeddingVersion: row.embedding_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tombstonedAt: row.tombstoned_at
  };
}

function toPersistedKnowledgeChunkRecord(row: ChunkRow): PersistedKnowledgeChunkRecord {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    sectionId: row.section_id,
    headingPath: fromJson<string[]>(row.heading_path_json),
    sourceOrder: row.source_order,
    chunkKind: row.chunk_kind,
    retrievalText: row.chunk_text,
    contentHash: row.content_hash,
    chunkerVersion: row.chunker_version,
    provenance: fromJson<Record<string, unknown>>(row.provenance_json),
    metadata: fromJson<Record<string, unknown>>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tombstonedAt: row.tombstoned_at
  };
}

export class KnowledgeV2SqliteStore implements KnowledgeStore {
  private readonly db: SqliteDatabase;
  private readonly dbPath: string;
  private readonly migrationsDir: string;

  constructor(options: KnowledgeV2SqliteStoreOptions) {
    this.dbPath = resolve(options.databasePath);
    this.migrationsDir = resolve(options.migrationsDir);
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("foreign_keys = ON");
    // WAL improves read/write concurrency for main process + worker usage.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
  }

  initializeDatabase(): void {
    runMigrations(this.db, this.migrationsDir);
  }

  close(): void {
    this.db.close();
  }

  getSchemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  saveKnowledgeDocument(document: KnowledgeDocument, options: SaveDocumentOptions): SaveDocumentResult {
    const logicalIdentity = buildDocumentLogicalIdentity(document);
    const revisionFingerprint = hashValue(toJson(document.sourceRevision));
    const warningCount = document.diagnostics.filter((diag) => diag.severity === "warning").length;
    const errorCount = document.diagnostics.filter((diag) => diag.severity === "error").length;
    const parseStatus = computeParseStatus(document.diagnostics);
    const timestamp = nowIso();

    const existing = this.db
      .prepare("SELECT document_id, current_revision_fingerprint FROM documents WHERE logical_identity_key = ?")
      .get(logicalIdentity) as DocumentIdentityRow | undefined;
    const documentId = existing?.document_id ?? document.documentId;
    const created = !existing;

    const upsert = this.db.transaction(() => {
      this.db.prepare(
        `
          INSERT INTO documents (
            document_id, logical_identity_key, source_id, track_id, transport, canonical_url, source_path,
            content_hash, parse_status, warning_count, error_count,
            title, description, product, service, subservice, audience, topic, document_type,
            applicable_products_json, author, ms_author, created_date, updated_date,
            deprecation_status, preview_status, parser_version, chunker_version, embedding_version,
            source_status, authority_tier, current_revision_fingerprint, created_at, updated_at, tombstoned_at, last_seen_sync_at
          ) VALUES (
            @document_id, @logical_identity_key, @source_id, @track_id, @transport, @canonical_url, @source_path,
            @content_hash, @parse_status, @warning_count, @error_count,
            @title, @description, @product, @service, @subservice, @audience, @topic, @document_type,
            @applicable_products_json, @author, @ms_author, @created_date, @updated_date,
            @deprecation_status, @preview_status, @parser_version, NULL, NULL,
            NULL, NULL, @current_revision_fingerprint, @created_at, @updated_at, NULL, @last_seen_sync_at
          )
          ON CONFLICT(document_id) DO UPDATE SET
            logical_identity_key = excluded.logical_identity_key,
            source_id = excluded.source_id,
            track_id = excluded.track_id,
            transport = excluded.transport,
            canonical_url = excluded.canonical_url,
            source_path = excluded.source_path,
            content_hash = excluded.content_hash,
            parse_status = excluded.parse_status,
            warning_count = excluded.warning_count,
            error_count = excluded.error_count,
            title = excluded.title,
            description = excluded.description,
            product = excluded.product,
            service = excluded.service,
            subservice = excluded.subservice,
            audience = excluded.audience,
            topic = excluded.topic,
            document_type = excluded.document_type,
            applicable_products_json = excluded.applicable_products_json,
            author = excluded.author,
            ms_author = excluded.ms_author,
            created_date = excluded.created_date,
            updated_date = excluded.updated_date,
            deprecation_status = excluded.deprecation_status,
            preview_status = excluded.preview_status,
            parser_version = excluded.parser_version,
            current_revision_fingerprint = excluded.current_revision_fingerprint,
            updated_at = excluded.updated_at,
            tombstoned_at = NULL,
            last_seen_sync_at = excluded.last_seen_sync_at
        `
      ).run({
        document_id: documentId,
        logical_identity_key: logicalIdentity,
        source_id: document.sourceId,
        track_id: document.trackId,
        transport: document.transport,
        canonical_url: document.canonicalUrl,
        source_path: document.sourcePath,
        content_hash: hashValue(document.rawMarkdown),
        parse_status: parseStatus,
        warning_count: warningCount,
        error_count: errorCount,
        title: document.normalizedMetadata.title ?? null,
        description: document.normalizedMetadata.description ?? null,
        product: document.normalizedMetadata.product ?? null,
        service: document.normalizedMetadata.service ?? null,
        subservice: document.normalizedMetadata.subservice ?? null,
        audience: document.normalizedMetadata.audience ?? null,
        topic: document.normalizedMetadata.topic ?? null,
        document_type: document.normalizedMetadata.documentType ?? null,
        applicable_products_json: toJson(document.normalizedMetadata.applicableProducts ?? null),
        author: document.normalizedMetadata.author ?? null,
        ms_author: document.normalizedMetadata.msAuthor ?? null,
        created_date: document.normalizedMetadata.createdDate ?? null,
        updated_date: document.normalizedMetadata.updatedDate ?? null,
        deprecation_status: document.normalizedMetadata.deprecationStatus ?? null,
        preview_status: document.normalizedMetadata.previewStatus ?? null,
        parser_version: options.parserVersion,
        current_revision_fingerprint: revisionFingerprint,
        created_at: timestamp,
        updated_at: timestamp,
        last_seen_sync_at: timestamp
      });

      this.db.prepare(
        `
          INSERT INTO document_contents (
            document_id, raw_markdown, raw_front_matter, front_matter_json, sections_json, source_revision_json
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(document_id) DO UPDATE SET
            raw_markdown = excluded.raw_markdown,
            raw_front_matter = excluded.raw_front_matter,
            front_matter_json = excluded.front_matter_json,
            sections_json = excluded.sections_json,
            source_revision_json = excluded.source_revision_json
        `
      ).run(
        documentId,
        document.rawMarkdown,
        document.rawFrontMatter,
        toJson(document.frontMatter),
        toJson(document.sections),
        toJson(document.sourceRevision)
      );

      this.db.prepare("DELETE FROM document_diagnostics WHERE document_id = ?").run(documentId);
      const diagnosticStmt = this.db.prepare(
        `
          INSERT INTO document_diagnostics (
            document_id, seq, severity, code, message, section_path_json, node_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      );
      document.diagnostics.forEach((diag, index) => {
        diagnosticStmt.run(
          documentId,
          index,
          diag.severity,
          diag.code,
          diag.message,
          toJson(diag.sectionPath),
          diag.nodeType ?? null
        );
      });

      this.db.prepare("DELETE FROM document_github_revisions WHERE document_id = ?").run(documentId);
      this.db.prepare("DELETE FROM document_learn_revisions WHERE document_id = ?").run(documentId);

      if (document.sourceRevision.transport === "github") {
        this.db.prepare(
          `
            INSERT INTO document_github_revisions (
              document_id, repository, branch, commit_sha, blob_sha, path
            ) VALUES (?, ?, ?, ?, ?, ?)
          `
        ).run(
          documentId,
          document.sourceRevision.repository,
          document.sourceRevision.branch,
          document.sourceRevision.commitSha,
          document.sourceRevision.blobSha,
          document.sourceRevision.path
        );
      } else {
        this.db.prepare(
          `
            INSERT INTO document_learn_revisions (
              document_id, canonical_url, locale, retrieved_at, content_hash, last_updated, external_document_id, source_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          documentId,
          document.sourceRevision.canonicalUrl,
          document.sourceRevision.locale,
          document.sourceRevision.retrievedAt,
          document.sourceRevision.contentHash,
          document.sourceRevision.lastUpdated ?? null,
          document.sourceRevision.documentId ?? null,
          document.sourceRevision.sourcePath ?? null
        );
      }

      if (
        existing?.current_revision_fingerprint &&
        existing.current_revision_fingerprint !== revisionFingerprint
      ) {
        this.db.prepare(
          `
            DELETE FROM knowledge_chunk_fts
            WHERE chunk_id IN (SELECT chunk_id FROM knowledge_chunks WHERE document_id = ?)
          `
        ).run(documentId);
        this.db.prepare(
          `
            DELETE FROM chunk_embeddings
            WHERE chunk_id IN (SELECT chunk_id FROM knowledge_chunks WHERE document_id = ?)
          `
        ).run(documentId);
        this.db.prepare(
          `
            UPDATE knowledge_chunks
            SET embedding_state = 'pending',
                tombstoned_at = COALESCE(tombstoned_at, ?),
                updated_at = ?
            WHERE document_id = ?
          `
        ).run(timestamp, timestamp, documentId);
      }
    });

    upsert();
    return {
      documentId,
      created,
      updated: !created
    };
  }

  getKnowledgeDocument(documentId: string): KnowledgeDocument | null {
    const docRow = this.db.prepare("SELECT * FROM documents WHERE document_id = ?").get(documentId) as
      | DocumentRow
      | undefined;
    if (!docRow) return null;

    const contentRow = this.db
      .prepare("SELECT * FROM document_contents WHERE document_id = ?")
      .get(documentId) as DocumentContentRow | undefined;
    if (!contentRow) return null;

    const diagnosticRows = this.db
      .prepare(
        "SELECT severity, code, message, section_path_json, node_type FROM document_diagnostics WHERE document_id = ? ORDER BY seq ASC"
      )
      .all(documentId) as DiagnosticRow[];

    const diagnostics: ParseDiagnostic[] = diagnosticRows.map((row) => ({
      severity: row.severity,
      code: row.code,
      message: row.message,
      sectionPath: fromJson<string[]>(row.section_path_json),
      nodeType: row.node_type ?? undefined
    }));

    return {
      documentId: docRow.document_id,
      sourceId: docRow.source_id,
      trackId: docRow.track_id,
      transport: docRow.transport,
      canonicalUrl: docRow.canonical_url,
      sourcePath: docRow.source_path,
      sourceRevision: fromJson<SourceRevision>(contentRow.source_revision_json),
      rawMarkdown: contentRow.raw_markdown,
      rawFrontMatter: contentRow.raw_front_matter,
      frontMatter: fromJson<Record<string, unknown>>(contentRow.front_matter_json),
      normalizedMetadata: {
        title: docRow.title ?? undefined,
        description: docRow.description ?? undefined,
        product: docRow.product ?? undefined,
        service: docRow.service ?? undefined,
        subservice: docRow.subservice ?? undefined,
        audience: docRow.audience ?? undefined,
        topic: docRow.topic ?? undefined,
        documentType: docRow.document_type ?? undefined,
        applicableProducts: fromOptionalArrayJson(docRow.applicable_products_json),
        author: docRow.author ?? undefined,
        msAuthor: docRow.ms_author ?? undefined,
        createdDate: docRow.created_date ?? undefined,
        updatedDate: docRow.updated_date ?? undefined,
        deprecationStatus: docRow.deprecation_status ?? undefined,
        previewStatus: docRow.preview_status ?? undefined
      },
      sections: fromJson<KnowledgeDocument["sections"]>(contentRow.sections_json),
      diagnostics
    };
  }

  findDocumentBySourceIdentity(query: FindDocumentIdentityQuery): KnowledgeDocument | null {
    const logicalIdentity = buildIdentityFromQuery(query);
    const row = this.db
      .prepare("SELECT document_id FROM documents WHERE logical_identity_key = ? AND tombstoned_at IS NULL")
      .get(logicalIdentity) as DocumentIdentityRow | undefined;
    if (!row) return null;
    return this.getKnowledgeDocument(row.document_id);
  }

  listDocumentsBySource(params: {
    sourceId: string;
    trackId?: string;
    includeTombstoned?: boolean;
  }): StoredDocumentRecord[] {
    const clauses = ["source_id = ?"];
    const values: unknown[] = [params.sourceId];
    if (params.trackId) {
      clauses.push("track_id = ?");
      values.push(params.trackId);
    }
    if (!params.includeTombstoned) {
      clauses.push("tombstoned_at IS NULL");
    }
    const sql = `
      SELECT
        document_id, source_id, track_id, transport, canonical_url, source_path, content_hash,
        parse_status, warning_count, error_count, parser_version, chunker_version, embedding_version,
        created_at, updated_at, tombstoned_at
      FROM documents
      WHERE ${clauses.join(" AND ")}
      ORDER BY source_path ASC
    `;
    const rows = this.db.prepare(sql).all(...values) as DocumentRow[];
    return rows.map(toStoredDocumentRecord);
  }

  getDocumentRawSource(documentId: string): {
    rawMarkdown: string;
    rawFrontMatter: string | null;
    frontMatter: Record<string, unknown>;
  } | null {
    const row = this.db
      .prepare("SELECT raw_markdown, raw_front_matter, front_matter_json FROM document_contents WHERE document_id = ?")
      .get(documentId) as
      | { raw_markdown: string; raw_front_matter: string | null; front_matter_json: string }
      | undefined;
    if (!row) return null;
    return {
      rawMarkdown: row.raw_markdown,
      rawFrontMatter: row.raw_front_matter,
      frontMatter: fromJson<Record<string, unknown>>(row.front_matter_json)
    };
  }

  tombstoneDocument(query: FindDocumentIdentityQuery, reason: string): boolean {
    const identity = buildIdentityFromQuery(query);
    const result = this.db
      .prepare(
        `
          UPDATE documents
          SET tombstoned_at = ?, updated_at = ?
          WHERE logical_identity_key = ? AND tombstoned_at IS NULL
        `
      )
      .run(nowIso(), nowIso(), identity);

    if (result.changes > 0) {
      this.db.prepare(
        `
          DELETE FROM knowledge_chunk_fts
          WHERE chunk_id IN (
            SELECT c.chunk_id
            FROM knowledge_chunks c
            JOIN documents d ON d.document_id = c.document_id
            WHERE d.logical_identity_key = ?
          )
        `
      ).run(identity);
      this.saveSyncCheckpoint({
        sourceId: query.sourceId,
        trackId: query.trackId,
        transport: query.transport,
        status: "ok",
        lastRevisionFingerprint: `tombstone:${identity}`,
        lastSyncedAt: nowIso(),
        lastError: `document_tombstoned:${reason}`,
        checkpointPayload: { reason }
      });
    }
    return result.changes > 0;
  }

  saveSyncCheckpoint(checkpoint: SyncCheckpointRecord): void {
    const timestamp = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `
          INSERT INTO source_tracks (source_id, track_id, transport, config_fingerprint, last_seen_at)
          VALUES (?, ?, ?, NULL, ?)
          ON CONFLICT(source_id, track_id) DO UPDATE SET
            transport = excluded.transport,
            last_seen_at = excluded.last_seen_at
        `
      ).run(checkpoint.sourceId, checkpoint.trackId, checkpoint.transport, timestamp);

      this.db.prepare(
        `
          INSERT INTO sync_checkpoints (
            source_id, track_id, transport, status, last_revision_fingerprint, last_synced_at,
            last_error, checkpoint_payload_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_id, track_id) DO UPDATE SET
            transport = excluded.transport,
            status = excluded.status,
            last_revision_fingerprint = excluded.last_revision_fingerprint,
            last_synced_at = excluded.last_synced_at,
            last_error = excluded.last_error,
            checkpoint_payload_json = excluded.checkpoint_payload_json,
            updated_at = excluded.updated_at
        `
      ).run(
        checkpoint.sourceId,
        checkpoint.trackId,
        checkpoint.transport,
        checkpoint.status,
        checkpoint.lastRevisionFingerprint,
        checkpoint.lastSyncedAt,
        checkpoint.lastError,
        toJson(checkpoint.checkpointPayload),
        timestamp,
        timestamp
      );
    });

    tx();
  }

  getSyncCheckpoint(query: SyncCheckpointQuery): SyncCheckpointRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT source_id, track_id, transport, status, last_revision_fingerprint, last_synced_at, last_error, checkpoint_payload_json
          FROM sync_checkpoints
          WHERE source_id = ? AND track_id = ?
        `
      )
      .get(query.sourceId, query.trackId) as SyncCheckpointRow | undefined;
    if (!row) return null;
    return {
      sourceId: row.source_id,
      trackId: row.track_id,
      transport: row.transport,
      status: row.status,
      lastRevisionFingerprint: row.last_revision_fingerprint,
      lastSyncedAt: row.last_synced_at,
      lastError: row.last_error,
      checkpointPayload: fromJson<Record<string, unknown>>(row.checkpoint_payload_json)
    };
  }

  saveChunkPlaceholder(chunk: ChunkSeedRecord): void {
    const timestamp = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `
          INSERT INTO knowledge_chunks (
            chunk_id, document_id, section_id, heading_path_json, chunk_kind, source_order, chunk_text,
            content_hash, provenance_json, metadata_json, chunker_version, embedding_state, created_at, updated_at, tombstoned_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, NULL)
          ON CONFLICT(chunk_id) DO UPDATE SET
            document_id = excluded.document_id,
            section_id = excluded.section_id,
            heading_path_json = excluded.heading_path_json,
            chunk_kind = excluded.chunk_kind,
            source_order = excluded.source_order,
            chunk_text = excluded.chunk_text,
            content_hash = excluded.content_hash,
            provenance_json = excluded.provenance_json,
            metadata_json = excluded.metadata_json,
            tombstoned_at = NULL,
            updated_at = excluded.updated_at
        `
      ).run(
        chunk.chunkId,
        chunk.documentId,
        chunk.sectionId,
        toJson(chunk.headingPath),
        chunk.chunkKind,
        chunk.sourceOrder,
        chunk.text,
        chunk.contentHash,
        toJson(chunk.provenance),
        toJson(chunk.metadata),
        timestamp,
        timestamp
      );

      this.db.prepare("DELETE FROM knowledge_chunk_fts WHERE chunk_id = ?").run(chunk.chunkId);
      this.db
        .prepare("INSERT INTO knowledge_chunk_fts (chunk_id, chunk_text) VALUES (?, ?)")
        .run(chunk.chunkId, chunk.text);
    });
    tx();
  }

  replaceDocumentChunks(params: {
    documentId: string;
    chunkerVersion: string;
    chunks: KnowledgeChunk[];
  }): ReplaceDocumentChunksResult {
    const started = Date.now();
    const { documentId, chunkerVersion, chunks } = params;
    for (const chunk of chunks) {
      if (chunk.documentId !== documentId) {
        throw new Error(`Chunk ${chunk.chunkId} does not belong to document ${documentId}.`);
      }
    }
    const byChunkId = new Map<string, KnowledgeChunk>();
    for (const chunk of chunks) {
      if (byChunkId.has(chunk.chunkId)) {
        throw new Error(`Duplicate chunk id in replacement payload: ${chunk.chunkId}`);
      }
      byChunkId.set(chunk.chunkId, chunk);
    }

    let inserted = 0;
    let updated = 0;
    let reused = 0;
    let tombstoned = 0;
    let ftsInserted = 0;
    let ftsUpdated = 0;
    let ftsRemoved = 0;
    let oldActiveChunkCount = 0;

    const tx = this.db.transaction(() => {
      const existingRows = this.db
        .prepare(
          `
            SELECT *
            FROM knowledge_chunks
            WHERE document_id = ?
          `
        )
        .all(documentId) as ChunkRow[];
      const existingById = new Map(existingRows.map((row) => [row.chunk_id, row] as const));
      oldActiveChunkCount = existingRows.filter((row) => row.tombstoned_at === null).length;

      const activeIds = new Set(
        existingRows.filter((row) => row.tombstoned_at === null).map((row) => row.chunk_id)
      );
      const incomingIds = new Set(chunks.map((chunk) => chunk.chunkId));
      const timestamp = nowIso();

      const upsertChunkStmt = this.db.prepare(
        `
          INSERT INTO knowledge_chunks (
            chunk_id, document_id, section_id, heading_path_json, chunk_kind, source_order, chunk_text,
            content_hash, provenance_json, metadata_json, chunker_version, embedding_state, created_at, updated_at, tombstoned_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
          ON CONFLICT(chunk_id) DO UPDATE SET
            document_id = excluded.document_id,
            section_id = excluded.section_id,
            heading_path_json = excluded.heading_path_json,
            chunk_kind = excluded.chunk_kind,
            source_order = excluded.source_order,
            chunk_text = excluded.chunk_text,
            content_hash = excluded.content_hash,
            provenance_json = excluded.provenance_json,
            metadata_json = excluded.metadata_json,
            chunker_version = excluded.chunker_version,
            tombstoned_at = NULL,
            updated_at = excluded.updated_at
        `
      );
      const deleteEntitiesStmt = this.db.prepare("DELETE FROM chunk_entities WHERE chunk_id = ?");
      const insertEntityStmt = this.db.prepare(
        `
          INSERT INTO chunk_entities (chunk_id, entity_index, entity_type, entity_value)
          VALUES (?, ?, ?, ?)
        `
      );
      const selectFtsStmt = this.db.prepare(
        "SELECT chunk_text FROM knowledge_chunk_fts WHERE chunk_id = ?"
      );
      const deleteFtsStmt = this.db.prepare("DELETE FROM knowledge_chunk_fts WHERE chunk_id = ?");
      const insertFtsStmt = this.db.prepare(
        "INSERT INTO knowledge_chunk_fts (chunk_id, chunk_text) VALUES (?, ?)"
      );

      for (const chunk of chunks) {
        const metadata = {
          sourceId: chunk.sourceId,
          trackId: chunk.trackId,
          canonicalUrl: chunk.canonicalUrl,
          contentStatus: chunk.contentStatus,
          inheritedMetadata: chunk.inheritedMetadata,
          exactEntities: chunk.exactEntities
        };
        const existing = existingById.get(chunk.chunkId);
        const incomingHeadingPathJson = toJson(chunk.headingPath);
        const incomingProvenanceJson = toJson(chunk.provenance);
        const incomingMetadataJson = toJson(metadata);
        const isReusable =
          existing?.tombstoned_at === null &&
          existing.content_hash === chunk.contentHash &&
          existing.chunk_text === chunk.retrievalText &&
          existing.chunk_kind === chunk.chunkKind &&
          existing.section_id === chunk.sectionId &&
          existing.source_order === chunk.sourceOrder &&
          existing.chunker_version === chunkerVersion &&
          existing.heading_path_json === incomingHeadingPathJson &&
          existing.provenance_json === incomingProvenanceJson &&
          existing.metadata_json === incomingMetadataJson;

        if (isReusable) {
          reused += 1;
        } else {
          upsertChunkStmt.run(
            chunk.chunkId,
            documentId,
            chunk.sectionId,
            incomingHeadingPathJson,
            chunk.chunkKind,
            chunk.sourceOrder,
            chunk.retrievalText,
            chunk.contentHash,
            incomingProvenanceJson,
            incomingMetadataJson,
            chunkerVersion,
            timestamp,
            timestamp
          );
          if (!existing) inserted += 1;
          else updated += 1;
        }

        deleteEntitiesStmt.run(chunk.chunkId);
        chunk.exactEntities.forEach((entity, index) => {
          insertEntityStmt.run(chunk.chunkId, index, entity.type, entity.value);
        });

        const existingFts = selectFtsStmt.get(chunk.chunkId) as { chunk_text: string } | undefined;
        if (!existingFts) {
          insertFtsStmt.run(chunk.chunkId, chunk.retrievalText);
          ftsInserted += 1;
        } else if (existingFts.chunk_text !== chunk.retrievalText) {
          deleteFtsStmt.run(chunk.chunkId);
          insertFtsStmt.run(chunk.chunkId, chunk.retrievalText);
          ftsUpdated += 1;
        }
      }

      for (const chunkId of activeIds) {
        if (incomingIds.has(chunkId)) continue;
        const result = this.db
          .prepare(
            `
              UPDATE knowledge_chunks
              SET tombstoned_at = ?, updated_at = ?
              WHERE chunk_id = ? AND tombstoned_at IS NULL
            `
          )
          .run(timestamp, timestamp, chunkId);
        if (result.changes > 0) {
          tombstoned += result.changes;
          const removed = deleteFtsStmt.run(chunkId);
          ftsRemoved += removed.changes;
        }
      }

      this.db
        .prepare(
          `
            UPDATE documents
            SET chunker_version = ?, updated_at = ?
            WHERE document_id = ?
          `
        )
        .run(chunkerVersion, timestamp, documentId);
    });

    tx();
    return {
      documentId,
      chunkerVersion,
      oldActiveChunkCount,
      newChunkCount: chunks.length,
      inserted,
      updated,
      reused,
      tombstoned,
      ftsInserted,
      ftsUpdated,
      ftsRemoved,
      durationMs: Date.now() - started
    };
  }

  listChunksForDocument(params: {
    documentId: string;
    includeTombstoned?: boolean;
  }): PersistedKnowledgeChunkRecord[] {
    const where = params.includeTombstoned ? "document_id = ?" : "document_id = ? AND tombstoned_at IS NULL";
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM knowledge_chunks
          WHERE ${where}
          ORDER BY source_order ASC, chunk_id ASC
        `
      )
      .all(params.documentId) as ChunkRow[];
    return rows.map(toPersistedKnowledgeChunkRecord);
  }

  getChunk(chunkId: string): PersistedKnowledgeChunkRecord | null {
    const row = this.db.prepare("SELECT * FROM knowledge_chunks WHERE chunk_id = ?").get(chunkId) as
      | ChunkRow
      | undefined;
    return row ? toPersistedKnowledgeChunkRecord(row) : null;
  }

  countActiveChunks(params?: { documentId?: string }): number {
    const row = (params?.documentId
      ? this.db
          .prepare(
            "SELECT COUNT(*) as count FROM knowledge_chunks WHERE tombstoned_at IS NULL AND document_id = ?"
          )
          .get(params.documentId)
      : this.db
          .prepare("SELECT COUNT(*) as count FROM knowledge_chunks WHERE tombstoned_at IS NULL")
          .get()) as { count: number };
    return row.count;
  }

  lexicalSearchChunks(params: {
    query: string;
    sourceId?: string;
    trackId?: string;
    limit?: number;
  }): Array<{
    chunkId: string;
    documentId: string;
    sourceId: string;
    trackId: string;
    chunkText: string;
    rank: number;
  }> {
    const safeQuery = buildSafeFtsQuery(params.query);
    if (!safeQuery) return [];
    const limit = Math.max(1, params.limit ?? 10);
    const conditions = [
      "d.tombstoned_at IS NULL",
      "kc.tombstoned_at IS NULL",
      "d.parse_status != 'failed'",
      "knowledge_chunk_fts MATCH ?"
    ];
    const values: unknown[] = [safeQuery];
    if (params.sourceId) {
      conditions.push("d.source_id = ?");
      values.push(params.sourceId);
    }
    if (params.trackId) {
      conditions.push("d.track_id = ?");
      values.push(params.trackId);
    }
    values.push(limit);
    const rows = this.db
      .prepare(
        `
          SELECT
            kc.chunk_id,
            kc.document_id,
            d.source_id,
            d.track_id,
            kc.chunk_text,
            bm25(knowledge_chunk_fts) as rank
          FROM knowledge_chunk_fts
          JOIN knowledge_chunks kc ON kc.chunk_id = knowledge_chunk_fts.chunk_id
          JOIN documents d ON d.document_id = kc.document_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY rank ASC, kc.source_order ASC
          LIMIT ?
        `
      )
      .all(...values) as Array<{
      chunk_id: string;
      document_id: string;
      source_id: string;
      track_id: string;
      chunk_text: string;
      rank: number;
    }>;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      sourceId: row.source_id,
      trackId: row.track_id,
      chunkText: row.chunk_text,
      rank: row.rank
    }));
  }

  inspectChunkLifecycle(params: { documentId: string }): ChunkLifecycleInspection {
    const activeChunkCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM knowledge_chunks WHERE document_id = ? AND tombstoned_at IS NULL"
        )
        .get(params.documentId) as { count: number }
    ).count;
    const tombstonedChunkCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM knowledge_chunks WHERE document_id = ? AND tombstoned_at IS NOT NULL"
        )
        .get(params.documentId) as { count: number }
    ).count;
    const ftsRowCount = (
      this.db
        .prepare(
          `
            SELECT COUNT(*) as count
            FROM knowledge_chunk_fts fts
            JOIN knowledge_chunks kc ON kc.chunk_id = fts.chunk_id
            WHERE kc.document_id = ?
          `
        )
        .get(params.documentId) as { count: number }
    ).count;

    return {
      activeChunkCount,
      tombstonedChunkCount,
      ftsRowCount
    };
  }

  saveChunkEmbedding(embedding: ChunkEmbeddingRecord): void {
    this.db.prepare(
      `
        INSERT INTO chunk_embeddings (
          chunk_id, embedding_provider, embedding_model, embedding_dimensions, embedding_schema_version,
          input_content_hash, vector_blob, usage_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(
          chunk_id,
          embedding_provider,
          embedding_model,
          embedding_schema_version,
          input_content_hash
        ) DO UPDATE SET
          embedding_provider = excluded.embedding_provider,
          embedding_model = excluded.embedding_model,
          embedding_dimensions = excluded.embedding_dimensions,
          vector_blob = excluded.vector_blob,
          usage_json = excluded.usage_json,
          updated_at = excluded.updated_at
      `
    ).run(
      embedding.chunkId,
      embedding.providerId,
      embedding.model,
      embedding.dimensions,
      embedding.embeddingSchemaVersion,
      embedding.inputContentHash,
      Buffer.from(embedding.vectorBlob),
      embedding.usage ? toJson(embedding.usage) : null,
      nowIso(),
      nowIso()
    );
  }

  getChunkEmbedding(params: ChunkEmbeddingLookup): LoadedChunkEmbedding | null {
    const sql =
      params.dimensions === undefined
        ? `
          SELECT chunk_id, embedding_provider, embedding_model, embedding_dimensions, embedding_schema_version,
                 input_content_hash, vector_blob, usage_json, created_at, updated_at
          FROM chunk_embeddings
          WHERE chunk_id = ?
            AND embedding_provider = ?
            AND embedding_model = ?
            AND embedding_schema_version = ?
            AND input_content_hash = ?
        `
        : `
          SELECT chunk_id, embedding_provider, embedding_model, embedding_dimensions, embedding_schema_version,
                 input_content_hash, vector_blob, usage_json, created_at, updated_at
          FROM chunk_embeddings
          WHERE chunk_id = ?
            AND embedding_provider = ?
            AND embedding_model = ?
            AND embedding_dimensions = ?
            AND embedding_schema_version = ?
            AND input_content_hash = ?
        `;

    const row = (params.dimensions === undefined
      ? this.db
          .prepare(sql)
          .get(
            params.chunkId,
            params.providerId,
            params.model,
            params.embeddingSchemaVersion,
            params.inputContentHash
          )
      : this.db
          .prepare(sql)
          .get(
            params.chunkId,
            params.providerId,
            params.model,
            params.dimensions,
            params.embeddingSchemaVersion,
            params.inputContentHash
          )) as
      | {
          chunk_id: string;
          embedding_provider: string;
          embedding_model: string;
          embedding_dimensions: number;
          embedding_schema_version: string;
          input_content_hash: string;
          vector_blob: Uint8Array;
          usage_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      chunkId: row.chunk_id,
      providerId: row.embedding_provider,
      model: row.embedding_model,
      dimensions: row.embedding_dimensions,
      embeddingSchemaVersion: row.embedding_schema_version,
      inputContentHash: row.input_content_hash,
      vectorBlob: new Uint8Array(row.vector_blob),
      usage: row.usage_json ? fromJson<Record<string, unknown>>(row.usage_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listChunkInputs(params?: {
    chunkIds?: string[];
    limit?: number;
    offset?: number;
  }): PersistedChunkInputRecord[] {
    const whereClauses = ["tombstoned_at IS NULL"];
    const values: unknown[] = [];
    if (params?.chunkIds && params.chunkIds.length > 0) {
      whereClauses.push(`chunk_id IN (${params.chunkIds.map(() => "?").join(",")})`);
      values.push(...params.chunkIds);
    }

    const limitClause = params?.limit ? "LIMIT ?" : "";
    const offsetClause = params?.offset ? "OFFSET ?" : "";
    if (params?.limit) values.push(params.limit);
    if (params?.offset) values.push(params.offset);

    const rows = this.db
      .prepare(
        `
          SELECT chunk_id, document_id, chunk_text, content_hash
          FROM knowledge_chunks
          WHERE ${whereClauses.join(" AND ")}
          ORDER BY source_order ASC, chunk_id ASC
          ${limitClause}
          ${offsetClause}
        `
      )
      .all(...values) as Array<{
      chunk_id: string;
      document_id: string;
      chunk_text: string;
      content_hash: string;
    }>;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      text: row.chunk_text,
      contentHash: row.content_hash
    }));
  }

  listChunkEmbeddings(params?: { chunkId?: string }): PersistedChunkEmbeddingRecord[] {
    const rows = (params?.chunkId
      ? this.db
          .prepare(
            `
          SELECT
            chunk_id,
            embedding_provider,
            embedding_model,
            embedding_dimensions,
            embedding_schema_version,
            input_content_hash,
            vector_blob,
            usage_json,
            created_at,
            updated_at
          FROM chunk_embeddings
          WHERE chunk_id = ?
          ORDER BY embedding_provider, embedding_model, embedding_schema_version, input_content_hash
        `
          )
          .all(params.chunkId)
      : this.db
          .prepare(
            `
          SELECT
            chunk_id,
            embedding_provider,
            embedding_model,
            embedding_dimensions,
            embedding_schema_version,
            input_content_hash,
            vector_blob,
            usage_json,
            created_at,
            updated_at
          FROM chunk_embeddings
          ORDER BY chunk_id, embedding_provider, embedding_model, embedding_schema_version, input_content_hash
        `
          )
          .all()) as Array<{
      chunk_id: string;
      embedding_provider: string;
      embedding_model: string;
      embedding_dimensions: number;
      embedding_schema_version: string;
      input_content_hash: string;
      vector_blob: Uint8Array;
      usage_json: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      providerId: row.embedding_provider,
      model: row.embedding_model,
      dimensions: row.embedding_dimensions,
      embeddingSchemaVersion: row.embedding_schema_version,
      inputContentHash: row.input_content_hash,
      vectorBlob: new Uint8Array(row.vector_blob),
      usage: row.usage_json ? fromJson<Record<string, unknown>>(row.usage_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  inspect(): KnowledgeStoreInspection {
    const documentsBySource = this.db.prepare(
      `
        SELECT source_id as sourceId, COUNT(*) as count
        FROM documents
        WHERE tombstoned_at IS NULL
        GROUP BY source_id
        ORDER BY source_id
      `
    ).all() as Array<{ sourceId: string; count: number }>;

    const documentsByTransport = this.db.prepare(
      `
        SELECT transport, COUNT(*) as count
        FROM documents
        WHERE tombstoned_at IS NULL
        GROUP BY transport
        ORDER BY transport
      `
    ).all() as Array<{ transport: "github" | "learn_mcp"; count: number }>;

    const parseStatusCounts = this.db.prepare(
      `
        SELECT parse_status as parseStatus, COUNT(*) as count
        FROM documents
        WHERE tombstoned_at IS NULL
        GROUP BY parse_status
        ORDER BY parse_status
      `
    ).all() as Array<{ parseStatus: DocumentParseStatus; count: number }>;

    const syncCheckpoints = this.db.prepare(
      `
        SELECT source_id, track_id, transport, status, last_synced_at, last_revision_fingerprint, last_error
        FROM sync_checkpoints
        ORDER BY source_id, track_id
      `
    ).all() as Array<{
      source_id: string;
      track_id: string;
      transport: "github" | "learn_mcp";
      status: "idle" | "ok" | "error";
      last_synced_at: string;
      last_revision_fingerprint: string;
      last_error: string | null;
    }>;

    const dbStats = this.db
      .prepare("SELECT COUNT(*) as count FROM documents WHERE tombstoned_at IS NULL")
      .get() as { count: number };
    const embeddingStats = this.db
      .prepare("SELECT COUNT(*) as count FROM chunk_embeddings")
      .get() as { count: number };
    const embeddingsByModel = this.db.prepare(
      `
        SELECT
          embedding_provider as providerId,
          embedding_model as model,
          embedding_schema_version as embeddingSchemaVersion,
          embedding_dimensions as dimensions,
          COUNT(*) as count
        FROM chunk_embeddings
        GROUP BY embedding_provider, embedding_model, embedding_schema_version, embedding_dimensions
        ORDER BY embedding_provider, embedding_model, embedding_schema_version
      `
    ).all() as Array<{
      providerId: string;
      model: string;
      embeddingSchemaVersion: string;
      dimensions: number;
      count: number;
    }>;

    const size = existsSync(this.dbPath) ? statSync(this.dbPath).size : null;

    return {
      databasePath: this.dbPath,
      schemaVersion: this.getSchemaVersion(),
      fileSizeBytes: size,
      documentCount: dbStats.count,
      documentsBySource,
      documentsByTransport,
      parseStatusCounts,
      embeddingCount: embeddingStats.count,
      embeddingsByModel,
      syncCheckpoints: syncCheckpoints.map((row) => ({
        sourceId: row.source_id,
        trackId: row.track_id,
        transport: row.transport,
        status: row.status,
        lastSyncedAt: row.last_synced_at,
        lastRevisionFingerprint: row.last_revision_fingerprint,
        lastError: row.last_error
      }))
    };
  }
}

export function createKnowledgeV2SqliteStore(
  options: KnowledgeV2SqliteStoreOptions
): KnowledgeV2SqliteStore {
  return new KnowledgeV2SqliteStore(options);
}
