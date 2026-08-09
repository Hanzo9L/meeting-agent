import assert from "node:assert/strict";
import test from "node:test";
import { IPC_CHANNELS } from "@shared/constants";
import { createHelpdeskApi, type HelpdeskIpcInvoker } from "./helpdeskApi";

test("Helpdesk preload exposes only typed command and query methods", async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const ipc: HelpdeskIpcInvoker = {
    async invoke(channel, ...args) {
      calls.push({ channel, args });
      return { ok: true, data: null };
    }
  };
  const api = createHelpdeskApi(ipc);

  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api).sort(), [
    "createConversation",
    "deleteConversation",
    "listConversations",
    "loadConversation",
    "renameConversation",
    "submitMessage"
  ]);
  assert.equal("invoke" in api, false);
  assert.equal("databasePath" in api, false);

  await api.listConversations();
  await api.createConversation("New");
  await api.loadConversation("conv-1");
  await api.renameConversation("conv-1", "Renamed");
  await api.deleteConversation("conv-1");
  await api.submitMessage({
    conversationId: "conv-1",
    content: "Question",
    inputOrigin: "typed"
  });

  assert.deepEqual(calls, [
    { channel: IPC_CHANNELS.helpdeskListConversations, args: [] },
    { channel: IPC_CHANNELS.helpdeskCreateConversation, args: ["New"] },
    { channel: IPC_CHANNELS.helpdeskLoadConversation, args: ["conv-1"] },
    {
      channel: IPC_CHANNELS.helpdeskRenameConversation,
      args: [{ conversationId: "conv-1", title: "Renamed" }]
    },
    {
      channel: IPC_CHANNELS.helpdeskDeleteConversation,
      args: ["conv-1"]
    },
    {
      channel: IPC_CHANNELS.helpdeskSubmitMessage,
      args: [
        {
          conversationId: "conv-1",
          content: "Question",
          inputOrigin: "typed"
        }
      ]
    }
  ]);
});
