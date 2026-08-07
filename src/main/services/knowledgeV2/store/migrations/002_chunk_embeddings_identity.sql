PRAGMA foreign_keys = ON;

CREATE TABLE chunk_embeddings_v2 (
  chunk_id TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
  embedding_schema_version TEXT NOT NULL,
  input_content_hash TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  usage_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    chunk_id,
    embedding_provider,
    embedding_model,
    embedding_schema_version,
    input_content_hash
  ),
  FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE
);

INSERT INTO chunk_embeddings_v2 (
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
)
SELECT
  chunk_id,
  embedding_provider,
  embedding_model,
  embedding_dimensions,
  embedding_version,
  source_content_hash,
  vector_blob,
  NULL,
  created_at,
  updated_at
FROM chunk_embeddings;

DROP TABLE chunk_embeddings;
ALTER TABLE chunk_embeddings_v2 RENAME TO chunk_embeddings;

CREATE INDEX idx_embeddings_model
  ON chunk_embeddings(embedding_provider, embedding_model, embedding_schema_version);

CREATE INDEX idx_embeddings_lookup
  ON chunk_embeddings(chunk_id, embedding_provider, embedding_model, embedding_schema_version, input_content_hash);
