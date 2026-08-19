import "dotenv/config";
import { runQuestionToEvidenceBundle } from "../../../src/main/services/answerV2/inspectEvidence";
import { buildAnswerPlan, assembleDeterministicAnswer } from "../../../src/main/services/answerV2";

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

async function main() {
  const evidence = await runQuestionToEvidenceBundle({ question: QUESTION });
  const plan = buildAnswerPlan(evidence.bundle);
  const assembled = assembleDeterministicAnswer({ bundle: evidence.bundle, plan });
  console.log(JSON.stringify(assembled, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
