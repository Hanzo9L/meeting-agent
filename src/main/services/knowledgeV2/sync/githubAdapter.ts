import type { GitHubRepositoryClient, GitTreeEntry } from "./types";

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const GITHUB_API_VERSION = "2022-11-28";

type AuthMode = "token" | "anonymous";

export interface GitHubRequestDiagnostic {
  method: "GET";
  host: string;
  path: string;
  authMode: AuthMode;
  authorizationPresent: boolean;
  acceptHeader: string;
  apiVersionHeader: string;
  responseStatus: number;
  responseHeaders: Record<string, string | null>;
  fallbackAttempted: boolean;
  errorCategory: "none" | "http_error" | "network_error";
  message?: string;
}

export class GitHubApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export class GitHubRestRepositoryClient implements GitHubRepositoryClient {
  private readonly apiBaseUrl: string;
  private readonly token: string | undefined;
  private readonly maxRetries: number;
  private readonly allowAnonymousFallbackForPublicRead: boolean;
  private readonly onDiagnostic?: (event: GitHubRequestDiagnostic) => void;

  constructor(params?: {
    apiBaseUrl?: string;
    token?: string;
    maxRetries?: number;
    allowAnonymousFallbackForPublicRead?: boolean;
    onDiagnostic?: (event: GitHubRequestDiagnostic) => void;
  }) {
    this.apiBaseUrl = params?.apiBaseUrl ?? "https://api.github.com";
    this.token = params?.token ?? process.env.GITHUB_TOKEN;
    this.maxRetries = params?.maxRetries ?? 2;
    this.allowAnonymousFallbackForPublicRead = params?.allowAnonymousFallbackForPublicRead ?? true;
    this.onDiagnostic = params?.onDiagnostic;
  }

