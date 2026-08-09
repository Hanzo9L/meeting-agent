export const IPC_CHANNELS = {
  startCapture: "capture:start",
  stopCapture: "capture:stop",
  askQuestion: "capture:ask-question",
  audioChunk: "capture:audio-chunk",
  relaySettingsGet: "relay:settings:get",
  relaySettingsUpdate: "relay:settings:update",
  relayProviderCredentialSet: "relay:provider-credential:set",
  relayProviderCredentialClear:
    "relay:provider-credential:clear",
  relayOverlayGetVisibility: "relay:overlay:get-visibility",
  relayOverlayShow: "relay:overlay:show",
  relayOverlayHide: "relay:overlay:hide",
  getDemoMode: "settings:get-demo-mode",
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
  liveAssistGetHydration: "live-assist:get-hydration",
  liveAssistCaptureError: "live-assist:capture-error",
  liveAssistProjection: "live-assist:projection",
  liveAssistOpenCitation: "live-assist:open-citation"
} as const;

export const DEFAULT_TOPIC_PROMPT =
  "You are helping a caller during a live meeting. Only answer questions about: {TOPIC}.";

export const DEFAULT_TOPIC = "Microsoft Teams developer platform";
export const DEFAULT_KNOWLEDGE_BASE_REPO_URL = "https://github.com/MicrosoftDocs/msteams-docs.git";
export const DEFAULT_KNOWLEDGE_BASE_BRANCH = "main";
