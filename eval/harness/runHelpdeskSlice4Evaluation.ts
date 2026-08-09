import "./cliEnvironment";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createSqliteConversationStore,
  GroundedAnswerExecutionPort,
  HelpdeskService,
  LiveAssistService,
  type AnswerExecutionPort,
  type AnswerExecutionRequest,
  type AnswerExecutionResult
} from "../../src/main/services/conversations";

interface EvalCase {
  questionId: string;
  question: string;
  expectedAnswerability:
    | "answered"
    | "partial"
    | "insufficient_evidence";
}

class MeasuringPort implements AnswerExecutionPort {
  result: AnswerExecutionResult | null = null;
  startedAt = 0;
  completedAt = 0;

  constructor(
    private readonly delegate: AnswerExecutionPort
  ) {}

  async execute(
    request: AnswerExecutionRequest
  ): Promise<AnswerExecutionResult> {
    this.startedAt = performance.now();
    this.result = await this.delegate.execute(request);
    this.completedAt = performance.now();
    return this.result;
  }
}

function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.max(
        0,
        Math.ceil((value / 100) * sorted.length) - 1
      )
    ] ?? 0
  );
}

function summary(values: number[]) {
  return {
    p50: Number(percentile(values, 50).toFixed(3)),
    p95: Number(percentile(values, 95).toFixed(3))
  };
}

async function main(): Promise<void> {
  const datasetPath = resolve(
    process.argv[2] ?? "eval/datasets/evidence-wb18.jsonl"
  );
  const outputDir = resolve(
    process.argv[3] ?? "eval/runs/helpdesk-slice4"
  );
  await mkdir(outputDir, { recursive: true });
  const runId = `helpdesk-slice4-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const databasePath = resolve(outputDir, `${runId}.sqlite`);
  const rows = (await readFile(datasetPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalCase);
  const store = createSqliteConversationStore({ databasePath });
  const port = new MeasuringPort(
    new GroundedAnswerExecutionPort()
  );
  const helpdesk = new HelpdeskService(store, port);
  let finalProjectionAt = 0;
  const live = new LiveAssistService(store, helpdesk, {
    sessionChanged: () => undefined,
    projectionChanged: (projection) => {
      if (
        !["accepted", "executing"].includes(projection.state)
      ) {
        finalProjectionAt = performance.now();
      }
    },
    conversationUpdated: () => undefined
  });
  const cases: Array<Record<string, unknown>> = [];

  try {
    for (const row of rows) {
      const created = helpdesk.createConversation(
        `Live evaluation ${row.questionId}`
      );
      live.start(created.conversation.id);
      finalProjectionAt = 0;
      const acceptedAt = performance.now();
      const completion = live.acceptQuestion(row.question);
      const durableUser = store
        .loadOrderedMessages(created.conversation.id)
        .find(
          (message) =>
            message.role === "user" &&
            message.inputOrigin === "live_transcript"
        );
      const durableAt = performance.now();
      await completion;
      const completedAt = performance.now();
      const view = helpdesk.loadConversation(
        created.conversation.id
      );
      const assistant = view.messages.find(
        (message) => message.role === "assistant"
      );
      const execution = port.result;
      const diagnostics =
        execution?.ok === true ? execution.diagnostics : null;
      cases.push({
        questionId: row.questionId,
        question: row.question,
        expectedAnswerability: row.expectedAnswerability,
        answerability: assistant?.answerability ?? "failed",
        answerabilityMatch:
          assistant?.answerability === row.expectedAnswerability,
        durableUserMessage: Boolean(durableUser),
        inputOrigin: durableUser?.inputOrigin ?? null,
        answerText: assistant?.content ?? null,
        citationCount: assistant?.citations.length ?? 0,
        snapshotId: assistant?.groundingSnapshotId ?? null,
        answerGenerationRequestCount:
          diagnostics?.answerGenerationRequestCount ?? 0,
        latencyMs: {
          stt: null,
          sttExcludedReason:
            "Harness begins at accepted-question boundary.",
          acceptedQuestionToDurableUser:
            durableAt - acceptedAt,
          groundedPipeline:
            port.completedAt - port.startedAt,
          persistence:
            Math.max(0, completedAt - port.completedAt),
          overlayProjection:
            Math.max(0, finalProjectionAt - completedAt),
          acceptedQuestionToVisibleValidatedAnswer:
            Math.max(
              0,
              (finalProjectionAt || completedAt) - acceptedAt
            )
        }
      });
      live.stop("evaluation_case_complete");
    }
  } finally {
    store.close();
  }

  const latency = (key: string) =>
    cases.map(
      (entry) =>
        (
          entry["latencyMs"] as Record<string, number | null>
        )[key] ?? 0
    );
  const artifact = {
    artifactVersion: "helpdesk-slice4.0",
    runId,
    createdAt: new Date().toISOString(),
    datasetPath,
    databasePath,
    summary: {
      total: cases.length,
      answerabilityMatch: cases.filter(
        (entry) => entry["answerabilityMatch"] === true
      ).length,
      durableLiveTurns: cases.filter(
        (entry) => entry["durableUserMessage"] === true
      ).length,
      answerGenerationRequestCount: cases.reduce(
        (sum, entry) =>
          sum +
          Number(entry["answerGenerationRequestCount"] ?? 0),
        0
      ),
      latencyMs: {
        acceptedQuestionToDurableUser: summary(
          latency("acceptedQuestionToDurableUser")
        ),
        groundedPipeline: summary(latency("groundedPipeline")),
        persistence: summary(latency("persistence")),
        overlayProjection: summary(
          latency("overlayProjection")
        ),
        acceptedQuestionToVisibleValidatedAnswer: summary(
          latency(
            "acceptedQuestionToVisibleValidatedAnswer"
          )
        )
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
            : "helpdesk_slice4_evaluation_failed"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
