import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  getConversationSchemaVersion,
  runConversationMigrations
} from "./migrationRunner";
import type {
  AnswerRunRecord,
  AnswerRunState,
  AppendGroundedAssistantMessageInput,
  AppendUserMessageInput,
  CompletedAnswerRun,
  ContextResolutionRecord,
  ConversationMessage,
  ConversationRecord,
  ConversationStore,
  CreateAnswerRunInput,
  CreateConversationInput,
  GroundingSnapshotReference,
  SaveContextResolutionInput,
  UpdateAnswerRunInput
} from "./types";

type SqliteDatabase = Database.Database;

export interface SqliteConversationStoreOptions {
  databasePath: string;
  now?: () => string;
}

type ConversationRow = {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type MessageRow = {
  message_id: string;
  conversation_id: string;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  input_origin: "typed" | "pasted" | "live_transcript" | null;
  answerability: "answered" | "partial" | null;
  grounding_snapshot_id: string | null;
  created_at: string;
};

type AnswerRunRow = {
  answer_run_id: string;
  conversation_id: string;
  triggering_user_message_id: string;
  assistant_message_id: string | null;
  grounding_snapshot_id: string | null;
  state: AnswerRunState;
  failure_code: string | null;
  failure_details_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type ContextResolutionRow = {
  context_resolution_id: string;
  source_user_message_id: string;
  original_text: string;
  resolved_question: string;
  created_at: string;
};

type SnapshotReferenceRow = {
  snapshot_id: string;
  snapshot_hash: string;
  schema_version: string;
  resolver_policy_version: string;
  corpus_revision_hash: string;
  created_at: string;
};

const ACTIVE_STATES: readonly AnswerRunState[] = [
  "received",
  "resolving_context",
  "retrieving",
  "planning",
  "executing_answer",
  "validating"
];

const ACTIVE_STATE_ORDER = new Map(ACTIVE_STATES.map((state, index) => [state, index]));

function newId(prefix: "conv" | "msg" | "run" | "ctx"): string {
  return `${prefix}_${randomUUID()}`;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }
  return normalized;
}

function toJson(value: Record<string, unknown> | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function fromJson(value: string | null): Record<string, unknown> | null {
  return value === null ? null : (JSON.parse(value) as Record<string, unknown>);
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.conversation_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.message_id,
    conversationId: row.conversation_id,
    turnIndex: row.turn_index,
    role: row.role,
    content: row.content,
    inputOrigin: row.input_origin,
    answerability: row.answerability,
    groundingSnapshotId: row.grounding_snapshot_id,
    createdAt: row.created_at
  };
}

function mapAnswerRun(row: AnswerRunRow): AnswerRunRecord {
  return {
    id: row.answer_run_id,
    conversationId: row.conversation_id,
    triggeringUserMessageId: row.triggering_user_message_id,
    assistantMessageId: row.assistant_message_id,
    groundingSnapshotId: row.grounding_snapshot_id,
    state: row.state,
    failureCode: row.failure_code,
    failureDetails: fromJson(row.failure_details_json),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export class SqliteConversationStore implements ConversationStore {
  readonly databasePath: string;
  private readonly db: SqliteDatabase;
  private readonly now: () => string;

  constructor(options: SqliteConversationStoreOptions) {
    this.databasePath = resolve(options.databasePath);
    this.now = options.now ?? (() => new Date().toISOString());
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new Database(this.databasePath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    runConversationMigrations(this.db, this.now);
    this.recoverInterruptedAnswerRuns();
  }

  createConversation(input: CreateConversationInput = {}): ConversationRecord {
    const timestamp = this.now();
    const id = newId("conv");
    const title = requiredText(input.title ?? "New conversation", "conversation title");
    this.db
      .prepare(
        `INSERT INTO conversations (
          conversation_id, title, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, NULL)`
      )
      .run(id, title, timestamp, timestamp);
    return this.requireConversation(id);
  }

  listConversations(): ConversationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM conversations
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, created_at DESC, conversation_id ASC`
      )
      .all() as ConversationRow[];
    return rows.map(mapConversation);
  }

  getConversation(conversationId: string): ConversationRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM conversations
         WHERE conversation_id = ? AND deleted_at IS NULL`
      )
      .get(conversationId) as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }

  renameConversation(conversationId: string, title: string): ConversationRecord {
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET title = ?, updated_at = ?
         WHERE conversation_id = ? AND deleted_at IS NULL`
      )
      .run(requiredText(title, "conversation title"), this.now(), conversationId);
    if (result.changes !== 1) {
      throw new Error(`Active conversation not found: ${conversationId}`);
    }
    return this.requireConversation(conversationId);
  }

  deleteConversation(conversationId: string): boolean {
    return this.db.transaction(() => {
      const timestamp = this.now();
      const result = this.db
        .prepare(
          `UPDATE conversations
           SET deleted_at = ?, updated_at = ?
           WHERE conversation_id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, conversationId);
      if (result.changes !== 1) return false;

      this.failActiveRunsForConversation(
        conversationId,
        timestamp,
        "conversation_deleted",
        { reason: "Conversation was deleted before answer completion." }
      );
      return true;
    }).immediate();
  }

  clearHistory(): number {
    return this.db.transaction(() => {
      const timestamp = this.now();
      const active = this.db
        .prepare("SELECT conversation_id FROM conversations WHERE deleted_at IS NULL")
        .all() as Array<{ conversation_id: string }>;
      for (const row of active) {
        this.failActiveRunsForConversation(
          row.conversation_id,
          timestamp,
          "history_cleared",
          { reason: "Conversation history was cleared before answer completion." }
        );
      }
      return this.db
        .prepare(
          `UPDATE conversations
           SET deleted_at = ?, updated_at = ?
           WHERE deleted_at IS NULL`
        )
        .run(timestamp, timestamp).changes;
    }).immediate();
  }

  appendUserMessage(input: AppendUserMessageInput): ConversationMessage {
    return this.db.transaction(() => {
      this.requireConversation(input.conversationId);
      const timestamp = this.now();
      const messageId = newId("msg");
      const turnIndex = this.nextTurnIndex(input.conversationId);
      this.db
        .prepare(
          `INSERT INTO messages (
            message_id,
            conversation_id,
            turn_index,
            role,
            content,
            input_origin,
            answerability,
            grounding_snapshot_id,
            created_at
          ) VALUES (?, ?, ?, 'user', ?, ?, NULL, NULL, ?)`
        )
        .run(
          messageId,
          input.conversationId,
          turnIndex,
          requiredText(input.content, "message content"),
          input.inputOrigin,
          timestamp
        );
      this.touchConversation(input.conversationId, timestamp);
      return this.requireMessage(messageId);
    }).immediate();
  }

  appendGroundedAssistantMessage(
    input: AppendGroundedAssistantMessageInput
  ): CompletedAnswerRun {
    return this.db.transaction(() => {
      const run = this.requireAnswerRun(input.answerRunId);
      if (run.state !== "validating") {
        throw new Error(
          `Answer run ${run.id} must be validating before grounded completion; current state is ${run.state}`
        );
      }
      if (run.assistantMessageId !== null) {
        throw new Error(`Answer run ${run.id} already has an assistant message`);
      }
      if (
        run.groundingSnapshotId !== null &&
        run.groundingSnapshotId !== input.snapshot.snapshotId
      ) {
        throw new Error(
          `Answer run ${run.id} is bound to a different grounding snapshot`
        );
      }
      this.requireConversation(run.conversationId);
      const userMessage = this.requireMessage(run.triggeringUserMessageId);
      if (userMessage.role !== "user" || userMessage.conversationId !== run.conversationId) {
        throw new Error(`Answer run ${run.id} does not reference a valid user message`);
      }

      const timestamp = this.now();
      this.ensureSnapshotReference(input.snapshot);
      const messageId = newId("msg");
      const turnIndex = this.nextTurnIndex(run.conversationId);
      this.db
        .prepare(
          `INSERT INTO messages (
            message_id,
            conversation_id,
            turn_index,
            role,
            content,
            input_origin,
            answerability,
            grounding_snapshot_id,
            created_at
          ) VALUES (?, ?, ?, 'assistant', ?, NULL, ?, ?, ?)`
        )
        .run(
          messageId,
          run.conversationId,
          turnIndex,
          requiredText(input.content, "assistant message content"),
          input.answerability,
          input.snapshot.snapshotId,
          timestamp
        );

      const finalState: AnswerRunState =
        input.answerability === "partial" ? "partial" : "completed";
      const updated = this.db
        .prepare(
          `UPDATE answer_runs
           SET assistant_message_id = ?,
               grounding_snapshot_id = ?,
               state = ?,
               failure_code = NULL,
               failure_details_json = NULL,
               completed_at = ?
           WHERE answer_run_id = ?
             AND state = 'validating'
             AND assistant_message_id IS NULL`
        )
        .run(
          messageId,
          input.snapshot.snapshotId,
          finalState,
          timestamp,
          input.answerRunId
        );
      if (updated.changes !== 1) {
        throw new Error(`Answer run completion lost its validating-state precondition: ${run.id}`);
      }
      this.touchConversation(run.conversationId, timestamp);

      return {
        message: this.requireMessage(messageId),
        answerRun: this.requireAnswerRun(run.id)
      };
    }).immediate();
  }

  loadOrderedMessages(conversationId: string): ConversationMessage[] {
    if (!this.getConversation(conversationId)) return [];
    const rows = this.db
      .prepare(
        `SELECT *
         FROM messages
         WHERE conversation_id = ?
         ORDER BY turn_index ASC`
      )
      .all(conversationId) as MessageRow[];
    return rows.map(mapMessage);
  }

  createAnswerRun(input: CreateAnswerRunInput): AnswerRunRecord {
    return this.db.transaction(() => {
      this.requireConversation(input.conversationId);
      const message = this.requireMessage(input.triggeringUserMessageId);
      if (message.conversationId !== input.conversationId || message.role !== "user") {
        throw new Error("Answer runs must be triggered by a user message in the same conversation");
      }
      const id = newId("run");
      this.db
        .prepare(
          `INSERT INTO answer_runs (
            answer_run_id,
            conversation_id,
            triggering_user_message_id,
            assistant_message_id,
            grounding_snapshot_id,
            state,
            failure_code,
            failure_details_json,
            created_at,
            started_at,
            completed_at
          ) VALUES (?, ?, ?, NULL, NULL, 'received', NULL, NULL, ?, NULL, NULL)`
        )
        .run(id, input.conversationId, input.triggeringUserMessageId, this.now());
      return this.requireAnswerRun(id);
    }).immediate();
  }

  updateAnswerRun(input: UpdateAnswerRunInput): AnswerRunRecord {
    return this.db.transaction(() => {
      const run = this.requireAnswerRun(input.answerRunId);
      this.requireConversation(run.conversationId);
      if (!ACTIVE_STATE_ORDER.has(run.state)) {
        throw new Error(`Terminal answer run cannot transition: ${run.id} (${run.state})`);
      }

      const timestamp = this.now();
      const targetOrder = ACTIVE_STATE_ORDER.get(input.state);
      const currentOrder = ACTIVE_STATE_ORDER.get(run.state);
      const snapshotId = this.resolveRunSnapshotId(run, input.snapshot);
      if (targetOrder !== undefined) {
        if (currentOrder === undefined || targetOrder <= currentOrder) {
          throw new Error(`Invalid answer run transition: ${run.state} -> ${input.state}`);
        }
        this.db
          .prepare(
            `UPDATE answer_runs
             SET state = ?,
                 grounding_snapshot_id = ?,
                 started_at = COALESCE(started_at, ?)
             WHERE answer_run_id = ?`
          )
          .run(input.state, snapshotId, timestamp, run.id);
      } else {
        if (input.state !== "failed" && input.state !== "cancelled") {
          throw new Error(`Answer run terminal state requires grounded completion: ${input.state}`);
        }
        this.db
          .prepare(
            `UPDATE answer_runs
             SET state = ?,
                 grounding_snapshot_id = ?,
                 failure_code = ?,
                 failure_details_json = ?,
                 started_at = COALESCE(started_at, ?),
                 completed_at = ?
             WHERE answer_run_id = ? AND assistant_message_id IS NULL`
          )
          .run(
            input.state,
            snapshotId,
            input.failureCode ?? (input.state === "cancelled" ? "cancelled" : "answer_failed"),
            toJson(input.failureDetails),
            timestamp,
            timestamp,
            run.id
          );
      }
      return this.requireAnswerRun(run.id);
    }).immediate();
  }

  getAnswerRun(answerRunId: string): AnswerRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT ar.*
         FROM answer_runs ar
         JOIN conversations c ON c.conversation_id = ar.conversation_id
         WHERE ar.answer_run_id = ? AND c.deleted_at IS NULL`
      )
      .get(answerRunId) as AnswerRunRow | undefined;
    return row ? mapAnswerRun(row) : null;
  }

  saveContextResolution(input: SaveContextResolutionInput): ContextResolutionRecord {
    return this.db.transaction(() => {
      const source = this.requireMessage(input.sourceUserMessageId);
      if (source.role !== "user") {
        throw new Error("Context resolution source must be a user message");
      }
      this.requireConversation(source.conversationId);
      if (source.content !== input.originalText) {
        throw new Error("Context resolution original text must match the persisted user message");
      }

      const priorIds = [...new Set(input.priorMessageIds)];
      if (priorIds.length !== input.priorMessageIds.length) {
        throw new Error("Context resolution prior-message references must be unique");
      }
      for (const priorId of priorIds) {
        const prior = this.requireMessage(priorId);
        if (
          prior.conversationId !== source.conversationId ||
          prior.turnIndex >= source.turnIndex
        ) {
          throw new Error(
            "Context resolution may reference only earlier messages in the same conversation"
          );
        }
      }

      const existing = this.db
        .prepare(
          `SELECT context_resolution_id
           FROM context_resolutions
           WHERE source_user_message_id = ?`
        )
        .get(source.id) as { context_resolution_id: string } | undefined;
      const id = existing?.context_resolution_id ?? newId("ctx");
      const timestamp = this.now();
      if (existing) {
        this.db
          .prepare(
            `UPDATE context_resolutions
             SET original_text = ?, resolved_question = ?, created_at = ?
             WHERE context_resolution_id = ?`
          )
          .run(
            input.originalText,
            requiredText(input.resolvedQuestion, "resolved question"),
            timestamp,
            id
          );
        this.db
          .prepare(
            "DELETE FROM context_resolution_prior_messages WHERE context_resolution_id = ?"
          )
          .run(id);
      } else {
        this.db
          .prepare(
            `INSERT INTO context_resolutions (
              context_resolution_id,
              source_user_message_id,
              original_text,
              resolved_question,
              created_at
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            id,
            source.id,
            input.originalText,
            requiredText(input.resolvedQuestion, "resolved question"),
            timestamp
          );
      }

      const insertReference = this.db.prepare(
        `INSERT INTO context_resolution_prior_messages (
          context_resolution_id, reference_order, prior_message_id
        ) VALUES (?, ?, ?)`
      );
      priorIds.forEach((priorMessageId, index) => {
        insertReference.run(id, index, priorMessageId);
      });
      return this.requireContextResolution(source.id);
    }).immediate();
  }

  getContextResolution(sourceUserMessageId: string): ContextResolutionRecord | null {
    const source = this.db
      .prepare(
        `SELECT m.message_id
         FROM messages m
         JOIN conversations c ON c.conversation_id = m.conversation_id
         WHERE m.message_id = ? AND c.deleted_at IS NULL`
      )
      .get(sourceUserMessageId) as { message_id: string } | undefined;
    return source ? this.requireContextResolution(source.message_id) : null;
  }

  recoverInterruptedAnswerRuns(): number {
    const timestamp = this.now();
    const placeholders = ACTIVE_STATES.map(() => "?").join(", ");
    return this.db
      .prepare(
        `UPDATE answer_runs
         SET state = 'failed',
             failure_code = 'interrupted',
             failure_details_json = ?,
             started_at = COALESCE(started_at, created_at),
             completed_at = ?
         WHERE state IN (${placeholders}) AND assistant_message_id IS NULL`
      )
      .run(
        JSON.stringify({ reason: "Application stopped before answer completion." }),
        timestamp,
        ...ACTIVE_STATES
      ).changes;
  }

  getSchemaVersion(): number {
    return getConversationSchemaVersion(this.db);
  }

  close(): void {
    this.db.close();
  }

  private requireConversation(conversationId: string): ConversationRecord {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Active conversation not found: ${conversationId}`);
    }
    return conversation;
  }

  private requireMessage(messageId: string): ConversationMessage {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE message_id = ?")
      .get(messageId) as MessageRow | undefined;
    if (!row) throw new Error(`Message not found: ${messageId}`);
    return mapMessage(row);
  }

  private requireAnswerRun(answerRunId: string): AnswerRunRecord {
    const row = this.db
      .prepare("SELECT * FROM answer_runs WHERE answer_run_id = ?")
      .get(answerRunId) as AnswerRunRow | undefined;
    if (!row) throw new Error(`Answer run not found: ${answerRunId}`);
    return mapAnswerRun(row);
  }

  private requireContextResolution(sourceUserMessageId: string): ContextResolutionRecord {
    const row = this.db
      .prepare(
        `SELECT *
         FROM context_resolutions
         WHERE source_user_message_id = ?`
      )
      .get(sourceUserMessageId) as ContextResolutionRow | undefined;
    if (!row) {
      throw new Error(`Context resolution not found for message: ${sourceUserMessageId}`);
    }
    const refs = this.db
      .prepare(
        `SELECT prior_message_id
         FROM context_resolution_prior_messages
         WHERE context_resolution_id = ?
         ORDER BY reference_order ASC`
      )
      .all(row.context_resolution_id) as Array<{ prior_message_id: string }>;
    return {
      id: row.context_resolution_id,
      sourceUserMessageId: row.source_user_message_id,
      originalText: row.original_text,
      resolvedQuestion: row.resolved_question,
      priorMessageIds: refs.map((ref) => ref.prior_message_id),
      createdAt: row.created_at
    };
  }

  private nextTurnIndex(conversationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn
         FROM messages
         WHERE conversation_id = ?`
      )
      .get(conversationId) as { next_turn: number };
    return row.next_turn;
  }

  private touchConversation(conversationId: string, timestamp: string): void {
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET updated_at = ?
         WHERE conversation_id = ? AND deleted_at IS NULL`
      )
      .run(timestamp, conversationId);
    if (result.changes !== 1) {
      throw new Error(`Active conversation not found: ${conversationId}`);
    }
  }

  private resolveRunSnapshotId(
    run: AnswerRunRecord,
    snapshot: UpdateAnswerRunInput["snapshot"]
  ): string | null {
    if (!snapshot) return run.groundingSnapshotId;
    if (
      run.groundingSnapshotId !== null &&
      run.groundingSnapshotId !== snapshot.snapshotId
    ) {
      throw new Error(`Answer run ${run.id} is bound to a different grounding snapshot`);
    }
    this.ensureSnapshotReference(snapshot);
    return snapshot.snapshotId;
  }

  private ensureSnapshotReference(
    snapshot: AppendGroundedAssistantMessageInput["snapshot"]
  ): GroundingSnapshotReference {
    const row = this.db
      .prepare("SELECT * FROM grounding_snapshot_refs WHERE snapshot_id = ?")
      .get(snapshot.snapshotId) as SnapshotReferenceRow | undefined;
    if (row) {
      const matches =
        row.snapshot_hash === snapshot.snapshotHash &&
        row.schema_version === snapshot.schemaVersion &&
        row.resolver_policy_version === snapshot.resolverPolicyVersion &&
        row.corpus_revision_hash === snapshot.corpusRevisionHash &&
        row.created_at === snapshot.createdAt;
      if (!matches) {
        throw new Error(
          `Grounding snapshot identity conflict for ${snapshot.snapshotId}`
        );
      }
      return {
        snapshotId: row.snapshot_id,
        snapshotHash: row.snapshot_hash,
        schemaVersion: row.schema_version,
        resolverPolicyVersion: row.resolver_policy_version,
        corpusRevisionHash: row.corpus_revision_hash,
        createdAt: row.created_at
      };
    }

    this.db
      .prepare(
        `INSERT INTO grounding_snapshot_refs (
          snapshot_id,
          snapshot_hash,
          schema_version,
          resolver_policy_version,
          corpus_revision_hash,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        requiredText(snapshot.snapshotId, "snapshot ID"),
        requiredText(snapshot.snapshotHash, "snapshot hash"),
        requiredText(snapshot.schemaVersion, "snapshot schema version"),
        requiredText(snapshot.resolverPolicyVersion, "resolver policy version"),
        requiredText(snapshot.corpusRevisionHash, "corpus revision hash"),
        requiredText(snapshot.createdAt, "snapshot creation time")
      );
    return snapshot;
  }

  private failActiveRunsForConversation(
    conversationId: string,
    timestamp: string,
    failureCode: string,
    details: Record<string, unknown>
  ): number {
    const placeholders = ACTIVE_STATES.map(() => "?").join(", ");
    return this.db
      .prepare(
        `UPDATE answer_runs
         SET state = 'cancelled',
             failure_code = ?,
             failure_details_json = ?,
             started_at = COALESCE(started_at, created_at),
             completed_at = ?
         WHERE conversation_id = ?
           AND state IN (${placeholders})
           AND assistant_message_id IS NULL`
      )
      .run(
        failureCode,
        JSON.stringify(details),
        timestamp,
        conversationId,
        ...ACTIVE_STATES
      ).changes;
  }
}

export function createSqliteConversationStore(
  options: SqliteConversationStoreOptions
): SqliteConversationStore {
  return new SqliteConversationStore(options);
}
