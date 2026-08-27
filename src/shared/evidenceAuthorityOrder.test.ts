import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  detectEvidenceAuthorityPreference,
  hasTroubleshootingIntent,
  orderEvidenceByAuthority,
  orderEvidenceForPresentation,
  presentationIntentClass
} from "./evidenceAuthorityOrder";
import { classifyQuestionIntent } from "./questionIntent";

test("cue detection is mechanical and defaults to Microsoft", () => {
  assert.equal(
    detectEvidenceAuthorityPreference("Explain Direct Routing"),
    "microsoft"
  );
  assert.equal(
    detectEvidenceAuthorityPreference(
      "What would geographic redundancy look like for Direct Routing?"
    ),
    "microsoft"
  );
  assert.equal(
    detectEvidenceAuthorityPreference("What does Get-CsOnlineUser return?"),
    "microsoft"
  );
  assert.equal(
    detectEvidenceAuthorityPreference(
      "How would you secure data before Microsoft 365 Copilot rollout?"
    ),
    "microsoft"
  );
  assert.equal(
    detectEvidenceAuthorityPreference("What happens if there are issues"),
    "microsoft"
  );
  assert.equal(
    detectEvidenceAuthorityPreference(
      "How would you configure an AudioCodes Mediant SBC?"
    ),
    "audiocodes"
  );
  assert.equal(
    detectEvidenceAuthorityPreference("How does Mediant HA work?"),
    "audiocodes"
  );
  assert.equal(
    detectEvidenceAuthorityPreference("How do audio codes SBCs pair?"),
    "audiocodes"
  );
  assert.equal(
    detectEvidenceAuthorityPreference(
      "A Linux service is failing intermittently"
    ),
    "linux"
  );
  assert.equal(
    detectEvidenceAuthorityPreference("How would you use journalctl?"),
    "linux"
  );
  assert.equal(
    detectEvidenceAuthorityPreference("How would you use ss to inspect sockets?"),
    "linux"
  );
  assert.equal(detectEvidenceAuthorityPreference("systemctl status"), "linux");
  assert.equal(detectEvidenceAuthorityPreference("tcpdump capture"), "linux");
  assert.equal(detectEvidenceAuthorityPreference("systemd unit failed"), "linux");
});

test("generic Microsoft questions keep vendor hits and original ranks", () => {
  const ordered = orderEvidenceByAuthority(
    [
      { parentId: "ac-1", publisher: "AudioCodes", retrievalRank: 1 },
      { parentId: "ms-2", publisher: "Microsoft", retrievalRank: 2 },
      { parentId: "ms-3", publisher: "Microsoft", retrievalRank: 3 },
      { parentId: "ac-4", publisher: "AudioCodes", retrievalRank: 4 },
      { parentId: "ms-5", publisher: "Microsoft", retrievalRank: 5 }
    ],
    "Explain Direct Routing"
  );
  assert.deepEqual(
    new Set(ordered.map((item) => item.parentId)),
    new Set(["ac-1", "ms-2", "ms-3", "ac-4", "ms-5"])
  );
  assert.deepEqual(
    ordered.find((item) => item.parentId === "ac-1")?.retrievalRank,
    1
  );
  assert.deepEqual(
    ordered.find((item) => item.parentId === "ms-5")?.retrievalRank,
    5
  );
  assert.equal(ordered.length, 5);
});

test("explicit AudioCodes/Mediant questions keep vendor authority first", () => {
  const ordered = orderEvidenceByAuthority(
    [
      { parentId: "ac-1", publisher: "AudioCodes", retrievalRank: 1 },
      { parentId: "ms-2", publisher: "Microsoft", retrievalRank: 2 },
      { parentId: "linux-3", publisher: "Linux", retrievalRank: 3 }
    ],
    "How would you configure an AudioCodes Mediant SBC for Teams Direct Routing?"
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["ac-1", "ms-2", "linux-3"]
  );
  assert.deepEqual(
    ordered.map((item) => item.retrievalRank),
    [1, 2, 3]
  );
});

