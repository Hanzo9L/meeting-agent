import "dotenv/config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createConfiguredGroundedSynthesisProvider,
  resolveGroundedSynthesisRuntimeConfig,
  type GroundedSynthesisPayload,
  type GroundedSynthesisProvider,
  type GroundedSynthesisProviderResult
} from "../../src/main/services/answerV2";
import {
  createSqliteConversationStore,
  GroundedAnswerExecutionPort,
  HelpdeskService,
  type AnswerExecutionPort,
  type AnswerExecutionRequest,
  type AnswerExecutionResult
} from "../../src/main/services/conversations";

const allScenarios = [
  {
    id: "powershell_workflow",
    question:
      "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.",
    profiles: ["helpdesk_detailed", "live_assist_quick"] as const
  },
  {
    id: "sharepoint_copilot",
    question:
      "How would you secure SharePoint data so it is not accessible by all Copilot users?",
    profiles: ["helpdesk_detailed"] as const
  },
  {
    id: "entra_conditional_access",
    question:
      "How do I configure Conditional Access to require MFA?",
    profiles: ["helpdesk_detailed"] as const
  },
  {
    id: "calling_plans",
    question: "How do Calling Plans work?",
    profiles: ["helpdesk_detailed"] as const
  }
];
const requestedScenarioIds = new Set(
  (process.env["G1_VALIDATION_SCENARIOS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const scenarios =
  requestedScenarioIds.size === 0
    ? allScenarios
    : allScenarios.filter((scenario) =>
        requestedScenarioIds.has(scenario.id)
      );

class RecordingSynthesisProvider implements GroundedSynthesisProvider {
  readonly providerId: string;
  readonly records: Array<{
    payload: GroundedSynthesisPayload;
    result?: GroundedSynthesisProviderResult;
    error?: string;
  }> = [];

  constructor(private readonly inner: GroundedSynthesisProvider) {
    this.providerId = `recording:${inner.providerId}`;
  }

  async synthesize(
    payload: GroundedSynthesisPayload
  ): Promise<GroundedSynthesisProviderResult> {
    const record: (typeof this.records)[number] = { payload };
    this.records.push(record);
    try {
      const result = await this.inner.synthesize(payload);
      record.result = result;
      return result;
    } catch (error) {
      record.error =
        error instanceof Error ? error.message : "provider_failed";
      throw error;
    }
  }
}

class RecordingExecutionPort implements AnswerExecutionPort {
  lastResult: AnswerExecutionResult | null = null;
  lastLatencyMs = 0;

  constructor(private readonly inner: AnswerExecutionPort) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    const started = performance.now();
    this.lastResult = await this.inner.execute(request);
    this.lastLatencyMs = performance.now() - started;
    return this.lastResult;
  }
}

async function main(): Promise<void> {
  const configured = createConfiguredGroundedSynthesisProvider();
  if (!configured) {
    throw new Error("G1 validation requires an OpenAI credential.");
  }
  const synthesis = new RecordingSynthesisProvider(configured);
  const execution = new RecordingExecutionPort(
    new GroundedAnswerExecutionPort({
      databasePath: resolve(".knowledge-v2/knowledge-v2.sqlite"),
      synthesisProvider: synthesis
    })
  );
  const root = mkdtempSync(join(tmpdir(), "relay-g1-validation-"));
  const conversationDatabasePath = join(root, "conversations.sqlite");
  const store = createSqliteConversationStore({
    databasePath: conversationDatabasePath
  });
  const service = new HelpdeskService(store, execution);
  const results: unknown[] = [];
  try {
    for (const scenario of scenarios) {
      for (const profile of scenario.profiles) {
        const beforeProviderCount = synthesis.records.length;
        const conversation = service.createConversation(
          `G1 ${scenario.id} ${profile}`
        );
        const visibleStarted = performance.now();
        const submission =
          profile === "live_assist_quick"
            ? await service.submitLiveQuestion({
                conversationId: conversation.conversation.id,
                content: scenario.question,
                captureSource: "system"
              })
            : await service.submitMessage({
                conversationId: conversation.conversation.id,
                content: scenario.question,
                inputOrigin: "typed"
              });
        const totalVisibleMs = performance.now() - visibleStarted;
        const executionResult = execution.lastResult;
        const synthesisRecord =
          synthesis.records.length > beforeProviderCount
            ? synthesis.records.at(-1) ?? null
            : null;
        const reader = createSqliteConversationStore({
          databasePath: conversationDatabasePath
        });
        const reloaded = reader.loadOrderedMessages(
          conversation.conversation.id
        );
        reader.close();
        const assistant = reloaded.find(
          (message) => message.role === "assistant"
        );
        results.push({
          scenario: scenario.id,
          profile,
          question: scenario.question,
          outcome: submission.outcome,
          deterministicFactualText:
            executionResult?.ok
              ? executionResult.factualAnswerText
              : null,
          synthesisPayload: synthesisRecord?.payload ?? null,
          synthesisProviderOutput: synthesisRecord?.result?.output ?? null,
          synthesisProviderError: synthesisRecord?.error ?? null,
          displayedAnswer:
            executionResult?.ok ? executionResult.answerText : null,
          diagnostics:
            executionResult?.ok ? executionResult.diagnostics : null,
          persistenceAndServiceMs: Math.max(
            0,
            totalVisibleMs - execution.lastLatencyMs
          ),
          totalVisibleMs,
          attribution:
            executionResult?.ok
              ? executionResult.citations.map((citation) => ({
                  claimId: citation.claimId,
                  evidenceId: citation.evidenceId,
                  sourceTitle: citation.sourceTitle,
                  canonicalUrl: citation.canonicalUrl,
                  range: citation.answerRange,
                  displayedSubstring: executionResult.answerText.slice(
                    citation.answerRange.startOffset,
                    citation.answerRange.endOffset
                  )
                }))
              : [],
          contextReferences:
            executionResult?.ok
              ? executionResult.contextReferences
              : [],
          persisted: Boolean(assistant),
          reloadedAnswer: assistant?.content ?? null,
          reloadByteEquivalent:
            executionResult?.ok &&
            assistant?.content === executionResult.answerText,
          reloadedCitations: assistant?.citations ?? [],
          reloadedContextReferences:
            assistant?.contextReferences ?? []
        });
      }
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
  const outputPath = resolve(
    "eval/runs/indexing/g1-production-validation.json"
  );
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        synthesisProviderId: configured.providerId,
        synthesisRuntimeConfig:
          resolveGroundedSynthesisRuntimeConfig(),
        results
      },
      null,
      2
    )
  );
  console.log(outputPath);
}

void main();
