-- runner: no-transaction
PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE source_tracks_v2 (
  source_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('github', 'learn_mcp', 'local')),
  config_fingerprint TEXT,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (source_id, track_id)
);

INSERT INTO source_tracks_v2 (
  source_id,
  track_id,
  transport,
  config_fingerprint,
  last_seen_at
)
SELECT
  source_id,
  track_id,
  transport,
  config_fingerprint,
  last_seen_at
FROM source_tracks;

DROP TABLE source_tracks;
ALTER TABLE source_tracks_v2 RENAME TO source_tracks;

CREATE TABLE sync_checkpoints_v2 (
  source_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('github', 'learn_mcp', 'local')),
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

INSERT INTO sync_checkpoints_v2 (
  source_id,
  track_id,
  transport,
  status,
  last_revision_fingerprint,
  last_synced_at,
  last_error,
  checkpoint_payload_json,
  created_at,
  updated_at
)
SELECT
  source_id,
  track_id,
  transport,
  status,
  last_revision_fingerprint,
  last_synced_at,
  last_error,
  checkpoint_payload_json,
  created_at,
  updated_at
FROM sync_checkpoints;

DROP TABLE sync_checkpoints;
ALTER TABLE sync_checkpoints_v2 RENAME TO sync_checkpoints;

CREATE TABLE documents_v2 (
  document_id TEXT PRIMARY KEY,
  logical_identity_key TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('github', 'learn_mcp', 'local')),
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

INSERT INTO documents_v2 (
  document_id,
  logical_identity_key,
  source_id,
  track_id,
  transport,
  canonical_url,
  source_path,
  content_hash,
  parse_status,
  warning_count,
  error_count,
  title,
  description,
  product,
  service,
  subservice,
  audience,
  topic,
  document_type,
  applicable_products_json,
  author,
  ms_author,
  created_date,
  updated_date,
  deprecation_status,
  preview_status,
  parser_version,
  chunker_version,
  embedding_version,
  source_status,
  authority_tier,
  current_revision_fingerprint,
  created_at,
  updated_at,
  tombstoned_at,
  last_seen_sync_at
)
SELECT
  document_id,
  logical_identity_key,
  source_id,
  track_id,
  transport,
  canonical_url,
  source_path,
  content_hash,
  parse_status,
  warning_count,
  error_count,
  title,
  description,
  product,
  service,
  subservice,
  audience,
  topic,
  document_type,
  applicable_products_json,
  author,
  ms_author,
  created_date,
  updated_date,
  deprecation_status,
  preview_status,
  parser_version,
  chunker_version,
  embedding_version,
  source_status,
  authority_tier,
  current_revision_fingerprint,
  created_at,
  updated_at,
  tombstoned_at,
  last_seen_sync_at
FROM documents;

DROP TABLE documents;
ALTER TABLE documents_v2 RENAME TO documents;

CREATE INDEX idx_documents_source ON documents(source_id, track_id);
CREATE INDEX idx_documents_transport ON documents(transport);
CREATE INDEX idx_documents_parse_status ON documents(parse_status);

CREATE TEMP TABLE _fk_ok (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _fk_ok (ok)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0
  ELSE 1
END;

COMMIT;
PRAGMA foreign_keys = ON;