test("explicit Linux questions keep Linux authority first", () => {
  const ordered = orderEvidenceByAuthority(
    [
      { parentId: "linux-1", publisher: "Linux", retrievalRank: 1 },
      { parentId: "ms-2", publisher: "Microsoft", retrievalRank: 2 },
      { parentId: "ms-3", publisher: "Microsoft", retrievalRank: 3 },
      { parentId: "linux-4", publisher: "Linux", retrievalRank: 4 },
      { parentId: "ms-5", publisher: "Microsoft", retrievalRank: 5 }
    ],
    "A Linux service is failing intermittently. How would you investigate it?"
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["linux-1", "linux-4", "ms-2", "ms-3", "ms-5"]
  );
  assert.deepEqual(
    ordered.map((item) => item.retrievalRank),
    [1, 4, 2, 3, 5]
  );
});

test("Microsoft-only relative order is unchanged and Copilot has no special rule", () => {
  const sources = [
    { parentId: "rollout", publisher: "Microsoft" as const, retrievalRank: 1 },
    { parentId: "plan", publisher: "Microsoft" as const, retrievalRank: 2 },
    { parentId: "overshare", publisher: "Microsoft" as const, retrievalRank: 3 }
  ];
  const ordered = orderEvidenceByAuthority(
    sources,
    "How would you secure data before Microsoft 365 Copilot rollout?"
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["rollout", "plan", "overshare"]
  );
  assert.equal(ordered[0], sources[0]);
  assert.equal(ordered[1], sources[1]);
  assert.equal(ordered[2], sources[2]);
});

test("B1 architecture overview beats a narrow analog step", () => {
  const analog = {
    parentId: "analog",
    publisher: "Microsoft" as const,
    title: "Direct Routing - Connecting analog devices",
    section: "Step 1: Connect the SBC to Direct Routing",
    retrievalRank: 3,
    score: 0.024
  };
  const overview = {
    parentId: "plan-overview",
    publisher: "Microsoft" as const,
    title: "Plan Direct Routing",
    section: "Overview",
    retrievalRank: 5,
    score: 0.021
  };
  const prereq = {
    parentId: "ac-prereq",
    publisher: "AudioCodes" as const,
    title: "AudioCodes Mediant infrastructure",
    section: "Infrastructure Prerequisites",
    retrievalRank: 1,
    score: 0.027
  };
  const ordered = orderEvidenceForPresentation(
    [prereq, analog, overview],
    "Explain Direct Routing"
  );
  assert.equal(ordered[0]?.parentId, "plan-overview");
  assert.ok(
    ordered.findIndex((item) => item.parentId === "plan-overview") <
      ordered.findIndex((item) => item.parentId === "analog")
  );
  assert.deepEqual(
    new Set(ordered.map((item) => item.parentId)),
    new Set(["plan-overview", "analog", "ac-prereq"])
  );
  assert.equal(ordered.find((item) => item.parentId === "analog")?.retrievalRank, 3);
  assert.equal(ordered.find((item) => item.parentId === "plan-overview")?.score, 0.021);
  assert.equal(presentationIntentClass("Explain Direct Routing"), "architecture");
});

test("B2 HA/redundancy evidence beats country/region-code material", () => {
  const ha = {
    parentId: "ac-ha",
    publisher: "AudioCodes" as const,
    title: "AudioCodes Mediant SBC: Overview of High Availability Mode",
    section: "Overview",
    retrievalRank: 1,
    score: 0.027
  };
  const country = {
    parentId: "ms-country",
    publisher: "Microsoft" as const,
    title: "Direct Routing country/region codes",
    section: "Country and region code reference table",
    retrievalRank: 2,
    score: 0.016
  };
  const lmo = {
    parentId: "ms-lmo",
    publisher: "Microsoft" as const,
    title: "Local Media Optimization for Direct Routing",
    section: "Supported customer scenarios",
    retrievalRank: 3,
    score: 0.016
  };
  const ordered = orderEvidenceForPresentation(
    [ha, country, lmo],
    "What would geographic redundancy look like for Direct Routing?"
  );
  assert.equal(ordered[0]?.parentId, "ac-ha");
  assert.equal(ordered[0]?.publisher, "AudioCodes");
  assert.ok(
    ordered.findIndex((item) => item.parentId === "ac-ha") <
      ordered.findIndex((item) => item.parentId === "ms-country")
  );
  assert.equal(ordered.find((item) => item.parentId === "ac-ha")?.retrievalRank, 1);
  assert.equal(ordered.length, 3);
});

