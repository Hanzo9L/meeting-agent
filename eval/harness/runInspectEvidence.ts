import "./cliEnvironment";
import { inspectEvidenceForQuestion } from "../../src/main/services/answerV2";

function resolveQuestionFromArgs(): string {
  const args = process.argv.slice(2);
  if (args.length === 0) return "How does Teams Direct Routing voice routing work?";
  return args.join(" ");
}

async function main(): Promise<void> {
  const question = resolveQuestionFromArgs();
  const result = await inspectEvidenceForQuestion({ question });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      { error: error instanceof Error ? error.message : "inspect_evidence_failed" },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
