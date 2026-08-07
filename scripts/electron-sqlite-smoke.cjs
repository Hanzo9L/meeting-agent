const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { app } = require("electron");
const Database = require("better-sqlite3");

function run() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-agent-electron-sqlite-"));
  const dbPath = path.join(baseDir, "smoke.sqlite");
  const db = new Database(dbPath);

  try {
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS smoke (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO smoke (id, value) VALUES (?, ?)").run("smoke-1", "ok");
    const row = db.prepare("SELECT value FROM smoke WHERE id = ?").get("smoke-1");
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          electronVersion: process.versions.electron ?? null,
          nodeVersion: process.versions.node,
          dbPath,
          value: row ? row.value : null
        },
        null,
        2
      )}\n`
    );
  } finally {
    db.close();
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
    app.quit();
  }
}

app.whenReady().then(run);
