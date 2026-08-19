import Database from "better-sqlite3";

const dbPath =
  process.argv[2] ??
  `${process.env.APPDATA}\\meeting-agent\\conversations\\conversations.sqlite`;
const conversationId = process.argv[3];
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const messages = db
  .prepare(
    `SELECT message_id, turn_index, role, content, input_origin, capture_source,
            answerability, created_at
     FROM messages
     WHERE conversation_id = ?
     ORDER BY turn_index ASC`
  )
  .all(conversationId);

const runs = db
  .prepare(
    `SELECT answer_run_id, triggering_user_message_id, assistant_message_id,
            state, failure_code, created_at, started_at, completed_at
     FROM answer_runs
     WHERE conversation_id = ?
     ORDER BY created_at ASC`
  )
  .all(conversationId);

const citations = db
  .prepare(
    `SELECT mc.message_id, mc.source_title, mc.canonical_url, mc.authority_role
     FROM message_citations mc
     JOIN messages m ON m.message_id = mc.message_id
     WHERE m.conversation_id = ?
     ORDER BY mc.message_id, mc.citation_id`
  )
  .all(conversationId);

process.stdout.write(
  `${JSON.stringify({ dbPath, conversationId, messages, runs, citations }, null, 2)}\n`
);
db.close();
