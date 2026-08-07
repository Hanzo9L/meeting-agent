import { createHash } from "node:crypto";
import { getSourceById } from "../sourceRegistry";
import type { KnowledgeSourceDefinition, LearnMcpTransportConfig } from "../sourceTypes";
import type { AcquisitionResult, SourceAcquisitionAdapter } from "./types";
import { buildLearnMcpClient, selectToolName } from "./learnMcpClient";

function toHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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

