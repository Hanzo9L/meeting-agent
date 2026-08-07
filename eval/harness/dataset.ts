import { readFile } from "node:fs/promises";
import type { EvaluationQuestion } from "./types";

const QUESTION_ID_PATTERN = /^Q-[0-9]{3}$/;

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === "string")) return null;
  return value;
}

function assertQuestionShape(
  value: unknown,
  lineNumber: number
): asserts value is EvaluationQuestion {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Line ${lineNumber}: expected JSON object.`);
  }

  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "1.0") {
    throw new Error(`Line ${lineNumber}: schemaVersion must be "1.0".`);
  }

  if (typeof record.questionId !== "string" || !QUESTION_ID_PATTERN.test(record.questionId)) {
    throw new Error(`Line ${lineNumber}: questionId must match Q-###.`);
  }

  if (typeof record.question !== "string" || !record.question.trim()) {
    throw new Error(`Line ${lineNumber}: question must be a non-empty string.`);
  }

  if (typeof record.expectedDomain !== "string" || !record.expectedDomain.trim()) {
    throw new Error(`Line ${lineNumber}: expectedDomain must be a non-empty string.`);
  }

  if (typeof record.expectedIntent !== "string" || !record.expectedIntent.trim()) {
    throw new Error(`Line ${lineNumber}: expectedIntent must be a non-empty string.`);
  }

  const expectedSourceDomains = asStringArray(record.expectedSourceDomains);
  if (!expectedSourceDomains || expectedSourceDomains.length === 0) {
    throw new Error(`Line ${lineNumber}: expectedSourceDomains must be a non-empty string array.`);
  }

  const requiredConcepts = asStringArray(record.requiredConcepts);
  if (!requiredConcepts) {
    throw new Error(`Line ${lineNumber}: requiredConcepts must be a string array.`);
  }

  const prohibitedClaims = asStringArray(record.prohibitedClaims);
  if (!prohibitedClaims) {
    throw new Error(`Line ${lineNumber}: prohibitedClaims must be a string array.`);
  }

  const knownSourceHints = asStringArray(record.knownSourceHints);
  if (!knownSourceHints) {
    throw new Error(`Line ${lineNumber}: knownSourceHints must be a string array.`);
  }

  if (typeof record.evaluationNotes !== "string") {
    throw new Error(`Line ${lineNumber}: evaluationNotes must be a string.`);
  }
}

export async function loadEvaluationDataset(path: string): Promise<EvaluationQuestion[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("Dataset is empty.");
  }

  const questions: EvaluationQuestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const parsed = JSON.parse(lines[i] ?? "{}") as unknown;
    assertQuestionShape(parsed, lineNumber);
    if (seen.has(parsed.questionId)) {
      throw new Error(`Line ${lineNumber}: duplicate questionId ${parsed.questionId}.`);
    }
    seen.add(parsed.questionId);
    questions.push(parsed);
  }

  return questions;
}

