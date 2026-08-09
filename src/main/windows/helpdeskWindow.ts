import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createHelpdeskWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    title: "Relay: Real-Time Operations",
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#101114",
    webPreferences: {
      preload: join(__dirname, "../preload/helpdesk.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Matches existing electron-vite ESM preload windows; context isolation
      // remains the renderer security boundary.
      sandbox: false
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && url !== currentUrl) {
      event.preventDefault();
    }
  });

  return window;
}
