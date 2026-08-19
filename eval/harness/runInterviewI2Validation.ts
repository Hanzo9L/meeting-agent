import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  GroundedAnswerExecutionPort,
  type AnswerExecutionResult
} from "../../src/main/services/conversations/answerExecutionPort";
import {
  loadInterviewDataset,
  PRIORITY_14_QUESTION_IDS,
  resolveLocalInterviewPacks,
  type InterviewQuestionRecord,
  type MicrosoftInterviewPackId
} from "./interviewAuthorityPack";

const PRIORITY_IDS = new Set<string>(PRIORITY_14_QUESTION_IDS);

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function conceptPresent(answer: string, concept: string): boolean {
  const answerTokens = new Set(normalizedTokens(answer));
  const conceptTokens = normalizedTokens(concept).filter(
    (token) => !["with", "from", "where", "when", "each"].includes(token)
  );
  if (conceptTokens.length === 0) return false;
  const hits = conceptTokens.filter((token) =>
    answerTokens.has(token)
  ).length;
  return hits >= Math.max(1, Math.ceil(conceptTokens.length / 2));
}

function grade(
  question: InterviewQuestionRecord,
  result: AnswerExecutionResult,
  citationsPackBounded: boolean
): {
  grade: "PASS" | "PARTIAL" | "FAIL";
  reasons: string[];
  requiredConceptCoverage: number;
} {
  if (!result.ok) {
    return {
      grade: "FAIL",
      reasons: [result.userSafeMessage],
      requiredConceptCoverage: 0
    };
  }
  const covered = question.requiredConcepts.filter((concept) =>
    conceptPresent(result.answerText, concept)
  );
  const missing = question.requiredConcepts.filter(
    (concept) => !conceptPresent(result.answerText, concept)
  );
  const coverage =
    question.requiredConcepts.length === 0
      ? 1
      : covered.length / question.requiredConcepts.length;
  const words = wordCount(result.answerText);
  const reasons: string[] = [];
  if (result.answerability === "insufficient_evidence") {
    reasons.push("Grounding reported insufficient evidence.");
  }
  if (coverage < 0.7) {
    reasons.push(
      `Required-concept coverage ${covered.length}/${question.requiredConcepts.length}.`
    );
  }
  if (words > question.liveQuickTargetWords) {
    reasons.push(
      `${words} words exceeds ${question.liveQuickTargetWords}-word target.`
    );
  }
  if (!citationsPackBounded) {
    reasons.push("At least one citation escaped the selected pack.");
  }
  const quality = {
    requiredConcepts: question.requiredConcepts,
    conceptsInQuick: covered,
    conceptsMissing: missing,
    requiredConceptCoverage: coverage,
    reasons
  };
  if (
    result.answerability === "answered" &&
    coverage >= 0.7 &&
    words <= question.liveQuickTargetWords &&
    citationsPackBounded
  ) {
    return { grade: "PASS" as const, ...quality };
  }
  if (
    result.answerability !== "insufficient_evidence" &&
    coverage >= 0.25 &&
    citationsPackBounded
  ) {
    return { grade: "PARTIAL" as const, ...quality };
  }
  return { grade: "FAIL" as const, ...quality };
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ]!;
}

async function executeQuick(
  port: GroundedAnswerExecutionPort,
  item: InterviewQuestionRecord,
  eligibleDocumentIds?: string[]
): Promise<{ result: AnswerExecutionResult; wallClockMs: number }> {
  const started = performance.now();
  const result = await port.execute({
    conversationId: "interview-i2-validation",
    userMessageId: `${item.questionId}:${eligibleDocumentIds ? "pack" : "broad"}`,
    question: item.question,
    presentationProfile: "live_assist_quick",
    presentationSynthesis: "disabled",
    eligibleDocumentIds
  });
  return { result, wallClockMs: performance.now() - started };
}

