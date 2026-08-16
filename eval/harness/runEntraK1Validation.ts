import "dotenv/config";
import { GroundedAnswerExecutionPort } from "../../src/main/services/conversations/answerExecutionPort";
import { runQuestionToEvidenceBundle } from "../../src/main/services/answerV2/inspectEvidence";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import { routeQueryIntent } from "../../src/main/services/retrievalV2/domainPolicies";

const QUESTIONS = [
  {
    id: "ca-mfa",
    question: "How would I configure a Conditional Access policy to require MFA for all admin roles?"
  },
  {
    id: "app-registration",
    question: "How do I register an application in Entra and grant it API permissions?"
  },
  {
    id: "entra-role",
    question: "What Entra role would let someone manage Exchange without being a Global Administrator?"
  },
  {
    id: "compliant-device",
    question: "How do I require a compliant device for access to a specific app?"
  },
  {
    id: "sharepoint-negative",
    question: "How would you secure SharePoint data so it is not accessible by all Copilot users?"
  },
  {
    id: "calling-plans-regression",
    question: "How do I assign a Calling Plan phone number to a user?"
  }
] as const;

async function main(): Promise<void> {
  const port = new GroundedAnswerExecutionPort();
  const results = [];
  for (const item of QUESTIONS) {
    const intent = extractQueryIntent(item.question).intent;
    const route = routeQueryIntent(intent);
    const evidence = await runQuestionToEvidenceBundle({ question: item.question });
    const executed = await port.execute({
      conversationId: "k1-entra-validation",
      userMessageId: item.id,
      question: item.question
    });
    results.push({
      id: item.id,
      question: item.question,
      queryIntent: {
        domains: intent.domains,
        products: intent.products,
        entities: intent.entities,
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
        routingWarnings: route.scope.routingWarnings
      },
      r2: {
        answerability: evidence.bundle.answerability,
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
          }
    });
    process.stderr.write(`[K1-validate] ${item.id} answerability=${evidence.bundle.answerability} portOk=${executed.ok}\n`);
  }
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
