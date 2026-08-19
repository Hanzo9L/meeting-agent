import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { EvidenceReadinessStatus } from "@shared/types";

export const BRIDGE_READY_ID = "__bridge_ready__";

export interface LearnRagChildOptions {
  pythonExecutable?: string;
  learnRagRoot?: string;
  startTimeoutMs?: number;
  searchTimeoutMs?: number;
  bridgeScript?: string;
  onStatusChange?: (status: EvidenceReadinessStatus) => void;
}

export interface LearnRagReadyInfo {
  engine: string;
  corpusFingerprint: string;
  indexFingerprint: string;
  searchHash?: string;
  scopeHash?: string;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LearnRagChildError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LearnRagChildError";
  }
}

export function resolveLearnRagRoot(explicit?: string): string {
  return (
    explicit ??
    process.env["RELAY_LEARN_RAG_ROOT"] ??
    "C:\\Users\\joegc\\projects\\learn-rag\\learn-rag"
  );
}

export function resolvePythonExecutable(
  explicit?: string,
  learnRagRoot?: string
): string {
  if (explicit ?? process.env["RELAY_PYTHON"]) {
    return explicit ?? process.env["RELAY_PYTHON"]!;
  }
  const root = resolveLearnRagRoot(learnRagRoot);
  const venvWindows = join(root, ".venv", "Scripts", "python.exe");
  if (existsSync(venvWindows)) return venvWindows;
  const venvUnix = join(root, ".venv", "bin", "python");
  if (existsSync(venvUnix)) return venvUnix;
  return "python";
}

export class LearnRagChild {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private readyInfo: LearnRagReadyInfo | null = null;
  private status: EvidenceReadinessStatus = "starting";
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;
  private exitWait: Promise<void> = Promise.resolve();

  constructor(private readonly options: LearnRagChildOptions = {}) {}

  getReadyInfo(): LearnRagReadyInfo | null {
    return this.readyInfo;
  }

  getStatus(): EvidenceReadinessStatus {
    return this.status;
  }

