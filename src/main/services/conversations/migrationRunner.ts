import type Database from "better-sqlite3";
import { CONVERSATION_MIGRATIONS } from "./migrations";

type SqliteDatabase = Database.Database;

export function runConversationMigrations(
  db: SqliteDatabase,
  now: () => string
): void {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string }>;
  const applied = new Map(appliedRows.map((row) => [row.version, row.name]));

  for (const migration of [...CONVERSATION_MIGRATIONS].sort(
    (left, right) => left.version - right.version
  )) {
    const appliedName = applied.get(migration.version);
    if (appliedName !== undefined) {
      if (appliedName !== migration.name) {
        throw new Error(
          `Conversation migration ${migration.version} name mismatch: ${appliedName}`
        );
      }
      continue;
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, now());
    }).immediate();
  }
}

export function getConversationSchemaVersion(db: SqliteDatabase): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}