async function main(): Promise<void> {
  const outputArg = process.argv.find((arg) =>
    arg.startsWith("--out=")
  );
  const outputPath = resolve(
    outputArg?.slice("--out=".length) ??
      `eval/runs/interview-i2/interview-i2-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`
  );
  const questions = loadInterviewDataset();
  const packs = resolveLocalInterviewPacks();
  const port = new GroundedAnswerExecutionPort();
  const results = [];

  for (const item of questions) {
    const pack = packs.get(
      item.expectedAuthorityPack as MicrosoftInterviewPackId
    );
    const documentIds =
      pack?.localDocuments.map((document) => document.documentId) ?? [];
    let execution: Awaited<ReturnType<typeof executeQuick>>;
    if (documentIds.length === 0) {
      execution = {
        result: {
          ok: false,
          code: "grounding_execution_failed",
          stage: "retrieval_grounding",
          userSafeMessage:
            "The selected authority pack has no materialized local documents."
        },
        wallClockMs: 0
      };
    } else {
      execution = await executeQuick(port, item, documentIds);
    }

    let broadFallback:
      | Awaited<ReturnType<typeof executeQuick>>
      | null = null;
    if (
      pack &&
      (!execution.result.ok ||
        execution.result.answerability ===
          "insufficient_evidence")
    ) {
      broadFallback = await executeQuick(port, item);
    }

    const allowed = new Set(documentIds);
    const packCitationsBounded =
      !execution.result.ok ||
      execution.result.citations.every((citation) =>
        allowed.has(citation.documentId)
      );
    const quality = grade(
      item,
      execution.result,
      packCitationsBounded
    );
    const result = execution.result;
    results.push({
      questionId: item.questionId,
      priority: PRIORITY_IDS.has(item.questionId),
      question: item.question,
      detectedInterviewTopic: item.interviewTopic,
      authorityPackSelected: item.expectedAuthorityPack,
      pack: {
        selectedReferenceCount:
          pack?.selectedCanonicalUrls.length ?? 0,
        localDocumentCount: documentIds.length,
        localChunkCount:
          pack?.localDocuments.reduce(
            (total, document) => total + document.chunkCount,
            0
          ) ?? 0,
        missingReferenceCount:
          pack?.missingCanonicalUrls.length ?? 0,
        documentIds
      },
      topEvidence: result.ok
        ? result.retrievalSummary?.topEvidence ?? []
        : [],
      retrievalSearch: result.ok
        ? {
            documents:
              result.retrievalSummary?.eligibleDocumentCount ??
              documentIds.length,
            eligibleChunks:
              result.retrievalSummary?.eligibleChunkCount ?? 0,
            scoredChunks:
              result.retrievalSummary?.scoredChunkCount ?? 0,
            returnedCandidates:
              result.retrievalSummary?.returnedCandidateCount ?? 0
          }
        : {
            documents: documentIds.length,
            eligibleChunks:
              pack?.localDocuments.reduce(
                (total, document) =>
                  total + document.chunkCount,
                0
              ) ?? 0,
            scoredChunks: 0,
            returnedCandidates: 0
          },
      answerability: result.ok
        ? result.answerability
        : "execution_failed",
      deterministicQuickOutput: result.ok
        ? result.answerText
        : result.userSafeMessage,
      citations: result.ok
        ? result.citations.map((citation) => ({
            documentId: citation.documentId,
            sourceTitle: citation.sourceTitle,
            canonicalUrl: citation.canonicalUrl
          }))
        : [],
      packCitationsBounded,
      latencyMs: result.ok
        ? {
            retrieval: result.diagnostics.retrievalMs,
            evidenceResolution:
              result.diagnostics.evidenceResolutionMs,
            presentation:
              result.diagnostics.presentationPlanningMs +
              result.diagnostics.presentationRenderMs,
            totalQuick: result.diagnostics.pipelineTotalMs,
            wallClock: execution.wallClockMs
          }
        : null,
      generationRequests: result.ok
        ? {
            factual:
              result.diagnostics
                .factualGroundingGenerationRequests,
            presentation:
              result.diagnostics.presentationSynthesisRequests,
            presentationStatus:
              result.diagnostics.presentationSynthesisStatus
          }
        : null,
      broadCorpusFallback: broadFallback
        ? {
            used: true,
            answerability: broadFallback.result.ok
              ? broadFallback.result.answerability
              : "execution_failed",
            answer: broadFallback.result.ok
              ? broadFallback.result.answerText
              : broadFallback.result.userSafeMessage,
            totalQuickMs: broadFallback.result.ok
              ? broadFallback.result.diagnostics.pipelineTotalMs
              : null
          }
        : { used: false },
      quality
    });
    process.stderr.write(
      `[I2] ${item.questionId} pack=${item.expectedAuthorityPack} docs=${documentIds.length} answerability=${
        result.ok ? result.answerability : "failed"
      } grade=${quality.grade}\n`
    );
  }

  const successful = results.filter((result) => result.latencyMs);
  const retrieval = successful.map(
    (result) => result.latencyMs!.retrieval
  );
  const totalQuick = successful.map(
    (result) => result.latencyMs!.totalQuick
  );
  const report = {
    schemaVersion: "i2.1",
    generatedAt: new Date().toISOString(),
    packInventory: [...packs.values()].map((pack) => ({
      packId: pack.packId,
      selectedReferenceCount: pack.selectedCanonicalUrls.length,
      localDocumentCount: pack.localDocuments.length,
      localChunkCount: pack.localDocuments.reduce(
        (total, document) => total + document.chunkCount,
        0
      ),
      missingReferenceCount: pack.missingCanonicalUrls.length
    })),
    summary: {
      questionCount: results.length,
      priorityQuestionCount: results.filter((result) => result.priority)
        .length,
      grades: {
        PASS: results.filter(
          (result) => result.quality.grade === "PASS"
        ).length,
        PARTIAL: results.filter(
          (result) => result.quality.grade === "PARTIAL"
        ).length,
        FAIL: results.filter(
          (result) => result.quality.grade === "FAIL"
        ).length
      },
      broadFallbackCount: results.filter(
        (result) => result.broadCorpusFallback.used
      ).length,
      retrievalLatencyMs: {
        min: retrieval.length ? Math.min(...retrieval) : null,
        p50: percentile(retrieval, 0.5),
        p95: percentile(retrieval, 0.95),
        max: retrieval.length ? Math.max(...retrieval) : null
      },
      totalQuickLatencyMs: {
        min: totalQuick.length ? Math.min(...totalQuick) : null,
        p50: percentile(totalQuick, 0.5),
        p95: percentile(totalQuick, 0.95),
        max: totalQuick.length ? Math.max(...totalQuick) : null
      },
      generationRequests: {
        factual: results.reduce(
          (total, result) =>
            total +
            (result.generationRequests?.factual ?? 0),
          0
        ),
        presentation: results.reduce(
          (total, result) =>
            total +
            (result.generationRequests?.presentation ?? 0),
          0
        )
      }
    },
    results
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