test("B3 explicit AudioCodes configuration still leads with AudioCodes", () => {
  const ordered = orderEvidenceForPresentation(
    [
      {
        parentId: "ac-1",
        publisher: "AudioCodes",
        title: "AudioCodes Mediant pairing",
        section: "Configure the SBC",
        retrievalRank: 1
      },
      {
        parentId: "ms-plan",
        publisher: "Microsoft",
        title: "Plan Direct Routing",
        section: "Overview",
        retrievalRank: 2
      }
    ],
    "How would you configure an AudioCodes Mediant SBC?"
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["ac-1", "ms-plan"]
  );
  assert.equal(classifyQuestionIntent("How would you configure an AudioCodes Mediant SBC?").intentClass, "configuration");
});

test("B4 troubleshooting prefers diagnostic material and ignores architecture overview rules", () => {
  const routing = {
    parentId: "outbound",
    publisher: "Microsoft" as const,
    title: "Issues with outbound calls",
    section: "Troubleshoot users unable to make calls",
    retrievalRank: 1
  };
  const overview = {
    parentId: "plan-overview",
    publisher: "Microsoft" as const,
    title: "Plan Direct Routing",
    section: "Overview",
    retrievalRank: 2
  };
  const analytics = {
    parentId: "cqa",
    publisher: "Microsoft" as const,
    title: "Call Analytics",
    section: "Troubleshoot user call quality problems",
    retrievalRank: 3
  };
  const ordered = orderEvidenceForPresentation(
    [routing, overview, analytics],
    "A user cannot call external numbers. How would you troubleshoot?"
  );
  assert.equal(ordered[0]?.parentId, "outbound");
  assert.notEqual(ordered[0]?.parentId, "plan-overview");
  assert.ok(ordered.some((item) => item.parentId === "outbound"));
  assert.ok(ordered.some((item) => item.parentId === "cqa"));
  assert.equal(
    classifyQuestionIntent(
      "A user cannot call external numbers. How would you troubleshoot?"
    ).intentClass,
    "troubleshooting"
  );
  assert.equal(ordered.length, 3);
});

test("B5 configuration prefers procedural sources over architecture overviews", () => {
  const overview = {
    parentId: "phone-overview",
    publisher: "Microsoft" as const,
    title: "Plan Teams Phone",
    section: "Overview",
    retrievalRank: 1
  };
  const procedure = {
    parentId: "call-queue",
    publisher: "Microsoft" as const,
    title: "Set up a Call queue",
    section: "Step 1: Create the resource account",
    retrievalRank: 2
  };
  const ordered = orderEvidenceForPresentation(
    [overview, procedure],
    "Walk me through configuring an Auto Attendant and Call Queue."
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["call-queue", "phone-overview"]
  );
  assert.equal(procedure.retrievalRank, 2);
  assert.equal(
    classifyQuestionIntent(
      "Walk me through configuring an Auto Attendant and Call Queue."
    ).intentClass,
    "configuration"
  );
});

test("B6 Copilot/governance sources are not demoted by overview rules", () => {
  const rollout = {
    parentId: "ms-rollout",
    publisher: "Microsoft" as const,
    title: "SharePoint OneDrive rollout Overview",
    section: "Overview",
    retrievalRank: 1,
    score: 0.03
  };
  const overshare = {
    parentId: "ms-overshare",
    publisher: "Microsoft" as const,
    title: "SAM Step 3 oversharing",
    section: "Restrict oversharing before Copilot",
    retrievalRank: 3,
    score: 0.02
  };
  const ordered = orderEvidenceForPresentation(
    [rollout, overshare],
    "How would you secure SharePoint and OneDrive before Copilot?"
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["ms-rollout", "ms-overshare"]
  );
  assert.equal(overshare.retrievalRank, 3);
  assert.equal(overshare.score, 0.02);
  assert.notEqual(
    classifyQuestionIntent(
      "How would you secure SharePoint and OneDrive before Copilot?"
    ).intentClass,
    "architecture"
  );
});

