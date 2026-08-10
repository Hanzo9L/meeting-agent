import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCliEnvironment } from "./cliEnvironment";
import {
  assembleDeterministicAnswer,
  buildAnswerPlan,
  buildExplanationContext,
  presentGroundedAnswer,
  runQuestionToEvidenceBundle
} from "../../src/main/services/answerV2";

loadCliEnvironment();

const QUESTIONS = [
  {
    id: "procedural-powershell",
    question:
      "How do I enable a Teams user for voice using PowerShell?"
  },
  {
    id: "conceptual",
    question: "What is a Microsoft Teams Calling Plan?"
  },
  {
    id: "cmdlet-reference",
    question: "What does Set-CsOnlineVoiceUser do?"
  },
  {
    id: "partial-candidate",
    question:
      "How do Microsoft Teams Calling Plans work and which nonexistent cmdlet enables them?"
  },
  {
    id: "insufficient-candidate",
    question:
      "What does Set-CsDefinitelyNotARealCmdletForRelayEval do?"
  }
] as const;

async function evaluateOne(question: string): Promise<Record<string, unknown>> {
  const grounding = await runQuestionToEvidenceBundle({ question });
  const plan = buildAnswerPlan(grounding.bundle);
  const assembled = assembleDeterministicAnswer({
    bundle: grounding.bundle,
    plan
  });
  if (!assembled.ok || !assembled.answer.extractiveAssembly) {
    return {
      question,
      ok: false,
      stage: "r4",
      answerability: grounding.bundle.answerability,
      proofFacts: plan.plannedClaims.map((claim) => ({
        claimId: claim.claimId,
        proposition: claim.proposition,
        evidenceIds: claim.evidenceIds,
        mandatory: claim.mandatory
      })),
      unsupportedAspects: plan.unsupportedAspects,
      r4Failure: assembled.ok ? null : assembled.failure,
      note: "Presentation was not applied because frozen R4 assembly failed closed."
    };
  }
  const context = buildExplanationContext({
    bundle: grounding.bundle,
    plan
  });
  const presented = presentGroundedAnswer({
    plan,
    answer: assembled.answer,
    provenance: assembled.answer.extractiveAssembly,
    contextBlocks: context.blocks
  });
  return {
    question,
    ok: true,
    answerability: plan.answerability,
    proofFacts: plan.plannedClaims.map((claim) => ({
      claimId: claim.claimId,
      proposition: claim.proposition,
      evidenceIds: claim.evidenceIds,
      mandatory: claim.mandatory
    })),
    unsupportedAspects: plan.unsupportedAspects,
    r4Baseline: assembled.answer.answerText,
    explanationContext: context.blocks.map((block) => ({
      contextBlockId: block.contextBlockId,
      contextType: block.contextType,
      evidenceId: block.evidenceId,
      documentId: block.documentId,
      sourceTitle: block.sourceTitle,
      headingPath: block.headingPath,
      exactText: block.exactText,
      contentHash: block.contentHash,
      canonicalUrl: block.canonicalUrl,
      relatedClaimIds: block.relatedClaimIds,
      relatedAspectIds: block.relatedAspectIds
    })),
    helpdeskDetailed: presented.helpdeskDetailed.answerText,
    liveAssistQuick: presented.liveAssistQuick.answerText,
    sourceMapping: {
      proofFacts: assembled.answer.extractiveAssembly.renderedClaims.map(
        (claim) => ({
          claimId: claim.claimId,
          renderedText: claim.renderedText,
          evidenceIds: claim.evidenceIds
        })
      ),
      contextBlocks: presented.helpdeskDetailed.contextReferences
    },
    performance: {
      contextBuildMs: context.diagnostics.latencyMs,
      presentationPlanningMs: presented.planningLatencyMs,
      presentationRenderMs: presented.renderingLatencyMs,
      providerRequestCount: 0
    }
  };
}

async function main(): Promise<void> {
  const started = new Date().toISOString();
  const results = [];
  for (const entry of QUESTIONS) {
    results.push({
      id: entry.id,
      ...(await evaluateOne(entry.question))
    });
  }
  const outDir = join("eval", "runs", "answer-experience");
  await mkdir(outDir, { recursive: true });
  const outPath = join(
    outDir,
    `answer-experience-${started.replace(/[:.]/g, "-")}.json`
  );
  const payload = {
    schemaVersion: "answer-experience-eval/v1",
    startedAt: started,
    results
  };
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outPath, count: results.length }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exit(1);
});
