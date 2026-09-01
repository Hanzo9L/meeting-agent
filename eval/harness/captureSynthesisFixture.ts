import "./cliEnvironment";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceSearchClient } from "../../src/main/services/evidence/evidenceSearchClient";
import { LearnRagChild } from "../../src/main/services/evidence/learnRagChild";
import { MultiSearchEvidenceOrchestrator } from "../../src/main/services/evidence/multiSearchEvidenceOrchestrator";
import type { InterviewAnswerSynthesisInput } from "../../src/main/services/evidence/interviewAnswerSynthesisPort";
import { OpenAiQuestionUnderstandingPort } from "../../src/main/services/openAiQuestionUnderstandingPort";
import { resolveV2OpenAiModel } from "../../src/main/services/v2OpenAiRuntime";

const QUESTION =
  "Walk me through your Teams experience with Calling Plans and Operator Connect, and how you isolate whether a call issue is client, network, or Microsoft service.";
const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRECTORY = resolve(
  HARNESS_DIRECTORY,
  "../fixtures/synthesis-bench"
);
const FIXTURE_PATH = resolve(FIXTURE_DIRECTORY, "frozen-input.json");
const FIXTURE_HASH_PATH = resolve(
  FIXTURE_DIRECTORY,
  "frozen-input.sha256"
);

async function main(): Promise<void> {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");
  const model = resolveV2OpenAiModel();
  const understandingPort = new OpenAiQuestionUnderstandingPort({
    apiKey,
    model
  });
  const understanding = await understandingPort.understand({
    text: QUESTION,
    source: "system",
    utteranceCount: 1
  });
  if (
    understanding.decision !== "complete" ||
    !understanding.normalizedQuestion ||
    !understanding.facets?.length
  ) {
    throw new Error(
      "question_understanding_did_not_return_complete_plan"
    );
  }

  const evidenceChild = new LearnRagChild({
    onStatusChange: (status) => {
      console.info(`[Relay evidence] ${status}`);
    }
  });
  try {
    await evidenceChild.start();
    const search = createEvidenceSearchClient(evidenceChild);
    const orchestrator = new MultiSearchEvidenceOrchestrator(search);
    const request = {
      originalQuestion: QUESTION,
      question: understanding.normalizedQuestion,
      retrievalQueries: understanding.facets
    };
    const retrieval = await orchestrator.execute({
      question: request.question,
      facets: request.retrievalQueries
    });
    if (!retrieval.ok) {
      throw new Error(
        `${retrieval.failure.code}: ${retrieval.failure.message}`
      );
    }
    const input: InterviewAnswerSynthesisInput = {
      originalQuestion:
        request.originalQuestion ?? request.question,
      normalizedQuestion: request.question,
      facets: retrieval.facets,
      facetCoverage: retrieval.facetCoverage,
      evidence: retrieval.evidence
    };
    const bytes = `${JSON.stringify(input, null, 2)}\n`;
    const digest = createHash("sha256")
      .update(bytes)
      .digest("hex");
    await mkdir(FIXTURE_DIRECTORY, { recursive: true });
    await writeFile(FIXTURE_PATH, bytes, "utf8");
    await writeFile(FIXTURE_HASH_PATH, digest, "utf8");
    console.log(
      JSON.stringify(
        {
          digest,
          facetCount: input.facets.length,
          evidenceCount: input.evidence.length,
          totalEvidenceCharacters: input.evidence.reduce(
            (total, item) => total + item.hit.body.length,
            0
          )
        },
        null,
        2
      )
    );
  } finally {
    evidenceChild.dispose();
    await evidenceChild.waitUntilStopped();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
