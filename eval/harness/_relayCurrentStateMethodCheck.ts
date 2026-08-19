import "dotenv/config";
import { runQuestionToEvidenceBundle } from "../../src/main/services/answerV2/inspectEvidence";
import { aspectMethodConstraintsSatisfied } from "../../src/main/services/answerV2/methodConstraintPolicy";

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

async function main(): Promise<void> {
  const run = await runQuestionToEvidenceBundle({ question: QUESTION });
  const bundle = run.bundle;
  const evidenceById = new Map(bundle.evidence.map((e) => [e.evidenceId, e]));

  const results = bundle.aspectCoverage.aspects
    .filter((a) => a.requirement === "mandatory")
    .map((aspect) => {
      const evidenceIds = bundle.aspectCoverage.evidenceByAspect[aspect.aspectId] ?? [];
      const items = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean) as typeof bundle.evidence;
      const satisfied = aspectMethodConstraintsSatisfied(aspect, items);
      return {
        aspectId: aspect.aspectId,
        supported: bundle.aspectCoverage.supportedMandatoryAspectIds.includes(aspect.aspectId),
        methodConstraintRequired: aspect.methodConstraints.some((c) => c.required),
        selectedEvidenceSourceIds: items.map((i) => i.source.sourceId),
        selectedEvidenceAuthorityRoles: items.map((i) => i.source.authorityRoles),
        selectedEvidenceTitles: items.map((i) => i.source.title),
        aspectMethodConstraintsSatisfied: satisfied,
        MISMATCH: bundle.aspectCoverage.supportedMandatoryAspectIds.includes(aspect.aspectId) && !satisfied
      };
    });

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
