import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderEndpoint, RenderEndpointSnapshot } from "@shared/renderEndpoint";

export interface WasapiLoopbackHandlers {
  onPcm(chunk: Int16Array): void;
  onGone(): void;
  onError(message: string): void;
}

const SOURCE_NAME = "RelayWasapiCapture.cs";

export function resolveWasapiSourcePath(appPath?: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "native", SOURCE_NAME),
    join(process.cwd(), "src/main/audio/native", SOURCE_NAME),
    appPath ? join(appPath, "src/main/audio/native", SOURCE_NAME) : ""
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("WASAPI capture helper source is missing.");
}

export function findCscPath(): string {
  const roots = [
    process.env["WINDIR"] ?? "C:\\Windows",
    "C:\\Windows"
  ];
  for (const root of roots) {
    const candidates = [
      join(root, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
      join(root, "Microsoft.NET/Framework/v4.0.30319/csc.exe")
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Windows C# compiler (csc.exe) was not found.");
}

export function parseRenderEndpointSnapshot(
  raw: string
): RenderEndpointSnapshot {
  const parsed = JSON.parse(raw) as {
    defaultId?: string | null;
    communicationsDefaultId?: string | null;
    endpoints?: Array<{
      id?: string;
      name?: string;
      isDefault?: boolean;
      isCommunicationsDefault?: boolean;
      sessions?: Array<{
        processId?: number;
        processName?: string;
        displayName?: string;
        state?: string;
        peak?: number;
      }>;
    }>;
  };
  const endpoints: RenderEndpoint[] = (parsed.endpoints ?? [])
    .filter((endpoint) => typeof endpoint.id === "string" && endpoint.id)
    .map((endpoint) => ({
      id: endpoint.id as string,
      name:
        typeof endpoint.name === "string" && endpoint.name.trim()
          ? endpoint.name
          : (endpoint.id as string),
      isDefault: endpoint.isDefault === true,
      isCommunicationsDefault: endpoint.isCommunicationsDefault === true,
      sessions: (endpoint.sessions ?? []).map((session) => ({
        processId: Number(session.processId) || 0,
        processName:
          typeof session.processName === "string" ? session.processName : "",
        displayName:
          typeof session.displayName === "string" ? session.displayName : "",
        state:
          session.state === "active" || session.state === "expired"
            ? session.state
            : "inactive",
        peak: Number(session.peak) || 0
      }))
    }));
  return {
    defaultId:
      typeof parsed.defaultId === "string" ? parsed.defaultId : null,
    communicationsDefaultId:
      typeof parsed.communicationsDefaultId === "string"
        ? parsed.communicationsDefaultId
        : null,
    endpoints
  };
}

function helperOutputDir(userDataPath: string): string {
  const directory = join(userDataPath, "wasapi-capture");
  mkdirSync(directory, { recursive: true });
  return directory;
}

async function compileHelper(options: {
  userDataPath: string;
  appPath?: string;
}): Promise<string> {
  const sourcePath = resolveWasapiSourcePath(options.appPath);
  const source = readFileSync(sourcePath);
  const sourceVersion = createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 12);
  const outputPath = join(
    helperOutputDir(options.userDataPath),
    `RelayWasapiCapture-${sourceVersion}.exe`
  );
  if (existsSync(outputPath)) return outputPath;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const csc = findCscPath();
  const staging = join(helperOutputDir(options.userDataPath), SOURCE_NAME);
  writeFileSync(staging, source);
  await execFileAsync(csc, [
    "/nologo",
    "/optimize",
    `/out:${outputPath}`,
    staging
  ]);
  return outputPath;
}

export async function enumerateRenderEndpoints(options: {
  userDataPath: string;
  appPath?: string;
  excludeProcessIds?: number[];
}): Promise<RenderEndpointSnapshot> {
  const helper = await compileHelper(options);
  const args = ["--enumerate"];
  for (const pid of options.excludeProcessIds ?? []) {
    args.push("--exclude-pid", String(pid));
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(helper, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 2 * 1024 * 1024
  });
  return parseRenderEndpointSnapshot(String(stdout));
}

export class WasapiLoopbackProcess {
  private child: ChildProcess | null = null;
  private leftover = Buffer.alloc(0);

  async start(
    endpointId: string,
    options: {
      userDataPath: string;
      appPath?: string;
    },
    handlers: WasapiLoopbackHandlers
  ): Promise<void> {
    await this.stop();
    const helper = await compileHelper(options);
    const child = spawn(helper, ["--capture", endpointId], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      const combined = Buffer.concat([this.leftover, chunk]);
      const even = combined.length - (combined.length % 2);
      if (even > 0) {
        const slice = combined.subarray(0, even);
        const pcm = new Int16Array(
          slice.buffer,
          slice.byteOffset,
          slice.byteLength / 2
        );
        if (pcm.length > 0) handlers.onPcm(new Int16Array(pcm));
      }
      this.leftover = combined.subarray(even);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (text: string) => {
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as {
            event?: string;
            message?: string;
          };
          if (event.event === "gone") handlers.onGone();
          if (event.event === "error" && event.message) {
            handlers.onError(event.message);
          }
        } catch {
          handlers.onError(line.trim());
        }
      }
    });
    child.on("exit", (code) => {
      if (this.child === child) this.child = null;
      if (code && code !== 0) {
        handlers.onGone();
      }
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.leftover = Buffer.alloc(0);
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 800);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}
