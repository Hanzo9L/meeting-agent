import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createKnowledgeV2SqliteStore } from "./sqliteStore";
import { resolveKnowledgeV2DatabasePath } from "./dbPaths";

function parseArg(name: string): string | null {
  const index = process.argv.findIndex((value) => value === name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function removeIfExists(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

function main(): void {
  const explicitPath = parseArg("--db");
  const dbPath =
    explicitPath && explicitPath.trim()
      ? resolve(explicitPath)
      : resolveKnowledgeV2DatabasePath({
          cwd: process.cwd()
        });

  removeIfExists(dbPath);
  removeIfExists(`${dbPath}-wal`);
  removeIfExists(`${dbPath}-shm`);

  const migrationsDir = join(dirname(import.meta.filename), "migrations");
  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir
  });

  try {
    store.initializeDatabase();
    const report = store.inspect();
    process.stdout.write(
      `${JSON.stringify({ reset: true, databasePath: dbPath, schemaVersion: report.schemaVersion }, null, 2)}\n`
    );
  } finally {
    store.close();
  }
}

main();
