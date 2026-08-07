import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubRestRepositoryClient,
  type GitHubRequestDiagnostic
} from "./githubAdapter";

type MockResponseInit = {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
};

function makeResponse(init: MockResponseInit): Response {
  const body =
    init.status >= 200 && init.status < 300
      ? JSON.stringify(init.json ?? {})
      : (init.text ?? "error");
  return new Response(body, {
    status: init.status,
    headers: init.headers
  });
}

test("falls back to anonymous for access-like 404 on public branch endpoint", async () => {
  const diagnostics: GitHubRequestDiagnostic[] = [];
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; auth: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
    const path = new URL(url).pathname;
    calls.push({ path, auth });
    if (auth) {
      return makeResponse({
        status: 404,
        text: '{"message":"Not Found"}',
        headers: { "x-ratelimit-remaining": "4999" }
      });
    }
    return makeResponse({
      status: 200,
      json: { commit: { sha: "sha-anon-success" } },
      headers: { "x-ratelimit-remaining": "60" }
    });
  }) as typeof fetch;

  try {
    const client = new GitHubRestRepositoryClient({
      token: "fake-token",
      onDiagnostic: (event) => diagnostics.push(event)
    });
    const sha = await client.resolveBranchHead({
      owner: "MicrosoftDocs",
      repo: "OfficeDocs-SkypeForBusiness",
      branch: "public"
    });
    assert.equal(sha, "sha-anon-success");
    assert.equal(calls.length, 2);
    assert.equal(Boolean(calls[0]?.auth), true);
    assert.equal(calls[1]?.auth, null);
    assert.equal(diagnostics[0]?.authorizationPresent, true);
    assert.equal(diagnostics[1]?.authorizationPresent, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to anonymous for bad-credentials 401 on public branch endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ auth: string | null }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
    calls.push({ auth });
    if (auth) {
      return makeResponse({
        status: 401,
        text: '{"message":"Bad credentials"}'
      });
    }
    return makeResponse({
      status: 200,
      json: { commit: { sha: "sha-after-401-fallback" } }
    });
  }) as typeof fetch;

  try {
    const client = new GitHubRestRepositoryClient({ token: "bad-token" });
    const sha = await client.resolveBranchHead({
      owner: "MicrosoftDocs",
      repo: "office-docs-powershell",
      branch: "main"
    });
    assert.equal(sha, "sha-after-401-fallback");
    assert.equal(calls.length, 2);
    assert.equal(Boolean(calls[0]?.auth), true);
    assert.equal(calls[1]?.auth, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("nonexistent branch fails after auth and anonymous attempts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    makeResponse({
      status: 404,
      text: '{"message":"Not Found"}',
      headers: { "x-ratelimit-remaining": "4999" }
    })) as typeof fetch;

  try {
    const client = new GitHubRestRepositoryClient({ token: "fake-token" });
    await assert.rejects(
      () =>
        client.resolveBranchHead({
          owner: "MicrosoftDocs",
          repo: "does-not-exist",
          branch: "main"
        }),
      /auth fallback|request failed/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("diagnostics never include credential values", async () => {
  const diagnostics: GitHubRequestDiagnostic[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    makeResponse({
      status: 200,
      json: { commit: { sha: "ok" } }
    })) as typeof fetch;

  try {
    const client = new GitHubRestRepositoryClient({
      token: "super-secret-token",
      onDiagnostic: (event) => diagnostics.push(event)
    });
    await client.resolveBranchHead({
      owner: "MicrosoftDocs",
      repo: "office-docs-powershell",
      branch: "main"
    });
    const diagnosticText = JSON.stringify(diagnostics);
    assert.equal(diagnosticText.includes("super-secret-token"), false);
    assert.equal(diagnostics[0]?.authorizationPresent, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

