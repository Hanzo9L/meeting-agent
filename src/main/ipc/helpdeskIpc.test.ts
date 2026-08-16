import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IPC_CHANNELS } from "@shared/constants";
import type { HelpdeskResult } from "@shared/helpdesk";
import type { RelaySettingsSnapshot } from "@shared/types";
import { registerHelpdeskIpcHandlers, type IpcEventLike } from "./helpdeskIpc";
import {
  createSqliteConversationStore,
  HelpdeskService,
  UnavailableAnswerExecutionPort,
  type AnswerExecutionPort
} from "../services/conversations";

const TEST_SETTINGS: RelaySettingsSnapshot = {
  providers: {
    deepgram: {
      provider: "deepgram",
      state: "missing",
      source: "missing",
      externallyManaged: false,
      maskedSuffix: null
    },
    openAiEmbeddings: {
      provider: "openai_embeddings",
      state: "missing",
      source: "missing",
      externallyManaged: false,
      maskedSuffix: null
    }
  },
  speech: {
    captureSourceMode: "microphone",
    answerTriggerMode: "questions_only",
    microphoneDeviceId: null,
    microphoneLabel: null
  },
  overlay: {
    x: 0,
    y: 0,
    width: 480,
    height: 320,
    opacity: 0.95,
    autoShow: false,
    visibleInScreenShare: false
  },
  privacy: {
    persistsRawAudio: false,
    persistsContinuousTranscript: false
  }
};

const relayShellOptions = {
  getRelaySettings: () => TEST_SETTINGS,
  updateRelaySettings: () => TEST_SETTINGS,
  setProviderCredential: () => TEST_SETTINGS,
  clearProviderCredential: () => TEST_SETTINGS,
  getOverlayVisibility: () => ({
    created: false,
    visible: false
  }),
  showOverlay: async () => ({ created: true, visible: true }),
  hideOverlay: () => ({ created: true, visible: false })
};

class IpcGroundedPort implements AnswerExecutionPort {
  async execute() {
    const answerText =
      "Calling Plans connect Teams Phone to the PSTN.";
    return {
      ok: true as const,
      answerability: "answered" as const,
      answerText,
      factualAnswerText: answerText,
      presentationProfile: "helpdesk_detailed" as const,
      helpdeskDetailedText: answerText,
      liveAssistQuickText: answerText,
      snapshot: {
        snapshotId: "grounding:ipc",
        snapshotHash: "a".repeat(64),
        schemaVersion:
          "grounding-decision-snapshot/v1" as const,
        resolverPolicyVersion:
          "proposition-aware-evidence-policy/r2.2" as const,
        corpusRevisionHash: "b".repeat(64),
        createdAt: "2026-08-09T00:00:00.000Z"
      },
      citations: [
        {
          citationId: "citation:ipc",
          factualRangeId: "factual-range:ipc",
          claimId: "claim:ipc",
          answerRange: {
            startOffset: 0,
            endOffset: answerText.length
          },
          evidenceId: "evidence:ipc",
          spanId: "span:ipc",
          supportingSpanIds: [],
          documentId: "document:ipc",
          sourceTitle: "Microsoft Teams Calling Plans",
          canonicalUrl:
            "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365",
          sourceId: "ms-teams-admin",
          authorityRole: "teams_admin_primary",
          headingPath: ["Microsoft Teams Calling Plans"],
          sectionId: "calling-plans",
          sourceStatus: "ga",
          preview: false
        }
      ],
      contextReferences: [],
      diagnostics: {
        retrievalMs: 1,
        evidenceResolutionMs: 1,
        planningMs: 1,
        assemblyMs: 1,
        citationMappingMs: 1,
        contextBuildMs: 0,
        presentationPlanningMs: 0,
        presentationRenderMs: 0,
        synthesisMs: 0,
        pipelineTotalMs: 5,
        factualGroundingGenerationRequests: 0 as const,
        presentationSynthesisRequests: 0 as const,
        presentationSynthesisStatus: "not_configured" as const,
        presentationSynthesisFallbackReason: null
      }
    };
  }
}

