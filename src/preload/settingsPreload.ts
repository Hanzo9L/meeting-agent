import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/constants";
import type { SettingsApi } from "@shared/types";

const settingsApi: SettingsApi = {
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateTopic: (topic) => ipcRenderer.invoke(IPC_CHANNELS.updateTopic, topic),
  updateApiKeys: (apiKeys) => ipcRenderer.invoke(IPC_CHANNELS.updateApiKeys, apiKeys),
  updateOverlayPrefs: (prefs) => ipcRenderer.invoke(IPC_CHANNELS.updateOverlayPrefs, prefs),
  updateHotkey: (hotkey) => ipcRenderer.invoke(IPC_CHANNELS.updateHotkey, hotkey)
};

contextBridge.exposeInMainWorld("settingsApi", settingsApi);
