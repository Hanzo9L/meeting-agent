import {
  PCM16_ACTIVITY_THRESHOLD,
  computePcm16ActivityLevel,
  resolveRenderEndpoint,
  toEndpointOptions,
  type RenderCaptureListenState,
  type RenderCaptureStatusView,
  type RenderEndpoint,
  type RenderEndpointSnapshot,
  type RenderResolveResult
} from "@shared/renderEndpoint";

export interface RememberedRenderEndpoint {
  id: string | null;
  label: string | null;
}

export interface RenderCaptureHost {
  enumerate(): Promise<RenderEndpointSnapshot>;
  startLoopback(
    endpointId: string,
    handlers: {
      onPcm(chunk: Int16Array): void;
      onGone(): void;
      onError(message: string): void;
    }
  ): Promise<void>;
  stopLoopback(): Promise<void>;
}

export interface RenderCaptureControllerOptions {
  host: RenderCaptureHost;
  getRemembered(): RememberedRenderEndpoint;
  setRemembered(id: string, label: string): void;
  onStatus(status: RenderCaptureStatusView): void;
  onSystemPcm(chunk: Int16Array): void;
  excludeProcessIds?: number[];
  pollMs?: number;
}

export class RenderCaptureController {
  private readonly host: RenderCaptureHost;
  private readonly getRemembered: () => RememberedRenderEndpoint;
  private readonly setRemembered: (id: string, label: string) => void;
  private readonly onStatus: (status: RenderCaptureStatusView) => void;
  private readonly onSystemPcm: (chunk: Int16Array) => void;
  private readonly excludeProcessIds: number[];
  private readonly pollMs: number;
  private sessionId: string | null = null;
  private snapshot: RenderEndpointSnapshot = {
    defaultId: null,
    endpoints: []
  };
  private selected: RenderEndpoint | null = null;
  private automatic = true;
  private explicitId: string | null = null;
  private listenState: RenderCaptureListenState = "idle";
  private message: string | null = null;
  private activityPeak = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private rebinding = false;

  private lastStatusAt = 0;

  constructor(options: RenderCaptureControllerOptions) {
    this.host = options.host;
    this.getRemembered = options.getRemembered;
    this.setRemembered = options.setRemembered;
    this.onStatus = options.onStatus;
    this.onSystemPcm = options.onSystemPcm;
    this.excludeProcessIds = options.excludeProcessIds ?? [];
    this.pollMs = options.pollMs ?? 1500;
  }

  getStatus(): RenderCaptureStatusView {
    return this.view();
  }

  async start(sessionId: string): Promise<RenderCaptureStatusView> {
    this.sessionId = sessionId;
    this.explicitId = null;
    this.activityPeak = 0;
    await this.refreshSnapshot();
    await this.applyResolution(this.resolve());
    this.startPolling();
    return this.view();
  }

  async select(endpointId: string): Promise<RenderCaptureStatusView> {
    if (!this.sessionId) {
      throw new Error("Render capture is not active.");
    }
    this.explicitId = endpointId;
    await this.refreshSnapshot();
    const chosen = this.snapshot.endpoints.find(
      (endpoint) => endpoint.id === endpointId
    );
    if (!chosen) {
      this.selected = null;
      this.listenState = "device_changed";
      this.message = "Audio output changed — select capture device";
      this.emit();
      return this.view();
    }
    this.setRemembered(chosen.id, chosen.name);
    this.automatic = false;
    await this.bind(chosen);
    return this.view();
  }

  async stop(): Promise<void> {
    this.stopPolling();
    this.sessionId = null;
    this.explicitId = null;
    this.selected = null;
    this.activityPeak = 0;
    this.listenState = "idle";
    this.message = null;
    await this.host.stopLoopback();
    this.emit();
  }

  private resolve(options?: { currentMissing?: boolean }): RenderResolveResult {
    const remembered = this.getRemembered();
    return resolveRenderEndpoint({
      endpoints: this.snapshot.endpoints,
      rememberedId: remembered.id,
      explicitId: this.explicitId,
      currentId: this.selected?.id ?? null,
      currentMissing: options?.currentMissing === true,
      excludeProcessIds: this.excludeProcessIds
    });
  }