test("typed Helpdesk IPC persists grounded answers and opens only stored citations", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-helpdesk-ipc-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const handlers = new Map<
    string,
    (event: IpcEventLike, ...args: unknown[]) => unknown
  >();
  const openedUrls: string[] = [];
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    service: new HelpdeskService(store, new IpcGroundedPort()),
    isTrustedSender: (event) => event.sender.id === 7,
    openExternal: async (url) => {
      openedUrls.push(url);
    },
    getLiveAssistSession: () =>
      store.getActiveLiveAssistSession(),
    startLiveAssist: (conversationId) =>
      store.startLiveAssistSession(conversationId, "live_assist"),
    startQaAssist: (conversationId) =>
      store.startLiveAssistSession(conversationId, "qa_assist"),
    stopLiveAssist: async () => {
      const active = store.getActiveLiveAssistSession();
      return active
        ? store.stopLiveAssistSession(active.id, "test_stopped")
        : null;
    },
    ...relayShellOptions
  });

  const invoke = async <T>(
    channel: string,
    ...args: unknown[]
  ): Promise<HelpdeskResult<T>> => {
    const handler = handlers.get(channel);
    assert.ok(handler, `Missing handler for ${channel}`);
    return (await handler({ sender: { id: 7 } }, ...args)) as HelpdeskResult<T>;
  };

  try {
    const created = await invoke<{ conversation: { id: string } }>(
      IPC_CHANNELS.helpdeskCreateConversation,
      "IPC Chat"
    );
    if (!created.ok) throw new Error(created.error.message);
    assert.equal(created.ok, true);
    const conversationId = created.data.conversation.id;

    const startedLive = await invoke<{
      id: string;
      conversationId: string;
      state: string;
    }>(
      IPC_CHANNELS.helpdeskStartLiveAssist,
      conversationId
    );
    assert.equal(
      startedLive.ok && startedLive.data.conversationId,
      conversationId
    );
    const activeLive = await invoke<{
      id: string;
    } | null>(IPC_CHANNELS.helpdeskGetLiveAssistSession);
    assert.equal(
      activeLive.ok && activeLive.data?.id,
      startedLive.ok ? startedLive.data.id : null
    );
    const stoppedLive = await invoke<{
      state: string;
    } | null>(IPC_CHANNELS.helpdeskStopLiveAssist);
    assert.equal(
      stoppedLive.ok && stoppedLive.data?.state,
      "inactive"
    );

    const listed = await invoke<Array<{ id: string }>>(
      IPC_CHANNELS.helpdeskListConversations
    );
    assert.equal(listed.ok && listed.data[0]?.id, conversationId);

    const renamed = await invoke<{ title: string }>(
      IPC_CHANNELS.helpdeskRenameConversation,
      { conversationId, title: "Renamed IPC Chat" }
    );
    assert.equal(renamed.ok && renamed.data.title, "Renamed IPC Chat");

    const submitted = await invoke<{
      outcome: string;
      view: {
        messages: Array<{
          id: string;
          role: string;
          inputOrigin: string | null;
        }>;
        answerRuns: Array<{ state: string; failureCode: string | null }>;
      };
    }>(IPC_CHANNELS.helpdeskSubmitMessage, {
      conversationId,
      content: "Pasted through IPC",
      inputOrigin: "pasted"
    });
    if (!submitted.ok) throw new Error(submitted.error.message);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.data.outcome, "answered");
    assert.equal(submitted.data.view.messages.length, 2);
    assert.equal(submitted.data.view.messages[0]?.role, "user");
    assert.equal(submitted.data.view.messages[0]?.inputOrigin, "pasted");
    assert.equal(
      submitted.data.view.messages[1]?.role,
      "assistant"
    );
    assert.equal(submitted.data.view.answerRuns[0]?.state, "completed");

    const opened = await invoke<{ opened: true }>(
      IPC_CHANNELS.helpdeskOpenCitation,
      {
        messageId: submitted.data.view.messages[1]!.id,
        citationId: "citation:ipc"
      }
    );
    assert.equal(opened.ok && opened.data.opened, true);
    assert.deepEqual(openedUrls, [
      "https://learn.microsoft.com/en-us/microsoftteams/calling-plans-for-office-365"
    ]);

    const loaded = await invoke<{
      messages: Array<{ role: string }>;
    }>(IPC_CHANNELS.helpdeskLoadConversation, conversationId);
    assert.equal(loaded.ok && loaded.data.messages.length, 2);
    assert.equal(loaded.ok && loaded.data.messages[0]?.role, "user");

    const deleted = await invoke<{ deleted: boolean }>(
      IPC_CHANNELS.helpdeskDeleteConversation,
      conversationId
    );
    assert.equal(deleted.ok && deleted.data.deleted, true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("QA Assist IPC channel starts a qa_assist-profile session via the injected port", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-helpdesk-ipc-qa-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const handlers = new Map<
    string,
    (event: IpcEventLike, ...args: unknown[]) => unknown
  >();
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    service: new HelpdeskService(store, new IpcGroundedPort()),
    isTrustedSender: (event) => event.sender.id === 7,
    openExternal: async () => undefined,
    getLiveAssistSession: () => store.getActiveLiveAssistSession(),
    startLiveAssist: (conversationId) =>
      store.startLiveAssistSession(conversationId, "live_assist"),
    startQaAssist: (conversationId) =>
      store.startLiveAssistSession(conversationId, "qa_assist"),
    stopLiveAssist: async () => null,
    ...relayShellOptions
  });

  const invoke = async <T>(
    channel: string,
    ...args: unknown[]
  ): Promise<HelpdeskResult<T>> => {
    const handler = handlers.get(channel);
    assert.ok(handler, `Missing handler for ${channel}`);
    return (await handler({ sender: { id: 7 } }, ...args)) as HelpdeskResult<T>;
  };

  try {
    const created = await invoke<{ conversation: { id: string } }>(
      IPC_CHANNELS.helpdeskCreateConversation,
      "QA Assist Chat"
    );
    if (!created.ok) throw new Error(created.error.message);
    const conversationId = created.data.conversation.id;

    const started = await invoke<{ profile: string }>(
      IPC_CHANNELS.helpdeskStartQaAssist,
      conversationId
    );
    assert.equal(started.ok && started.data.profile, "qa_assist");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Helpdesk IPC rejects untrusted senders and malformed messages safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeting-agent-helpdesk-ipc-safe-"));
  const store = createSqliteConversationStore({
    databasePath: join(root, "conversations.sqlite")
  });
  const handlers = new Map<
    string,
    (event: IpcEventLike, ...args: unknown[]) => unknown
  >();
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    service: new HelpdeskService(store, new UnavailableAnswerExecutionPort()),
    isTrustedSender: (event) => event.sender.id === 7,
    openExternal: async () => {
      throw new Error("must not open");
    },
    getLiveAssistSession: () => null,
    startLiveAssist: () => {
      throw new Error("must not start");
    },
    startQaAssist: () => {
      throw new Error("must not start");
    },
    stopLiveAssist: async () => null,
    ...relayShellOptions
  });

  try {
    const listHandler = handlers.get(IPC_CHANNELS.helpdeskListConversations);
    assert.ok(listHandler);
    const unauthorized = (await listHandler({
      sender: { id: 99 }
    })) as HelpdeskResult<unknown>;
    assert.equal(unauthorized.ok, false);
    if (unauthorized.ok) throw new Error("Expected unauthorized result");
    assert.equal(unauthorized.error.code, "unauthorized");

    const submitHandler = handlers.get(IPC_CHANNELS.helpdeskSubmitMessage);
    assert.ok(submitHandler);
    const invalid = (await submitHandler(
      { sender: { id: 7 } },
      { conversationId: "x", content: "", inputOrigin: "unknown" }
    )) as HelpdeskResult<unknown>;
    assert.equal(invalid.ok, false);
    if (invalid.ok) throw new Error("Expected invalid request");
    assert.equal(invalid.error.code, "invalid_request");
    assert.doesNotMatch(invalid.error.message, /sqlite|stack|database/i);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
