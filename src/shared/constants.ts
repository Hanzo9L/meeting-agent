export const IPC_CHANNELS = {
  startCapture: "capture:start",
  stopCapture: "capture:stop",
  audioChunk: "capture:audio-chunk",
  clearFeed: "feed:clear",
  updateTopic: "settings:update-topic",
  updateApiKeys: "settings:update-api-keys",
  updateOverlayPrefs: "settings:update-overlay-prefs",
  updateHotkey: "settings:update-hotkey",
  getSettings: "settings:get",
  transcript: "pipeline:transcript",
  answerChunk: "pipeline:answer-chunk",
  answerDone: "pipeline:answer-done",
  connectionStatus: "pipeline:status"
} as const;

export const DEFAULT_TOPIC_PROMPT =
  "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}. Keep responses short, direct, and practical.";

export const DEFAULT_TOPIC = "General business discussion";
export const DEFAULT_HOTKEY = "CommandOrControl+Shift+H";
