import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type { SettingsApi } from "@shared/types";

const settingsApi: SettingsApi = {
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateTopic: (topic) => ipcRenderer.invoke(IPC_CHANNELS.updateTopic, topic),
  updateApiKeys: (apiKeys) => ipcRenderer.invoke(IPC_CHANNELS.updateApiKeys, apiKeys),
  updateOverlayPrefs: (prefs) => ipcRenderer.invoke(IPC_CHANNELS.updateOverlayPrefs, prefs),
  updateDemoMode: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.updateDemoMode, enabled),
  updateKnowledgeBaseSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateKnowledgeBaseSettings, settings),
  getKnowledgeBaseStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getKnowledgeBaseStatus),
  syncKnowledgeBase: () => ipcRenderer.invoke(IPC_CHANNELS.syncKnowledgeBase)
};

contextBridge.exposeInMainWorld("settingsApi", settingsApi);
