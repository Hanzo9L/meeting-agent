import "./cliEnvironment";
import { inspectGroundedAnswerForQuestion } from "../../src/main/services/answerV2";

async function main(): Promise<void> {
  const question = process.argv[2];
  if (!question) {
    throw new Error('Usage: npm run inspect:grounded-answer -- "question" [provider]');
  }
  const providerArg = process.argv[3] as "openai" | "fake" | undefined;
  const result = await inspectGroundedAnswerForQuestion({
    question,
    provider: providerArg
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "inspect_grounded_answer_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
