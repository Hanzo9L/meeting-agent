import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type { OverlayApi } from "@shared/types";

const overlayApi: OverlayApi = {
  startCapture: (config) => ipcRenderer.invoke(IPC_CHANNELS.startCapture, config),
  stopCapture: () => ipcRenderer.invoke(IPC_CHANNELS.stopCapture),
  askQuestion: (question) => ipcRenderer.invoke(IPC_CHANNELS.askQuestion, question),
  clearFeed: () => ipcRenderer.invoke(IPC_CHANNELS.clearFeed),
  enableLoopbackAudio: () => ipcRenderer.invoke("enable-loopback-audio"),
  disableLoopbackAudio: () => ipcRenderer.invoke("disable-loopback-audio"),
  sendAudioChunk: (payload) => ipcRenderer.send(IPC_CHANNELS.audioChunk, payload),
  getRuntimeCaptureConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeCaptureConfig),
  getDemoMode: () => ipcRenderer.invoke(IPC_CHANNELS.getDemoMode),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  onDemoMode: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => handler(enabled);
    ipcRenderer.on(IPC_CHANNELS.demoModeChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.demoModeChanged, listener);
  },
  onTranscript: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.transcript, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.transcript, listener);
  },
  onAnswerStart: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.answerStart, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.answerStart, listener);
  },
  onAnswerChunk: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.answerChunk, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.answerChunk, listener);
  },
  onAnswerSources: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.answerSources, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.answerSources, listener);
  },
  onAnswerDone: (handler) => {
    const listener = () => handler();
    ipcRenderer.on(IPC_CHANNELS.answerDone, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.answerDone, listener);
  },
  onStatus: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof handler>[0]) =>
      handler(status);
    ipcRenderer.on(IPC_CHANNELS.connectionStatus, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.connectionStatus, listener);
  }
};

contextBridge.exposeInMainWorld("overlayApi", overlayApi);
