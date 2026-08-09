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
import type { LiveAssistSessionView } from "@shared/types";

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
    }
  });
}
