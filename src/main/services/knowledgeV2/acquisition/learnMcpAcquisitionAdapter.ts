import { createHash } from "node:crypto";
import { getSourceById } from "../sourceRegistry";
import type { KnowledgeSourceDefinition, LearnMcpTransportConfig } from "../sourceTypes";
import type { AcquisitionResult, SourceAcquisitionAdapter } from "./types";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id?: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

type LearnMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type LearnMcpClient = {
  initialize: () => Promise<void>;
  listTools: () => Promise<LearnMcpTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

function toHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

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

function buildLearnMcpClient(endpoint: string): LearnMcpClient {
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

function selectToolName(tools: LearnMcpTool[], predicate: (name: string) => boolean): string {
  const tool = tools.find((item) => predicate(item.name.toLowerCase()));
  if (!tool) {
    throw new Error("Required Learn MCP tool not available from dynamic discovery.");
  }
  return tool.name;
}

function assertLearnMcpSource(
  sourceId: string
): KnowledgeSourceDefinition & { acquisition: LearnMcpTransportConfig } {
  const source = getSourceById(sourceId);
  if (!source) throw new Error(`Unknown source ${sourceId}.`);
  if (source.acquisition.transport !== "learn_mcp") {
    throw new Error(`Source ${sourceId} is not configured for learn_mcp transport.`);
  }
  return source as KnowledgeSourceDefinition & { acquisition: LearnMcpTransportConfig };
}

export function createLearnMcpAcquisitionAdapter(): SourceAcquisitionAdapter {
  return {
    async acquire(params): Promise<AcquisitionResult> {
      const source = assertLearnMcpSource(params.sourceId);
      const acquisition = source.acquisition;
      const track = source.contentTracks.find((item) => item.id === params.trackId);
      if (!track) {
        return {
          sourceId: params.sourceId,
          trackId: params.trackId,
          transport: "learn_mcp",
          startCheckpoint: params.previousCheckpoint ?? null,
          endCheckpoint: null,
          added: [],
          modified: [],
          unchanged: [],
          deleted: [],
          errors: [
            {
              sourceId: params.sourceId,
              trackId: params.trackId,
              transport: "learn_mcp",
              code: "track_not_found",
              message: `Unknown content track ${params.trackId}.`,
              retryable: false
            }
          ]
        };
      }

      try {
        const client = buildLearnMcpClient(acquisition.endpoint);
        await client.initialize();
        const tools = await client.listTools();
        const searchTool = selectToolName(tools, (name) => name.includes("search"));
        const fetchTool = selectToolName(tools, (name) => name.includes("fetch"));

        const query = "Microsoft Teams Direct Routing voice routing policy";
        const searchResult = await client.callTool(searchTool, { query });
        const selectedUrlMatch = JSON.stringify(searchResult).match(
          /https:\/\/learn\.microsoft\.com\/[^\s"')]+/i
        );
        const canonicalUrl =
          selectedUrlMatch?.[0] ?? `${acquisition.canonicalBaseUrl}/trusted-organizations-external-meetings-chat`;

        const fetched = await client.callTool(fetchTool, { url: canonicalUrl });
        const markdown = typeof fetched === "string" ? fetched : JSON.stringify(fetched, null, 2);
        const retrievedAt = new Date().toISOString();
        const contentHash = toHash(markdown);

        return {
          sourceId: params.sourceId,
          trackId: params.trackId,
          transport: "learn_mcp",
          startCheckpoint: params.previousCheckpoint ?? null,
          endCheckpoint: {
            sourceId: params.sourceId,
            trackId: params.trackId,
            transport: "learn_mcp",
            lastRevisionFingerprint: contentHash,
            lastAcquiredAt: retrievedAt
          },
          added: [
            {
              sourceId: params.sourceId,
              trackId: track.id,
              transport: "learn_mcp",
              canonicalUrl,
              rawMarkdown: markdown,
              revision: {
                transport: "learn_mcp",
                canonicalUrl,
                locale: acquisition.locale,
                retrievedAt,
                contentHash
              },
              metadata: {
                locale: acquisition.locale,
                retrievedAt
              }
            }
          ],
          modified: [],
          unchanged: [],
          deleted: [],
          errors: []
        };
      } catch (error) {
        return {
          sourceId: params.sourceId,
          trackId: params.trackId,
          transport: "learn_mcp",
          startCheckpoint: params.previousCheckpoint ?? null,
          endCheckpoint: null,
          added: [],
          modified: [],
          unchanged: [],
          deleted: [],
          errors: [
            {
              sourceId: params.sourceId,
              trackId: params.trackId,
              transport: "learn_mcp",
              code: "acquisition_failed",
              message: error instanceof Error ? error.message : "Learn MCP acquisition failed.",
              retryable: true
            }
          ]
        };
      }
    }
  };
}

