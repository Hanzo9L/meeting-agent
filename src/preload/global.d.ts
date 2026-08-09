import type { HelpdeskApi } from "@shared/helpdesk";
import type { OverlayApi, SettingsApi } from "@shared/types";

declare global {
  interface Window {
    overlayApi: OverlayApi;
    settingsApi: SettingsApi;
    helpdeskApi: HelpdeskApi;
  }
}

export {};
