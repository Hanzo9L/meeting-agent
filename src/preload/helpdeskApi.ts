import { IPC_CHANNELS } from "@shared/constants";
import type {
  HelpdeskApi,
  HelpdeskConversation,
  HelpdeskConversationView,
  HelpdeskResult,
  SubmitHelpdeskMessageInput,
  SubmitHelpdeskMessageResult
} from "@shared/helpdesk";

export interface HelpdeskIpcInvoker {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
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
      )
  });
}