  start(): Promise<void> {
    if (this.disposed) {
      this.setStatus("failed");
      throw new LearnRagChildError(
        "child_disposed",
        "Microsoft evidence retrieval is unavailable."
      );
    }
    if (this.child && this.readyInfo) {
      this.setStatus("ready");
      return;
    }
    if (this.startPromise) return this.startPromise;
    this.setStatus("warming");
    this.startPromise = this.spawnAndWait()
      .then(() => {
        this.setStatus("ready");
      })
      .catch((error: unknown) => {
        this.setStatus("failed");
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  async request(
    payload: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<Record<string, unknown>> {
    await this.start();
    const child = this.child;
    if (!child?.stdin.writable) {
      throw new LearnRagChildError(
        "child_not_running",
        "Microsoft evidence retrieval is unavailable."
      );
    }
    const id = String(payload["id"] ?? randomUUID());
    const body = { ...payload, id };
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new LearnRagChildError(
            "search_timeout",
            "Microsoft evidence retrieval timed out."
          )
        );
      }, timeoutMs ?? this.options.searchTimeoutMs ?? 20_000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(body)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new LearnRagChildError(
            "child_write_failed",
            "Microsoft evidence retrieval is unavailable."
          )
        );
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.failPending("child_stopped", "Microsoft evidence retrieval stopped.");
    this.killProcess();
    this.readyInfo = null;
    this.setStatus("failed");
  }

  async waitUntilStopped(timeoutMs = 2_000): Promise<void> {
    await Promise.race([
      this.exitWait,
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }

  private async spawnAndWait(): Promise<void> {
    const root = resolveLearnRagRoot(this.options.learnRagRoot);
    const python = resolvePythonExecutable(
      this.options.pythonExecutable,
      root
    );
    const script =
      this.options.bridgeScript ?? join(root, "service", "relay_bridge.py");
    if (!existsSync(root)) {
      throw new LearnRagChildError(
        "learn_rag_path_invalid",
        "Microsoft evidence retrieval is unavailable."
      );
    }
    if (!existsSync(script)) {
      throw new LearnRagChildError(
        "bridge_missing",
        "Microsoft evidence retrieval is unavailable."
      );
    }
    const corpus = join(root, "data", "corpus.db");
    const index = join(root, "data", "hnsw.bin");
    if (!this.options.bridgeScript && !existsSync(corpus)) {
      throw new LearnRagChildError(
        "corpus_missing",
        "Microsoft evidence retrieval is unavailable."
      );
    }
    if (!this.options.bridgeScript && !existsSync(index)) {
      throw new LearnRagChildError(
        "index_missing",
        "Microsoft evidence retrieval is unavailable."
      );
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const startTimer = setTimeout(() => {
        finish(
          new LearnRagChildError(
            "engine_init_failed",
            "Microsoft evidence retrieval is still warming or failed to start."
          )
        );
      }, this.options.startTimeoutMs ?? 90_000);

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        if (error) {
          this.killProcess();
          reject(error);
          return;
        }
        resolve();
      };

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(python, ["-u", script], {
          cwd: root,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
            PYTHONPATH: root
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
      } catch {
        finish(
          new LearnRagChildError(
            "python_unavailable",
            "Microsoft evidence retrieval is unavailable."
          )
        );
        return;
      }

      this.child = child;
      this.exitWait = new Promise((resolve) => {
        child.once("exit", () => resolve());
      });
      child.on("error", (error) => {
        const code =
          "code" in error && error.code === "ENOENT"
            ? "python_unavailable"
            : "child_error";
        this.failPending(code, "Microsoft evidence retrieval is unavailable.");
        finish(
          new LearnRagChildError(
            code,
            "Microsoft evidence retrieval is unavailable."
          )
        );
      });
      child.stderr.on("data", (chunk: Buffer) => {
        console.error("[Relay evidence]", chunk.toString("utf8").trimEnd());
      });
      const reader = createInterface({
        input: child.stdout,
        crlfDelay: Infinity
      });
      reader.on("line", (line) => {
        this.handleLine(line, finish);
      });
      child.on("exit", (code, signal) => {
        this.child = null;
        this.readyInfo = null;
        this.failPending(
          "child_exited",
          "Microsoft evidence retrieval is unavailable."
        );
        if (settled) {
          this.setStatus("failed");
        }
        if (!settled) {
          finish(
            new LearnRagChildError(
              "child_exited",
              `Microsoft evidence child exited (${code ?? signal ?? "unknown"}).`
            )
          );
        }
      });
    });
  }

  private handleLine(
    line: string,
    finishStart: (error?: Error) => void
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      console.error("[Relay evidence] ignored non-JSON stdout line");
      return;
    }
    const id = String(payload["id"] ?? "");
    if (id === BRIDGE_READY_ID) {
      if (payload["ok"] === true && payload["event"] === "ready") {
        this.readyInfo = {
          engine: String(payload["engine"] ?? "learn-rag-r0.4"),
          corpusFingerprint: String(payload["corpusFingerprint"] ?? ""),
          indexFingerprint: String(payload["indexFingerprint"] ?? ""),
          searchHash:
            typeof payload["searchHash"] === "string"
              ? payload["searchHash"]
              : undefined,
          scopeHash:
            typeof payload["scopeHash"] === "string"
              ? payload["scopeHash"]
              : undefined
        };
        finishStart();
        return;
      }
      const error = payload["error"];
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "engine_init_failed";
      finishStart(
        new LearnRagChildError(
          code,
          "Microsoft evidence retrieval is unavailable."
        )
      );
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(payload);
  }

  private setStatus(status: EvidenceReadinessStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  private failPending(code: string, message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new LearnRagChildError(code, message));
      this.pending.delete(id);
    }
  }

  private killProcess(): void {
    const child = this.child;
    this.child = null;
    this.readyInfo = null;
    if (!child || child.killed) return;
    try {
      child.stdin.end();
    } catch {
      // Ignore stdin close races during shutdown.
    }
    child.kill();
  }
}
