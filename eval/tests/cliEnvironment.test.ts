import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCliEnvironment } from "../harness/cliEnvironment";

test("CLI environment bootstrap loads an available credential without logging it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-agent-cli-env-"));
  const envPath = join(directory, ".env");
  const previous = process.env["OPENAI_API_KEY"];
  const sentinel = "test-credential-not-a-secret";
  writeFileSync(envPath, `OPENAI_API_KEY=${sentinel}\n`, "utf8");

  try {
    delete process.env["OPENAI_API_KEY"];
    loadCliEnvironment(envPath);
    assert.equal(process.env["OPENAI_API_KEY"], sentinel);
  } finally {
    if (previous === undefined) {
      delete process.env["OPENAI_API_KEY"];
    } else {
      process.env["OPENAI_API_KEY"] = previous;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
