import "./cliEnvironment";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";

const QUESTIONS = [
  "Tell me about a time you troubleshot a persistent Call Quality issue in Microsoft Teams. How did you use the Call Quality Dashboard (CQD) and Call Analytics to identify the root cause?",
  "A user is complaining they can't call external numbers. How do you troubleshoot?",
  "What is your experience with configuring an Auto Attendant and Call Queue from start to finish? Talk me through it.",
  "How do you approach creating and managing standard conference room resources in Exchange/M365?",
  "Explain the concept of Direct Routing to me as if I were a junior engineer. How do SBCs fit into the flow, and what role do certificates play?",
  "Have you coordinated number porting with carriers? What's the biggest challenge you've faced in that process?",
  "A Teams Room account seems to be locked out constantly. How do you investigate this using standard Windows/M365 tools?",
  "What's your comfort level in a Linux command line? Give me an example of how you've used it to manage a service or script.",
  "How do you approach managing MTR devices through Intune? Talk about policy configuration or troubleshooting a compliance issue.",
  "What is the most complex administrative task you have automated from scratch? Walk me through your process for identifying the opportunity and building the script.",
  "Tell me about a script you wrote to identify and fix a systemic issue in a UC environment.",
  "Tell me how you implemented Teams in a large conference room environment, and how Exchange and room resource accounts fit into that migration",
  "What are the steps to deploy Teams Rooms with Exchange resource accounts"
] as const;

async function main(): Promise<void> {
  const results = QUESTIONS.map((question) => {
    const extraction = extractQueryIntent(question);
    console.log(
      `${extraction.intent.expectedAnswerType.padEnd(15)} | ${extraction.intent.entities.length} | ${question.slice(0, 60)}`
    );
    return {
      question,
      latencyMs: extraction.latencyMs,
      intent: extraction.intent
    };
  });
  const tally = results.reduce<Record<string, number>>(
    (counts, result) => {
      const type = result.intent.expectedAnswerType;
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    },
    {}
  );
  console.log("Tally:");
  for (const [type, count] of Object.entries(tally).sort()) {
    console.log(`${type}: ${count}`);
  }

  const timestamp = new Date().toISOString();
  const outputDirectory = resolve(
    "eval/runs/query-intent-baseline"
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(
      outputDirectory,
      `${timestamp.replace(/[:.]/g, "-")}.json`
    ),
    `${JSON.stringify(
      {
        timestamp,
        questions: results,
        tally
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
