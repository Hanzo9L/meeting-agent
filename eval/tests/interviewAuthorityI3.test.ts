import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  classifyInterviewMaterializationTarget,
  markdownLooksRetiredOrSuperseded,
  SUPERSEDED_CALL_QUALITY_URLS
} from "../../src/main/services/knowledgeV2/corpus/interviewAuthorityMaterialization";
import {
  conceptPresentInText,
  interviewPowerShellCoreCanonicalUrls,
  loadInterviewDataset,
  loadPackChunkCorpus,
  loadSelectedMicrosoftPackUrls,
  PRIORITY_14_QUESTION_IDS,
  resolveLocalInterviewPacks,
  SUPERSEDED_INTERVIEW_URLS,
  type MicrosoftInterviewPackId
} from "../harness/interviewAuthorityPack";

test("I3 keeps the fixed 72 Microsoft I1 references and does not add superseded call-quality pages", () => {
  const selected = [...loadSelectedMicrosoftPackUrls().values()].flat();
  assert.equal(selected.length, 72);
  for (const excluded of [
    ...SUPERSEDED_INTERVIEW_URLS,
    ...SUPERSEDED_CALL_QUALITY_URLS
  ]) {
    assert.equal(selected.includes(excluded), false);
    const classified = classifyInterviewMaterializationTarget(excluded);
    assert.equal("unsupported" in classified, true);
  }
});

test("I3 classifies missing Priority-14 pages onto existing Microsoft sources", () => {
  assert.deepEqual(
    classifyInterviewMaterializationTarget(
      "https://learn.microsoft.com/en-us/microsoftteams/cqd-what-is-call-quality-dashboard"
    ),
    { sourceId: "ms-teams-admin", trackId: "ga", transport: "learn_mcp" }
  );
  assert.deepEqual(
    classifyInterviewMaterializationTarget(
      "https://learn.microsoft.com/en-us/troubleshoot/microsoftteams/phone-system/direct-routing/sip-options-tls-certificate-issues"
    ),
    { sourceId: "ms-teams-admin", trackId: "ga", transport: "learn_mcp" }
  );
  assert.deepEqual(
    classifyInterviewMaterializationTarget(
      "https://learn.microsoft.com/en-us/sharepoint/restricted-access-control"
    ),
    { sourceId: "ms-sharepoint-docs", trackId: "ga", transport: "learn_mcp" }
  );
  assert.deepEqual(
    classifyInterviewMaterializationTarget(
      "https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-troubleshoot-sign-in-errors"
    ),
    { sourceId: "ms-entra-docs", trackId: "ga", transport: "learn_mcp" }
  );
  assert.deepEqual(
    classifyInterviewMaterializationTarget(
      "https://learn.microsoft.com/en-us/microsoft-365/copilot/get-ready-copilot-sharepoint-advanced-management"
    ),
    { sourceId: "ms-m365-docs", trackId: "ga", transport: "learn_mcp" }
  );
  assert.equal(
    "unsupported" in
      classifyInterviewMaterializationTarget(
        "https://www.freedesktop.org/software/systemd/man/latest/systemctl.html"
      ),
    true
  );
});

test("retired Learn notices are rejected during I3 materialization", () => {
  assert.equal(
    markdownLooksRetiredOrSuperseded(
      "---\nms.custom: retired\n---\nThis article is retired."
    ),
    true
  );
  assert.equal(
    markdownLooksRetiredOrSuperseded(
      "# Call Quality Dashboard\n\nCQD reports organization-wide trends."
    ),
    false
  );
});

test("G2.2 PowerShell Core facts remain reusable by the interview pack", () => {
  const coreUrls = interviewPowerShellCoreCanonicalUrls();
  assert.equal(coreUrls.length, 4);
  assert.ok(coreUrls.some((url) => url.toLowerCase().includes("foreach-object")));
  assert.ok(coreUrls.some((url) => url.toLowerCase().includes("export-csv")));
  const powershell = resolveLocalInterviewPacks().get(
    "teams_powershell_interview_subset"
  );
  assert.ok(powershell);
  assert.ok(
    powershell.localDocuments.some((doc) =>
      /foreach-object/i.test(`${doc.sourcePath} ${doc.title}`)
    )
  );
});

