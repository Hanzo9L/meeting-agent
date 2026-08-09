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
import type {
  AudioChunkPayload,
  CaptureStartConfig,
  ConnectionStatus,
  LiveAssistHydration,
  LiveAssistProjection,
  LiveAssistSessionView,
  OverlayVisibilityState,
  TranscriptMessage
} from "@shared/types";
import { SettingsStore } from "./store/settingsStore";
import { registerHelpdeskIpcHandlers } from "./ipc/helpdeskIpc";
import {
  createSqliteConversationStore,
  GroundedAnswerExecutionPort,
  HelpdeskService,
  HelpdeskServiceError,
  LiveAssistService,
  resolveConversationDatabasePath,
  type SqliteConversationStore
} from "./services/conversations";
import { createOverlayWindow } from "./windows/overlayWindow";
import { createHelpdeskWindow } from "./windows/helpdeskWindow";
import { DeepgramSttProvider } from "./services/deepgramSttProvider";
import { PipelineManager } from "./services/pipelineManager";

const preloadRoot = join(__dirname, "../preload");
const rendererRoot = join(__dirname, "../../out/renderer");
const sessionDataRoot = join(
  app.getPath("temp"),
  "meeting-agent",
  "session-data"
);

mkdirSync(sessionDataRoot, { recursive: true });
app.setPath("sessionData", sessionDataRoot);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-http-cache");

const hasSingleInstanceLock =
  app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let overlayWindow: BrowserWindow | null = null;
let overlayLoadPromise: Promise<void> | null = null;
let helpdeskWindow: BrowserWindow | null = null;
let pipelineManager: PipelineManager | null = null;
let conversationStore: SqliteConversationStore | null = null;
let helpdeskService: HelpdeskService | null = null;
let liveAssistService: LiveAssistService | null = null;
let latestStatus: ConnectionStatus = "idle";
let latestTranscript: TranscriptMessage | null = null;
let latestProjection: LiveAssistProjection | null = null;
let audioChunkCount = 0;
const settingsStore = new SettingsStore();

function isHelpdeskSender(senderId: number): boolean {
  return (
    helpdeskWindow !== null &&
    senderId === helpdeskWindow.webContents.id
  );
}

function isOverlaySender(senderId: number): boolean {
  return (
    overlayWindow !== null &&
    senderId === overlayWindow.webContents.id
  );
}

function sendStatus(status: ConnectionStatus): void {
  latestStatus = status;
  helpdeskWindow?.webContents.send(
    IPC_CHANNELS.connectionStatus,
    status
  );
  overlayWindow?.webContents.send(
    IPC_CHANNELS.connectionStatus,
    status
  );
}

