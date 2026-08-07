import { routeQueryIntent } from "./domainPolicies";
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
  const intentResult = extractQueryIntent(question);
  const routeResult = routeQueryIntent(intentResult.intent);
  process.stdout.write(
    `${JSON.stringify(
      {
        question,
        queryIntentLatencyMs: Number(intentResult.latencyMs.toFixed(3)),
        routerLatencyMs: Number(routeResult.latencyMs.toFixed(3)),
        intent: intentResult.intent,
        scope: routeResult.scope
      },
      null,
      2
    )}\n`
  );
}

main();

