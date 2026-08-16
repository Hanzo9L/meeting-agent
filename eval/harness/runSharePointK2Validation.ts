import "dotenv/config";
import { GroundedAnswerExecutionPort } from "../../src/main/services/conversations/answerExecutionPort";
import { runQuestionToEvidenceBundle } from "../../src/main/services/answerV2/inspectEvidence";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../src/main/services/retrievalV2/domainPolicies";

const QUESTIONS = [
  {
    id: "primary-copilot-security",
    question:
      "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  },
  {
    id: "copilot-permission-boundary",
    question: "Does Microsoft 365 Copilot bypass existing SharePoint permissions?"
  },
  {
    id: "oversharing",
    question: "How do I identify SharePoint sites that are overshared before rolling out Copilot?"
  },
  {
    id: "restricted-content-discovery",
    question: "What is Restricted Content Discovery?"
  },
  {
    id: "sharing-restriction",
    question: "How would I restrict sharing on a sensitive SharePoint site?"
  },
  {
    id: "anyone-links",
    question: "How do I review or remove Anyone sharing links?"
  },
  {
    id: "spo-cmdlet",
    question: "What does the Set-SPOSite cmdlet do?"
  },
  {
    id: "entra-conditional-access-regression",
    question:
      "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  },
  {
    id: "teams-calling-plans-regression",
    question: "How do I assign a Calling Plan phone number to a user?"
  },
  {
    id: "exchange-negative-control",
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
    const startedAt = performance.now();
    const executed = await port.execute({
      conversationId: "k2-sharepoint-validation",
      userMessageId: item.id,
      question: item.question
    });
    const latencyMs = performance.now() - startedAt;
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
        eligibleSources: route.scope.eligibleSources.map((source) => ({
          sourceId: source.sourceId,
          priority: source.priority,
          authorityRoles: source.authorityRoles
        })),
        sourcePriorityChain: route.scope.sourcePriorityChain,
        routingWarnings: route.scope.routingWarnings
      },
      r2: {
        answerability: evidence.bundle.answerability,
        aspects: evidence.bundle.aspectCoverage.aspects.map((aspect) => ({
          aspectId: aspect.aspectId,
          requirement: aspect.requirement,
          answerObject: aspect.answerObject
        })),
        selectedEvidence: evidence.bundle.evidence.slice(0, 8).map((entry) => ({
          sourceId: entry.source.sourceId,
          sourceDomain: entry.source.sourceDomain,
          title: entry.source.title,
          canonicalUrl: entry.source.canonicalUrl,
          headingPath: entry.location.headingPath,
          supportTypes: entry.supportTypes
        }))
      },
      productionPort: executed.ok
        ? {
            ok: true,
            answerability: executed.answerability,
            answerText: executed.answerText,
            factualAnswerText: executed.factualAnswerText,
            citations: executed.citations.map((citation) => ({
              sourceId: citation.sourceId,
              authorityRole: citation.authorityRole,
              sourceTitle: citation.sourceTitle,
              canonicalUrl: citation.canonicalUrl,
              headingPath: citation.headingPath,
              preview: citation.preview
            })),
            latencyMs: executed.diagnostics.pipelineTotalMs,
            factualGroundingGenerationRequests:
              executed.diagnostics.factualGroundingGenerationRequests,
            presentationSynthesisRequests:
              executed.diagnostics.presentationSynthesisRequests
          }
        : {
            ok: false,
            code: executed.code,
            stage: executed.stage,
            userSafeMessage: executed.userSafeMessage
          },
      wallClockLatencyMs: latencyMs
    });
    process.stderr.write(
      `[K2-validate] ${item.id} domains=${intent.domains.join(",")} answerability=${evidence.bundle.answerability} portOk=${executed.ok}\n`
    );
  }
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
