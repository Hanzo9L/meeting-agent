import "dotenv/config";
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme
} from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initMain as initLoopbackMain } from "electron-audio-loopback";
import { IPC_CHANNELS } from "@shared/constants";
import { SettingsStore } from "./store/settingsStore";
import { createOverlayWindow } from "./windows/overlayWindow";
import { createSettingsWindow } from "./windows/settingsWindow";
import { DeepgramSttProvider } from "./services/deepgramSttProvider";
import { OpenAiLlmProvider } from "./services/openAiLlmProvider";
import { PipelineManager } from "./services/pipelineManager";
import type { ApiKeys, ConnectionStatus, OverlayPrefs } from "@shared/types";

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
let pipelineManager: PipelineManager | null = null;
const settingsStore = new SettingsStore();
let audioChunkCount = 0;

function sendStatus(status: ConnectionStatus): void {
  overlayWindow?.webContents.send(IPC_CHANNELS.connectionStatus, status);
}

function createPipeline(): PipelineManager {
  const { apiKeys } = settingsStore.getSettings();
  return new PipelineManager({
    sttProvider: new DeepgramSttProvider(apiKeys.deepgramApiKey),
    llmProvider: new OpenAiLlmProvider(apiKeys.openAiApiKey),
    getTopic: () => {
      const settings = settingsStore.getSettings();
      return { topic: settings.topic, topicPromptTemplate: settings.topicPromptTemplate };
    },
    sendStatus
  });
}

function createWindows(): void {
  const settings = settingsStore.getSettings();
  overlayWindow = createOverlayWindow(settings.overlay);
  settingsWindow = createSettingsWindow();

  if (process.env["ELECTRON_RENDERER_URL"]) {
    overlayWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/overlay/index.html`);
    settingsWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/settings/index.html`);
  } else {
    overlayWindow.loadFile(join(rendererRoot, "overlay/index.html"));
    settingsWindow.loadFile(join(rendererRoot, "settings/index.html"));
  }

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
    settingsWindow?.focus();
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getSettings, () => settingsStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.updateTopic, (_event, topic: string) => {
    settingsStore.updateTopic(topic);
  });

  ipcMain.handle(IPC_CHANNELS.updateApiKeys, (_event, apiKeys: ApiKeys) => {
    settingsStore.updateApiKeys(apiKeys);
    pipelineManager = null;
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

  ipcMain.handle(IPC_CHANNELS.startCapture, async () => {
    audioChunkCount = 0;
    if (!pipelineManager) {
      pipelineManager = createPipeline();
    }
    await pipelineManager.start();
  });

  ipcMain.handle(IPC_CHANNELS.stopCapture, async () => {
    await pipelineManager?.stop();
  });

  ipcMain.handle(IPC_CHANNELS.clearFeed, () => {
    overlayWindow?.webContents.send(IPC_CHANNELS.answerDone);
  });

  ipcMain.on(IPC_CHANNELS.audioChunk, (_event, audioBuffer: unknown) => {
    if (!pipelineManager) return;
    let chunk: Int16Array | null = null;
    if (audioBuffer instanceof ArrayBuffer) {
      chunk = new Int16Array(audioBuffer);
    } else if (ArrayBuffer.isView(audioBuffer)) {
      chunk = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, Math.floor(audioBuffer.byteLength / 2));
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
    pipelineManager.sendAudioChunk(chunk);
  });
}

app.whenReady().then(() => {
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
  process.env["MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY"] = preloadRoot;
  nativeTheme.themeSource = "dark";

  initLoopbackMain();
  createWindows();
  registerIpcHandlers();
  sendStatus("idle");
});

app.on("window-all-closed", async () => {
  await pipelineManager?.stop();
  if (process.platform !== "darwin") app.quit();
});
