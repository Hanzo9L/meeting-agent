import "dotenv/config";
import { performance } from "node:perf_hooks";
import { runQuestionToEvidenceBundle } from "../../src/main/services/answerV2/inspectEvidence";
import { buildAnswerPlan } from "../../src/main/services/answerV2/answerPlanner";
import { assembleDeterministicAnswer } from "../../src/main/services/answerV2/deterministicAnswerAssembler";
import { mapAnswerCitations } from "../../src/main/services/answerV2/citationMapper";
import { buildExplanationContext } from "../../src/main/services/answerV2/explanationContextBuilder";
import { presentGroundedAnswer } from "../../src/main/services/answerV2/deterministicAnswerPresenter";

const QUESTION =
  process.argv[2] ??
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

async function main(): Promise<void> {
  const t0 = performance.now();
  const run = await runQuestionToEvidenceBundle({ question: QUESTION });
  const bundle = run.bundle;
  const t1 = performance.now();

  const plan = buildAnswerPlan(bundle);
  const t2 = performance.now();

  const assembled = assembleDeterministicAnswer({ bundle, plan });
  const t3 = performance.now();

  let citationMapping: ReturnType<typeof mapAnswerCitations> | null = null;
  let presented: ReturnType<typeof presentGroundedAnswer> | null = null;
  if (assembled.ok) {
    citationMapping = mapAnswerCitations({ bundle, plan, answer: assembled.answer });
    const explanation = buildExplanationContext({ bundle, plan });
    presented = presentGroundedAnswer({
      plan,
      answer: assembled.answer,
      provenance: assembled.answer.extractiveAssembly!,
      contextBlocks: explanation.blocks
    });
  }
  const t4 = performance.now();

  const report = {
    latency: {
      retrievalAndEvidenceMs: t1 - t0,
      planningMs: t2 - t1,
      assemblyMs: t3 - t2,
      citationAndPresentationMs: t4 - t3,
      totalMs: t4 - t0
    },
    intent: bundle.intent,
    routeScope: run.routeScope,
    hybridDiagnostics: run.hybridDiagnostics,
    answerability: bundle.answerability,
    aspects: bundle.aspectCoverage.aspects.map((a) => ({
      aspectId: a.aspectId,
      requirement: a.requirement,
      subject: a.subject,
      operation: a.operation,
      methodConstraints: a.methodConstraints,
      answerObject: a.answerObject,
      requiredFacets: a.requiredFacets,
      authorityRequirement: a.authorityRequirement,
      canonicalIdentifier: a.canonicalIdentifier
    })),
    supportByAspect: bundle.aspectCoverage.supportByAspect,
    evidenceByAspect: bundle.aspectCoverage.evidenceByAspect,
    supportedMandatoryAspectIds: bundle.aspectCoverage.supportedMandatoryAspectIds,
    unsupportedMandatoryAspectIds: bundle.aspectCoverage.unsupportedMandatoryAspectIds,
    authorityLimitedAspectIds: bundle.aspectCoverage.authorityLimitedAspectIds,
    selectedEvidence: bundle.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      chunkId: e.chunkId,
      sourceId: e.source.sourceId,
      sourceDomain: e.source.sourceDomain,
      authorityRoles: e.source.authorityRoles,
      routePriority: e.source.routePriority,
      title: e.source.title,
      headingPath: e.location.headingPath,
      supportTypes: e.supportTypes,
      fusionRank: e.retrieval.fusionRank,
      methods: e.retrieval.methods,
      textSnippet: e.text.slice(0, 500)
    })),
    rejectedCandidatesCount: bundle.rejectedCandidates.length,
    authorityCoverage: bundle.authorityCoverage,
    exactIdentifierValidation: bundle.exactIdentifierValidation,
    plan: {
      answerType: plan.answerType,
      answerability: plan.answerability,
      facetCoverage: plan.diagnostics.facetCoverage,
      decomposition: plan.diagnostics.decomposition,
      duplicateClaimsCollapsed: plan.diagnostics.duplicateClaimsCollapsed,
      claims: plan.plannedClaims.map((c) => ({
        claimId: c.claimId,
        requiredAspectId: c.requiredAspectId,
        coveredFacets: c.coveredFacets,
        claimType: c.claimType,
        sectionId: c.sectionId,
        proposition: c.proposition,
        supportStrength: c.supportStrength,
        mandatory: c.mandatory,
        requiresCaveat: c.requiresCaveat,
        caveatCodes: c.caveatCodes,
        unsupportedAspectIds: c.unsupportedAspectIds,
        sourceSpans: c.sourceSpans.map((s) => ({
          sourceId: s.sourceId,
          sectionId: s.sectionId,
          headingPath: s.headingPath,
          text: s.text
        }))
      })),
      unsupportedAspects: plan.unsupportedAspects,
      requiredCaveats: plan.requiredCaveats
    },
    assembled: assembled.ok
      ? {
          answerability: assembled.answer.answerability,
          answerText: assembled.answer.answerText,
          validationIssues: (assembled.answer as any).validation?.issues ?? [],
          diagnostics: assembled.answer.diagnostics
        }
      : { ok: false, error: assembled },
    citations: citationMapping
      ? citationMapping.citations.map((c) => ({
          citationId: c.citationId,
          sourceTitle: c.sourceTitle,
          canonicalUrl: c.canonicalUrl,
          sourceId: c.sourceId,
          authorityRole: c.authorityRole,
          validation: c.validation
        }))
      : null,
    presented: presented
      ? {
          helpdeskDetailed: presented.helpdeskDetailed.answerText,
          liveAssistQuick: presented.liveAssistQuick.answerText
        }
      : null
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
