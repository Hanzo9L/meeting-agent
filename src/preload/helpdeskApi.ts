import { IPC_CHANNELS } from "@shared/constants";
import type {
  HelpdeskApi,
  HelpdeskConversation,
  HelpdeskConversationView,
  HelpdeskResult,
  OpenHelpdeskCitationInput,
  SubmitHelpdeskMessageInput,
  SubmitHelpdeskMessageResult
} from "@shared/helpdesk";
import type {
  AudioChunkPayload,
  CaptureStartConfig,
  ConnectionStatus,
  LiveAssistCaptureCommand,
  LiveAssistSessionView,
  OverlayVisibilityState,
  ProviderCredentialId,
  RelaySettingsSnapshot,
  TranscriptMessage,
  UpdateRelaySettingsInput
} from "@shared/types";

export interface HelpdeskIpcInvoker {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(
    channel: string,
    listener: (_event: unknown, payload: unknown) => void
  ): void;
  off(
    channel: string,
    listener: (_event: unknown, payload: unknown) => void
  ): void;
  send(channel: string, ...args: unknown[]): void;
}

function invokeAs<T>(
  ipc: HelpdeskIpcInvoker,
  channel: string,
  ...args: unknown[]
): Promise<HelpdeskResult<T>> {
  return ipc.invoke(channel, ...args) as Promise<HelpdeskResult<T>>;
}

export function createHelpdeskApi(ipc: HelpdeskIpcInvoker): HelpdeskApi {
  return Object.freeze({
    listConversations: () =>
      invokeAs<HelpdeskConversation[]>(
        ipc,
        IPC_CHANNELS.helpdeskListConversations
      ),
    createConversation: (title?: string) =>
      invokeAs<HelpdeskConversationView>(
        ipc,
        IPC_CHANNELS.helpdeskCreateConversation,
        title
      ),
    loadConversation: (conversationId: string) =>
      invokeAs<HelpdeskConversationView>(
        ipc,
        IPC_CHANNELS.helpdeskLoadConversation,
        conversationId
      ),
    renameConversation: (conversationId: string, title: string) =>
      invokeAs<HelpdeskConversation>(
        ipc,
        IPC_CHANNELS.helpdeskRenameConversation,
        { conversationId, title }
      ),
    deleteConversation: (conversationId: string) =>
      invokeAs<{ deleted: boolean }>(
        ipc,
        IPC_CHANNELS.helpdeskDeleteConversation,
        conversationId
      ),
    submitMessage: (input: SubmitHelpdeskMessageInput) =>
      invokeAs<SubmitHelpdeskMessageResult>(
        ipc,
        IPC_CHANNELS.helpdeskSubmitMessage,
        input
      ),
    openCitation: (input: OpenHelpdeskCitationInput) =>
      invokeAs<{ opened: true }>(
        ipc,
        IPC_CHANNELS.helpdeskOpenCitation,
        input
      ),
    getLiveAssistSession: () =>
      invokeAs<LiveAssistSessionView | null>(
        ipc,
        IPC_CHANNELS.helpdeskGetLiveAssistSession
      ),
    startLiveAssist: (conversationId: string) =>
      invokeAs<LiveAssistSessionView>(
        ipc,
        IPC_CHANNELS.helpdeskStartLiveAssist,
        conversationId
      ),
    startQaAssist: (conversationId: string) =>
      invokeAs<LiveAssistSessionView>(
        ipc,
        IPC_CHANNELS.helpdeskStartQaAssist,
        conversationId
      ),
    stopLiveAssist: () =>
      invokeAs<LiveAssistSessionView | null>(
        ipc,
        IPC_CHANNELS.helpdeskStopLiveAssist
      ),
    onLiveAssistSession: (
      handler: (session: LiveAssistSessionView | null) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) =>
        handler(payload as LiveAssistSessionView | null);
      ipc.on(IPC_CHANNELS.liveAssistSessionChanged, listener);
      return () =>
        ipc.off(
          IPC_CHANNELS.liveAssistSessionChanged,
          listener
        );
    },
    onConversationUpdated: (
      handler: (conversationId: string) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) => {
        if (typeof payload === "string") handler(payload);
      };
      ipc.on(IPC_CHANNELS.helpdeskConversationUpdated, listener);
      return () =>
        ipc.off(
          IPC_CHANNELS.helpdeskConversationUpdated,
          listener
        );
    },
    getRelaySettings: () =>
      invokeAs<RelaySettingsSnapshot>(
        ipc,
        IPC_CHANNELS.relaySettingsGet
      ),
    updateRelaySettings: (input: UpdateRelaySettingsInput) =>
      invokeAs<RelaySettingsSnapshot>(
        ipc,
        IPC_CHANNELS.relaySettingsUpdate,
        input
      ),
    setProviderCredential: (
      provider: ProviderCredentialId,
      credential: string
    ) =>
      invokeAs<RelaySettingsSnapshot>(
        ipc,
        IPC_CHANNELS.relayProviderCredentialSet,
        { provider, credential }
      ),
    clearProviderCredential: (
      provider: ProviderCredentialId
    ) =>
      invokeAs<RelaySettingsSnapshot>(
        ipc,
        IPC_CHANNELS.relayProviderCredentialClear,
        provider
      ),
    getOverlayVisibility: () =>
      invokeAs<OverlayVisibilityState>(
        ipc,
        IPC_CHANNELS.relayOverlayGetVisibility
      ),
    showOverlay: () =>
      invokeAs<OverlayVisibilityState>(
        ipc,
        IPC_CHANNELS.relayOverlayShow
      ),
    hideOverlay: () =>
      invokeAs<OverlayVisibilityState>(
        ipc,
        IPC_CHANNELS.relayOverlayHide
      ),
    startCapture: (config: CaptureStartConfig) =>
      ipc.invoke(IPC_CHANNELS.startCapture, config) as Promise<void>,
    stopCapture: (sessionId: string) =>
      ipc.invoke(IPC_CHANNELS.stopCapture, sessionId) as Promise<void>,
    reportLiveAssistCaptureError: (sessionId: string) =>
      ipc.invoke(
        IPC_CHANNELS.liveAssistCaptureError,
        sessionId
      ) as Promise<void>,
    enableLoopbackAudio: () =>
      ipc.invoke("enable-loopback-audio") as Promise<void>,
    disableLoopbackAudio: () =>
      ipc.invoke("disable-loopback-audio") as Promise<void>,
    sendAudioChunk: (payload: AudioChunkPayload) =>
      ipc.send(IPC_CHANNELS.audioChunk, payload),
    onLiveAssistCaptureCommand: (
      handler: (command: LiveAssistCaptureCommand) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) =>
        handler(payload as LiveAssistCaptureCommand);
      ipc.on(IPC_CHANNELS.liveAssistCaptureCommand, listener);
      return () =>
        ipc.off(
          IPC_CHANNELS.liveAssistCaptureCommand,
          listener
        );
    },
    onTranscript: (
      handler: (payload: TranscriptMessage) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) =>
        handler(payload as TranscriptMessage);
      ipc.on(IPC_CHANNELS.transcript, listener);
      return () =>
        ipc.off(IPC_CHANNELS.transcript, listener);
    },
    onConnectionStatus: (
      handler: (status: ConnectionStatus) => void
    ) => {
      const listener = (_event: unknown, payload: unknown) =>
        handler(payload as ConnectionStatus);
      ipc.on(IPC_CHANNELS.connectionStatus, listener);
      return () =>
        ipc.off(
          IPC_CHANNELS.connectionStatus,
          listener
        );
    }
  });
}
