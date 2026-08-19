import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { resolveKnowledgeV2DatabasePath } from "../../src/main/services/knowledgeV2";
import type { ResolvedInterviewPack } from "../../src/main/services/answerV2/interviewAuthorityPack";

export {
  INTERVIEW_PACK_BY_SECTION,
  documentIdsForInterviewPacks,
  interviewPowerShellCoreCanonicalUrls,
  loadSelectedMicrosoftPackUrls,
  resolveLocalInterviewPacks,
  type LocalPackDocument,
  type MicrosoftInterviewPackId,
  type ResolvedInterviewPack
} from "../../src/main/services/answerV2/interviewAuthorityPack";

export interface InterviewQuestionRecord {
  questionId: string;
  question: string;
  interviewTopic: string;
  expectedAuthorityPack: string;
  answerType: string;
  liveQuickTargetWords: number;
  requiredConcepts: string[];
  prohibitedClaims: string[];
}

export const SUPERSEDED_INTERVIEW_URLS = [
  "https://learn.microsoft.com/en-us/microsoftteams/use-call-analytics-to-troubleshoot-poor-call-quality",
  "https://learn.microsoft.com/en-us/microsoftteams/use-real-time-telemetry-to-troubleshoot-poor-meeting-quality"
] as const;

export const PRIORITY_14_QUESTION_IDS = [
  "Q-001",
  "Q-003",
  "Q-004",
  "Q-005",
  "Q-006",
  "Q-010",
  "Q-016",
  "Q-021",
  "Q-022",
  "Q-023",
  "Q-024",
  "Q-011",
  "Q-030",
  "Q-026"
] as const;

export function loadInterviewDataset(
  datasetPath = resolve("eval/datasets/interview-authority-i1.jsonl")
): InterviewQuestionRecord[] {
  return readFileSync(datasetPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as InterviewQuestionRecord);
}

export function loadPackChunkCorpus(
  pack: ResolvedInterviewPack,
  databasePath = resolveKnowledgeV2DatabasePath()
): string {
  if (pack.localDocuments.length === 0) return "";
  const db = new Database(databasePath, { readonly: true });
  try {
    const ids = pack.localDocuments.map((document) => document.documentId);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT chunk_text FROM knowledge_chunks WHERE document_id IN (${placeholders})`
      )
      .all(...ids) as Array<{ chunk_text: string }>;
    return rows.map((row) => row.chunk_text).join("\n");
  } finally {
    db.close();
  }
}

export function conceptPresentInText(text: string, concept: string): boolean {
  const tokens = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3);
  const textTokens = new Set(tokens(text));
  const conceptTokens = tokens(concept).filter(
    (token) => !["with", "from", "where", "when", "each"].includes(token)
  );
  if (conceptTokens.length === 0) return false;
  const hits = conceptTokens.filter((token) => textTokens.has(token)).length;
  return hits >= Math.max(1, Math.ceil(conceptTokens.length / 2));
}
