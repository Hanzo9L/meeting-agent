import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import {
  AUTO_SOURCE_LABEL,
  DEVICE_CHANGED_PROMPT,
  MEETING_CAPABLE_PROCESS_NAMES,
  SELECT_MEETING_OUTPUT_PROMPT,
  computePcm16ActivityLevel,
  describeListenState,
  findEndpointById,
  formatRenderCaptureLine,
  normalizeProcessName,
  resolveRenderEndpoint,
  type RenderEndpoint
} from "./renderEndpoint";

const SURFACE_ID = "{0.0.0.00000000}.{surface-speakers}";
const JABRA_ID = "{0.0.0.00000000}.{jabra-evolve-65}";
const JABRA_LINK_ID = "{0.0.0.00000000}.{jabra-link}";

function endpoint(
  id: string,
  name: string,
  options: Partial<RenderEndpoint> = {}
): RenderEndpoint {
  return {
    id,
    name,
    isDefault: false,
    sessions: [],
    ...options
  };
}

function chromeOn(id: string, name: string, isDefault = false): RenderEndpoint {
  return endpoint(id, name, {
    isDefault,
    sessions: [
      {
        processId: 4400,
        processName: "chrome.exe",
        displayName: "",
        state: "active",
        peak: 0.2
      }
    ]
  });
}

test("selected render endpoint uses the stable Windows endpoint ID, not the display name", () => {
  const jabra = chromeOn(JABRA_ID, "Headphones (Jabra Evolve 65)");
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    explicitId: JABRA_ID
  });
  assert.equal(result.status, "selected");
  assert.equal(result.endpoint?.id, JABRA_ID);
  assert.notEqual(result.endpoint?.id, result.endpoint?.name);
  assert.equal(findEndpointById([surface, jabra], JABRA_ID)?.id, JABRA_ID);
});

test("Jabra can be selected independently of the Windows default render endpoint", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const jabra = endpoint(JABRA_ID, "Jabra Evolve 65");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    explicitId: JABRA_ID
  });
  assert.equal(result.status, "selected");
  assert.equal(result.endpoint?.id, JABRA_ID);
  assert.equal(result.automatic, false);
  assert.equal(result.endpoint?.isDefault, false);
});

test("default endpoint is not assumed when an explicit endpoint exists", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const jabra = endpoint(JABRA_ID, "Headset Earphone (Jabra Evolve 65)");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    explicitId: JABRA_ID,
    rememberedId: SURFACE_ID
  });
  assert.equal(result.endpoint?.id, JABRA_ID);
  assert.notEqual(result.endpoint?.id, SURFACE_ID);
});

test("D1: unique browser session on Jabra wins over Surface Windows default", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const jabra = chromeOn(JABRA_ID, "Headphones (Jabra Evolve 65)");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    rememberedId: SURFACE_ID
  });
  assert.equal(result.status, "selected");
  assert.equal(result.endpoint?.id, JABRA_ID);
  assert.equal(result.reason, "unique_meeting_session");
  assert.equal(result.automatic, true);
});

test("D2: Jabra default and Meet on Jabra selects the Jabra endpoint ID", () => {
  const jabra = chromeOn(JABRA_ID, "Jabra Evolve 65", true);
  const result = resolveRenderEndpoint({
    endpoints: [jabra]
  });
  assert.equal(result.status, "selected");
  assert.equal(result.endpoint?.id, JABRA_ID);
});

test("ambiguous auto-detection does not silently pick the Windows default", () => {
  const surface = chromeOn(SURFACE_ID, "Speakers (Surface Speakers)", true);
  const jabra = chromeOn(JABRA_ID, "Jabra Evolve 65");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra]
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.endpoint, null);
  assert.equal(result.prompt, SELECT_MEETING_OUTPUT_PROMPT);
  assert.deepEqual(
    result.candidates.map((item) => item.id).sort(),
    [JABRA_ID, SURFACE_ID].sort()
  );
});

test("idle multiple endpoints do not fall back to the default speaker", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const jabra = endpoint(JABRA_ID, "Jabra Evolve 65");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra]
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "ambiguous_idle");
  assert.equal(result.endpoint, null);
});

test("endpoint disappearance does not silently continue on another device", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const explicitGone = resolveRenderEndpoint({
    endpoints: [surface],
    explicitId: JABRA_ID,
    currentId: JABRA_ID,
    rememberedId: JABRA_ID
  });
  assert.equal(explicitGone.status, "missing");
  assert.equal(explicitGone.prompt, DEVICE_CHANGED_PROMPT);
  assert.equal(explicitGone.endpoint, null);
  const unplugged = resolveRenderEndpoint({
    endpoints: [surface],
    currentMissing: true,
    rememberedId: JABRA_ID
  });
  assert.equal(unplugged.status, "missing");
  assert.equal(unplugged.endpoint, null);
  assert.equal(unplugged.prompt, DEVICE_CHANGED_PROMPT);
});

