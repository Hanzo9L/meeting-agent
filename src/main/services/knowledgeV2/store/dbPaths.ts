import { join, resolve } from "node:path";

const ENV_DB_PATH = "MEETING_AGENT_KNOWLEDGE_V2_DB_PATH";

export interface ResolveKnowledgeDbPathParams {
  userDataPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Database path strategy:
 * - explicit env override for local/dev automation
 * - Electron userData path in production runtime
 * - deterministic workspace-local fallback for CLI/test usage
 */
export function resolveKnowledgeV2DatabasePath(
  params: ResolveKnowledgeDbPathParams = {}
): string {
  const env = params.env ?? process.env;
  const fromEnv = env[ENV_DB_PATH];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }

  if (params.userDataPath) {
    return join(params.userDataPath, "knowledge-v2", "knowledge-v2.sqlite");
  }

  const cwd = params.cwd ?? process.cwd();
  return join(cwd, ".knowledge-v2", "knowledge-v2.sqlite");
}

export function getKnowledgeV2DbPathEnvKey(): string {
  return ENV_DB_PATH;
}