  private async applyResolution(
    result: RenderResolveResult
  ): Promise<void> {
    if (result.status === "selected" && result.endpoint) {
      this.automatic = result.automatic;
      await this.bind(result.endpoint);
      return;
    }
    await this.host.stopLoopback();
    this.selected = null;
    this.activityPeak = 0;
    if (result.status === "missing" || result.reason === "explicit_missing") {
      this.listenState = "device_changed";
    } else {
      this.listenState = "needs_selection";
    }
    this.message = result.prompt;
    this.emit();
  }

  private async bind(endpoint: RenderEndpoint): Promise<void> {
    const previousId = this.selected?.id ?? null;
    if (previousId === endpoint.id && this.listenState !== "idle") {
      this.selected = endpoint;
      this.emit();
      return;
    }
    await this.host.stopLoopback();
    this.selected = endpoint;
    this.listenState = "no_system_audio";
    this.message = null;
    this.activityPeak = 0;
    await this.host.startLoopback(endpoint.id, {
      onPcm: (chunk) => this.handlePcm(chunk),
      onGone: () => {
        void this.handleGone();
      },
      onError: (errorMessage) => {
        this.listenState = "error";
        this.message = errorMessage;
        this.emit();
      }
    });
    this.emit();
  }

  private handlePcm(chunk: Int16Array): void {
    if (!this.sessionId || !this.selected) return;
    const level = computePcm16ActivityLevel(chunk);
    this.activityPeak = Math.max(level, this.activityPeak * 0.86);
    this.listenState =
      this.activityPeak >= PCM16_ACTIVITY_THRESHOLD
        ? "listening"
        : "no_system_audio";
    this.onSystemPcm(chunk);
    const now = Date.now();
    if (now - this.lastStatusAt >= 120) {
      this.lastStatusAt = now;
      this.emit();
    }
  }

  private async handleGone(): Promise<void> {
    if (!this.sessionId || this.rebinding) return;
    this.rebinding = true;
    try {
      this.selected = null;
      this.explicitId = null;
      await this.host.stopLoopback();
      await this.refreshSnapshot();
      await this.applyResolution(this.resolve({ currentMissing: true }));
      if (!this.selected) {
        this.listenState = "device_changed";
        this.message = "Audio output changed — select capture device";
        this.emit();
      }
    } finally {
      this.rebinding = false;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.sessionId || this.rebinding) return;
    await this.refreshSnapshot();
    const currentId = this.selected?.id ?? null;
    if (currentId && !this.snapshot.endpoints.some((item) => item.id === currentId)) {
      await this.handleGone();
      return;
    }
    const resolved = this.resolve();
    if (
      resolved.status === "selected" &&
      resolved.endpoint &&
      resolved.endpoint.id !== currentId
    ) {
      await this.bind(resolved.endpoint);
      return;
    }
    if (resolved.status === "ambiguous") {
      await this.host.stopLoopback();
      this.selected = null;
      this.listenState = currentId ? "device_changed" : "needs_selection";
      this.message = resolved.prompt;
      this.emit();
      return;
    }
    if (this.selected) {
      const fresh = this.snapshot.endpoints.find(
        (item) => item.id === this.selected?.id
      );
      if (fresh) this.selected = fresh;
    }
    this.emit();
  }

  private async refreshSnapshot(): Promise<void> {
    this.snapshot = await this.host.enumerate();
  }

  private emit(): void {
    this.onStatus(this.view());
  }

  private view(): RenderCaptureStatusView {
    return {
      listenState: this.listenState,
      selectedEndpointId: this.selected?.id ?? null,
      selectedEndpointName: this.selected?.name ?? null,
      automatic: this.automatic,
      message: this.message,
      activityLevel: this.activityPeak,
      endpoints: toEndpointOptions(this.snapshot.endpoints)
    };
  }
}
