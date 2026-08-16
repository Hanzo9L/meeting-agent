import "dotenv/config";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createConfiguredGroundedSynthesisProvider,
  resolveGroundedSynthesisRuntimeConfig,
  validateExecutablePowerShellAgainstClaims,
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

const QUESTION =
  "Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.";
const PROFILES = ["helpdesk_detailed", "live_assist_quick"] as const;
const ACCEPTANCE_SCRIPT = `$users = Get-CsOnlineUser -Filter {(EnterpriseVoiceEnabled -eq $True) -and (FeatureTypes -contains 'PhoneSystem') -and (AccountEnabled -eq $True)} -AccountType User

$users | ForEach-Object {
  $user = $_
  $dialPlan = Get-CsEffectiveTenantDialPlan -Identity $user.Identity
  $callingPolicy = $user.EffectivePolicyAssignments |
    Where-Object { $_.PolicyType -eq 'TeamsCallingPolicy' }

  [pscustomobject]@{
    Identity = $user.Identity
    EnterpriseVoiceEnabled = $user.EnterpriseVoiceEnabled
    TelephoneNumbers = $user.TelephoneNumbers
    OnlineVoiceRoutingPolicy = $user.OnlineVoiceRoutingPolicy
    EffectiveTenantDialPlanName = $dialPlan.EffectiveTenantDialPlanName
    TeamsCallingPolicy = $callingPolicy.PolicyAssignment.displayName
  }
} | Export-Csv -Path .\\TeamsVoiceReport.csv -NoTypeInformation`;

class RecordingSynthesisProvider implements GroundedSynthesisProvider {
  readonly providerId: string;
  readonly records: Array<{
    payload: GroundedSynthesisPayload;
    startedAt: number;
    completedAt?: number;
    result?: GroundedSynthesisProviderResult;
    error?: string;
  }> = [];

  constructor(private readonly inner: GroundedSynthesisProvider) {
    this.providerId = `recording:${inner.providerId}`;
  }

  async synthesize(
    payload: GroundedSynthesisPayload
  ): Promise<GroundedSynthesisProviderResult> {
    const record: (typeof this.records)[number] = {
      payload,
      startedAt: performance.now()
    };
    this.records.push(record);
    try {
      record.result = await this.inner.synthesize(payload);
      return record.result;
    } catch (error) {
      record.error =
        error instanceof Error ? error.message : "provider_failed";
      throw error;
    } finally {
      record.completedAt = performance.now();
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
    throw new Error(
      "G2.2 validation requires the configured cloud synthesis credential."
    );
  }
  const synthesis = new RecordingSynthesisProvider(configured);
  const execution = new RecordingExecutionPort(
    new GroundedAnswerExecutionPort({
      databasePath: resolve(".knowledge-v2/knowledge-v2.sqlite"),
      synthesisProvider: synthesis
    })
  );
  const root = mkdtempSync(join(tmpdir(), "relay-g2-2-validation-"));
  const conversationDatabasePath = join(root, "conversations.sqlite");
  const store = createSqliteConversationStore({
    databasePath: conversationDatabasePath
  });
  const results: unknown[] = [];

  try {
    for (const profile of PROFILES) {
      const beforeProviderCount = synthesis.records.length;
      const conversation = serviceConversation(
        new HelpdeskService(store, execution),
        profile
      );
      const visibleStarted = performance.now();
      const service = new HelpdeskService(store, execution);
      const submission =
        profile === "live_assist_quick"
          ? await service.submitLiveQuestion({
              conversationId: conversation,
              content: QUESTION,
              captureSource: "system"
            })
          : await service.submitMessage({
              conversationId: conversation,
              content: QUESTION,
              inputOrigin: "typed"
            });
      const totalVisibleMs = performance.now() - visibleStarted;
      const executionResult = execution.lastResult;
      const synthesisRecord =
        synthesis.records.length > beforeProviderCount
          ? synthesis.records.at(-1) ?? null
          : null;
      const persistenceStarted = performance.now();
      const reader = createSqliteConversationStore({
        databasePath: conversationDatabasePath
      });
      const reloaded = reader.loadOrderedMessages(conversation);
      reader.close();
      const persistenceReloadMs = performance.now() - persistenceStarted;
      const assistant = reloaded.find(
        (message) => message.role === "assistant"
      );
      const executable = synthesisRecord?.payload.executableWorkflow ?? null;
      const executableValidation = executable
        ? validateExecutablePowerShellAgainstClaims(
            executable.script,
            synthesisRecord!.payload.claims
          )
        : null;
      const acceptanceScriptValidation = synthesisRecord
        ? validateExecutablePowerShellAgainstClaims(
            ACCEPTANCE_SCRIPT,
            synthesisRecord.payload.claims
          )
        : null;
      const diagnostics = executionResult?.ok
        ? executionResult.diagnostics
        : null;
      const synthesisMs =
        synthesisRecord?.completedAt === undefined
          ? null
          : synthesisRecord.completedAt - synthesisRecord.startedAt;

      results.push({
        profile,
        question: QUESTION,
        outcome: submission.outcome,
        deterministicFactualText:
          executionResult?.ok ? executionResult.factualAnswerText : null,
        synthesisPayload: synthesisRecord?.payload ?? null,
        synthesisProviderOutput: synthesisRecord?.result?.output ?? null,
        synthesisProviderError: synthesisRecord?.error ?? null,
        executableScript: executable?.script ?? null,
        executableValidation,
        acceptanceScriptValidation,
        displayedAnswer:
          executionResult?.ok ? executionResult.answerText : null,
        diagnostics,
        latency: {
          retrievalAndEvidenceMs:
            readNumber(diagnostics, "retrievalMs") ??
            readNumber(diagnostics, "retrievalAndEvidenceMs"),
          deterministicGroundingMs:
            readNumber(diagnostics, "planningMs") ??
            readNumber(diagnostics, "groundingMs"),
          synthesisMs,
          persistenceAndServiceMs: Math.max(
            0,
            totalVisibleMs - execution.lastLatencyMs
          ),
          persistenceReloadMs,
          totalExecutionMs: execution.lastLatencyMs,
          totalVisibleMs
        },
        citations: executionResult?.ok ? executionResult.citations : [],
        persisted: Boolean(assistant),
        reloadedAnswer: assistant?.content ?? null,
        reloadByteEquivalent:
          executionResult?.ok &&
          assistant?.content === executionResult.answerText,
        reloadedCitations: assistant?.citations ?? []
      });
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }

  const outputPath = resolve(
    "eval/runs/indexing/g2_2-production-validation.json"
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
  process.stdout.write(`${outputPath}\n`);
}

function serviceConversation(
  service: HelpdeskService,
  profile: (typeof PROFILES)[number]
): string {
  return service.createConversation(`G2.2 ${profile}`).conversation.id;
}

function readNumber(
  value: unknown,
  key: string
): number | null {
  if (!value || typeof value !== "object") return null;
  const result = (value as Record<string, unknown>)[key];
  return typeof result === "number" ? result : null;
}

void main();