test("forensic Direct Routing / geo / vendor / Linux presentation order", () => {
  assert.deepEqual(
    orderEvidenceForPresentation(
      [
        {
          publisher: "AudioCodes",
          retrievalRank: 1,
          title: "AudioCodes Mediant SBC to Microsoft Teams Direct Routing",
          section: "1.4 Infrastructure Prerequisites"
        },
        {
          publisher: "AudioCodes",
          retrievalRank: 2,
          title: "AudioCodes Mediant SBC with Microsoft Teams Direct Routing",
          section: "2.3 Infrastructure Prerequisites"
        },
        {
          publisher: "Microsoft",
          retrievalRank: 3,
          title: "Direct Routing - Connecting analog devices",
          section: "Step 1: Connect the SBC to Direct Routing"
        },
        {
          publisher: "AudioCodes",
          retrievalRank: 4,
          title: "AudioCodes Mediant SBC with Microsoft Teams Direct Routing",
          section: "1.1 About Microsoft Teams Direct Routing"
        },
        {
          publisher: "Microsoft",
          retrievalRank: 5,
          title: "Plan Direct Routing",
          section: "Overview"
        }
      ],
      "Explain Direct Routing"
    ).map((item) => `${item.retrievalRank}:${item.publisher}:${item.section}`),
    [
      "5:Microsoft:Overview",
      "3:Microsoft:Step 1: Connect the SBC to Direct Routing",
      "1:AudioCodes:1.4 Infrastructure Prerequisites",
      "4:AudioCodes:1.1 About Microsoft Teams Direct Routing",
      "2:AudioCodes:2.3 Infrastructure Prerequisites"
    ]
  );
  assert.equal(
    orderEvidenceForPresentation(
      [
        {
          publisher: "AudioCodes",
          retrievalRank: 1,
          title: "AudioCodes Mediant SBC: Overview of High Availability Mode",
          section: "Overview"
        },
        {
          publisher: "Microsoft",
          retrievalRank: 2,
          title: "Direct Routing country/region codes",
          section: "Country and region code reference table"
        },
        {
          publisher: "Microsoft",
          retrievalRank: 3,
          title: "Local Media Optimization for Direct Routing",
          section: "Supported customer scenarios"
        }
      ],
      "What would geographic redundancy look like for Direct Routing?"
    )[0]?.publisher,
    "AudioCodes"
  );
});

test("C1 symptom-specific outbound troubleshooting beats adjacent generic pages", () => {
  const question =
    "How would you troubleshoot a user who cannot call external numbers?";
  assert.equal(classifyQuestionIntent(question).intentClass, "troubleshooting");
  assert.equal(hasTroubleshootingIntent(question), true);
  const analyticsRoles = {
    parentId: "cqa-roles",
    publisher: "Microsoft" as const,
    title: "Use Call Analytics to support call quality",
    section: "Assign Call Analytics support roles",
    retrievalRank: 1,
    score: 0.03
  };
  const callerId = {
    parentId: "aa-cli",
    publisher: "Microsoft" as const,
    title: "Auto attendant and Call queue outbound calling",
    section: "Calling line identification",
    retrievalRank: 2,
    score: 0.028
  };
  const licensing = {
    parentId: "aa-license",
    publisher: "Microsoft" as const,
    title: "Auto attendant and Call queue licensing",
    section: "License requirements",
    retrievalRank: 3,
    score: 0.026
  };
  const dialPlans = {
    parentId: "dial-plans",
    publisher: "Microsoft" as const,
    title: "Microsoft Teams Dial plans for phone call routing",
    section: "Overview",
    retrievalRank: 4,
    score: 0.024
  };
  const outbound = {
    parentId: "outbound-issues",
    publisher: "Microsoft" as const,
    title: "Issues with outbound calls",
    section: "Some users are unable to make calls",
    retrievalRank: 5,
    score: 0.022
  };
  const ordered = orderEvidenceForPresentation(
    [analyticsRoles, callerId, licensing, dialPlans, outbound],
    question
  );
  assert.equal(ordered[0]?.parentId, "outbound-issues");
  assert.ok(
    ordered.findIndex((item) => item.parentId === "outbound-issues") <
      ordered.findIndex((item) => item.parentId === "aa-license")
  );
  assert.ok(
    ordered.findIndex((item) => item.parentId === "dial-plans") <
      ordered.findIndex((item) => item.parentId === "aa-license")
  );
  assert.deepEqual(
    new Set(ordered.map((item) => item.parentId)),
    new Set([
      "cqa-roles",
      "aa-cli",
      "aa-license",
      "dial-plans",
      "outbound-issues"
    ])
  );
  assert.equal(outbound.retrievalRank, 5);
  assert.equal(outbound.score, 0.022);
});

