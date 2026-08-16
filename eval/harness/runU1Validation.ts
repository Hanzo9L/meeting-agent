import "dotenv/config";
import { GroundedAnswerExecutionPort } from "../../src/main/services/conversations/answerExecutionPort";
import { runQuestionToEvidenceBundle } from "../../src/main/services/answerV2/inspectEvidence";
import { buildAnswerPlan } from "../../src/main/services/answerV2";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../src/main/services/retrievalV2/domainPolicies";

const QUESTIONS = [
  {
    id: "sharepoint-copilot-security",
    question:
      "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  },
  {
    id: "conditional-access-mfa",
    question:
      "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  },
  {
    id: "restricted-content-discovery",
    question: "What is Restricted Content Discovery?"
  },
  {
    id: "teams-rooms-management-health",
    question: "How do I manage Microsoft Teams Rooms devices and health from Teams admin tools?"
  },
  {
    id: "teams-calling-plans-narrow",
    question: "How do Microsoft Teams Calling Plans work?"
  },
  {
    id: "sharepoint-spo-cmdlet-narrow",
    question: "What does the Set-SPOSite cmdlet do?"
  },
  {
    id: "exchange-unknown-negative-control",
    question:
      "How do I set up a mailbox delegation so my assistant can manage my calendar and email?"
  }
] as const;

async function main(): Promise<void> {
  const port = new GroundedAnswerExecutionPort();
  const results = [];
  for (const item of QUESTIONS) {
    const intent = extractQueryIntent(item.question).intent;
    const route = routeQueryIntent(intent);
    const evidence = await runQuestionToEvidenceBundle({ question: item.question });
    const plan = buildAnswerPlan(evidence.bundle);

    const startedAt = performance.now();
    const executedDetailed = await port.execute({
      conversationId: "u1-validation",
      userMessageId: `${item.id}-detailed`,
      question: item.question,
      presentationProfile: "helpdesk_detailed"
    });
    const detailedLatencyMs = performance.now() - startedAt;

    const quickStartedAt = performance.now();
    const executedQuick = await port.execute({
      conversationId: "u1-validation",
      userMessageId: `${item.id}-quick`,
      question: item.question,
      presentationProfile: "live_assist_quick"
    });
    const quickLatencyMs = performance.now() - quickStartedAt;

    results.push({
      id: item.id,
      question: item.question,
      queryIntent: {
        domains: intent.domains,
        products: intent.products,
        technologies: intent.technologies,
        entities: intent.entities,
        commandNames: intent.commandNames,
        unresolvedAmbiguity: intent.unresolvedAmbiguity,
        expectedAnswerType: intent.expectedAnswerType
      },
      routed: {
        selectedDomains: route.scope.selectedDomains,
        routingWarnings: route.scope.routingWarnings
      },
      aspects: evidence.bundle.aspectCoverage.aspects.map((aspect) => ({
        aspectId: aspect.aspectId,
        requirement: aspect.requirement,
        breadth: aspect.breadth,
        answerObject: aspect.answerObject,
        requiredFacets: aspect.requiredFacets,
        subjects: aspect.subjects.map((subject) => ({ kind: subject.kind, terms: subject.terms }))
      })),
      topCandidates: [
        ...evidence.bundle.evidence.map((entry) => ({
          fusionRank: entry.retrieval.fusionRank,
          sourceId: entry.source.sourceId,
          title: entry.source.title,
          headingPath: entry.location.headingPath,
          outcome: "selected" as const
        })),
        ...evidence.bundle.rejectedCandidates.map((candidate) => ({
          fusionRank: candidate.fusionRank,
          sourceId: candidate.sourceId,
          title: candidate.title,
          headingPath: [] as string[],
          outcome: "rejected" as const
        }))
      ]
        .sort((a, b) => a.fusionRank - b.fusionRank)
        .slice(0, 15),
      r2: {
        answerability: evidence.bundle.answerability,
        selectedEvidence: evidence.bundle.evidence.map((entry) => ({
          sourceId: entry.source.sourceId,
          sourceDomain: entry.source.sourceDomain,
          title: entry.source.title,
          canonicalUrl: entry.source.canonicalUrl,
          headingPath: entry.location.headingPath,
          supportTypes: entry.supportTypes,
          selectionReason: entry.selectionReason
        })),
        rejectedCandidates: evidence.bundle.rejectedCandidates.map((candidate) => ({
          title: candidate.title,
          sourceId: candidate.sourceId,
          fusionRank: candidate.fusionRank,
          reasons: candidate.reasons
        })),
        populations: evidence.bundle.diagnostics.populations
      },
      r3: {
        plannedClaimsTotal: plan.plannedClaims.length,
        mandatoryClaimsTotal: plan.plannedClaims.filter((claim) => claim.mandatory).length,
        supportingClaimsTotal: plan.plannedClaims.filter((claim) => !claim.mandatory).length,
        distinctAspectIdsCovered: [
          ...new Set(plan.plannedClaims.map((claim) => claim.requiredAspectId))
        ],
        distinctEvidenceIdsUsed: plan.evidenceReferences.usedEvidenceIds.length,
        duplicateClaimsCollapsed: plan.diagnostics.duplicateClaimsCollapsed
      },
      productionPortDetailed: executedDetailed.ok
        ? {
            ok: true,
            answerability: executedDetailed.answerability,
            answerText: executedDetailed.helpdeskDetailedText,
            citations: executedDetailed.citations.map((citation) => ({
              sourceId: citation.sourceId,
              authorityRole: citation.authorityRole,
              sourceTitle: citation.sourceTitle,
              canonicalUrl: citation.canonicalUrl,
              preview: citation.preview
            })),
            factualGroundingGenerationRequests:
              executedDetailed.diagnostics
                .factualGroundingGenerationRequests,
            presentationSynthesisRequests:
              executedDetailed.diagnostics
                .presentationSynthesisRequests,
            latencyMs: executedDetailed.diagnostics.pipelineTotalMs
          }
        : {
            ok: false,
            code: executedDetailed.code,
            stage: executedDetailed.stage,
            userSafeMessage: executedDetailed.userSafeMessage
          },
      productionPortQuick: executedQuick.ok
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
          },
      wallClockLatencyMs: { detailed: detailedLatencyMs, quick: quickLatencyMs }
    });
    process.stderr.write(
      `[U1-validate] ${item.id} domains=${intent.domains.join(",")} answerability=${evidence.bundle.answerability} selected=${evidence.bundle.evidence.length} portOk=${executedDetailed.ok}\n`
    );
  }
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
