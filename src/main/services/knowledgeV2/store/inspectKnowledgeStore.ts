import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createKnowledgeV2SqliteStore } from "./sqliteStore";
import { resolveKnowledgeV2DatabasePath } from "./dbPaths";

function parseArg(name: string): string | null {
  const index = process.argv.findIndex((value) => value === name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function main(): void {
  const explicitPath = parseArg("--db");
  const dbPath =
    explicitPath && explicitPath.trim()
      ? resolve(explicitPath)
      : resolveKnowledgeV2DatabasePath({
          cwd: process.cwd()
        });
  const migrationsDir = join(dirname(import.meta.filename), "migrations");

  if (!existsSync(dbPath)) {
    process.stdout.write(
      JSON.stringify(
        {
          databasePath: dbPath,
          exists: false,
          note: "Database file does not exist yet."
        },
        null,
        2
      )
    );
    process.stdout.write("\n");
    return;
  }

  const store = createKnowledgeV2SqliteStore({
    databasePath: dbPath,
    migrationsDir
  });

  try {
    store.initializeDatabase();
    const report = store.inspect();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    store.close();
  }
}

main();
