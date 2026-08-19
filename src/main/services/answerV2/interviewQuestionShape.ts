import type { QueryIntent } from "../retrievalV2/queryIntent";

export type InterviewQuestionShape =
  | "conceptual"
  | "troubleshooting"
  | "procedural"
  | "powershell"
  | "comparison";

const COMPARISON_CUES =
  /\b(?:difference between|compared?|versus|\bvs\b|when would you use)\b/i;
const TROUBLESHOOTING_CUES =
  /\b(?:why|cannot|can'?t|not (?:able|working|routing|hear)|fail(?:s|ed|ure)?|error|troubleshoot|lock(?:ed)? out|lockout|one-way|no audio|cannot sign|sign-?in (?:fail|issue))\b/i;
const POWERSHELL_CUES =
  /\b(?:powershell|cmdlet|script|foreach-object|export-csv|get-cs[a-z]+)\b/i;
const PROCEDURAL_CUES =
  /\b(?:how (?:would|do|can) you|how to|steps|configure|build(?:ing)?|create|renew(?:al)?|assign|secure|set up|setup)\b/i;

/**
 * Interview Quick question-shape classifier.
 *
 * Uses QueryIntent.expectedAnswerType plus a small set of interview phrasing
 * cues. Does not call a model and does not match individual question strings.
 */
export function classifyInterviewQuestionShape(
  intent: QueryIntent
): InterviewQuestionShape {
  const question = `${intent.originalQuestion} ${intent.normalizedQuestion}`;
  if (
    intent.expectedAnswerType === "comparison" ||
    COMPARISON_CUES.test(question)
  ) {
    return "comparison";
  }
  if (
    intent.expectedAnswerType === "troubleshooting" ||
    TROUBLESHOOTING_CUES.test(question)
  ) {
    return "troubleshooting";
  }
  const powershellDomain =
    intent.domains.includes("teams_powershell") ||
    intent.domains.includes("powershell_core");
  if (
    POWERSHELL_CUES.test(question) ||
    (intent.commandNames ?? []).length > 0 ||
    powershellDomain
  ) {
    return "powershell";
  }
  if (
    intent.expectedAnswerType === "procedural" ||
    intent.expectedAnswerType === "configuration" ||
    PROCEDURAL_CUES.test(question)
  ) {
    return "procedural";
  }
  return "conceptual";
}
