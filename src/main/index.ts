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
import { updateProjectionFeed } from "@shared/projectionFeed";
import type {
  AudioChunkPayload,
  CaptureStartConfig,
  ConnectionStatus,
  EvidenceReadinessStatus,
  LiveAssistHydration,
  LiveAssistProjection,
  LiveAssistSessionView,
  OverlayVisibilityState,
  RelaySettingsSnapshot,
  TranscriptMessage
} from "@shared/types";
import { SettingsStore } from "./store/settingsStore";
import { registerHelpdeskIpcHandlers } from "./ipc/helpdeskIpc";
import {
  createSqliteConversationStore,
  EvidenceAnswerExecutionPort,
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
import { createEvidenceSearchClient } from "./services/evidence/evidenceSearchClient";
import { LearnRagChild } from "./services/evidence/learnRagChild";
import { V2ProviderRuntime } from "./services/v2ProviderRuntime";
import { RenderCaptureController } from "./audio/renderCaptureController";
import {
  WasapiLoopbackProcess,
  enumerateRenderEndpoints
} from "./audio/wasapiCaptureHost";
import type { RenderCaptureStatusView } from "@shared/renderEndpoint";

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
let evidenceChild: LearnRagChild | null = null;
let latestStatus: ConnectionStatus = "idle";
let latestTranscript: TranscriptMessage | null = null;
let latestProjections: LiveAssistProjection[] = [];
let latestEvidenceStatus: EvidenceReadinessStatus = "starting";
let audioChunkCount = 0;
const settingsStore = new SettingsStore();
let v2Runtime: V2ProviderRuntime | null = null;
const wasapiLoopback = new WasapiLoopbackProcess();
let renderCapture: RenderCaptureController | null = null;

function refreshV2Runtime(): V2ProviderRuntime {
  v2Runtime ??= new V2ProviderRuntime({
    getApiKey: () =>
      settingsStore.getProviderCredential("openai_embeddings")
  });
  const readiness = v2Runtime.refresh();
  console.info(
    "[Relay V2 readiness]",
    JSON.stringify(readiness)
  );
  return v2Runtime;
}

function getRelaySettingsSnapshot(): RelaySettingsSnapshot {
  return {
    ...settingsStore.getRelaySettings(),
    v2: v2Runtime?.getReadiness() ?? {
      state: "misconfigured",
      model: null,
      semanticReady: false,
      synthesisReady: false,
      reason: "not_initialized"
    }
  };
}

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

function ingestSystemPcm(sessionId: string, chunk: Int16Array): void {
  if (!pipelineManager) return;
  const activeSession = liveAssistService?.getActiveSession() ?? null;
  if (!activeSession || activeSession.id !== sessionId) return;
  if (chunk.length === 0) return;
  if (audioChunkCount === 0) {
    sendTranscript({
      text: "Audio stream detected in main process...",
      isFinal: false,
      timestamp: Date.now()
    });
  }
  audioChunkCount += 1;
  pipelineManager.sendAudioChunk("system", chunk);
}

function getRenderCapture(): RenderCaptureController {
  renderCapture ??= new RenderCaptureController({
    host: {
      enumerate: () =>
        enumerateRenderEndpoints({
          userDataPath: app.getPath("userData"),
          appPath: app.getAppPath(),
          excludeProcessIds: [process.pid]
        }),
      startLoopback: (endpointId, handlers) =>
        wasapiLoopback.start(
          endpointId,
          {
            userDataPath: app.getPath("userData"),
            appPath: app.getAppPath()
          },
          handlers
        ),
      stopLoopback: () => wasapiLoopback.stop()
    },
    getRemembered: () => settingsStore.getRememberedRenderEndpoint(),
    setRemembered: (id, label) =>
      settingsStore.setRememberedRenderEndpoint(id, label),
    onStatus: (status) => {
      helpdeskWindow?.webContents.send(
        IPC_CHANNELS.renderCaptureStatus,
        status
      );
    },
    onSystemPcm: (chunk) => {
      const session = liveAssistService?.getActiveSession();
      if (session) ingestSystemPcm(session.id, chunk);
    },
    excludeProcessIds: [process.pid]
  });
  return renderCapture;
}

function idleRenderCaptureStatus(): RenderCaptureStatusView {
  return {
    listenState: "idle",
    selectedEndpointId: null,
    selectedEndpointName: null,
    automatic: true,
    message: null,
    activityLevel: 0,
    endpoints: []
  };
}

async function stopRenderCapture(): Promise<void> {
  await renderCapture?.stop();
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
  if (
    !session ||
    latestProjections.some(
      (projection) => projection.sessionId !== session.id
    )
  ) {
    latestProjections = [];
  }
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
  console.info(
    "[Relay live latency]",
    JSON.stringify({
      event: "projection_created",
      timestampMs: Date.now(),
      sessionId: projection.sessionId,
      conversationId: projection.conversationId,
      userMessageId: projection.userMessageId,
      answerRunId: projection.answerRunId,
      state: projection.state,
      usefulAnswer: Boolean(projection.answerText)
    })
  );
  latestProjections = updateProjectionFeed(latestProjections, projection);
  overlayWindow?.webContents.send(
    IPC_CHANNELS.liveAssistProjection,
    projection
  );
}

function sendEvidenceStatus(status: EvidenceReadinessStatus): void {
  latestEvidenceStatus = status;
  overlayWindow?.webContents.send(
    IPC_CHANNELS.liveAssistEvidenceStatus,
    status
  );
}

function getLiveAssistHydration(): LiveAssistHydration {
  return {
    session: liveAssistService?.getActiveSession() ?? null,
    projections: [...latestProjections],
    transcript: latestTranscript,
    status: latestStatus,
    evidenceStatus: latestEvidenceStatus
  };
}

function createPipeline(): PipelineManager {
  return new PipelineManager({
    sttProviderFactory: () =>
      new DeepgramSttProvider(
        settingsStore.getProviderCredential("deepgram")
      ),
    questionUnderstanding: {
      understand: (input) =>
        (v2Runtime ?? refreshV2Runtime()).understand(input)
    },
    onQuestionUnderstandingDiagnostic: (diagnostic) => {
      console.info(
        "[Relay V2 semantic]",
        JSON.stringify(diagnostic)
      );
    },
    requireSemanticCompletion: true,
    onQuestionGateDiagnostic: (diagnostic) => {
      console.info(
        "[Relay V2 acceptance gate]",
        JSON.stringify(diagnostic)
      );
    },
    onAcceptedQuestion: (
      question,
      source,
      understanding,
      originatingSessionId
    ) => {
      if (!liveAssistService) {
        return Promise.reject(new Error(
          "Live Assist session service is unavailable."
        ));
      }
      const expectedSessionId =
        originatingSessionId ??
        liveAssistService.getActiveSession()?.id;
      if (!expectedSessionId) return Promise.resolve();
      // Durable acceptance occurs synchronously before acceptQuestion reaches
      // answer execution. Do not hold the STT promotion queue for the full
      // answer so rapid completed questions can become independent turns.
      void liveAssistService
        .acceptQuestion(
          question,
          source,
          expectedSessionId,
          understanding
        )
        .catch((error) => {
          console.error("[Relay Live Assist answer]", error);
        });
      return Promise.resolve();
    },
    sendStatus,
    sendTranscript,
    onArbitrationDiagnostic: (diagnostic) => {
      console.info(
        "[Relay Live Assist arbitration]",
        JSON.stringify(diagnostic)
      );
    },
    onSttDiagnostic: (diagnostic) => {
      console.info(
        "[Relay Deepgram event]",
        JSON.stringify(diagnostic)
      );
    }
  });
}

/**
 * QA Assist always forces system-only capture, regardless of the user's
 * configured Relay settings capture mode. Normal Live Assist continues to
 * use the configured microphone/system/both mode. Main dictates this to
 * the renderer via the capture-start command rather than letting the
 * renderer infer it from settings.
 */
function sourceModeForProfile(
  profile: "live_assist" | "qa_assist"
): "system" | "microphone" | "both" {
  return profile === "qa_assist"
    ? "system"
    : settingsStore.getRelaySettings().speech.captureSourceMode;
}

function startLiveAssistSession(
  conversationId: string,
  profile: "live_assist" | "qa_assist"
): LiveAssistSessionView {
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
  const readiness =
    (v2Runtime ?? refreshV2Runtime()).getReadiness();
  if (readiness.state !== "ready") {
    throw new HelpdeskServiceError(
      "invalid_request",
      `V2 unavailable: ${
        readiness.reason === "model_not_configured"
          ? "model not configured"
          : readiness.reason === "api_key_missing"
            ? "OpenAI API key not configured"
            : "provider could not be constructed"
      }.`
    );
  }
  const session = liveAssistService.start(conversationId, profile);
  helpdeskWindow?.webContents.send(
    IPC_CHANNELS.liveAssistCaptureCommand,
    {
      action: "start",
      sessionId: session.id,
      sourceMode: sourceModeForProfile(profile)
    }
  );
  if (settingsStore.getRelaySettings().overlay.autoShow) {
    void showOverlay();
  }
  return session;
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
      if (
        activeSession.profile === "qa_assist" &&
        config.sources.includes("microphone")
      ) {
        // Defense-in-depth: QA Assist must never instantiate a
        // microphone provider, even if a client requested it.
        throw new Error(
          "QA Assist sessions must not request microphone capture."
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
        if (
          config.sources.length === 1 &&
          config.sources[0] === "system"
        ) {
          try {
            await getRenderCapture().start(config.sessionId);
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Render endpoint capture failed.";
            helpdeskWindow?.webContents.send(
              IPC_CHANNELS.renderCaptureStatus,
              {
                ...idleRenderCaptureStatus(),
                listenState: "error",
                message
              }
            );
          }
        }
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
      await stopRenderCapture();
      await pipelineManager?.stop();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.renderCaptureGetStatus,
    (event) => {
      if (!isHelpdeskSender(event.sender.id)) {
        throw new Error("Render capture status is not allowed.");
      }
      return renderCapture?.getStatus() ?? idleRenderCaptureStatus();
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.renderCaptureSelect,
    async (event, endpointId: unknown) => {
      if (!isHelpdeskSender(event.sender.id)) {
        throw new Error("Render capture select is not allowed.");
      }
      if (typeof endpointId !== "string" || !endpointId.trim()) {
        throw new Error("A render endpoint ID is required.");
      }
      return getRenderCapture().select(endpointId.trim());
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
      if (
        activeSession.profile === "qa_assist" &&
        payload.source === "microphone"
      ) {
        // Defense-in-depth: drop any microphone audio that reaches the
        // ingestion boundary during a QA Assist session.
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
    startLiveAssist: (conversationId) =>
      startLiveAssistSession(conversationId, "live_assist"),
    startQaAssist: (conversationId) =>
      startLiveAssistSession(conversationId, "qa_assist"),
    stopLiveAssist: async () => {
      const active = liveAssistService?.getActiveSession();
      if (!active) return null;
      await stopRenderCapture();
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
      getRelaySettingsSnapshot(),
    updateRelaySettings: (input) => {
      settingsStore.updateRelaySettings(input);
      applyOverlaySettings();
      return getRelaySettingsSnapshot();
    },
    setProviderCredential: (provider, credential) => {
      settingsStore.setProviderCredential(
        provider,
        credential
      );
      if (provider === "openai_embeddings") refreshV2Runtime();
      return getRelaySettingsSnapshot();
    },
    clearProviderCredential: (provider) => {
      settingsStore.clearProviderCredential(provider);
      if (provider === "openai_embeddings") refreshV2Runtime();
      return getRelaySettingsSnapshot();
    },
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
  refreshV2Runtime();
  initLoopbackMain();
  conversationStore = createSqliteConversationStore({
    databasePath: resolveConversationDatabasePath({
      userDataPath: app.getPath("userData")
    })
  });
  evidenceChild = new LearnRagChild({
    onStatusChange: sendEvidenceStatus
  });
  sendEvidenceStatus(evidenceChild.getStatus());
  helpdeskService = new HelpdeskService(
    conversationStore,
    new EvidenceAnswerExecutionPort(
      createEvidenceSearchClient(evidenceChild),
      {
        synthesis: {
          getReadiness: () =>
            (v2Runtime ?? refreshV2Runtime()).getReadiness(),
          synthesize: (input) =>
            (v2Runtime ?? refreshV2Runtime()).synthesize(input)
        },
        onLatencyEvent: (event) => {
          console.info(
            "[Relay live latency]",
            JSON.stringify(event)
          );
        }
      }
    )
  );
  void evidenceChild.start().catch((error) => {
    console.error("[Relay evidence] child failed to start", error);
  });
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
      },
      microphoneRejected: (event) => {
        console.info(
          "[Relay QA Assist] microphone-sourced question rejected",
          JSON.stringify(event)
        );
      }
    },
    { requireSemanticComplete: true }
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
    await stopRenderCapture();
    await pipelineManager?.stop();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    void stopRenderCapture();
    liveAssistService?.stop("application_shutdown");
    evidenceChild?.dispose();
    evidenceChild = null;
    conversationStore?.close();
    conversationStore = null;
    helpdeskService = null;
    liveAssistService = null;
  });
}
