import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeTheme
} from "electron";
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

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let pipelineManager: PipelineManager | null = null;
const settingsStore = new SettingsStore();

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

function registerHotkey(hotkey: string): void {
  globalShortcut.unregisterAll();
  globalShortcut.register(hotkey, () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.showInactive();
    }
  });
}

function createWindows(): void {
  const settings = settingsStore.getSettings();
  overlayWindow = createOverlayWindow(settings.overlay);
  settingsWindow = createSettingsWindow();

  if (process.env["ELECTRON_RENDERER_URL"]) {
    overlayWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/src/renderer/overlay/index.html`);
    settingsWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/src/renderer/settings/index.html`);
  } else {
    overlayWindow.loadFile(join(rendererRoot, "overlay/index.html"));
    settingsWindow.loadFile(join(rendererRoot, "settings/index.html"));
  }

  registerHotkey(settings.hotkey);
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

  ipcMain.handle(IPC_CHANNELS.updateHotkey, (_event, hotkey: string) => {
    settingsStore.updateHotkey(hotkey);
    registerHotkey(hotkey);
  });

  ipcMain.handle(IPC_CHANNELS.startCapture, async () => {
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

  ipcMain.on(IPC_CHANNELS.audioChunk, (_event, audioBuffer: ArrayBuffer) => {
    if (!pipelineManager) return;
    const chunk = new Int16Array(audioBuffer);
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

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