  async resolveBranchHead(params: {
    owner: string;
    repo: string;
    branch: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const response = await this.requestJson<{ commit?: { sha?: string } }>(
      `/repos/${params.owner}/${params.repo}/branches/${encodeURIComponent(params.branch)}`,
      params.signal
    );
    const sha = response.commit?.sha;
    if (!sha) {
      throw new GitHubApiError(
        `Missing commit SHA for branch ${params.owner}/${params.repo}#${params.branch}.`,
        500,
        false
      );
    }
    return sha;
  }

  async listTree(params: {
    owner: string;
    repo: string;
    ref: string;
    signal?: AbortSignal;
  }): Promise<GitTreeEntry[]> {
    const response = await this.requestJson<{
      tree?: Array<{ path?: string; type?: string; sha?: string }>;
      truncated?: boolean;
    }>(
      `/repos/${params.owner}/${params.repo}/git/trees/${encodeURIComponent(params.ref)}?recursive=1`,
      params.signal
    );
    const tree = response.tree ?? [];
    return tree
      .filter((entry): entry is { path: string; type: string; sha: string } =>
        Boolean(entry.path && entry.type && entry.sha)
      )
      .filter((entry) => entry.type === "blob" || entry.type === "tree")
      .map((entry) => ({
        path: entry.path,
        type: entry.type as "blob" | "tree",
        sha: entry.sha
      }));
  }

  async getBlobContent(params: {
    owner: string;
    repo: string;
    blobSha: string;
    signal?: AbortSignal;
  }): Promise<{ content: string }> {
    const response = await this.requestJson<{ content?: string; encoding?: string }>(
      `/repos/${params.owner}/${params.repo}/git/blobs/${params.blobSha}`,
      params.signal
    );
    if (!response.content) {
      throw new GitHubApiError(
        `Missing blob content for ${params.owner}/${params.repo}@${params.blobSha}.`,
        500,
        false
      );
    }
    if ((response.encoding ?? "").toLowerCase() !== "base64") {
      throw new GitHubApiError(
        `Unsupported blob encoding for ${params.owner}/${params.repo}@${params.blobSha}.`,
        500,
        false
      );
    }
    const decoded = Buffer.from(response.content.replace(/\n/g, ""), "base64").toString("utf8");
    return { content: decoded };
  }

  private async requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const modeOrder: AuthMode[] = this.token ? ["token", "anonymous"] : ["anonymous"];
    for (const mode of modeOrder) {
      if (mode === "anonymous" && !this.shouldTryAnonymousMode(path, modeOrder)) {
        continue;
      }

      let attempt = 0;
      while (true) {
        try {
          const response = await fetch(`${this.apiBaseUrl}${path}`, {
            method: "GET",
            headers: this.buildHeaders(mode),
            signal
          });

          if (!response.ok) {
            const bodyText = await response.text();
            const rateLimited =
              response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
            const retryable = rateLimited || TRANSIENT_STATUS.has(response.status);
            this.emitDiagnostic({
              method: "GET",
              host: this.apiBaseUrl,
              path,
              authMode: mode,
              authorizationPresent: mode === "token",
              acceptHeader: "application/vnd.github+json",
              apiVersionHeader: GITHUB_API_VERSION,
              responseStatus: response.status,
              responseHeaders: this.pickRelevantHeaders(response),
              fallbackAttempted:
                mode === "token" &&
                this.allowAnonymousFallbackForPublicRead &&
                this.isAnonymousFallbackCandidate(path, response.status),
              errorCategory: "http_error",
              message: bodyText.slice(0, 200)
            });

            if (
              mode === "token" &&
              this.allowAnonymousFallbackForPublicRead &&
              this.isAnonymousFallbackCandidate(path, response.status)
            ) {
              break;
            }

            if (attempt < this.maxRetries && retryable) {
              await this.delay(200 * 2 ** attempt, signal);
              attempt += 1;
              continue;
            }
            throw new GitHubApiError(
              `GitHub request failed (${response.status}) for ${path}: ${bodyText.slice(0, 200)}`,
              response.status,
              retryable
            );
          }

          this.emitDiagnostic({
            method: "GET",
            host: this.apiBaseUrl,
            path,
            authMode: mode,
            authorizationPresent: mode === "token",
            acceptHeader: "application/vnd.github+json",
            apiVersionHeader: GITHUB_API_VERSION,
            responseStatus: response.status,
            responseHeaders: this.pickRelevantHeaders(response),
            fallbackAttempted: false,
            errorCategory: "none"
          });

          return (await response.json()) as T;
        } catch (error) {
          if (error instanceof GitHubApiError) {
            throw error;
          }
          if (signal?.aborted) {
            this.emitDiagnostic({
              method: "GET",
              host: this.apiBaseUrl,
              path,
              authMode: mode,
              authorizationPresent: mode === "token",
              acceptHeader: "application/vnd.github+json",
              apiVersionHeader: GITHUB_API_VERSION,
              responseStatus: 499,
              responseHeaders: {},
              fallbackAttempted: false,
              errorCategory: "network_error",
              message: "aborted"
            });
            throw new GitHubApiError(`GitHub request aborted for ${path}.`, 499, false);
          }
          if (attempt < this.maxRetries) {
            await this.delay(200 * 2 ** attempt, signal);
            attempt += 1;
            continue;
          }
          this.emitDiagnostic({
            method: "GET",
            host: this.apiBaseUrl,
            path,
            authMode: mode,
            authorizationPresent: mode === "token",
            acceptHeader: "application/vnd.github+json",
            apiVersionHeader: GITHUB_API_VERSION,
            responseStatus: 0,
            responseHeaders: {},
            fallbackAttempted: false,
            errorCategory: "network_error",
            message: error instanceof Error ? error.message : "unknown error"
          });
          throw new GitHubApiError(
            `GitHub network request failed for ${path}: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
            0,
            true
          );
        }
      }
    }
    throw new GitHubApiError(`GitHub request failed after auth fallback for ${path}.`, 404, false);
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private buildHeaders(mode: AuthMode): HeadersInit {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "meeting-agent-knowledgev2-sync",
      "x-github-api-version": GITHUB_API_VERSION
    };
    if (mode === "token" && this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private shouldTryAnonymousMode(path: string, modes: AuthMode[]): boolean {
    if (!modes.includes("token")) return true;
    if (!this.allowAnonymousFallbackForPublicRead) return false;
    return this.isPublicReadPath(path);
  }

  private isAnonymousFallbackCandidate(path: string, status: number): boolean {
    if (!this.isPublicReadPath(path)) return false;
    return status === 401 || status === 403 || status === 404;
  }

  private isPublicReadPath(path: string): boolean {
    return path.startsWith("/repos/");
  }

  private pickRelevantHeaders(response: Response): Record<string, string | null> {
    return {
      "x-ratelimit-limit": response.headers.get("x-ratelimit-limit"),
      "x-ratelimit-remaining": response.headers.get("x-ratelimit-remaining"),
      "x-ratelimit-reset": response.headers.get("x-ratelimit-reset"),
      "x-github-request-id": response.headers.get("x-github-request-id"),
      "x-github-api-version-selected": response.headers.get("x-github-api-version-selected"),
      "content-type": response.headers.get("content-type")
    };
  }

  private emitDiagnostic(event: GitHubRequestDiagnostic): void {
    this.onDiagnostic?.(event);
  }
}

