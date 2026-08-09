import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import type { OverlayPrefs } from "@shared/types";

export function createOverlayWindow(
  preferences: OverlayPrefs,
  demoMode = false
): BrowserWindow {
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
      preload: join(__dirname, "../preload/overlay.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({
    action: "deny"
  }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  // Demo mode turns capture exclusion off so the overlay appears in screen shares.
  window.setContentProtection(!demoMode);
  window.setOpacity(preferences.opacity);

  return window;
}
