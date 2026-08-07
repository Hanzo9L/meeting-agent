import { extractQueryIntent } from "./queryIntentRules";

function resolveQuestionFromArgs(): string {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return "How does Teams Direct Routing voice routing work?";
  }
  return args.join(" ");
}

function main(): void {
  const question = resolveQuestionFromArgs();
  const result = extractQueryIntent(question);
  process.stdout.write(
    `${JSON.stringify(
      {
        question,
        latencyMs: Number(result.latencyMs.toFixed(3)),
        intent: result.intent
      },
      null,
      2
    )}\n`
  );
}

main();
