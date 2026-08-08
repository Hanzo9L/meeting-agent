export interface ConversationMigration {
  version: number;
  name: string;
  sql: string;
}

export const CONVERSATION_MIGRATIONS: readonly ConversationMigration[] = [
  {
    version: 1,
    name: "initial_conversation_persistence",
    sql: `
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX idx_conversations_active_updated
        ON conversations(deleted_at, updated_at DESC);

      CREATE TABLE grounding_snapshot_refs (
        snapshot_id TEXT PRIMARY KEY,
        snapshot_hash TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        resolver_policy_version TEXT NOT NULL,
        corpus_revision_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL CHECK (turn_index > 0),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        input_origin TEXT CHECK (input_origin IN ('typed', 'pasted', 'live_transcript')),
        answerability TEXT CHECK (answerability IN ('answered', 'partial')),
        grounding_snapshot_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
        FOREIGN KEY (grounding_snapshot_id) REFERENCES grounding_snapshot_refs(snapshot_id) ON DELETE RESTRICT,
        UNIQUE (conversation_id, turn_index),
        CHECK (
          (
            role = 'user'
            AND input_origin IS NOT NULL
            AND answerability IS NULL
            AND grounding_snapshot_id IS NULL
          )
          OR
          (
            role = 'assistant'
            AND input_origin IS NULL
            AND answerability IS NOT NULL
            AND grounding_snapshot_id IS NOT NULL
          )
        )
      );

      CREATE INDEX idx_messages_conversation_order
        ON messages(conversation_id, turn_index);

      CREATE TABLE answer_runs (
        answer_run_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        triggering_user_message_id TEXT NOT NULL,
        assistant_message_id TEXT,
        grounding_snapshot_id TEXT,
        state TEXT NOT NULL CHECK (
          state IN (
            'received',
            'resolving_context',
            'retrieving',
            'planning',
            'executing_answer',
            'validating',
            'completed',
            'partial',
            'failed',
            'cancelled'
          )
        ),
        failure_code TEXT,
        failure_details_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
        FOREIGN KEY (triggering_user_message_id) REFERENCES messages(message_id) ON DELETE RESTRICT,
        FOREIGN KEY (assistant_message_id) REFERENCES messages(message_id) ON DELETE RESTRICT,
        FOREIGN KEY (grounding_snapshot_id) REFERENCES grounding_snapshot_refs(snapshot_id) ON DELETE RESTRICT,
        CHECK (
          (
            state IN (
              'received',
              'resolving_context',
              'retrieving',
              'planning',
              'executing_answer',
              'validating'
            )
            AND assistant_message_id IS NULL
            AND completed_at IS NULL
          )
          OR
          (
            state IN ('completed', 'partial')
            AND assistant_message_id IS NOT NULL
            AND grounding_snapshot_id IS NOT NULL
            AND failure_code IS NULL
            AND completed_at IS NOT NULL
          )
          OR
          (
            state IN ('failed', 'cancelled')
            AND assistant_message_id IS NULL
            AND failure_code IS NOT NULL
            AND completed_at IS NOT NULL
          )
        )
      );

      CREATE INDEX idx_answer_runs_conversation_created
        ON answer_runs(conversation_id, created_at);
      CREATE INDEX idx_answer_runs_state
        ON answer_runs(state);

      CREATE TABLE context_resolutions (
        context_resolution_id TEXT PRIMARY KEY,
        source_user_message_id TEXT NOT NULL UNIQUE,
        original_text TEXT NOT NULL,
        resolved_question TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_user_message_id) REFERENCES messages(message_id) ON DELETE RESTRICT
      );

      CREATE TABLE context_resolution_prior_messages (
        context_resolution_id TEXT NOT NULL,
        reference_order INTEGER NOT NULL CHECK (reference_order >= 0),
        prior_message_id TEXT NOT NULL,
        PRIMARY KEY (context_resolution_id, reference_order),
        UNIQUE (context_resolution_id, prior_message_id),
        FOREIGN KEY (context_resolution_id)
          REFERENCES context_resolutions(context_resolution_id) ON DELETE CASCADE,
        FOREIGN KEY (prior_message_id) REFERENCES messages(message_id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_context_prior_message
        ON context_resolution_prior_messages(prior_message_id);
    `
  }
];
