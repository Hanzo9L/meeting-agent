export const IPC_CHANNELS = {
  startCapture: "capture:start",
  stopCapture: "capture:stop",
  askQuestion: "capture:ask-question",
  audioChunk: "capture:audio-chunk",
  clearFeed: "feed:clear",
  updateTopic: "settings:update-topic",
  updateApiKeys: "settings:update-api-keys",
  updateCaptureSourceMode: "settings:update-capture-source-mode",
  updateAnswerTriggerMode: "settings:update-answer-trigger-mode",
  updateOverlayPrefs: "settings:update-overlay-prefs",
  updateDemoMode: "settings:update-demo-mode",
  updateKnowledgeBaseSettings: "settings:update-knowledge-base",
  getSettings: "settings:get",
  getRuntimeCaptureConfig: "settings:get-runtime-capture-config",
  getDemoMode: "settings:get-demo-mode",
  getKnowledgeBaseStatus: "settings:get-knowledge-base-status",
  syncKnowledgeBase: "settings:sync-knowledge-base",
  openExternalUrl: "shell:open-external-url",
  demoModeChanged: "settings:demo-mode-changed",
  transcript: "pipeline:transcript",
  answerStart: "pipeline:answer-start",
  answerChunk: "pipeline:answer-chunk",
  answerSources: "pipeline:answer-sources",
  answerDone: "pipeline:answer-done",
  connectionStatus: "pipeline:status"
} as const;

export const DEFAULT_TOPIC_PROMPT =
  "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}.";

export const DEFAULT_TOPIC = "Microsoft Teams developer platform";
export const DEFAULT_KNOWLEDGE_BASE_REPO_URL = "https://github.com/MicrosoftDocs/msteams-docs.git";
export const DEFAULT_KNOWLEDGE_BASE_BRANCH = "main";