function sendTranscript(payload: TranscriptMessage): void {
  latestTranscript = payload;
  helpdeskWindow?.webContents.send(
    IPC_CHANNELS.transcript,
    payload
  );
  overlayWindow?.webContents.send(
    IPC_CHANNELS.transcript,
    payload
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
  latestProjection = projection;
  overlayWindow?.webContents.send(
    IPC_CHANNELS.liveAssistProjection,
    projection
  );
}

function getLiveAssistHydration(): LiveAssistHydration {
  return {
    session: liveAssistService?.getActiveSession() ?? null,
    projection: latestProjection,
    transcript: latestTranscript,
    status: latestStatus
  };
}

function createPipeline(): PipelineManager {
  return new PipelineManager({
    sttProviderFactory: () =>
      new DeepgramSttProvider(
        settingsStore.getProviderCredential("deepgram")
      ),
    onAcceptedQuestion: async (question) => {
      if (!liveAssistService) {
        throw new Error(
          "Live Assist session service is unavailable."
        );
      }
      await liveAssistService.acceptQuestion(question);
    },
    sendStatus,
    sendTranscript,
    onArbitrationDiagnostic: (diagnostic) => {
      console.info(
        "[Relay Live Assist arbitration]",
        JSON.stringify(diagnostic)
      );
    }
  });
}

function loadHelpdeskWindow(): void {
  if (helpdeskWindow && !helpdeskWindow.isDestroyed()) {
    helpdeskWindow.show();
    if (helpdeskWindow.isMinimized()) {
      helpdeskWindow.restore();
    }
    helpdeskWindow.focus();
    return;
  }
  const window = createHelpdeskWindow();
  helpdeskWindow = window;
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/helpdesk/index.html`
    );
  } else {
    void window.loadFile(
      join(rendererRoot, "helpdesk/index.html")
    );
  }
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.on("closed", () => {
    if (helpdeskWindow === window) helpdeskWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
    }
  });
}

function overlayVisibility(): OverlayVisibilityState {
  return {
    created:
      overlayWindow !== null && !overlayWindow.isDestroyed(),
    visible:
      overlayWindow !== null &&
      !overlayWindow.isDestroyed() &&
      overlayWindow.isVisible()
  };
}

function applyOverlaySettings(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const settings = settingsStore.getRelaySettings().overlay;
  overlayWindow.setSize(settings.width, settings.height);
  overlayWindow.setOpacity(settings.opacity);
  overlayWindow.setContentProtection(
    !settings.visibleInScreenShare
  );
  overlayWindow.webContents.send(
    IPC_CHANNELS.demoModeChanged,
    settings.visibleInScreenShare
  );
}

async function showOverlay(): Promise<OverlayVisibilityState> {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    const settings = settingsStore.getRelaySettings().overlay;
    const window = createOverlayWindow(
      settings,
      settings.visibleInScreenShare
    );
    overlayWindow = window;
    window.on("closed", () => {
      if (overlayWindow === window) {
        overlayWindow = null;
        overlayLoadPromise = null;
      }
    });
    overlayLoadPromise = process.env["ELECTRON_RENDERER_URL"]
      ? window
          .loadURL(
            `${process.env["ELECTRON_RENDERER_URL"]}/overlay/index.html`
          )
          .then(() => undefined)
      : window
          .loadFile(join(rendererRoot, "overlay/index.html"))
          .then(() => undefined);
  }
  await overlayLoadPromise;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    applyOverlaySettings();
    overlayWindow.showInactive();
  }
  return overlayVisibility();
}

function hideOverlay(): OverlayVisibilityState {
  overlayWindow?.hide();
  return overlayVisibility();
}

function registerRuntimeIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getDemoMode, (event) => {
    if (!isOverlaySender(event.sender.id)) {
      throw new Error("Overlay settings request is not allowed.");
    }
    return settingsStore.getRelaySettings().overlay
      .visibleInScreenShare;
  });

  ipcMain.handle(
    IPC_CHANNELS.liveAssistGetHydration,
    (event) => {
      if (!isOverlaySender(event.sender.id)) {
        throw new Error(
          "Live Assist hydration request is not allowed."
        );
      }
      return getLiveAssistHydration();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.liveAssistCaptureError,
    (event, sessionId: unknown) => {
      if (!isHelpdeskSender(event.sender.id)) {
        throw new Error(
          "Live Assist capture update is not allowed."
        );
      }
      if (
        typeof sessionId === "string" &&
        liveAssistService?.getActiveSession()?.id ===
          sessionId
      ) {
        liveAssistService.setCaptureStatus("error");
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.startCapture,
    async (event, config: CaptureStartConfig) => {
      if (!isHelpdeskSender(event.sender.id)) {
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
      pipelineManager ??= createPipeline();
      try {
        await pipelineManager.start({
          sessionId: config.sessionId,
          sources: [...new Set(config.sources)],
          answerTriggerMode:
            settingsStore.getRelaySettings().speech
              .answerTriggerMode
        });
        service.setCaptureStatus("capturing");
      } catch (error) {
        service.setCaptureStatus("error");
        throw error;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.stopCapture,
    async (event, sessionId: unknown) => {
      if (!isHelpdeskSender(event.sender.id)) {
        throw new Error("Capture stop request is not allowed.");
      }
      const activeSession =
        liveAssistService?.getActiveSession() ?? null;
      if (
        typeof sessionId !== "string" ||
        !activeSession ||
        activeSession.id !== sessionId
      ) {
        return;
      }
      await pipelineManager?.stop();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.liveAssistOpenCitation,
    async (
      event,
      messageId: unknown,
      citationId: unknown
    ) => {
      if (
        !isOverlaySender(event.sender.id) ||
        typeof messageId !== "string" ||
        typeof citationId !== "string" ||
        !messageId.trim() ||
        !citationId.trim() ||
        !helpdeskService
      ) {
        throw new Error(
          "Live Assist citation request is not allowed."
        );
      }
      const url = helpdeskService.getActionableCitationUrl(
        messageId.trim(),
        citationId.trim()
      );
      await shell.openExternal(url);
    }
  );

  ipcMain.on(
    IPC_CHANNELS.audioChunk,
    (event, payload: AudioChunkPayload) => {
      if (!isHelpdeskSender(event.sender.id) || !pipelineManager) {
        return;
      }
      const activeSession =
        liveAssistService?.getActiveSession() ?? null;
      if (
        !activeSession ||
        payload?.sessionId !== activeSession.id ||
        (payload.source !== "system" &&
          payload.source !== "microphone")
      ) {
        return;
      }
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
        sendTranscript({
          text: "Audio stream detected in main process...",
          isFinal: false,
          timestamp: Date.now()
        });
      }
      audioChunkCount += 1;
      pipelineManager.sendAudioChunk(payload.source, chunk);
    }
  );
}

function registerHelpdeskHandlers(): void {
  if (!helpdeskService) {
    throw new Error(
      "Helpdesk service must be initialized before IPC registration."
    );
  }
  registerHelpdeskIpcHandlers({
    registrar: {
      handle: (channel, listener) => {
        ipcMain.handle(channel, (event, ...args) =>
          listener(event, ...args)
        );
      }
    },
    service: helpdeskService,
    isTrustedSender: (event) =>
      isHelpdeskSender(event.sender.id),
    openExternal: async (url) => {
      await shell.openExternal(url);
    },
    getLiveAssistSession: () =>
      liveAssistService?.getActiveSession() ?? null,
    startLiveAssist: (conversationId) => {
      if (!liveAssistService) {
        throw new HelpdeskServiceError(
          "operation_failed",
          "Live Assist service is unavailable."
        );
      }
      if (
        settingsStore.getProviderStatus("deepgram").state !==
        "configured"
      ) {
        throw new HelpdeskServiceError(
          "invalid_request",
          "Configure Deepgram STT in Relay Settings before starting Live Assist."
        );
      }
      const session = liveAssistService.start(conversationId);
      helpdeskWindow?.webContents.send(
        IPC_CHANNELS.liveAssistCaptureCommand,
        { action: "start", sessionId: session.id }
      );
      if (settingsStore.getRelaySettings().overlay.autoShow) {
        void showOverlay();
      }
      return session;
    },
    stopLiveAssist: async () => {
      const active = liveAssistService?.getActiveSession();
      if (!active) return null;
      await pipelineManager?.stop();
      const stopped =
        liveAssistService?.stop("user_stopped") ?? null;
      helpdeskWindow?.webContents.send(
        IPC_CHANNELS.liveAssistCaptureCommand,
        { action: "stop", sessionId: active.id }
      );
      return stopped;
    },
    getRelaySettings: () =>
      settingsStore.getRelaySettings(),
    updateRelaySettings: (input) => {
      const settings =
        settingsStore.updateRelaySettings(input);
      applyOverlaySettings();
      return settings;
    },
    setProviderCredential: (provider, credential) =>
      settingsStore.setProviderCredential(
        provider,
        credential
      ),
    clearProviderCredential: (provider) =>
      settingsStore.clearProviderCredential(provider),
    getOverlayVisibility: overlayVisibility,
    showOverlay,
    hideOverlay
  });
}

async function initializeRelay(): Promise<void> {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
  process.env["MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY"] =
    preloadRoot;
  nativeTheme.themeSource = "dark";
  settingsStore.applyRuntimeCredentials();
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
  registerRuntimeIpcHandlers();
  registerHelpdeskHandlers();
  loadHelpdeskWindow();
  sendStatus("idle");
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (app.isReady()) loadHelpdeskWindow();
  });

  void app.whenReady().then(initializeRelay);

  app.on("activate", () => {
    if (helpdeskService) loadHelpdeskWindow();
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
}
