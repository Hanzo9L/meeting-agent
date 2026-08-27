import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("overlay renderer uses the shared in-place projection feed", () => {
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  assert.match(overlay, /from "@shared\/projectionFeed"/);
  assert.match(overlay, /updateProjectionFeed\(current, projection\)/);
  assert.match(overlay, /key=\{item\.answerRunId\}/);
  assert.doesNotMatch(overlay, /key=\{index\}/);
  assert.doesNotMatch(overlay, /sessionId\}:\$\{item\.question/);
});
