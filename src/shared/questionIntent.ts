/**
 * Deterministic question-shape → card-mode classifier.
 *
 * Grounded in docs/interview/two_sigma_final_round_prep_relay_ready.md
 * intent classes. Does not call a model, change retrieval, or ingest
 * interview docs into the technical corpus.
 */

export type InterviewIntentClass =
  | "troubleshooting"
  | "architecture"
  | "configuration"
  | "automation"
  | "behavioral_story";

export type ResponseMode =
  | "technical_evidence"
  | "personal_response"
  | "mixed_personal_technical";

export interface QuestionIntentDecision {
  responseMode: ResponseMode;
  intentClass: InterviewIntentClass | null;
  reason: string;
}

const STRONG_PERSONAL = [
  /\btell me about a time\b/,
  /\bdescribe a situation\b/,
  /\bgive me an example\b/,
  /\bwhat (?:is|was) the hardest\b/,
  /\bwhat (?:is|was) the most complex\b/,
  /\bwhat have you done\b/,
  /\bwhat did you (?:build|write|automate|solve|diagnose)\b/,
  /\bwhat challenge did you face\b/,
  /\bhow have you\b/,
  /\ba script you wrote\b/,
  /\byou wrote from scratch\b/,
  /\bbiggest challenge you (?:have )?faced\b/,
  /\bhave you (?:ever )?(?:coordinated|built|automated|diagnosed|solved|written|faced)\b/,
  /\bfrom your experience\b/,
  /\byour comfort level\b/
];

const TELL_ME_ABOUT = /\btell me about\b/;
const PERSONAL_YOU_ACT =
  /\byou (?:solved|wrote|built|diagnosed|automated|faced|troubleshot)\b/;
const PERSONAL_NOUN_YOU =
  /\ba (?:script|time|situation|problem|issue|challenge)\b/;

const EXPERIENCE_HOWTO =
  /\byour experience\b.+\b(?:configur|set up|setup|design|architect|troubleshoot|create and manage|roll out)\b|\b(?:configur|set up|setup|design|architect|troubleshoot|create and manage|roll out)\b.+\byour experience\b/;

const TECHNICAL_STRONG = [
  /\bhow would you (?:troubleshoot|configure|design|approach|secure|roll out|create|manage)\b/,
  /\bexplain\b/,
  /\bwhat happens if\b/,
  /\bhow does\b/,
  /\bwhat architecture\b/,
  /\bhow do you (?:create|configure|manage|approach|troubleshoot|design|secure)\b/
];

const TECHNICAL_WHAT_IS = /^(?:what is|what's)\b/;
const WALK_ME_THROUGH = /\bwalk me through\b/;
const HARDEST_OR_COMPLEX = /\bhardest\b|\bmost complex\b/;

const TROUBLESHOOTING_METHOD =
  /\b(?:diagnos(?:e|is|ing)|investigat(?:e|ion|ing)|isolat(?:e|ing)|troubleshoot(?:ing)?)\b|\bdetermine (?:the (?:root )?cause|where the problem is|why)\b|\bidentify the root cause\b|\bfind the root cause\b|\bfigure out why\b/;

const FAILURE_SYMPTOM =
  /\bissues?\b|\bproblems?\b|\bfailures?\b|\bfailed\b|\bfailing\b|\bcannot\b|\bcan'?t\b|\bunable\b|\bnot working\b|\bpoor\b|\bdegraded\b|\bintermittent\b|\bdropped\b|\bdisconnect|\block(?:ed|ing)? out\b|\block-?outs?\b|\bno audio\b|\bone-way audio\b|\bcall quality\b|\bcannot call\b|\bcannot connect\b|\bcannot sign in\b/;

const MIXED_BACKUP = [
  /\bpowershell\b/,
  /\bpython\b/,
  /\bcmdlet\b/,
  /\blinux\b/,
  /\bcqd\b/,
  /\bcall analytics\b/,
  /\bdirect routing\b/,
  /\bsession border\b/,
  /\bsbc\b/,
  /\bauto attendant\b/,
  /\bcall queue\b/,
  /\bsharepoint\b/,
  /\bcopilot\b/,
  /\bentra\b/,
  /\bintune\b/,
  /\bteams rooms\b/,
  /\bjournalctl\b/,
  /\bsystemctl\b/,
  /\bsystemic\b/,
  /\bnumber porting\b/,
  /\bpstn\b/
];

function normalize(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasStrongPersonal(text: string): boolean {
  if (anyMatch(STRONG_PERSONAL, text)) return true;
  if (!TELL_ME_ABOUT.test(text)) return false;
  if (PERSONAL_YOU_ACT.test(text)) return true;
  return PERSONAL_NOUN_YOU.test(text) && /\byou\b/.test(text);
}

function hasTechnicalBackup(text: string): boolean {
  return anyMatch(MIXED_BACKUP, text);
}

function hasTroubleshootingMethod(text: string): boolean {
  return TROUBLESHOOTING_METHOD.test(text);
}

function hasFailureSymptom(text: string): boolean {
  return FAILURE_SYMPTOM.test(text);
}

function isSymptomGuidedTroubleshooting(text: string): boolean {
  return hasTroubleshootingMethod(text) && hasFailureSymptom(text);
}

function hasTechnicalStrong(text: string, personal: boolean): boolean {
  if (anyMatch(TECHNICAL_STRONG, text)) return true;
  if (WALK_ME_THROUGH.test(text) && !personal) return true;
  if (TECHNICAL_WHAT_IS.test(text) && !HARDEST_OR_COMPLEX.test(text)) {
    return true;
  }
  if (!personal && isSymptomGuidedTroubleshooting(text)) return true;
  return false;
}

export function classifyQuestionIntent(
  question: string
): QuestionIntentDecision {
  const text = normalize(question);
  if (text.length === 0) {
    return {
      responseMode: "technical_evidence",
      intentClass: null,
      reason: "empty_default_technical"
    };
  }

  const personal = hasStrongPersonal(text);
  const experienceHowTo = EXPERIENCE_HOWTO.test(text);

  if (experienceHowTo && !anyMatch(STRONG_PERSONAL, text)) {
    return {
      responseMode: "technical_evidence",
      intentClass: "configuration",
      reason: "experience_howto_technical"
    };
  }

  const technical = hasTechnicalStrong(text, personal);
  if (personal) {
    const mixed = hasTechnicalBackup(text);
    return {
      responseMode: mixed ? "mixed_personal_technical" : "personal_response",
      intentClass: "behavioral_story",
      reason: mixed ? "personal_with_technical_backup" : "personal_story"
    };
  }

  if (technical) {
    let intentClass: InterviewIntentClass | null = null;
    if (
      /\btroubleshoot|fail|lockout|one-way|cannot\b/.test(text) ||
      isSymptomGuidedTroubleshooting(text)
    ) {
      intentClass = "troubleshooting";
    } else if (/\barchitect|design|roll out|resilien/.test(text)) {
      intentClass = "architecture";
    } else if (/\bconfigur|set up|setup|create and manage\b/.test(text)) {
      intentClass = "configuration";
    } else if (/\bscript|automat/.test(text)) {
      intentClass = "automation";
    }
    return {
      responseMode: "technical_evidence",
      intentClass,
      reason: "technical_question_shape"
    };
  }

  return {
    responseMode: "technical_evidence",
    intentClass: null,
    reason: "ambiguous_default_technical"
  };
}

export function isPersonalResponseMode(mode: ResponseMode | undefined): boolean {
  return (
    mode === "personal_response" || mode === "mixed_personal_technical"
  );
}
