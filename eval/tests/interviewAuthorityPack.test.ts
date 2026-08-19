import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  loadInterviewDataset,
  loadSelectedMicrosoftPackUrls
} from "../harness/interviewAuthorityPack";

test("I2 consumes the fixed 72-reference I1 manifest without expanding it", () => {
  const selected = loadSelectedMicrosoftPackUrls();
  assert.equal(
    [...selected.values()].reduce(
      (total, urls) => total + urls.length,
      0
    ),
    72
  );
  assert.deepEqual(
    Object.fromEntries(
      [...selected.entries()].map(([packId, urls]) => [
        packId,
        urls.length
      ])
    ),
    {
      teams_voice_direct_routing: 15,
      call_quality_troubleshooting: 7,
      auto_attendants_call_queues: 8,
      teams_rooms: 15,
      teams_powershell_interview_subset: 12,
      sharepoint_onedrive_copilot_governance: 9,
      entra_identity_support: 6
    }
  );
});

test("I2 pack-only harness stays bounded and reports fallback explicitly", () => {
  const harness = readFileSync(
    resolve("eval/harness/runInterviewI2Validation.ts"),
    "utf8"
  );
  assert.match(harness, /presentationSynthesis: "disabled"/);
  assert.match(harness, /eligibleDocumentIds/);
  assert.match(harness, /broadCorpusFallback/);
  assert.match(harness, /broadFallbackCount/);
  assert.doesNotMatch(harness, /Learn MCP|learnMcp/);
});

test("I2 validation input remains the 39 tagged I1 questions", () => {
  const questions = loadInterviewDataset();
  assert.equal(questions.length, 39);
  assert.equal(new Set(questions.map((item) => item.questionId)).size, 39);
  assert.ok(
    questions.every(
      (item) =>
        item.interviewTopic &&
        item.expectedAuthorityPack &&
        item.liveQuickTargetWords > 0
    )
  );
});
