import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const source = (relativePath: string) =>
  readFile(resolve(root, relativePath), "utf8");

test("normal startup owns one primary Relay window and single-instance focus", async () => {
  const main = await source("src/main/index.ts");
  const initialize = main.match(
    /async function initializeRelay[\s\S]*?\n\}/
  )?.[0];
  assert.ok(initialize);

  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\("second-instance"/);
  assert.match(main, /loadHelpdeskWindow\(\)/);
  assert.match(initialize, /loadHelpdeskWindow\(\)/);
  assert.doesNotMatch(initialize, /showOverlay\(/);
  assert.doesNotMatch(initialize, /createOverlayWindow\(/);
  assert.doesNotMatch(main, /createSettingsWindow|settingsWindow/);
  assert.doesNotMatch(
    main,
    /KnowledgeBaseService|knowledgeBaseService/
  );
});

test("standalone settings renderer and preload are absent from build entries", async () => {
  const config = await source("electron.vite.config.ts");
  assert.doesNotMatch(
    config,
    /settingsPreload|renderer\/settings|settings:\s*resolve/
  );
});

test("primary renderer owns capture without overlay API dependency", async () => {
  const capture = await source(
    "src/renderer/audio-capture/captureLoopbackAudio.ts"
  );
  const helpdesk = await source(
    "src/renderer/helpdesk/App.tsx"
  );
  const overlay = await source(
    "src/renderer/overlay/App.tsx"
  );

  assert.doesNotMatch(capture, /window\.overlayApi/);
  assert.match(capture, /AudioCaptureBridge/);
  assert.match(helpdesk, /startLoopbackCapture/);
  assert.match(helpdesk, /onLiveAssistCaptureCommand/);
  assert.doesNotMatch(overlay, /startLoopbackCapture|startCapture/);
});

test("overlay is lazy, hydratable, and independent from Live Assist stop", async () => {
  const main = await source("src/main/index.ts");
  const overlay = await source(
    "src/renderer/overlay/App.tsx"
  );
  const hideFunction = main.match(
    /function hideOverlay[\s\S]*?\n\}/
  )?.[0];
  const stopCallback = main.match(
    /stopLiveAssist: async \(\) => \{[\s\S]*?\n    \}/
  )?.[0];
  assert.ok(hideFunction);
  assert.ok(stopCallback);

  assert.match(main, /async function showOverlay/);
  assert.match(main, /latestProjection/);
  assert.match(overlay, /getLiveAssistHydration/);
  assert.doesNotMatch(hideFunction, /pipelineManager|liveAssistService/);
  assert.doesNotMatch(stopCallback, /hideOverlay|destroy|close/);
});

test("in-app Settings exposes retained controls without deprecated product UI", async () => {
  const settings = await source(
    "src/renderer/helpdesk/SettingsPage.tsx"
  );
  const preload = await source(
    "src/preload/helpdeskApi.ts"
  );

  assert.match(settings, /Deepgram STT/);
  assert.match(settings, /live question completion\/planning/);
  assert.match(settings, /Capture mode/);
  assert.match(settings, /Question trigger/);
  assert.match(settings, /screen shares/);
  assert.doesNotMatch(
    settings,
    /Topic|prompt template|repository URL|repository branch|manual sync/i
  );
  assert.doesNotMatch(
    preload,
    /deepgramApiKey|openAiApiKey|getSettings/
  );
});

test("Live and QA Assist expose and enforce main-process V2 readiness", async () => {
  const main = await source("src/main/index.ts");
  const helpdesk = await source(
    "src/renderer/helpdesk/App.tsx"
  );

  assert.match(main, /refreshV2Runtime\(\)/);
  assert.match(main, /readiness\.state !== "ready"/);
  assert.match(main, /V2 unavailable:/);
  assert.match(helpdesk, /Question understanding ready/);
  assert.match(helpdesk, /settings\.v2\?\.state !== "ready"/);
  assert.match(helpdesk, /Live and QA Assist remain disabled/);
});

test("Slice 4B.1 adds no TTS or read-aloud path", async () => {
  const files = await Promise.all(
    [
      "src/main/index.ts",
      "src/shared/helpdesk.ts",
      "src/preload/helpdeskApi.ts",
      "src/renderer/helpdesk/App.tsx",
      "src/renderer/helpdesk/SettingsPage.tsx"
    ].map(source)
  );
  assert.doesNotMatch(
    files.join("\n"),
    /\bTTS\b|read[- ]aloud|speechSynthesis|textToSpeech/i
  );
});
