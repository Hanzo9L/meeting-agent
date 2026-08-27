import {
  classifyQuestionIntent,
  type InterviewIntentClass
} from "./questionIntent";

export type EvidenceAuthorityPreference =
  | "microsoft"
  | "audiocodes"
  | "linux";

export type EvidenceAuthorityPublisher = "Microsoft" | "AudioCodes" | "Linux";

/**
 * Presentation-only weights. Higher score renders first.
 * Stored retrieval `score` is never written.
 *
 * presentationScore =
 *   retrievalRelevance          // 1.00 at rank 1, -0.12 per rank
 *   + authorityBonus            // preference, not a hard group
 *   + intentHint                // title/section pattern, once
 *   + questionTermOverlap       // architecture-shaped query/source HA terms
 *   + troubleshootingSymptom    // classifier troubleshooting only
 */
export const PRESENTATION_WEIGHTS = {
  retrievalRankStep: 0.12,
  preferredAuthority: 0.5,
  secondaryAuthority: 0.15,
  intentMatch: 0.45,
  intentPenalty: 0.35,
  questionTermOverlap: 0.2,
  symptomPhrase: 0.55,
  symptomToken: 0.28,
  weakDiagnostic: 0.12,
  adjacentPenalty: 0.4
} as const;

const AUDIOCODES_CUE = /\baudiocodes\b|\baudio codes\b|\bmediant\b/i;
const LINUX_CUE =
  /\blinux\b|\bsystemctl\b|\bjournalctl\b|\btcpdump\b|\bsystemd\b|\bss\b/i;

const ARCHITECTURE_QUERY =
  /\bexplain\b|\bdesign\b|\barchitect|\btopolog|\bredundan|\bresilien|\bfailover\b|\bhigh availability\b|\bha\b/;

const ARCHITECTURE_MATCH =
  /\boverview\b|\bplan(?:ning|s)?\b|\barchitecture\b|\btopology\b|\bdesign\b|\bresilien(?:ce|cy|t)\b|\bredundan(?:t|cy)\b|\bhigh availability\b|\bha\b|\bfailover\b|\bcall flow\b|\brouting overview\b/;

const ARCHITECTURE_PENALTY =
  /\bexample\s+[12]\b|\bstep\s+\d+\b|\bprerequisites?\b|\bcountry(?:\/|\s+and\s+)?region codes?\b|\bregion code reference\b|\bchangelog\b|\brelease notes\b|\bwhat'?s new\b|\bfaq\b|\bfrequently asked\b/;

const TROUBLESHOOT_MATCH =
  /\btroubleshoot(?:ing)?\b|\bdiagnostics?\b|\bcall analytics\b|\bcqd\b|\bmonitor\b|\bhealth\b|\bfailover\b|\blogs\b|\bstatus\b/;

const CONFIGURE_MATCH =
  /\bconfigur(?:e|ing|ation)\b|\bsetup\b|\bset up\b|\bdeployment steps\b|\bprerequisites?\b|\bstep\s+\d+\b|\bprocedure\b/;

const HA_TERMS =
  /\bredundan|\bresilien|\bfailover\b|\bhigh availability\b|\bha\b/;

const SYMPTOM_PHRASES = [
  "unable make call",
  "issues with outbound",
  "outbound call",
  "poor quality",
  "cannot connect",
  "call failure",
  "signin failure",
  "not working",
  "unable join",
  "no audio",
  "oneway audio",
  "dropped call",
  "registration failure",
  "connection failure"
];

const SYMPTOM_TOKENS = new Set([
  "unable",
  "outbound",
  "lockout",
  "poor",
  "quality",
  "audio",
  "oneway",
  "signin",
  "authentication",
  "dropped",
  "join",
  "registration",
  "connect",
  "failure"
]);

const ADJACENT_MARKERS: Array<{ source: RegExp; query: RegExp }> = [
  { source: /\bauto attendants?\b/, query: /\bauto attendants?\b/ },
  { source: /\bcall queues?\b/, query: /\bcall queues?\b/ },
  {
    source: /\b(?:caller.?id|calling line identification)\b/,
    query: /\b(?:caller.?id|calling line identification)\b/
  },
  { source: /\blicens/, query: /\blicens/ },
  {
    source: /\b(?:assign |support )?roles\b/,
    query: /\b(?:assign |support )?roles\b/
  }
];

