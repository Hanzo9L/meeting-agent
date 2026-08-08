# Conversation Persistence

Slice 1 stores durable helpdesk conversations in a SQLite database that is
separate from Knowledge V2.

## Runtime location

The runtime supplies Electron's `userData` directory to
`resolveConversationDatabasePath`, producing:

`<userData>/conversations/conversations.sqlite`

The `MEETING_AGENT_CONVERSATION_DB_PATH` environment variable is available for
development and test tooling. A workspace-local `.conversations` path is the
non-Electron fallback.

## Persistence boundary

The store owns conversations, ordered messages, answer-run lifecycle state,
context-resolution records, and normalized R1 snapshot identity references.
It does not persist full grounding snapshots, evidence, citations, raw audio,
or raw STT transcript streams.

Only `answered` and `partial` grounded results may create assistant messages.
Failed, cancelled, or interrupted answer runs retain lifecycle metadata but no
factual assistant content.

## Recovery

Opening the store changes any nonterminal answer run to `failed` with failure
code `interrupted`. Assistant-message insertion and successful answer-run
completion occur in one immediate transaction.

## Deletion and retention

Conversation deletion and clear-history use logical deletion. Deleted
conversations are excluded from product-facing store queries, and any active
answer runs are cancelled. Rows remain in SQLite for recovery and schema
integrity.

Logical deletion is not secure erasure. SQLite pages, WAL files, filesystem
snapshots, and backups may retain prior bytes. Slice 1 does not claim physical
secure deletion and does not implement enterprise wipe or retention policy.
