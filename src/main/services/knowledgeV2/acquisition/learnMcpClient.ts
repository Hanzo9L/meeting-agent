type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id?: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

export type LearnMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type LearnMcpClient = {
  initialize: () => Promise<void>;
  listTools: () => Promise<LearnMcpTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

function parseSsePayload<T>(body: string): T {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0);
  for (let i = dataLines.length - 1; i >= 0; i -= 1) {
    const candidate = dataLines[i];
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try earlier event frames
    }
  }
  throw new Error("Unable to parse JSON payload from Learn MCP stream.");
}

async function parseTransportPayload<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const body = await response.text();
    return parseSsePayload<T>(body);
  }
  return (await response.json()) as T;
}

export function buildLearnMcpClient(endpoint: string): LearnMcpClient {
  let requestId = 1;
  async function call<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId++,
        method,
        params
      })
    });
    const payload = await parseTransportPayload<JsonRpcResponse<TResult>>(response);
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `MCP call failed: ${method}`);
    }
    if (payload.result === undefined) {
      throw new Error(`MCP call returned no result: ${method}`);
    }
    return payload.result;
  }

  return {
    async initialize(): Promise<void> {
      await call("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "meeting-agent", version: "1.0.0" }
      });
    },
    async listTools(): Promise<LearnMcpTool[]> {
      const result = await call<{ tools?: LearnMcpTool[] }>("tools/list");
      return result.tools ?? [];
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = await call<{ content?: unknown[]; structuredContent?: unknown }>("tools/call", {
        name,
        arguments: args
      });
      return result.structuredContent ?? result.content ?? result;
    }
  };
}

export function selectToolName(tools: LearnMcpTool[], predicate: (name: string) => boolean): string {
  const tool = tools.find((item) => predicate(item.name.toLowerCase()));
  if (!tool) {
    throw new Error("Required Learn MCP tool not available from dynamic discovery.");
  }
  return tool.name;
}
