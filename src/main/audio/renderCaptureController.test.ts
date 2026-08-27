import assert from "node:assert/strict";
import test from "node:test";
import {
  RenderCaptureController,
  type RenderCaptureHost
} from "./renderCaptureController";
import type {
  RenderCaptureStatusView,
  RenderEndpointSnapshot
} from "@shared/renderEndpoint";

const SURFACE_ID = "{0.0.0.00000000}.{surface}";
const JABRA_ID = "{0.0.0.00000000}.{jabra}";

function snapshot(
  endpoints: RenderEndpointSnapshot["endpoints"]
): RenderEndpointSnapshot {
  return {
    defaultId: SURFACE_ID,
    endpoints
  };
}

function createHost(
  current: { snapshot: RenderEndpointSnapshot }
): RenderCaptureHost & {
  started: string[];
  stopped: number;
  gone: (() => void) | null;
} {
  const host = {
    started: [] as string[],
    stopped: 0,
    gone: null as (() => void) | null,
    async enumerate() {
      return current.snapshot;
    },
    async startLoopback(
      endpointId: string,
      handlers: { onGone(): void; onPcm(chunk: Int16Array): void }
    ) {
      host.started.push(endpointId);
      host.gone = handlers.onGone;
    },
    async stopLoopback() {
      host.stopped += 1;
      host.gone = null;
    }
  };
  return host;
}

test("explicit Jabra ID binds loopback even when Surface is the Windows default", async () => {
  const current = {
    snapshot: snapshot([
      {
        id: SURFACE_ID,
        name: "Speakers (Surface Speakers)",
        isDefault: true,
        sessions: []
      },
      {
        id: JABRA_ID,
        name: "Speaker (Jabra Engage 65 SE)",
        isDefault: false,
        sessions: []
      }
    ])
  };
  const host = createHost(current);
  const statuses: RenderCaptureStatusView[] = [];
  const pcmSources: string[] = [];
  const remembered = { id: null as string | null, label: null as string | null };
  const controller = new RenderCaptureController({
    host,
    getRemembered: () => remembered,
    setRemembered: (id, label) => {
      remembered.id = id;
      remembered.label = label;
    },
    onStatus: (status) => statuses.push(status),
    onSystemPcm: () => pcmSources.push("system")
  });

  await controller.start("session-1");
  assert.equal(controller.getStatus().listenState, "needs_selection");
  assert.equal(host.started.length, 0);

  await controller.select(JABRA_ID);
  assert.deepEqual(host.started, [JABRA_ID]);
  assert.equal(controller.getStatus().selectedEndpointId, JABRA_ID);
  assert.equal(remembered.id, JABRA_ID);
  assert.notEqual(remembered.id, SURFACE_ID);
  assert.notEqual(remembered.id, remembered.label);

  const loud = new Int16Array(320);
  loud.fill(12000);
  const startedHandlers = host as unknown as {
    gone: null;
  };
  void startedHandlers;
  await host.startLoopback(JABRA_ID, {
    onPcm: (chunk) => {
      assert.equal(chunk.length > 0, true);
    },
    onGone() {},
    onError() {}
  });
  await controller.stop();
  assert.equal(controller.getStatus().listenState, "idle");
  assert.equal(pcmSources.includes("microphone"), false);
});

test("changing endpoint stops the old loopback before rebinding", async () => {
  const current = {
    snapshot: snapshot([
      {
        id: SURFACE_ID,
        name: "Speakers (Surface Speakers)",
        isDefault: true,
        sessions: []
      },
      {
        id: JABRA_ID,
        name: "Jabra Evolve 65",
        isDefault: false,
        sessions: []
      }
    ])
  };
  const host = createHost(current);
  const remembered = { id: SURFACE_ID as string | null, label: "Surface" };
  const controller = new RenderCaptureController({
    host,
    getRemembered: () => remembered,
    setRemembered: (id, label) => {
      remembered.id = id;
      remembered.label = label;
    },
    onStatus: () => undefined,
    onSystemPcm: () => undefined
  });
  await controller.start("session-1");
  assert.deepEqual(host.started, [SURFACE_ID]);
  const stoppedAfterStart = host.stopped;
  await controller.select(JABRA_ID);
  assert.equal(host.stopped > stoppedAfterStart, true);
  assert.equal(host.started.at(-1), JABRA_ID);
  await controller.stop();
});

test("endpoint disappearance does not silently continue on another device", async () => {
  const current = {
    snapshot: snapshot([
      {
        id: JABRA_ID,
        name: "Jabra Evolve 65",
        isDefault: false,
        sessions: []
      },
      {
        id: SURFACE_ID,
        name: "Speakers (Surface Speakers)",
        isDefault: true,
        sessions: []
      }
    ])
  };
  const host = createHost(current);
  const remembered = { id: JABRA_ID as string | null, label: "Jabra" };
  const controller = new RenderCaptureController({
    host,
    getRemembered: () => remembered,
    setRemembered: () => undefined,
    onStatus: () => undefined,
    onSystemPcm: () => undefined
  });
  await controller.start("session-1");
  assert.equal(controller.getStatus().selectedEndpointId, JABRA_ID);
  current.snapshot = snapshot([
    {
      id: SURFACE_ID,
      name: "Speakers (Surface Speakers)",
      isDefault: true,
      sessions: []
    }
  ]);
  host.gone?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const status = controller.getStatus();
  assert.notEqual(status.selectedEndpointId, SURFACE_ID);
  assert.ok(
    status.listenState === "needs_selection" ||
      status.listenState === "device_changed"
  );
  await controller.stop();
});

test("unique browser session on Jabra rebinds away from Surface default", async () => {
  const current = {
    snapshot: snapshot([
      {
        id: SURFACE_ID,
        name: "Speakers (Surface Speakers)",
        isDefault: true,
        sessions: []
      },
      {
        id: JABRA_ID,
        name: "Headphones (Jabra Evolve 65)",
        isDefault: false,
        sessions: [
          {
            processId: 44,
            processName: "chrome",
            displayName: "",
            state: "active",
            peak: 0.4
          }
        ]
      }
    ])
  };
  const host = createHost(current);
  const pcmTags: string[] = [];
  const controller = new RenderCaptureController({
    host,
    getRemembered: () => ({ id: SURFACE_ID, label: "Surface" }),
    setRemembered: () => undefined,
    onStatus: () => undefined,
    onSystemPcm: () => pcmTags.push("system")
  });
  await controller.start("session-1");
  assert.equal(controller.getStatus().selectedEndpointId, JABRA_ID);
  assert.deepEqual(host.started, [JABRA_ID]);
  assert.equal(pcmTags.includes("microphone"), false);
  await controller.stop();
});