test("C2 poor-audio Call Analytics stays high and is not penalized as a tool page", () => {
  const exact =
    "A user is complaining of poor audio. How would you determine where the problem is?";
  assert.equal(hasTroubleshootingIntent(exact), true);
  const analytics = {
    parentId: "cqa-quality",
    publisher: "Microsoft" as const,
    title: "Call Analytics",
    section: "Troubleshoot user call quality problems",
    retrievalRank: 1,
    score: 0.03
  };
  const rooms = {
    parentId: "rooms-hw",
    publisher: "Microsoft" as const,
    title: "Microsoft Teams Rooms hardware requirements",
    section: "Certified systems",
    retrievalRank: 5,
    score: 0.02
  };
  const exactOrder = orderEvidenceForPresentation([rooms, analytics], exact);
  assert.equal(exactOrder[0]?.parentId, "cqa-quality");
  assert.equal(analytics.retrievalRank, 1);
  assert.equal(exactOrder.length, 2);
});

test("C3 lockout/sign-in evidence leads generic MTR setup when troubleshooting intent applies", () => {
  const exact =
    "A Teams Room account keeps locking out. How would you investigate it?";
  assert.equal(hasTroubleshootingIntent(exact), true);
  const setup = {
    parentId: "mtr-setup",
    publisher: "Microsoft" as const,
    title: "Set up Microsoft Teams Rooms",
    section: "Deployment checklist",
    retrievalRank: 1
  };
  const lockout = {
    parentId: "mtr-lockout",
    publisher: "Microsoft" as const,
    title: "Microsoft Teams Rooms authentication",
    section: "Troubleshoot account lockout and sign-in failures",
    retrievalRank: 3
  };
  const ordered = orderEvidenceForPresentation([setup, lockout], exact);
  assert.equal(ordered[0]?.parentId, "mtr-lockout");
  assert.equal(lockout.retrievalRank, 3);
  assert.equal(ordered.length, 2);
});

test("C4 architecture Direct Routing ordering does not regress", () => {
  const question = "Explain Direct Routing";
  assert.equal(hasTroubleshootingIntent(question), false);
  const ordered = orderEvidenceForPresentation(
    [
      {
        parentId: "ac-prereq",
        publisher: "AudioCodes",
        title: "AudioCodes Mediant infrastructure",
        section: "Infrastructure Prerequisites",
        retrievalRank: 1
      },
      {
        parentId: "analog",
        publisher: "Microsoft",
        title: "Direct Routing - Connecting analog devices",
        section: "Step 1: Connect the SBC to Direct Routing",
        retrievalRank: 3
      },
      {
        parentId: "plan-overview",
        publisher: "Microsoft",
        title: "Plan Direct Routing",
        section: "Overview",
        retrievalRank: 5
      }
    ],
    question
  );
  assert.equal(ordered[0]?.parentId, "plan-overview");
  assert.ok(
    ordered.findIndex((item) => item.parentId === "plan-overview") <
      ordered.findIndex((item) => item.parentId === "analog")
  );
});

