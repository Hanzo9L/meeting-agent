import assert from "node:assert/strict";
import test from "node:test";
import { toRawDeepgramDiagnostic } from "./deepgramSttProvider";

test("Deepgram diagnostics bound transcript previews and preserve final flags", () => {
  const transcript = `  ${"word ".repeat(30)}  `;
  const diagnostic = toRawDeepgramDiagnostic({
    type: "Results",
    is_final: true,
    speech_final: false,
    channel: {
      alternatives: [{ transcript }]
    }
  }, 1234);

  assert.deepEqual(diagnostic, {
    event: "results",
    timestamp: 1234,
    transcriptLength: transcript.trim().length,
    transcriptPreview: transcript.replace(/\s+/g, " ").trim().slice(0, 96),
    isFinal: true,
    speechFinal: false
  });
});

test("Deepgram diagnostics identify UtteranceEnd without transcript content", () => {
  assert.deepEqual(
    toRawDeepgramDiagnostic({ type: "UtteranceEnd" }, 5678),
    {
      event: "utterance_end",
      timestamp: 5678,
      transcriptLength: 0,
      transcriptPreview: null,
      isFinal: null,
      speechFinal: null
    }
  );
});

test("Deepgram diagnostics ignore unrelated transport events", () => {
  assert.equal(
    toRawDeepgramDiagnostic({ type: "Metadata" }, 9999),
    null
  );
});
