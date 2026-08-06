export interface KnowledgeBaseSettings {
  enabled: boolean;
  repoUrl: string;
  branch: string;
}

export interface KnowledgeChunk {
  id: string;
  path: string;
  title: string;
  description: string;
  msTopic: string;
  heading: string;
  text: string;
  searchText: string;
}

export interface RetrievedContextChunk {
  title: string;
  path: string;
  text: string;
}

export interface KnowledgeBaseStatus {
  ready: boolean;
  syncing: boolean;
  docCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  localPath: string;
}

