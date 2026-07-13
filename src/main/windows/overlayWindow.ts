import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import type { OverlayPrefs } from "@shared/types";

export function createOverlayWindow(preferences: OverlayPrefs): BrowserWindow {
  const { width: displayWidth, height: displayHeight } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(preferences.width, displayWidth);
  const height = Math.min(preferences.height, displayHeight);

  const window = new BrowserWindow({
    width,
    height,
    x: preferences.x,
    y: preferences.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../../preload/overlay.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setContentProtection(true);
  window.setOpacity(preferences.opacity);

  return window;
}
