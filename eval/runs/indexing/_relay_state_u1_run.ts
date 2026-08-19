import "dotenv/config";
import { GroundedAnswerExecutionPort } from "../../../src/main/services/conversations/answerExecutionPort";
import { runQuestionToEvidenceBundle } from "../../../src/main/services/answerV2/inspectEvidence";
import { buildAnswerPlan } from "../../../src/main/services/answerV2";

const QUESTION = "How would you secure SharePoint data so it is not accessible by all Copilot users?";

async function main() {
  const port = new GroundedAnswerExecutionPort();
  const evidence = await runQuestionToEvidenceBundle({ question: QUESTION });
  const plan = buildAnswerPlan(evidence.bundle);
  const executed = await port.execute({
    conversationId: "u1-state-check",
    userMessageId: "u1-msg",
    question: QUESTION,
    presentationProfile: "helpdesk_detailed"
  });

  console.log(JSON.stringify({
    selectedEvidenceCount: evidence.bundle.evidence.length,
    selectedEvidence: evidence.bundle.evidence.map((e) => ({
      title: e.source.title,
      sourceId: e.source.sourceId,
      headingPath: e.location.headingPath,
      supportTypes: e.supportTypes,
      selectionReason: e.selectionReason
    })),
    plannedClaims: plan.plannedClaims.map((c) => ({
      claimId: c.claimId,
      requiredAspectId: c.requiredAspectId,
      proposition: c.proposition.slice(0, 200),
      evidenceIds: c.evidenceIds
    })),
    plannedClaimsTotal: plan.plannedClaims.length,
    r4: executed.ok
      ? { ok: true, answerability: executed.answerability, answerText: executed.helpdeskDetailedText, citations: executed.citations.map((c) => c.sourceTitle), contextReferences: executed.contextReferences.map((c) => c.sourceTitle) }
      : { ok: false, code: executed.code, stage: executed.stage }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