export function detectEvidenceAuthorityPreference(
  query: string
): EvidenceAuthorityPreference {
  const text = query ?? "";
  if (AUDIOCODES_CUE.test(text)) return "audiocodes";
  if (LINUX_CUE.test(text)) return "linux";
  return "microsoft";
}

function publisherOf(source: {
  publisher?: string | null;
  url?: string | null;
  repo?: string | null;
}): EvidenceAuthorityPublisher {
  if (
    source.publisher === "AudioCodes" ||
    source.publisher === "Linux" ||
    source.publisher === "Microsoft"
  ) {
    return source.publisher;
  }
  const url = source.url ?? "";
  const repo = (source.repo ?? "").toLowerCase();
  if (repo === "audiocodes" || /audiocodes\.com/i.test(url)) {
    return "AudioCodes";
  }
  if (
    repo === "linux" ||
    /man7\.org|freedesktop\.org|tcpdump\.org/i.test(url) ||
    /docs\.python\.org/i.test(url)
  ) {
    return "Linux";
  }
  return "Microsoft";
}

function authorityBonus(
  publisher: EvidenceAuthorityPublisher,
  preference: EvidenceAuthorityPreference
): number {
  const { preferredAuthority, secondaryAuthority } = PRESENTATION_WEIGHTS;
  if (preference === "audiocodes") {
    if (publisher === "AudioCodes") return preferredAuthority;
    if (publisher === "Microsoft") return secondaryAuthority;
    return 0;
  }
  if (preference === "linux") {
    if (publisher === "Linux") return preferredAuthority;
    if (publisher === "Microsoft") return secondaryAuthority;
    return 0;
  }
  if (publisher === "Microsoft") return preferredAuthority;
  if (publisher === "AudioCodes") return secondaryAuthority;
  return 0;
}

/**
 * Uses classifyQuestionIntent as-is. Does not change that classifier.
 * Null technical classes that are already explain/design/resiliency-shaped
 * receive architecture presentation hints only.
 */
export function presentationIntentClass(
  query: string
): InterviewIntentClass | null {
  const classified = classifyQuestionIntent(query).intentClass;
  if (classified) return classified;
  if (ARCHITECTURE_QUERY.test((query ?? "").toLowerCase())) {
    return "architecture";
  }
  return null;
}

export function hasTroubleshootingIntent(query: string): boolean {
  return classifyQuestionIntent(query).intentClass === "troubleshooting";
}

function blobOf(source: { title?: string | null; section?: string | null }): string {
  return `${source.title ?? ""} ${source.section ?? ""}`.toLowerCase();
}

function intentHint(
  intent: InterviewIntentClass | null,
  blob: string
): number {
  const { intentMatch, intentPenalty } = PRESENTATION_WEIGHTS;
  if (intent === "architecture") {
    if (ARCHITECTURE_PENALTY.test(blob)) return -intentPenalty;
    if (ARCHITECTURE_MATCH.test(blob)) return intentMatch;
    return 0;
  }
  if (intent === "troubleshooting") {
    return 0;
  }
  if (intent === "configuration") {
    return CONFIGURE_MATCH.test(blob) ? intentMatch : 0;
  }
  return 0;
}

function questionTermOverlap(
  intent: InterviewIntentClass | null,
  query: string,
  blob: string
): number {
  if (intent !== "architecture") return 0;
  if (!HA_TERMS.test(query.toLowerCase())) return 0;
  if (!HA_TERMS.test(blob)) return 0;
  return PRESENTATION_WEIGHTS.questionTermOverlap;
}

function normalizeSymptomText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\bcan'?t\b/g, "cannot")
    .replace(/\bcannot\b/g, "unable")
    .replace(/\bunable to\b/g, "unable")
    .replace(/\block(?:ed|ing)?\s+out\b/g, "lockout")
    .replace(/\block-?outs?\b/g, "lockout")
    .replace(/\bsign(?:-|\s*)in(?:g)?\b/g, "signin")
    .replace(/\bone[-\s]way\b/g, "oneway")
    .replace(/\bexternal\b/g, "outbound")
    .replace(/\bpoor audio\b/g, "poor quality")
    .replace(/\b(?:call|audio) quality\b/g, "poor quality")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSymptomLanguage(normalizedQuery: string): boolean {
  if (SYMPTOM_PHRASES.some((phrase) => normalizedQuery.includes(phrase))) {
    return true;
  }
  return [...SYMPTOM_TOKENS].some((token) =>
    new RegExp(`\\b${token}\\b`).test(normalizedQuery)
  );
}

