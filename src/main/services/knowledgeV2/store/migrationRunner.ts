import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

interface SqliteConnection {
  pragma(source: string): unknown;
  exec(source: string): this;
  prepare(source: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void;
}

type MigrationFile = {
  version: number;
  name: string;
  path: string;
};

function parseMigrationFilename(filename: string): MigrationFile {
  const match = filename.match(/^(\d+)_([\w.-]+)\.sql$/i);
  if (!match) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }
  const version = Number(match[1]);
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(`Invalid migration version in: ${filename}`);
  }
  return {
    version,
    name: basename(filename, ".sql"),
    path: filename
  };
}

function loadMigrationFiles(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(migrationsDir)
    .filter((entry) => entry.toLowerCase().endsWith(".sql"))
    .map(parseMigrationFilename)
    .sort((a, b) => a.version - b.version);
  return files.map((entry) => ({ ...entry, path: join(migrationsDir, entry.path) }));
}

export function runMigrations(db: SqliteConnection, migrationsDir: string): void {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));
  const migrationFiles = loadMigrationFiles(migrationsDir);

  const applyMigration = db.transaction((migration: MigrationFile) => {
    const sql = readFileSync(migration.path, "utf8");
    db.exec(sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    ).run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrationFiles) {
    if (applied.has(migration.version)) continue;
    applyMigration(migration);
  }
}

export function getSchemaVersion(db: SqliteConnection): number {
  const row = db.prepare("SELECT MAX(version) as version FROM schema_migrations").get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}
