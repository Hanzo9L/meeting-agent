import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("overlay interview turns are GPT-style user bubbles plus independent evidence cards", () => {
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  assert.match(overlay, /className="interviewTurn"/);
  assert.match(overlay, /className="userBubble"/);
  assert.match(overlay, /className=\{`answerCard/);
  assert.match(overlay, /key=\{item\.answerRunId\}/);
  assert.match(overlay, /data-answer-run-id=\{item\.answerRunId\}/);
  assert.match(overlay, /data-user-message-id=\{item\.userMessageId\}/);
  assert.match(overlay, /data-turn-anchor=\{item\.userMessageId\}/);
  assert.match(overlay, /useNewestTurnFocus/);
  assert.doesNotMatch(overlay, /block:\s*"end"/);
  assert.doesNotMatch(overlay, /feedEndRef/);
  assert.doesNotMatch(overlay, /scrollIntoView/);
  assert.match(overlay, /Relay Quick/);
  assert.match(overlay, /Preparing evidence\.\.\./);
  assert.match(overlay, /Evidence ready/);
  assert.match(overlay, /Evidence unavailable/);
  assert.match(overlay, /overlayEvidencePublisher/);
  assert.match(overlay, /formatEvidenceSourceRoleLabel/);
  assert.match(overlay, /excerptOverlayPreview/);
  assert.match(overlay, /Evidence retrieval failed\./);
  assert.match(overlay, /PERSONAL_RESPONSE_HEADING/);
  assert.match(overlay, /overlayPersonal/);
  assert.match(overlay, /data-response-mode/);
  assert.match(overlay, /SUPPORTING_EVIDENCE_HEADING/);
  assert.doesNotMatch(overlay, /Best answer|AI answer|Recommended answer/);
  assert.doesNotMatch(overlay, /sessionId\}:\$\{item\.question/);
});

test("overlay and Helpdesk share listEvidenceCardSources for authority presentation", () => {
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  const helpdesk = readFileSync(resolve("src/renderer/helpdesk/App.tsx"), "utf8");
  assert.match(overlay, /listEvidenceCardSources\(parsed\.payload\)/);
  assert.match(helpdesk, /listEvidenceCardSources\(payload\)/);
  assert.doesNotMatch(overlay, /orderEvidenceByAuthority|orderEvidenceForPresentation/);
  assert.doesNotMatch(helpdesk, /orderEvidenceByAuthority|orderEvidenceForPresentation/);
});