test("C5 AudioCodes configuration ordering does not regress", () => {
  const question = "How would you configure an AudioCodes Mediant SBC?";
  assert.equal(hasTroubleshootingIntent(question), false);
  const ordered = orderEvidenceForPresentation(
    [
      {
        parentId: "ac-1",
        publisher: "AudioCodes",
        title: "AudioCodes Mediant pairing",
        section: "Configure the SBC",
        retrievalRank: 1
      },
      {
        parentId: "ms-plan",
        publisher: "Microsoft",
        title: "Plan Direct Routing",
        section: "Overview",
        retrievalRank: 2
      }
    ],
    question
  );
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    ["ac-1", "ms-plan"]
  );
});

test("C6 PowerShell audit collection is not reordered by symptom matching", () => {
  const question =
    "How would you use PowerShell to audit Teams Voice users and their voice configuration?";
  assert.equal(hasTroubleshootingIntent(question), false);
  const sources = [
    { parentId: "Get-CsOnlineUser", publisher: "Microsoft" as const, title: "Get-CsOnlineUser", section: "Synopsis", retrievalRank: 1, score: 0.9 },
    { parentId: "Get-CsOnlineVoiceRoutingPolicy", publisher: "Microsoft" as const, title: "Get-CsOnlineVoiceRoutingPolicy", section: "Synopsis", retrievalRank: 2, score: 0.8 },
    { parentId: "Get-CsTeamsCallingPolicy", publisher: "Microsoft" as const, title: "Get-CsTeamsCallingPolicy", section: "Synopsis", retrievalRank: 3, score: 0.7 },
    { parentId: "Get-CsOnlineVoiceRoute", publisher: "Microsoft" as const, title: "Get-CsOnlineVoiceRoute", section: "Synopsis", retrievalRank: 4, score: 0.6 },
    { parentId: "Get-CsTenantDialPlan", publisher: "Microsoft" as const, title: "Get-CsTenantDialPlan", section: "Synopsis", retrievalRank: 5, score: 0.5 }
  ];
  const ordered = orderEvidenceForPresentation(sources, question);
  assert.deepEqual(
    ordered.map((item) => item.parentId),
    [
      "Get-CsOnlineUser",
      "Get-CsOnlineVoiceRoutingPolicy",
      "Get-CsTeamsCallingPolicy",
      "Get-CsOnlineVoiceRoute",
      "Get-CsTenantDialPlan"
    ]
  );
  assert.equal(ordered[0]?.score, 0.9);
  assert.equal(ordered[4]?.retrievalRank, 5);
});

test("retrieval, STT, and question intent stay outside authority ordering", () => {
  const forbidden = [
    "src/main/services/evidence/evidenceSearchClient.ts",
    "src/shared/questionIntent.ts",
    "src/main/services/pipelineManager.ts",
    "src/main/services/deepgramSttProvider.ts",
    "src/main/services/deepgramUtteranceAssembler.ts",
    "src/main/services/crossSourceUtteranceArbiter.ts",
    "src/main/services/questionCompletenessGuard.ts",
    "src/renderer/audio-capture/captureLoopbackAudio.ts"
  ];
  for (const file of forbidden) {
    const source = readFileSync(resolve(file), "utf8");
    assert.doesNotMatch(
      source,
      /orderEvidenceByAuthority|detectEvidenceAuthorityPreference|evidenceAuthorityOrder/
    );
  }
  const unchanged = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "HEAD",
      "--",
      "src/main/services/evidence/evidenceSearchClient.ts",
      "src/shared/questionIntent.ts",
      "src/main/services/pipelineManager.ts",
      "src/main/services/deepgramSttProvider.ts",
      "src/main/services/deepgramUtteranceAssembler.ts",
      "src/main/services/crossSourceUtteranceArbiter.ts",
      "src/main/services/questionCompletenessGuard.ts",
      "src/renderer/audio-capture/captureLoopbackAudio.ts"
    ],
    { encoding: "utf8", cwd: resolve(".") }
  ).trim();
  assert.equal(unchanged, "");
});
