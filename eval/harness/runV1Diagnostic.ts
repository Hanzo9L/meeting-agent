import "dotenv/config";
import { GroundedAnswerExecutionPort } from "../../src/main/services/conversations/answerExecutionPort";
import { runQuestionToEvidenceBundle } from "../../src/main/services/answerV2/inspectEvidence";
import { buildAnswerPlan } from "../../src/main/services/answerV2";
import { evidenceSatisfiesMethodConstraint } from "../../src/main/services/answerV2/methodConstraintPolicy";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../src/main/services/retrievalV2/domainPolicies";

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";

async function main(): Promise<void> {
  const port = new GroundedAnswerExecutionPort();

  const intent = extractQueryIntent(QUESTION).intent;
  const route = routeQueryIntent(intent);
  const evidence = await runQuestionToEvidenceBundle({ question: QUESTION });
  const plan = buildAnswerPlan(evidence.bundle);

  const executedDetailed = await port.execute({
    conversationId: "v1-diagnostic",
    userMessageId: "voice-csv-workflow-detailed",
    question: QUESTION,
    presentationProfile: "helpdesk_detailed"
  });
  const executedQuick = await port.execute({
    conversationId: "v1-diagnostic",
    userMessageId: "voice-csv-workflow-quick",
    question: QUESTION,
    presentationProfile: "live_assist_quick"
  });

  const methodSatisfactionByAspect = evidence.bundle.aspectCoverage.aspects.map((aspect) => {
    const evidenceIds = evidence.bundle.aspectCoverage.evidenceByAspect[aspect.aspectId] ?? [];
    const items = evidence.bundle.evidence.filter((item) => evidenceIds.includes(item.evidenceId));
    return {
      aspectId: aspect.aspectId,
      methodConstraints: aspect.methodConstraints.map((constraint) => ({
        kind: constraint.kind,
        required: constraint.required,
        satisfiedBy: items
          .filter((item) => evidenceSatisfiesMethodConstraint(item, constraint))
          .map((item) => item.evidenceId)
      }))
    };
  });

  const result = {
    question: QUESTION,
    queryIntent: {
      domains: intent.domains,
      products: intent.products,
      technologies: intent.technologies,
      entities: intent.entities,
      commandNames: intent.commandNames,
      policyNames: intent.policyNames,
      operationIntents: intent.operationIntents,
      expectedAnswerType: intent.expectedAnswerType,
      unresolvedAmbiguity: intent.unresolvedAmbiguity,
      requiresFreshnessCheck: intent.requiresFreshnessCheck,
      allowsBetaSources: intent.allowsBetaSources
    },
    routing: {
      selectedDomains: route.scope.selectedDomains,
      focusSubdomains: route.scope.focusSubdomains,
      sourcePriorityChain: route.scope.sourcePriorityChain,
      eligibleSources: route.scope.eligibleSources.map((source) => ({
        sourceId: source.sourceId,
        priority: source.priority,
        authorityRoles: source.authorityRoles,
        rationale: source.rationale
      })),
      excludedSources: route.scope.excludedSources,
      exactMatchDirectives: route.scope.exactMatchDirectives,
      routingWarnings: route.scope.routingWarnings,
      routingRationale: route.scope.routingRationale,
      scopeMode: route.scope.scopeMode,
      estimatedCandidatePopulation: route.scope.estimatedCandidatePopulation
    },
    aspects: evidence.bundle.aspectCoverage.aspects.map((aspect) => ({
      aspectId: aspect.aspectId,
      requirement: aspect.requirement,
      breadth: aspect.breadth,
      answerObject: aspect.answerObject,
      subject: aspect.subject,
      subjects: aspect.subjects.map((subject) => ({ kind: subject.kind, terms: subject.terms, value: subject.value })),
      operation: aspect.operation,
      requiredFacets: aspect.requiredFacets,
      methodConstraints: aspect.methodConstraints,
      authorityRequirement: aspect.authorityRequirement,
      derivation: aspect.derivation
    })),
    top25Candidates: [
      ...evidence.bundle.evidence.map((entry) => ({
        fusionRank: entry.retrieval.fusionRank,
        sourceId: entry.source.sourceId,
        title: entry.source.title,
        headingPath: entry.location.headingPath,
        methods: entry.retrieval.methods,
        outcome: "selected" as const,
        selectionReason: entry.selectionReason
      })),
      ...evidence.bundle.rejectedCandidates.map((candidate) => ({
        fusionRank: candidate.fusionRank,
        sourceId: candidate.sourceId,
        title: candidate.title,
        headingPath: [] as string[],
        methods: [] as string[],
        outcome: "rejected" as const,
        selectionReason: candidate.reasons.join(",")
      }))
    ]
      .sort((a, b) => a.fusionRank - b.fusionRank)
      .slice(0, 25),
    r2: {
      answerability: evidence.bundle.answerability,
      selectedEvidenceCount: evidence.bundle.evidence.length,
      selectedEvidence: evidence.bundle.evidence.map((entry) => ({
        sourceId: entry.source.sourceId,
        sourceDomain: entry.source.sourceDomain,
        authorityRoles: entry.source.authorityRoles,
        title: entry.source.title,
        canonicalUrl: entry.source.canonicalUrl,
        headingPath: entry.location.headingPath,
        supportTypes: entry.supportTypes,
        selectionReason: entry.selectionReason,
        textPreview: entry.text.slice(0, 300)
      })),
      rejectedCandidateCount: evidence.bundle.rejectedCandidates.length,
      rejectedCandidates: evidence.bundle.rejectedCandidates.map((candidate) => ({
        title: candidate.title,
        sourceId: candidate.sourceId,
        fusionRank: candidate.fusionRank,
        reasons: candidate.reasons
      })),
      supportedMandatoryAspectIds: evidence.bundle.aspectCoverage.supportedMandatoryAspectIds,
      unsupportedMandatoryAspectIds: evidence.bundle.aspectCoverage.unsupportedMandatoryAspectIds,
      authorityLimitedAspectIds: evidence.bundle.aspectCoverage.authorityLimitedAspectIds,
      methodSatisfactionByAspect,
      populations: evidence.bundle.diagnostics.populations,
      authorityCoverage: evidence.bundle.authorityCoverage
    },
    r3: {
      answerability: plan.answerability,
      decomposition: plan.diagnostics.decomposition,
      plannedClaims: plan.plannedClaims.map((claim) => ({
        claimId: claim.claimId,
        requiredAspectId: claim.requiredAspectId,
        claimType: claim.claimType,
        sectionId: claim.sectionId,
        proposition: claim.proposition,
        mandatory: claim.mandatory,
        supportStrength: claim.supportStrength,
        evidenceIds: claim.evidenceIds
      })),
      plannedClaimsTotal: plan.plannedClaims.length,
      mandatoryClaimsTotal: plan.plannedClaims.filter((c) => c.mandatory).length,
      unsupportedAspects: plan.unsupportedAspects,
      requiredCaveats: plan.requiredCaveats,
      recommendedStructure: plan.recommendedStructure
    },
    r4Detailed: executedDetailed.ok
      ? {
          ok: true,
          answerability: executedDetailed.answerability,
          answerText: executedDetailed.helpdeskDetailedText,
          citations: executedDetailed.citations.map((c) => ({
            sourceId: c.sourceId,
            authorityRole: c.authorityRole,
            sourceTitle: c.sourceTitle,
            canonicalUrl: c.canonicalUrl
          })),
          latencyMs: executedDetailed.diagnostics.pipelineTotalMs
        }
      : {
          ok: false,
          code: executedDetailed.code,
          stage: executedDetailed.stage,
          userSafeMessage: executedDetailed.userSafeMessage
        },
    r4Quick: executedQuick.ok
      ? {
          ok: true,
          answerability: executedQuick.answerability,
          answerText: executedQuick.liveAssistQuickText,
          latencyMs: executedQuick.diagnostics.pipelineTotalMs
        }
      : {
          ok: false,
          code: executedQuick.code,
          stage: executedQuick.stage,
          userSafeMessage: executedQuick.userSafeMessage
        }
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
