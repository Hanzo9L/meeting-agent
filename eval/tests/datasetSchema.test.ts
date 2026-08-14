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

test("loads and validates the Entra K1 evaluation set", async () => {
  const dataset = await loadEvaluationDataset("eval/datasets/entra-qa-k1.jsonl");
  assert.equal(dataset.length, 7);
  assert.equal(dataset[0]?.expectedDomain, "entra");
  assert.equal(dataset[5]?.expectedDomain, "unknown");
  assert.equal(dataset[6]?.expectedDomain, "teams_admin");
  assert.ok(dataset[5]?.evaluationNotes.includes("insufficient_evidence"));
});

test("loads and validates the SharePoint K2 evaluation set", async () => {
  const dataset = await loadEvaluationDataset("eval/datasets/sharepoint-qa-k2.jsonl");
  assert.equal(dataset.length, 10);
  assert.equal(dataset[0]?.expectedDomain, "sharepoint");
  assert.ok(dataset[0]?.question.includes("Copilot users"));
  assert.equal(dataset[6]?.expectedDomain, "sharepoint");
  assert.ok(dataset[6]?.question.includes("Set-SPOSite"), "cmdlet question should be present");
  assert.equal(dataset[7]?.expectedDomain, "teams_admin");
  assert.equal(dataset[8]?.expectedDomain, "entra");
  assert.equal(dataset[9]?.expectedDomain, "unknown");
  assert.ok(dataset[9]?.evaluationNotes.includes("insufficient_evidence"));
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

