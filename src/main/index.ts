import "dotenv/config";
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  shell
} from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initMain as initLoopbackMain } from "electron-audio-loopback";
import { IPC_CHANNELS } from "@shared/constants";
import { SettingsStore } from "./store/settingsStore";
import { registerHelpdeskIpcHandlers } from "./ipc/helpdeskIpc";
import {
  createSqliteConversationStore,
  GroundedAnswerExecutionPort,
  HelpdeskService,
  LiveAssistService,
  resolveConversationDatabasePath,
  type SqliteConversationStore
} from "./services/conversations";
import { createOverlayWindow } from "./windows/overlayWindow";
import { createSettingsWindow } from "./windows/settingsWindow";
import { createHelpdeskWindow } from "./windows/helpdeskWindow";
import { DeepgramSttProvider } from "./services/deepgramSttProvider";
import { PipelineManager } from "./services/pipelineManager";
import { KnowledgeBaseService } from "./services/knowledgeBase";
import type {
  AudioChunkPayload,
  CaptureStartConfig,
  ApiKeys,
  ConnectionStatus,
  KnowledgeBaseSettings,
  OverlayPrefs,
  RuntimeCaptureConfig,
  TranscriptMessage
} from "@shared/types";
import type {
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";

const preloadRoot = join(__dirname, "../preload");
const rendererRoot = join(__dirname, "../../out/renderer");
const sessionDataRoot = join(app.getPath("temp"), "meeting-agent", "session-data");

// Avoid Chromium cache permission issues on some Windows setups.
mkdirSync(sessionDataRoot, { recursive: true });
app.setPath("sessionData", sessionDataRoot);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-http-cache");

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let helpdeskWindow: BrowserWindow | null = null;
let pipelineManager: PipelineManager | null = null;
let conversationStore: SqliteConversationStore | null = null;
let helpdeskService: HelpdeskService | null = null;
let liveAssistService: LiveAssistService | null = null;
const settingsStore = new SettingsStore();
const knowledgeBaseService = new KnowledgeBaseService(
  join(app.getPath("userData"), "knowledge-base"),
  settingsStore.getSettings().knowledgeBase
);
let audioChunkCount = 0;

function sendStatus(status: ConnectionStatus): void {
  overlayWindow?.webContents.send(IPC_CHANNELS.connectionStatus, status);
}

function sendTranscript(payload: TranscriptMessage): void {
  BrowserWindow.getAllWindows().forEach((window) =>
    window.webContents.send(IPC_CHANNELS.transcript, payload)
  );
}

function broadcastLiveSession(
  session: LiveAssistSessionView | null
): void {
  helpdeskWindow?.webContents.send(
    IPC_CHANNELS.liveAssistSessionChanged,
    session
  );
  overlayWindow?.webContents.send(
    IPC_CHANNELS.liveAssistSessionChanged,
    session
  );
}

function sendLiveProjection(
  projection: LiveAssistProjection
): void {
  overlayWindow?.webContents.send(
    IPC_CHANNELS.liveAssistProjection,
    projection
  );
}

function createPipeline(): PipelineManager {
  const { apiKeys } = settingsStore.getSettings();
  return new PipelineManager({
    sttProviderFactory: () => new DeepgramSttProvider(apiKeys.deepgramApiKey),
    onAcceptedQuestion: async (question) => {
      if (!liveAssistService) {
        throw new Error("Live Assist session service is unavailable.");
      }
      await liveAssistService.acceptQuestion(question);
    },
    sendStatus,
    sendTranscript
  });
}

function loadHelpdeskWindow(): void {
  helpdeskWindow = createHelpdeskWindow();
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void helpdeskWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/helpdesk/index.html`
    );
  } else {
    void helpdeskWindow.loadFile(join(rendererRoot, "helpdesk/index.html"));
  }
  helpdeskWindow.once("ready-to-show", () => {
    helpdeskWindow?.show();
    helpdeskWindow?.focus();
  });
  helpdeskWindow.on("closed", () => {
    helpdeskWindow = null;
  });
}

function createWindows(): void {
  const settings = settingsStore.getSettings();
  overlayWindow = createOverlayWindow(settings.overlay, settings.demoMode);
  settingsWindow = createSettingsWindow();
  loadHelpdeskWindow();

  if (process.env["ELECTRON_RENDERER_URL"]) {
    overlayWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/overlay/index.html`);
    settingsWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/settings/index.html`);
  } else {
    overlayWindow.loadFile(join(rendererRoot, "overlay/index.html"));
    settingsWindow.loadFile(join(rendererRoot, "settings/index.html"));
  }

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.showInactive();
    helpdeskWindow?.focus();
  });
}

function applyDemoMode(enabled: boolean): void {
  overlayWindow?.setContentProtection(!enabled);
  overlayWindow?.webContents.send(IPC_CHANNELS.demoModeChanged, enabled);
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getSettings, () => settingsStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.getDemoMode, () => settingsStore.getSettings().demoMode);
  ipcMain.handle(IPC_CHANNELS.getRuntimeCaptureConfig, (): RuntimeCaptureConfig => {
    const settings = settingsStore.getSettings();
    return {
      captureSourceMode: settings.captureSourceMode,
      answerTriggerMode: settings.answerTriggerMode
    };
  });
  ipcMain.handle(IPC_CHANNELS.liveAssistGetSession, (event) => {
    if (
      !overlayWindow ||
      event.sender.id !== overlayWindow.webContents.id
    ) {
      throw new Error("Live Assist session request is not allowed.");
    }
    return liveAssistService?.getActiveSession() ?? null;
  });
  ipcMain.handle(IPC_CHANNELS.liveAssistCaptureError, (event, sessionId: string) => {
    if (
      !overlayWindow ||
      event.sender.id !== overlayWindow.webContents.id
    ) {
      throw new Error("Live Assist capture update is not allowed.");
    }
    if (
      typeof sessionId !== "string" ||
      liveAssistService?.getActiveSession()?.id !== sessionId
    ) {
      return;
    }
    liveAssistService?.setCaptureStatus("error");
  });

  ipcMain.handle(IPC_CHANNELS.updateTopic, (_event, topic: string) => {
    settingsStore.updateTopic(topic);
  });

  ipcMain.handle(IPC_CHANNELS.updateApiKeys, (_event, apiKeys: ApiKeys) => {
    settingsStore.updateApiKeys(apiKeys);
    pipelineManager = null;
  });

  ipcMain.handle(IPC_CHANNELS.updateCaptureSourceMode, (_event, mode: RuntimeCaptureConfig["captureSourceMode"]) => {
    settingsStore.updateCaptureSourceMode(mode);
  });

  ipcMain.handle(IPC_CHANNELS.updateAnswerTriggerMode, (_event, mode: RuntimeCaptureConfig["answerTriggerMode"]) => {
    settingsStore.updateAnswerTriggerMode(mode);
  });

  ipcMain.handle(IPC_CHANNELS.updateOverlayPrefs, (_event, prefs: Partial<OverlayPrefs>) => {
    settingsStore.updateOverlay(prefs);
    if (overlayWindow) {
      const updated = settingsStore.getSettings().overlay;
      overlayWindow.setBounds({
        x: updated.x,
        y: updated.y,
        width: updated.width,
        height: updated.height
      });
      overlayWindow.setOpacity(updated.opacity);
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateDemoMode, (_event, enabled: boolean) => {
    settingsStore.updateDemoMode(Boolean(enabled));
    applyDemoMode(Boolean(enabled));
  });

  ipcMain.handle(
    IPC_CHANNELS.updateKnowledgeBaseSettings,
    (_event, settings: Partial<KnowledgeBaseSettings>) => {
      settingsStore.updateKnowledgeBaseSettings(settings);
      knowledgeBaseService.updateSettings(settingsStore.getSettings().knowledgeBase);
    }
  );

  ipcMain.handle(IPC_CHANNELS.getKnowledgeBaseStatus, () => knowledgeBaseService.getStatus());

  ipcMain.handle(IPC_CHANNELS.syncKnowledgeBase, async () => knowledgeBaseService.sync());

  ipcMain.handle(IPC_CHANNELS.startCapture, async (event, config: CaptureStartConfig) => {
    if (
      !overlayWindow ||
      event.sender.id !== overlayWindow.webContents.id
    ) {
      throw new Error("Capture start request is not allowed.");
    }
    const service = liveAssistService;
    const activeSession =
      service?.getActiveSession() ?? null;
    if (
      !service ||
      !activeSession ||
      !config ||
      config.sessionId !== activeSession.id ||
      !Array.isArray(config.sources) ||
      config.sources.length === 0 ||
      config.sources.some(
        (source) =>
          source !== "system" && source !== "microphone"
      )
    ) {
      throw new Error(
        "Capture does not match the active Live Assist session."
      );
    }
    audioChunkCount = 0;
    if (!pipelineManager) {
      pipelineManager = createPipeline();
    }
    try {
      await pipelineManager.start({
        sources: [...new Set(config.sources)],
        answerTriggerMode:
          settingsStore.getSettings().answerTriggerMode
      });
      service.setCaptureStatus("capturing");
    } catch (error) {
      service.setCaptureStatus("error");
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.stopCapture, async (event, sessionId: string) => {
    if (
      !overlayWindow ||
      event.sender.id !== overlayWindow.webContents.id
    ) {
      throw new Error("Capture stop request is not allowed.");
    }
    const activeSession =
      liveAssistService?.getActiveSession() ?? null;
    if (!activeSession || activeSession.id !== sessionId) {
      return;
    }
    await pipelineManager?.stop();
    liveAssistService?.stop("capture_stopped");
  });

  ipcMain.handle(IPC_CHANNELS.askQuestion, async (event, question: string) => {
    if (
      !overlayWindow ||
      event.sender.id !== overlayWindow.webContents.id
    ) {
      throw new Error("Question acceptance request is not allowed.");
    }
    const text = typeof question === "string" ? question.trim() : "";
    if (!text) return;
    if (!liveAssistService?.getActiveSession()) return;
    if (!pipelineManager) {
      pipelineManager = createPipeline();
    }
    await pipelineManager.askQuestion(text, "microphone");
  });

  ipcMain.handle(
    IPC_CHANNELS.liveAssistOpenCitation,
    async (event, messageId: string, citationId: string) => {
      if (
        !overlayWindow ||
        event.sender.id !== overlayWindow.webContents.id ||
        typeof messageId !== "string" ||
        typeof citationId !== "string" ||
        !messageId.trim() ||
        !citationId.trim() ||
        !helpdeskService
      ) {
        throw new Error("Live Assist citation request is not allowed.");
      }
      const url = helpdeskService.getActionableCitationUrl(
        messageId.trim(),
        citationId.trim()
      );
      await shell.openExternal(url);
    }
  );

  ipcMain.on(IPC_CHANNELS.audioChunk, (event, payload: AudioChunkPayload) => {
    if (
      !overlayWindow ||
      event.sender.id !== overlayWindow.webContents.id
    ) {
      return;
    }
    if (
      !pipelineManager
    ) {
      return;
    }
    const activeSession =
      liveAssistService?.getActiveSession() ?? null;
    if (
      !activeSession ||
      payload?.sessionId !== activeSession.id
    ) {
      return;
    }
    if (!payload || (payload.source !== "system" && payload.source !== "microphone")) return;
    const audioBuffer: unknown = payload.buffer;
    let chunk: Int16Array | null = null;
    if (audioBuffer instanceof ArrayBuffer) {
      chunk = new Int16Array(audioBuffer);
    } else if (ArrayBuffer.isView(audioBuffer)) {
      chunk = new Int16Array(
        audioBuffer.buffer,
        audioBuffer.byteOffset,
        Math.floor(audioBuffer.byteLength / 2)
      );
    }
    if (!chunk || chunk.length === 0) return;
    if (audioChunkCount === 0) {
      overlayWindow?.webContents.send(IPC_CHANNELS.transcript, {
        text: "Audio stream detected in main process...",
        isFinal: false,
        timestamp: Date.now()
      });
    }
    audioChunkCount += 1;
    pipelineManager.sendAudioChunk(payload.source, chunk);
  });
}

function registerHelpdeskHandlers(): void {
  if (!helpdeskService) {
    throw new Error("Helpdesk service must be initialized before IPC registration.");
  }
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        ipcMain.handle(channel, (event, ...args) => listener(event, ...args));
      }
    },
    service: helpdeskService,
    isTrustedSender: (event) =>
      helpdeskWindow !== null &&
      event.sender.id === helpdeskWindow.webContents.id,
    openExternal: async (url) => {
      await shell.openExternal(url);
    },
    getLiveAssistSession: () =>
      liveAssistService?.getActiveSession() ?? null,
    startLiveAssist: (conversationId) => {
      if (!liveAssistService) {
        throw new Error("Live Assist service is unavailable.");
      }
      const session = liveAssistService.start(conversationId);
      overlayWindow?.webContents.send(
        IPC_CHANNELS.liveAssistCaptureCommand,
        { action: "start", sessionId: session.id }
      );
      return session;
    },
    stopLiveAssist: async () => {
      const active = liveAssistService?.getActiveSession();
      if (!active) return null;
      await pipelineManager?.stop();
      const stopped =
        liveAssistService?.stop("user_stopped") ?? null;
      overlayWindow?.webContents.send(
        IPC_CHANNELS.liveAssistCaptureCommand,
        { action: "stop", sessionId: active.id }
      );
      return stopped;
    }
  });
}

app.whenReady().then(() => {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
  process.env["MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY"] = preloadRoot;
  nativeTheme.themeSource = "dark";

  void (async () => {
    await knowledgeBaseService.initialize();
    initLoopbackMain();
    conversationStore = createSqliteConversationStore({
      databasePath: resolveConversationDatabasePath({
        userDataPath: app.getPath("userData")
      })
    });
    helpdeskService = new HelpdeskService(
      conversationStore,
      new GroundedAnswerExecutionPort()
    );
    liveAssistService = new LiveAssistService(
      conversationStore,
      helpdeskService,
      {
        sessionChanged: broadcastLiveSession,
        projectionChanged: sendLiveProjection,
        conversationUpdated: (conversationId) => {
          helpdeskWindow?.webContents.send(
            IPC_CHANNELS.helpdeskConversationUpdated,
            conversationId
          );
        }
      }
    );
    registerIpcHandlers();
    registerHelpdeskHandlers();
    createWindows();
    sendStatus("idle");

    const settings = settingsStore.getSettings().knowledgeBase;
    if (settings.enabled && !knowledgeBaseService.getStatus().ready) {
      void knowledgeBaseService.sync();
    }
  })();
});

app.on("activate", () => {
  if (!helpdeskWindow && helpdeskService) {
    loadHelpdeskWindow();
  }
});

app.on("window-all-closed", async () => {
  await pipelineManager?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  liveAssistService?.stop("application_shutdown");
  conversationStore?.close();
  conversationStore = null;
  helpdeskService = null;
  liveAssistService = null;
});