function sharedSymptomPhrases(queryNorm: string, blobNorm: string): number {
  return SYMPTOM_PHRASES.filter(
    (phrase) => queryNorm.includes(phrase) && blobNorm.includes(phrase)
  ).length;
}

function sharedSymptomTokens(queryNorm: string, blobNorm: string): number {
  const queryTokens = new Set(queryNorm.split(" ").filter(Boolean));
  const blobTokens = new Set(blobNorm.split(" ").filter(Boolean));
  let hits = 0;
  for (const token of SYMPTOM_TOKENS) {
    if (queryTokens.has(token) && blobTokens.has(token)) hits += 1;
  }
  return hits;
}

function isAdjacentUnrelated(queryNorm: string, blob: string): boolean {
  return ADJACENT_MARKERS.some(
    (marker) => marker.source.test(blob) && !marker.query.test(queryNorm)
  );
}

function troubleshootingSymptomHint(query: string, blob: string): number {
  if (!hasTroubleshootingIntent(query)) return 0;
  const queryNorm = normalizeSymptomText(query);
  const blobNorm = normalizeSymptomText(blob);
  const phrases = sharedSymptomPhrases(queryNorm, blobNorm);
  const tokens = sharedSymptomTokens(queryNorm, blobNorm);
  const overlap = phrases + tokens;
  const weights = PRESENTATION_WEIGHTS;
  let hint = 0;
  if (phrases > 0) hint += weights.symptomPhrase;
  hint += Math.min(tokens, 2) * weights.symptomToken;
  const toolMatch = TROUBLESHOOT_MATCH.test(blob) ? weights.intentMatch : 0;
  const questionHasSymptom = hasSymptomLanguage(queryNorm);
  if (questionHasSymptom && overlap === 0) {
    hint += Math.min(toolMatch, weights.weakDiagnostic);
  } else {
    hint += toolMatch;
  }
  if (questionHasSymptom && isAdjacentUnrelated(queryNorm, blob)) {
    hint -= weights.adjacentPenalty;
  }
  return hint;
}

export function scoreEvidencePresentation(source: {
  publisher?: string | null;
  url?: string | null;
  repo?: string | null;
  title?: string | null;
  section?: string | null;
  retrievalRank?: number;
  score?: number;
}, query: string, retrievalRank: number): number {
  const intent = presentationIntentClass(query);
  const blob = blobOf(source);
  const retrievalRelevance =
    1 - PRESENTATION_WEIGHTS.retrievalRankStep * (retrievalRank - 1);
  return (
    retrievalRelevance +
    authorityBonus(publisherOf(source), detectEvidenceAuthorityPreference(query)) +
    intentHint(intent, blob) +
    questionTermOverlap(intent, query, blob) +
    troubleshootingSymptomHint(query, blob)
  );
}

export function orderEvidenceForPresentation<
  T extends {
    publisher?: string | null;
    url?: string | null;
    repo?: string | null;
    title?: string | null;
    section?: string | null;
    retrievalRank?: number;
    score?: number;
  }
>(sources: T[], query: string): T[] {
  const decorated = sources.map((source, index) => {
    const retrievalRank = source.retrievalRank ?? index + 1;
    return {
      source,
      retrievalRank,
      presentationScore: scoreEvidencePresentation(source, query, retrievalRank)
    };
  });
  decorated.sort(
    (left, right) =>
      right.presentationScore - left.presentationScore ||
      left.retrievalRank - right.retrievalRank
  );
  return decorated.map((entry) =>
    entry.source.retrievalRank === entry.retrievalRank
      ? entry.source
      : { ...entry.source, retrievalRank: entry.retrievalRank }
  );
}

export function orderEvidenceByAuthority<
  T extends {
    publisher?: string | null;
    url?: string | null;
    repo?: string | null;
    title?: string | null;
    section?: string | null;
    retrievalRank?: number;
    score?: number;
  }
>(sources: T[], query: string): T[] {
  return orderEvidenceForPresentation(sources, query);
}
