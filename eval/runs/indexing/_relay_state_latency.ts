import "dotenv/config";
import { runQuestionToEvidenceBundle } from "../../../src/main/services/answerV2/inspectEvidence";

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

async function main() {
  const r = await runQuestionToEvidenceBundle({ question: QUESTION });
  console.log(JSON.stringify(r.bundle.diagnostics, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
