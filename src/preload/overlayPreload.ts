import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type { OverlayApi } from "@shared/types";

const overlayApi: OverlayApi = {
  startCapture: () => ipcRenderer.invoke(IPC_CHANNELS.startCapture),
  stopCapture: () => ipcRenderer.invoke(IPC_CHANNELS.stopCapture),
  clearFeed: () => ipcRenderer.invoke(IPC_CHANNELS.clearFeed),
  enableLoopbackAudio: () => ipcRenderer.invoke("enable-loopback-audio"),
  disableLoopbackAudio: () => ipcRenderer.invoke("disable-loopback-audio"),
  sendAudioChunk: (buffer) => ipcRenderer.send(IPC_CHANNELS.audioChunk, buffer),
  onTranscript: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.transcript, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.transcript, listener);
  },
  onAnswerChunk: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) =>
      handler(payload);
    ipcRenderer.on(IPC_CHANNELS.answerChunk, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.answerChunk, listener);
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
