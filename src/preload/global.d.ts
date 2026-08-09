import type { HelpdeskApi } from "@shared/helpdesk";
import type { OverlayApi } from "@shared/types";

declare global {
  interface Window {
    overlayApi: OverlayApi;
    helpdeskApi: HelpdeskApi;
  }
}

export {};
