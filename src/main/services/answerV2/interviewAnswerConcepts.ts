import type { QueryIntent } from "../retrievalV2/queryIntent";
import type { MicrosoftInterviewPackId } from "./interviewAuthorityPack";
import type { InterviewQuestionShape } from "./interviewQuestionShape";

const GENERIC_CONCEPTS = new Set([
  "microsoft",
  "teams",
  "microsoft teams",
  "admin",
  "user",
  "users"
]);

const PACK_SUBDOMAIN_HINTS: Record<MicrosoftInterviewPackId, string[]> = {
  teams_voice_direct_routing: [
    "Teams Phone",
    "certified SBC",
    "SIP signaling",
    "media path",
    "PSTN"
  ],
  call_quality_troubleshooting: [
    "CQD",
    "Call Analytics",
    "organization-wide trend",
    "per-user call",
    "Teams admin center"
  ],
  auto_attendants_call_queues: [
    "resource account",
    "business hours",
    "after-hours",
    "Call Queue",
    "Auto Attendant"
  ],
  teams_rooms: [
    "resource account",
    "calendar processing",
    "sign-in",
    "Teams Rooms Pro",
    "audio device"
  ],
  teams_powershell_interview_subset: [
    "Get-CsOnlineUser",
    "EnterpriseVoiceEnabled",
    "TelephoneNumbers",
    "effective policy",
    "per-user output"
  ],
  sharepoint_onedrive_copilot_governance: [
    "oversharing",
    "Data Access Governance",
    "SharePoint Advanced Management",
    "Restricted Content Discovery",
    "permissions"
  ],
  entra_identity_support: [
    "sign-in logs",
    "failure code",
    "Conditional Access",
    "MFA"
  ]
};

function normalizeConcept(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function comparisonParticipants(intent: QueryIntent): string[] {
  const question = intent.originalQuestion;
  const vs = question.split(/\b(?:vs\.?|versus|or|,)\b/i);
  if (vs.length < 2) return [];
  return vs
    .map((part) =>
      part
        .replace(
          /when would you use|what is the difference between|compare/gi,
          ""
        )
        .trim()
    )
    .filter((part) => part.length >= 3 && part.length <= 60)
    .slice(0, 3);
}

/**
 * Bounded interview answer concepts derived from QueryIntent, comparison
 * terms, and pack subdomain hints. Not a per-question answer key.
 */
export function deriveInterviewAnswerConcepts(params: {
  intent: QueryIntent;
  shape: InterviewQuestionShape;
  packIds: MicrosoftInterviewPackId[];
}): string[] {
  const concepts: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    const normalized = normalizeConcept(value);
    if (!normalized || GENERIC_CONCEPTS.has(normalized) || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    concepts.push(value.trim());
  };

  for (const entity of params.intent.entities) add(entity);
  for (const technology of params.intent.technologies) add(technology);
  for (const product of params.intent.products) add(product);
  for (const policy of params.intent.policyNames ?? []) add(policy);
  for (const command of params.intent.commandNames ?? []) add(command);
  if (params.shape === "comparison") {
    for (const participant of comparisonParticipants(params.intent)) {
      add(participant);
    }
  }
  for (const packId of params.packIds) {
    for (const hint of PACK_SUBDOMAIN_HINTS[packId] ?? []) {
      add(hint);
    }
  }
  return concepts.slice(0, 8);
}
