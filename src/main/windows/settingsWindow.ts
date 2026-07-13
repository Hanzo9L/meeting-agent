import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 560,
    height: 620,
    title: "Meeting Agent Settings",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../../preload/settings.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  return window;
}