test("D3: Meet moving uniquely to Jabra rebinds from Surface automatically", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true
  });
  const jabra = chromeOn(JABRA_ID, "Jabra Evolve 65");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    currentId: SURFACE_ID,
    rememberedId: SURFACE_ID
  });
  assert.equal(result.status, "selected");
  assert.equal(result.endpoint?.id, JABRA_ID);
  assert.equal(result.reason, "unique_meeting_session");
});

test("D3: Meet present on both endpoints prompts instead of silent switch", () => {
  const surface = chromeOn(SURFACE_ID, "Speakers (Surface Speakers)", true);
  const jabra = chromeOn(JABRA_ID, "Jabra Evolve 65");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    currentId: SURFACE_ID
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.endpoint, null);
  assert.equal(result.prompt, DEVICE_CHANGED_PROMPT);
});

test("distinct Jabra render endpoints stay independently selectable by ID", () => {
  const headphones = endpoint(JABRA_ID, "Headphones (Jabra Evolve 65)");
  const link = endpoint(JABRA_LINK_ID, "Headphones (Jabra Link 370)");
  const result = resolveRenderEndpoint({
    endpoints: [headphones, link],
    explicitId: JABRA_LINK_ID
  });
  assert.equal(result.endpoint?.id, JABRA_LINK_ID);
  assert.equal(result.endpoint?.name, "Headphones (Jabra Link 370)");
});

test("Teams/Zoom/Webex/Edge process names are treated as meeting-capable heuristics", () => {
  for (const name of [
    "msedge",
    "Teams",
    "zoom.exe",
    "webex",
    "chrome"
  ]) {
    assert.equal(
      MEETING_CAPABLE_PROCESS_NAMES.has(normalizeProcessName(name)),
      true,
      name
    );
  }
  assert.equal(MEETING_CAPABLE_PROCESS_NAMES.has("googlemeet"), false);
});

test("Relay process IDs are excluded from meeting-session detection", () => {
  const surface = endpoint(SURFACE_ID, "Speakers (Surface Speakers)", {
    isDefault: true,
    sessions: [
      {
        processId: 99,
        processName: "chrome",
        displayName: "",
        state: "active",
        peak: 0.4
      }
    ]
  });
  const jabra = endpoint(JABRA_ID, "Jabra Evolve 65");
  const result = resolveRenderEndpoint({
    endpoints: [surface, jabra],
    excludeProcessIds: [99]
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "ambiguous_idle");
});

test("listen-state copy and PCM activity stay render-path only", () => {
  assert.equal(describeListenState("listening"), "Listening");
  assert.equal(
    describeListenState("no_system_audio"),
    "No system audio detected"
  );
  assert.equal(
    formatRenderCaptureLine({
      selectedEndpointName: "Jabra Evolve 65",
      listenState: "listening"
    }),
    "Audio: Jabra Evolve 65 · Listening"
  );
  assert.match(AUTO_SOURCE_LABEL, /meeting app/);
  const silent = new Int16Array(1600);
  const loud = new Int16Array(1600);
  loud.fill(8000);
  assert.equal(computePcm16ActivityLevel(silent) < 0.001, true);
  assert.equal(computePcm16ActivityLevel(loud) > 0.2, true);
});

test("QA Assist / STT / retrieval / intent files stay outside endpoint selection", () => {
  const forbidden = [
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts",
    "src/shared/questionIntent.ts",
    "src/main/services/evidence/evidenceSearchClient.ts",
    "src/main/services/conversations/evidenceAnswerExecutionPort.ts",
    "src/shared/evidenceAuthorityOrder.ts",
    "src/renderer/audio-capture/captureLoopbackAudio.ts"
  ];
  for (const file of forbidden) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(
      source,
      /resolveRenderEndpoint|MEETING_CAPABLE_PROCESS_NAMES|renderEndpointId|WASAPI/
    );
  }
  const sttUnchanged = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "HEAD",
      "--",
      "src/main/services/pipelineManager.ts",
      "src/main/services/deepgramSttProvider.ts",
      "src/main/services/deepgramUtteranceAssembler.ts",
      "src/main/services/crossSourceUtteranceArbiter.ts",
      "src/main/services/questionCompletenessGuard.ts",
      "src/main/services/evidence/evidenceSearchClient.ts",
      "src/renderer/audio-capture/captureLoopbackAudio.ts"
    ],
    { encoding: "utf8", cwd: resolve(".") }
  ).trim();
  assert.equal(sttUnchanged, "");
});
