import { join, resolve } from "node:path";

const ENV_DB_PATH = "MEETING_AGENT_CONVERSATION_DB_PATH";

export interface ResolveConversationDbPathParams {
  userDataPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Conversation data has a separate lifecycle from the Knowledge V2 corpus.
 * The caller supplies Electron's userData path at runtime so this module stays
 * usable in tests and non-Electron tooling.
 */
export function resolveConversationDatabasePath(
  params: ResolveConversationDbPathParams = {}
): string {
  const env = params.env ?? process.env;
  const override = env[ENV_DB_PATH];
  if (typeof override === "string" && override.trim().length > 0) {
    return resolve(override.trim());
  }

  if (params.userDataPath) {
    return join(params.userDataPath, "conversations", "conversations.sqlite");
  }

  return join(params.cwd ?? process.cwd(), ".conversations", "conversations.sqlite");
}

export function getConversationDbPathEnvKey(): string {
  return ENV_DB_PATH;
}
