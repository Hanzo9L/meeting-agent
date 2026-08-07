PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE source_tracks (
  source_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('github', 'learn_mcp')),
  config_fingerprint TEXT,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (source_id, track_id)
);

CREATE TABLE sync_checkpoints (
  source_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('github', 'learn_mcp')),
  status TEXT NOT NULL CHECK (status IN ('idle', 'ok', 'error')),
  last_revision_fingerprint TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  last_error TEXT,
  checkpoint_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, track_id),
  FOREIGN KEY (source_id, track_id) REFERENCES source_tracks(source_id, track_id) ON DELETE CASCADE
);

CREATE TABLE documents (
  document_id TEXT PRIMARY KEY,
  logical_identity_key TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('github', 'learn_mcp')),
  canonical_url TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('success', 'warning', 'failed')),
  warning_count INTEGER NOT NULL CHECK (warning_count >= 0),
  error_count INTEGER NOT NULL CHECK (error_count >= 0),
  title TEXT,
  description TEXT,
  product TEXT,
  service TEXT,
  subservice TEXT,
  audience TEXT,
  topic TEXT,
  document_type TEXT,
  applicable_products_json TEXT NOT NULL,
  author TEXT,
  ms_author TEXT,
  created_date TEXT,
  updated_date TEXT,
  deprecation_status TEXT,
  preview_status TEXT,
  parser_version TEXT NOT NULL,
  chunker_version TEXT,
  embedding_version TEXT,
  source_status TEXT,
  authority_tier TEXT,
  current_revision_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tombstoned_at TEXT,
  last_seen_sync_at TEXT NOT NULL
);

CREATE INDEX idx_documents_source ON documents(source_id, track_id);
CREATE INDEX idx_documents_transport ON documents(transport);
CREATE INDEX idx_documents_parse_status ON documents(parse_status);

CREATE TABLE document_contents (
  document_id TEXT PRIMARY KEY,
  raw_markdown TEXT NOT NULL,
  raw_front_matter TEXT,
  front_matter_json TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  source_revision_json TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE document_diagnostics (
  document_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  section_path_json TEXT NOT NULL,
  node_type TEXT,
  PRIMARY KEY (document_id, seq),
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE document_github_revisions (
  document_id TEXT PRIMARY KEY,
  repository TEXT NOT NULL CHECK (length(repository) > 0),
  branch TEXT NOT NULL CHECK (length(branch) > 0),
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) > 0),
  blob_sha TEXT NOT NULL CHECK (length(blob_sha) > 0),
  path TEXT NOT NULL CHECK (length(path) > 0),
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE document_learn_revisions (
  document_id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL CHECK (length(canonical_url) > 0),
  locale TEXT NOT NULL CHECK (length(locale) > 0),
  retrieved_at TEXT NOT NULL CHECK (length(retrieved_at) > 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) > 0),
  last_updated TEXT,
  external_document_id TEXT,
  source_path TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE TABLE knowledge_chunks (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  heading_path_json TEXT NOT NULL,
  chunk_kind TEXT NOT NULL,
  source_order INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  chunker_version TEXT,
  embedding_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tombstoned_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE INDEX idx_chunks_document ON knowledge_chunks(document_id);

CREATE TABLE chunk_entities (
  chunk_id TEXT NOT NULL,
  entity_index INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  PRIMARY KEY (chunk_id, entity_index),
  FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE
);

CREATE TABLE chunk_embeddings (
  chunk_id TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
  embedding_version TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  source_content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chunk_id, embedding_version),
  FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE
);

CREATE INDEX idx_embeddings_model ON chunk_embeddings(embedding_model, embedding_version);

CREATE VIRTUAL TABLE knowledge_chunk_fts USING fts5(
  chunk_id UNINDEXED,
  chunk_text,
  tokenize = 'porter unicode61'
);