test("Priority 14 Microsoft packs have non-zero local materialization", () => {
  const questions = loadInterviewDataset().filter((item) =>
    (PRIORITY_14_QUESTION_IDS as readonly string[]).includes(item.questionId)
  );
  const packs = resolveLocalInterviewPacks();
  for (const packId of new Set(
    questions.map((item) => item.expectedAuthorityPack)
  )) {
    const resolved = packs.get(
      packId as "teams_voice_direct_routing"
    );
    assert.ok(resolved, packId);
    assert.ok(
      resolved.localDocuments.length > 0,
      `${packId} has no local documents`
    );
    assert.ok(
      resolved.localDocuments.reduce((total, doc) => total + doc.chunkCount, 0) >
        0,
      `${packId} has no local chunks`
    );
  }
  assert.ok(
    (packs.get("call_quality_troubleshooting")?.localDocuments.length ?? 0) >= 4
  );
});

test("I3 does not change Interview Quick generation, GPT-style turns, or QA Assist capture", () => {
  const presenter = readFileSync(
    resolve("src/main/services/answerV2/deterministicAnswerPresenter.ts"),
    "utf8"
  );
  const liveAssist = readFileSync(
    resolve("src/main/services/conversations/liveAssistService.ts"),
    "utf8"
  );
  const overlay = readFileSync(resolve("src/renderer/overlay/App.tsx"), "utf8");
  const main = readFileSync(resolve("src/main/index.ts"), "utf8");
  const retrieval = readFileSync(
    resolve("src/main/services/retrievalV2/retrievalSqliteCommon.ts"),
    "utf8"
  );
  assert.match(presenter, /live_assist_quick/);
  assert.doesNotMatch(presenter, /OpenAiGroundedAnswerGenerator/);
  assert.match(overlay, /interviewTurn/);
  assert.match(overlay, /answerRunId/);
  assert.match(liveAssist, /qa_assist/);
  assert.match(main, /profile === "qa_assist"\s*\n\s*\?\s*"system"/);
  assert.match(
    retrieval,
    /if \(scope\.eligibleDocumentIds !== undefined\)/
  );
  assert.match(
    retrieval,
    /\$\{documentAlias\}\.document_id IN \(\$\{documentPlaceholders\}\)/
  );
  assert.doesNotMatch(
    retrieval,
    /sourceTrackFilter AND \$\{documentAlias\}\.document_id IN/
  );
});

test("approved I1 Microsoft references resolve to canonical Learn sources", () => {
  const selected = loadSelectedMicrosoftPackUrls();
  for (const [packId, urls] of selected) {
    assert.ok(urls.length > 0, packId);
    for (const url of urls) {
      assert.match(
        url,
        /^https:\/\/learn\.microsoft\.com\//i,
        `${packId} ${url}`
      );
      if (url.includes("/powershell/module/")) continue;
      const classified = classifyInterviewMaterializationTarget(url);
      assert.equal(
        "unsupported" in classified,
        false,
        `${packId} ${url}`
      );
    }
  }
});

test("Priority-14 required concepts are present in local pack chunks", () => {
  const packs = resolveLocalInterviewPacks();
  const corpora = new Map<MicrosoftInterviewPackId, string>();
  const packIds: MicrosoftInterviewPackId[] = [
    "teams_voice_direct_routing",
    "call_quality_troubleshooting",
    "auto_attendants_call_queues",
    "teams_rooms",
    "sharepoint_onedrive_copilot_governance",
    "teams_powershell_interview_subset"
  ];
  for (const packId of packIds) {
    const pack = packs.get(packId);
    assert.ok(pack, packId);
    assert.equal(pack.missingCanonicalUrls.length, 0, packId);
    corpora.set(packId, loadPackChunkCorpus(pack));
  }

  const questions = loadInterviewDataset().filter((item) =>
    (PRIORITY_14_QUESTION_IDS as readonly string[]).includes(item.questionId)
  );
  for (const question of questions) {
    const corpus = corpora.get(
      question.expectedAuthorityPack as MicrosoftInterviewPackId
    );
    assert.ok(corpus && corpus.length > 0, question.expectedAuthorityPack);
    const missing = question.requiredConcepts.filter((concept) => {
      if (conceptPresentInText(corpus, concept)) return false;
      const compact = concept.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return compact.length < 6 || !corpus.toLowerCase().includes(compact);
    });
    assert.ok(
      missing.length <=
        Math.max(1, Math.floor(question.requiredConcepts.length * 0.4)),
      `${question.questionId} missing locally: ${missing.join(", ")}`
    );
    if (question.questionId === "Q-026") {
      assert.equal(missing.length, 0, missing.join(", "));
    }
  }
});
