import type { QueryIntent } from "../retrievalV2/queryIntent";
import type { InterviewQuestionShape } from "./interviewQuestionShape";
import type { MicrosoftInterviewPackId } from "./interviewAuthorityPack";

export interface InterviewPackRoute {
  packIds: MicrosoftInterviewPackId[];
  reasons: string[];
}

type PackCue = {
  packId: MicrosoftInterviewPackId;
  cues: string[];
  reason: string;
};

const PACK_CUES: PackCue[] = [
  {
    packId: "teams_voice_direct_routing",
    cues: [
      "direct routing",
      "sbc",
      "pstn",
      "voice routing",
      "media bypass",
      "emergency calling",
      "dial plan",
      "one-way audio",
      "one way audio",
      "external number",
      "cannot call",
      "outbound call"
    ],
    reason: "Question names Direct Routing, SBC, PSTN, or emergency-calling terms."
  },
  {
    packId: "call_quality_troubleshooting",
    cues: [
      "cqd",
      "call quality",
      "call analytics",
      "jitter",
      "packet loss",
      "qos",
      "telemetry",
      "round-trip",
      "rtt"
    ],
    reason: "Question names call-quality, CQD, or media-metric terms."
  },
  {
    packId: "auto_attendants_call_queues",
    cues: [
      "auto attendant",
      "call queue",
      "after-hours",
      "after hours",
      "shared voicemail"
    ],
    reason: "Question names Auto Attendant or Call Queue terms."
  },
  {
    packId: "teams_rooms",
    cues: [
      "teams rooms",
      "teams room",
      "mtr",
      "room mailbox",
      "rooms pro"
    ],
    reason: "Question names Teams Rooms / MTR terms."
  },
  {
    packId: "teams_powershell_interview_subset",
    cues: ["powershell", "cmdlet", "export-csv", "foreach-object"],
    reason: "Question names PowerShell or cmdlet automation."
  },
  {
    packId: "sharepoint_onedrive_copilot_governance",
    cues: [
      "sharepoint",
      "onedrive",
      "copilot",
      "oversharing",
      "data access governance",
      "restricted content discovery",
      "restricted access control"
    ],
    reason: "Question names SharePoint, OneDrive, or Copilot governance terms."
  },
  {
    packId: "entra_identity_support",
    cues: [
      "entra",
      "conditional access",
      "sign-in",
      "sign in",
      "locked out",
      "lockout",
      "mfa"
    ],
    reason: "Question names Entra identity, sign-in, or lockout terms."
  }
];

const MAX_PACK_UNION = 2;

function haystack(intent: QueryIntent): string {
  return [
    intent.normalizedQuestion,
    ...intent.entities,
    ...intent.technologies,
    ...intent.products,
    ...(intent.policyNames ?? []),
    ...(intent.commandNames ?? [])
  ]
    .join(" ")
    .toLowerCase();
}

function scorePack(text: string, cue: PackCue): number {
  return cue.cues.reduce(
    (total, term) => total + (text.includes(term) ? 1 : 0),
    0
  );
}

/**
 * Deterministic Interview Authority Pack router.
 * Returns at most two packs, each with an explicit cue-based reason.
 */
export function routeInterviewPacks(
  intent: QueryIntent,
  shape: InterviewQuestionShape
): InterviewPackRoute {
  const text = haystack(intent);
  const scored = PACK_CUES.map((cue) => ({
    cue,
    score: scorePack(text, cue)
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.cue.packId.localeCompare(right.cue.packId)
    );

  const selected: PackCue[] = [];
  const reasons: string[] = [];
  for (const entry of scored) {
    if (selected.length >= MAX_PACK_UNION) break;
    if (selected.some((item) => item.packId === entry.cue.packId)) continue;
    selected.push(entry.cue);
    reasons.push(entry.cue.reason);
  }

  const hasRooms = selected.some((item) => item.packId === "teams_rooms");
  const hasEntra = selected.some(
    (item) => item.packId === "entra_identity_support"
  );
  const needsIdentity =
    hasRooms &&
    /\b(?:lock(?:ed)? out|lockout|sign-?in|conditional access|cannot sign)\b/i.test(
      text
    );
  if (needsIdentity && !hasEntra && selected.length < MAX_PACK_UNION) {
    selected.push(
      PACK_CUES.find((cue) => cue.packId === "entra_identity_support")!
    );
    reasons.push(
      "Teams Rooms authentication/lockout also requires Entra sign-in evidence."
    );
  }

  if (shape === "powershell") {
    const powershell = PACK_CUES.find(
      (cue) => cue.packId === "teams_powershell_interview_subset"
    )!;
    if (!selected.some((item) => item.packId === powershell.packId)) {
      const trimmed = selected.slice(0, MAX_PACK_UNION - 1);
      selected.length = 0;
      selected.push(powershell, ...trimmed);
      reasons.unshift(powershell.reason);
      while (selected.length > MAX_PACK_UNION) {
        selected.pop();
        reasons.pop();
      }
    }
  }

  return {
    packIds: selected.map((item) => item.packId),
    reasons: reasons.slice(0, selected.length)
  };
}
