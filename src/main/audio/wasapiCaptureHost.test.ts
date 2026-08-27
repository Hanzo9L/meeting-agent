import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parseRenderEndpointSnapshot } from "./wasapiCaptureHost";

test("WASAPI helper enumerates render loopback endpoints by stable ID", () => {
  const source = readFileSync(
    resolve("src/main/audio/native/RelayWasapiCapture.cs"),
    "utf8"
  );
  assert.match(source, /AudClntStreamflagsLoopback = 0x00020000/);
  assert.match(source, /EDataFlowRender = 0/);
  assert.match(source, /TargetRate = 16000/);
  assert.doesNotMatch(source, /EDataFlowCapture\s*=\s*1[\s\S]*EnumAudioEndpoints\(\s*1/);
  assert.match(source, /EnumAudioEndpoints\(EDataFlowRender/);
});

test("enumerated snapshot keeps endpoint IDs distinct from display names", () => {
  const parsed = parseRenderEndpointSnapshot(
    JSON.stringify({
      defaultId: "{0.0.0.00000000}.{surface}",
      communicationsDefaultId: "{0.0.0.00000000}.{jabra}",
      endpoints: [
        {
          id: "{0.0.0.00000000}.{jabra}",
          name: "Speaker (Jabra Engage 65 SE)",
          isDefault: false,
          isCommunicationsDefault: true,
          sessions: [
            {
              processId: 12,
              processName: "chrome",
              displayName: "",
              state: "active",
              peak: 0.2
            }
          ]
        }
      ]
    })
  );
  assert.equal(parsed.endpoints[0]?.id, "{0.0.0.00000000}.{jabra}");
  assert.notEqual(parsed.endpoints[0]?.id, parsed.endpoints[0]?.name);
  assert.equal(parsed.defaultId, "{0.0.0.00000000}.{surface}");
});
