import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEvaluationDataset } from "../harness/dataset";

test("loads and validates the seed dataset schema", async () => {
  const dataset = await loadEvaluationDataset("eval/datasets/teams-admin-powershell.seed.jsonl");
  assert.ok(dataset.length >= 1);
  const ids = dataset.map((item) => item.questionId);
  assert.equal(new Set(ids).size, ids.length, "question IDs must be unique");
  assert.ok(ids.includes("Q-001"), "vertical-slice question ID should exist");
});

test("rejects duplicate question IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meeting-agent-eval-"));
  const filePath = join(dir, "dup.jsonl");
  const line =
    '{"schemaVersion":"1.0","questionId":"Q-001","question":"Q?","expectedDomain":"teams_admin","expectedIntent":"procedural","expectedSourceDomains":["teams_admin"],"requiredConcepts":[],"prohibitedClaims":[],"knownSourceHints":[],"evaluationNotes":""}';
  await writeFile(filePath, `${line}\n${line}\n`, "utf8");
  await assert.rejects(
    () => loadEvaluationDataset(filePath),
    /duplicate questionId/i
  );
});

