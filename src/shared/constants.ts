export const IPC_CHANNELS = {
  startCapture: "capture:start",
  stopCapture: "capture:stop",
  askQuestion: "capture:ask-question",
  audioChunk: "capture:audio-chunk",
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
  demoModeChanged: "settings:demo-mode-changed",
  transcript: "pipeline:transcript",
  connectionStatus: "pipeline:status",
  helpdeskListConversations: "helpdesk:list-conversations",
  helpdeskCreateConversation: "helpdesk:create-conversation",
  helpdeskLoadConversation: "helpdesk:load-conversation",
  helpdeskRenameConversation: "helpdesk:rename-conversation",
  helpdeskDeleteConversation: "helpdesk:delete-conversation",
  helpdeskSubmitMessage: "helpdesk:submit-message",
  helpdeskOpenCitation: "helpdesk:open-citation",
  helpdeskGetLiveAssistSession: "helpdesk:live-assist:get",
  helpdeskStartLiveAssist: "helpdesk:live-assist:start",
  helpdeskStopLiveAssist: "helpdesk:live-assist:stop",
  helpdeskConversationUpdated: "helpdesk:conversation-updated",
  liveAssistSessionChanged: "live-assist:session-changed",
  liveAssistCaptureCommand: "live-assist:capture-command",
  liveAssistGetSession: "live-assist:get-session",
  liveAssistCaptureError: "live-assist:capture-error",
  liveAssistProjection: "live-assist:projection",
  liveAssistOpenCitation: "live-assist:open-citation"
} as const;

export const DEFAULT_TOPIC_PROMPT =
  "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}.";

export const DEFAULT_TOPIC = "Microsoft Teams developer platform";
export const DEFAULT_KNOWLEDGE_BASE_REPO_URL = "https://github.com/MicrosoftDocs/msteams-docs.git";
export const DEFAULT_KNOWLEDGE_BASE_BRANCH = "main";
