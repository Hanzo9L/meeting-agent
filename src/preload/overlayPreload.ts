import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type { OverlayApi } from "@shared/types";

const overlayApi = Object.freeze<OverlayApi>({
  getLiveAssistHydration: () =>
    ipcRenderer.invoke(IPC_CHANNELS.liveAssistGetHydration),
  hideOverlay: () =>
    ipcRenderer.invoke(IPC_CHANNELS.relayOverlayHide),
  getDemoMode: () => ipcRenderer.invoke(IPC_CHANNELS.getDemoMode),
  openLiveCitation: (messageId, citationId) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.liveAssistOpenCitation,
      messageId,
      citationId
    ),
  onLiveAssistProjection: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      projection: Parameters<typeof handler>[0]
    ) => handler(projection);
    ipcRenderer.on(IPC_CHANNELS.liveAssistProjection, listener);
    return () =>
      ipcRenderer.off(IPC_CHANNELS.liveAssistProjection, listener);
  },
  onLiveAssistSession: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      session: Parameters<typeof handler>[0]
    ) => handler(session);
    ipcRenderer.on(IPC_CHANNELS.liveAssistSessionChanged, listener);
    return () =>
      ipcRenderer.off(IPC_CHANNELS.liveAssistSessionChanged, listener);
  },
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
  onStatus: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof handler>[0]) =>
      handler(status);
    ipcRenderer.on(IPC_CHANNELS.connectionStatus, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.connectionStatus, listener);
  },
  onEvidenceStatus: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: Parameters<typeof handler>[0]
    ) => handler(status);
    ipcRenderer.on(IPC_CHANNELS.liveAssistEvidenceStatus, listener);
    return () =>
      ipcRenderer.off(IPC_CHANNELS.liveAssistEvidenceStatus, listener);
  }
});

contextBridge.exposeInMainWorld("overlayApi", overlayApi);
