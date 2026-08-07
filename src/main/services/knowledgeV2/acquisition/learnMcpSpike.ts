import { SourceAcquisitionCoordinator } from "./coordinator";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  result?: T;
  error?: { message: string };
};

function parseSsePayload<T>(body: string): T {
  const lines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = lines[i];
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue
    }
  }
  throw new Error("Unable to parse Learn MCP stream payload.");
}

async function mcpCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://learn.microsoft.com/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("text/event-stream")
    ? parseSsePayload<JsonRpcResponse<T>>(await response.text())
    : ((await response.json()) as JsonRpcResponse<T>);
  if (payload.error) {
    throw new Error(payload.error.message);
  }
  if (payload.result === undefined) {
    throw new Error(`No result for MCP method ${method}`);
  }
  return payload.result;
}

async function main(): Promise<void> {
  const coordinator = new SourceAcquisitionCoordinator();
  const sourceId = process.argv.includes("--source") ? process.argv[process.argv.indexOf("--source") + 1] : "ms-teams-admin";
  const trackId = process.argv.includes("--track") ? process.argv[process.argv.indexOf("--track") + 1] : "ga";

  await mcpCall("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "meeting-agent-spike", version: "1.0.0" }
  });
  const toolsResult = await mcpCall<{ tools?: Array<{ name: string }> }>("tools/list");
  const discoveredTools = (toolsResult.tools ?? []).map((tool) => tool.name);

  const result = await coordinator.acquire({
    sourceId: sourceId ?? "ms-teams-admin",
    trackId: trackId ?? "ga"
  });

  const sample = result.added[0];
  const output = {
    sourceId: result.sourceId,
    trackId: result.trackId,
    transport: result.transport,
    added: result.added.length,
    modified: result.modified.length,
    unchanged: result.unchanged.length,
    deleted: result.deleted.length,
    errors: result.errors,
    discoveredTools,
    sample: sample
      ? {
          canonicalUrl: sample.canonicalUrl,
          markdownLength: sample.rawMarkdown.length,
          revision: sample.revision,
          metadata: sample.metadata
        }
      : null
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : "Learn MCP spike failed."
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});

