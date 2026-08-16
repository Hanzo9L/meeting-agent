export interface ConversationMigration {
  version: number;
  name: string;
  sql: string;
  foreignKeysOff?: boolean;
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
  },
  {
    version: 2,
    name: "grounded_helpdesk_answers_and_citations",
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE messages RENAME TO messages_v1;

      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL CHECK (turn_index > 0),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        input_origin TEXT CHECK (input_origin IN ('typed', 'pasted', 'live_transcript')),
        answerability TEXT CHECK (
          answerability IN ('answered', 'partial', 'insufficient_evidence')
        ),
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

      INSERT INTO messages (
        message_id,
        conversation_id,
        turn_index,
        role,
        content,
        input_origin,
        answerability,
        grounding_snapshot_id,
        created_at
      )
      SELECT
        message_id,
        conversation_id,
        turn_index,
        role,
        content,
        input_origin,
        answerability,
        grounding_snapshot_id,
        created_at
      FROM messages_v1;

      DROP TABLE messages_v1;

      CREATE INDEX idx_messages_conversation_order
        ON messages(conversation_id, turn_index);

      PRAGMA legacy_alter_table = OFF;

      CREATE TABLE message_citations (
        message_id TEXT NOT NULL,
        citation_id TEXT NOT NULL,
        factual_range_id TEXT NOT NULL,
        answer_range_start INTEGER NOT NULL CHECK (answer_range_start >= 0),
        answer_range_end INTEGER NOT NULL CHECK (answer_range_end > answer_range_start),
        source_title TEXT NOT NULL CHECK (length(trim(source_title)) > 0),
        canonical_url TEXT NOT NULL CHECK (
          canonical_url LIKE 'https://learn.microsoft.com/%'
        ),
        source_id TEXT NOT NULL,
        authority_role TEXT NOT NULL,
        heading_path_json TEXT NOT NULL,
        section_id TEXT NOT NULL,
        source_status TEXT NOT NULL,
        preview INTEGER NOT NULL CHECK (preview IN (0, 1)),
        grounding_snapshot_id TEXT NOT NULL,
        PRIMARY KEY (message_id, citation_id),
        FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
        FOREIGN KEY (grounding_snapshot_id)
          REFERENCES grounding_snapshot_refs(snapshot_id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_message_citations_message_range
        ON message_citations(message_id, answer_range_start, answer_range_end);
    `
  },
  {
    version: 3,
    name: "durable_live_assist_sessions",
    sql: `
      CREATE TABLE live_assist_sessions (
        live_session_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'inactive')),
        capture_status TEXT NOT NULL CHECK (
          capture_status IN (
            'starting',
            'capturing',
            'error',
            'stopped',
            'interrupted'
          )
        ),
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        stop_reason TEXT,
        FOREIGN KEY (conversation_id)
          REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
        CHECK (
          (
            state = 'active'
            AND stopped_at IS NULL
            AND stop_reason IS NULL
            AND capture_status IN ('starting', 'capturing', 'error')
          )
          OR
          (
            state = 'inactive'
            AND stopped_at IS NOT NULL
            AND stop_reason IS NOT NULL
            AND capture_status IN ('stopped', 'interrupted')
          )
        )
      );

      CREATE UNIQUE INDEX idx_live_assist_single_active
        ON live_assist_sessions(state)
        WHERE state = 'active';

      CREATE INDEX idx_live_assist_conversation_started
        ON live_assist_sessions(conversation_id, started_at DESC);
    `
  },
  {
    version: 4,
    name: "qa_assist_session_profile_and_source_provenance",
    foreignKeysOff: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE messages RENAME TO messages_v3;

      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL CHECK (turn_index > 0),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        input_origin TEXT CHECK (input_origin IN ('typed', 'pasted', 'live_transcript')),
        capture_source TEXT CHECK (capture_source IN ('system', 'microphone')),
        answerability TEXT CHECK (
          answerability IN ('answered', 'partial', 'insufficient_evidence')
        ),
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
            AND (input_origin = 'live_transcript' OR capture_source IS NULL)
          )
          OR
          (
            role = 'assistant'
            AND input_origin IS NULL
            AND capture_source IS NULL
            AND answerability IS NOT NULL
            AND grounding_snapshot_id IS NOT NULL
          )
        )
      );

      INSERT INTO messages (
        message_id,
        conversation_id,
        turn_index,
        role,
        content,
        input_origin,
        capture_source,
        answerability,
        grounding_snapshot_id,
        created_at
      )
      SELECT
        message_id,
        conversation_id,
        turn_index,
        role,
        content,
        input_origin,
        NULL,
        answerability,
        grounding_snapshot_id,
        created_at
      FROM messages_v3;

      DROP TABLE messages_v3;

      CREATE INDEX idx_messages_conversation_order
        ON messages(conversation_id, turn_index);

      ALTER TABLE live_assist_sessions RENAME TO live_assist_sessions_v3;

      CREATE TABLE live_assist_sessions (
        live_session_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        profile TEXT NOT NULL CHECK (profile IN ('live_assist', 'qa_assist')),
        state TEXT NOT NULL CHECK (state IN ('active', 'inactive')),
        capture_status TEXT NOT NULL CHECK (
          capture_status IN (
            'starting',
            'capturing',
            'error',
            'stopped',
            'interrupted'
          )
        ),
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        stop_reason TEXT,
        FOREIGN KEY (conversation_id)
          REFERENCES conversations(conversation_id) ON DELETE RESTRICT,
        CHECK (
          (
            state = 'active'
            AND stopped_at IS NULL
            AND stop_reason IS NULL
            AND capture_status IN ('starting', 'capturing', 'error')
          )
          OR
          (
            state = 'inactive'
            AND stopped_at IS NOT NULL
            AND stop_reason IS NOT NULL
            AND capture_status IN ('stopped', 'interrupted')
          )
        )
      );

      INSERT INTO live_assist_sessions (
        live_session_id,
        conversation_id,
        profile,
        state,
        capture_status,
        started_at,
        stopped_at,
        stop_reason
      )
      SELECT
        live_session_id,
        conversation_id,
        'live_assist',
        state,
        capture_status,
        started_at,
        stopped_at,
        stop_reason
      FROM live_assist_sessions_v3;

      DROP TABLE live_assist_sessions_v3;

      CREATE UNIQUE INDEX idx_live_assist_single_active
        ON live_assist_sessions(state)
        WHERE state = 'active';

      CREATE INDEX idx_live_assist_conversation_started
        ON live_assist_sessions(conversation_id, started_at DESC);

      PRAGMA legacy_alter_table = OFF;
    `
  },
  {
    version: 5,
    name: "presented_citation_coordinates_and_context_references",
    sql: `
      ALTER TABLE messages ADD COLUMN presentation_profile TEXT
        CHECK (
          presentation_profile IN (
            'helpdesk_detailed',
            'live_assist_quick'
          )
        );

      ALTER TABLE message_citations ADD COLUMN claim_id TEXT;
      ALTER TABLE message_citations ADD COLUMN evidence_id TEXT;
      ALTER TABLE message_citations ADD COLUMN span_id TEXT;
      ALTER TABLE message_citations ADD COLUMN supporting_span_ids_json TEXT
        NOT NULL DEFAULT '[]';
      ALTER TABLE message_citations ADD COLUMN document_id TEXT;

      CREATE TABLE message_context_references (
        message_id TEXT NOT NULL,
        context_block_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        source_title TEXT NOT NULL CHECK (length(trim(source_title)) > 0),
        canonical_url TEXT NOT NULL CHECK (
          canonical_url LIKE 'https://learn.microsoft.com/%'
        ),
        source_id TEXT NOT NULL,
        authority_role TEXT NOT NULL,
        heading_path_json TEXT NOT NULL,
        section_id TEXT NOT NULL,
        source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
        source_end_offset INTEGER NOT NULL CHECK (
          source_end_offset > source_start_offset
        ),
        source_content_hash TEXT NOT NULL,
        context_type TEXT NOT NULL,
        preview INTEGER NOT NULL CHECK (preview IN (0, 1)),
        grounding_snapshot_id TEXT NOT NULL,
        PRIMARY KEY (message_id, context_block_id),
        FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
        FOREIGN KEY (grounding_snapshot_id)
          REFERENCES grounding_snapshot_refs(snapshot_id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_message_context_references_message
        ON message_context_references(message_id, context_block_id);
    `
  }
];
