import "./cliEnvironment";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createSqliteConversationStore,
  GroundedAnswerExecutionPort,
  HelpdeskService,
  type AnswerExecutionPort,
  type AnswerExecutionRequest,
  type AnswerExecutionResult
} from "../../src/main/services/conversations";

interface Slice3EvalCase {
  questionId: string;
  question: string;
  expectedAnswerability:
    | "answered"
    | "partial"
    | "insufficient_evidence";
}

class RecordingGroundedPort implements AnswerExecutionPort {
  lastResult: AnswerExecutionResult | null = null;

  constructor(
    private readonly delegate: AnswerExecutionPort
  ) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    const result = await this.delegate.execute(request);
    this.lastResult = result;
    return result;
  }
}

function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((value / 100) * sorted.length) - 1
  );
  return sorted[index] ?? 0;
}

async function loadDataset(path: string): Promise<Slice3EvalCase[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Slice3EvalCase);
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.argv[2] ?? "eval/datasets/evidence-wb18.jsonl"
  );
  const outputDir = resolve(
    process.argv[3] ?? "eval/runs/helpdesk-slice3"
  );
  await mkdir(outputDir, { recursive: true });
  const runId = `helpdesk-slice3-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const databasePath = resolve(outputDir, `${runId}.sqlite`);
  const store = createSqliteConversationStore({ databasePath });
  const recordingPort = new RecordingGroundedPort(
    new GroundedAnswerExecutionPort()
  );
  const service = new HelpdeskService(store, recordingPort);
  const rows = await loadDataset(datasetPath);
  const cases: Array<Record<string, unknown>> = [];

  try {
    for (const row of rows) {
      const conversation = service.createConversation(
        `Evaluation ${row.questionId}`
      );
      const started = performance.now();
      const submitted = await service.submitMessage({
        conversationId: conversation.conversation.id,
        content: row.question,
        inputOrigin: "typed"
      });
      const endToVisibleAnswerMs = performance.now() - started;
      const execution = recordingPort.lastResult;
      const assistant = submitted.view.messages.find(
        (message) => message.role === "assistant"
      );
      const diagnostics =
        execution?.ok === true ? execution.diagnostics : null;
      cases.push({
        questionId: row.questionId,
        question: row.question,
        expectedAnswerability: row.expectedAnswerability,
        outcome: submitted.outcome,
        answerabilityMatch:
          submitted.outcome === row.expectedAnswerability,
        assistantMessagePersisted: Boolean(assistant),
        persistedAnswerText: assistant?.content ?? null,
        r4AnswerText:
          execution?.ok === true ? execution.answerText : null,
        answerTextUnchanged:
          execution?.ok === true
            ? assistant?.content === execution.answerText
            : assistant === undefined,
        citationCount: assistant?.citations.length ?? 0,
        citations: assistant?.citations ?? [],
        snapshotId: assistant?.groundingSnapshotId ?? null,
        stageLatencyMs: diagnostics,
        persistenceAndServiceMs: diagnostics
          ? Math.max(
              0,
              endToVisibleAnswerMs - diagnostics.pipelineTotalMs
            )
          : null,
        endToVisibleAnswerMs,
        answerGenerationRequestCount:
          diagnostics?.answerGenerationRequestCount ?? 0
      });
    }
  } finally {
    store.close();
  }

  const latencyValues = (
    key:
      | "retrievalMs"
      | "evidenceResolutionMs"
      | "planningMs"
      | "assemblyMs"
      | "citationMappingMs"
      | "pipelineTotalMs"
  ): number[] =>
    cases
      .map(
        (entry) =>
          (
            entry["stageLatencyMs"] as
              | Record<string, number>
              | null
          )?.[key]
      )
      .filter((value): value is number => typeof value === "number");
  const visibleValues = cases.map((entry) =>
    Number(entry["endToVisibleAnswerMs"] ?? 0)
  );
  const persistenceValues = cases
    .map((entry) => entry["persistenceAndServiceMs"])
    .filter((value): value is number => typeof value === "number");
  const summarize = (values: number[]) => ({
    p50: Number(percentile(values, 50).toFixed(3)),
    p95: Number(percentile(values, 95).toFixed(3))
  });
  const artifact = {
    artifactVersion: "helpdesk-slice3.0",
    runId,
    createdAt: new Date().toISOString(),
    datasetPath,
    databasePath,
    summary: {
      total: cases.length,
      answerabilityMatch: cases.filter(
        (entry) => entry["answerabilityMatch"] === true
      ).length,
      exactAnswerPersistence: cases.filter(
        (entry) => entry["answerTextUnchanged"] === true
      ).length,
      answerGenerationRequestCount: cases.reduce(
        (sum, entry) =>
          sum +
          Number(entry["answerGenerationRequestCount"] ?? 0),
        0
      ),
      latencyMs: {
        retrieval: summarize(latencyValues("retrievalMs")),
        evidenceResolution: summarize(
          latencyValues("evidenceResolutionMs")
        ),
        planning: summarize(latencyValues("planningMs")),
        assembly: summarize(latencyValues("assemblyMs")),
        citationMapping: summarize(
          latencyValues("citationMappingMs")
        ),
        frozenPipelineTotal: summarize(
          latencyValues("pipelineTotalMs")
        ),
        persistenceAndService: summarize(persistenceValues),
        endToVisibleAnswer: summarize(visibleValues)
      }
    },
    cases
  };
  const artifactPath = resolve(outputDir, `${runId}.json`);
  await writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    `${JSON.stringify(
      { artifactPath, summary: artifact.summary },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error:
          error instanceof Error
            ? error.message
            : "helpdesk_slice3_evaluation_failed"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
