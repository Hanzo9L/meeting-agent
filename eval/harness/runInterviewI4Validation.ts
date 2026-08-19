import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { deriveInterviewAnswerConcepts } from "../../src/main/services/answerV2/interviewAnswerConcepts";
import { documentIdsForInterviewPacks } from "../../src/main/services/answerV2/interviewAuthorityPack";
import { routeInterviewPacks } from "../../src/main/services/answerV2/interviewPackRouter";
import { classifyInterviewQuestionShape } from "../../src/main/services/answerV2/interviewQuestionShape";
import { extractQueryIntent } from "../../src/main/services/retrievalV2/queryIntentRules";
import {
  GroundedAnswerExecutionPort,
  type AnswerExecutionResult
} from "../../src/main/services/conversations/answerExecutionPort";
import {
  loadInterviewDataset,
  PRIORITY_14_QUESTION_IDS,
  resolveLocalInterviewPacks,
  type InterviewQuestionRecord
} from "./interviewAuthorityPack";

const PRIORITY_IDS = new Set<string>(PRIORITY_14_QUESTION_IDS);
const I4_WORD_CAP = 120;

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function conceptPresent(answer: string, concept: string): boolean {
  const tokens = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3);
  const answerTokens = new Set(tokens(answer));
  const conceptTokens = tokens(concept).filter(
    (token) => !["with", "from", "where", "when", "each"].includes(token)
  );
  if (conceptTokens.length === 0) return false;
  const hits = conceptTokens.filter((token) => answerTokens.has(token)).length;
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
  conceptsInQuick: string[];
  conceptsMissing: string[];
} {
  if (!result.ok) {
    return {
      grade: "FAIL",
      reasons: [result.userSafeMessage],
      requiredConceptCoverage: 0,
      conceptsInQuick: [],
      conceptsMissing: question.requiredConcepts
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
  if (words > I4_WORD_CAP) {
    reasons.push(`${words} words exceeds ${I4_WORD_CAP}-word glance target.`);
  }
  if (!citationsPackBounded) {
    reasons.push("At least one citation escaped the selected pack union.");
  }
  const quality = {
    requiredConceptCoverage: coverage,
    conceptsInQuick: covered,
    conceptsMissing: missing,
    reasons
  };
  if (
    result.answerability === "answered" &&
    coverage >= 0.7 &&
    words <= I4_WORD_CAP &&
    citationsPackBounded
  ) {
    return { grade: "PASS", ...quality };
  }
  if (
    result.answerability !== "insufficient_evidence" &&
    coverage >= 0.25 &&
    citationsPackBounded
  ) {
    return { grade: "PARTIAL", ...quality };
  }
  return { grade: "FAIL", ...quality };
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ]!;
}

async function main(): Promise<void> {
  const outputArg = process.argv.find((arg) => arg.startsWith("--out="));
  const priorityOnly = process.argv.includes("--priority-14");
  const outputPath = resolve(
    outputArg?.slice("--out=".length) ??
      `eval/runs/interview-i4/interview-i4-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`
  );
  const questions = loadInterviewDataset().filter(
    (item) => !priorityOnly || PRIORITY_IDS.has(item.questionId)
  );
  const packs = resolveLocalInterviewPacks();
  const port = new GroundedAnswerExecutionPort();
  const results = [];

  for (const item of questions) {
    const intent = extractQueryIntent(item.question).intent;
    const questionShape = classifyInterviewQuestionShape(intent);
    const packRoute = routeInterviewPacks(intent, questionShape);
    const derivedConcepts = deriveInterviewAnswerConcepts({
      intent,
      shape: questionShape,
      packIds: packRoute.packIds
    });
    const documentIds = documentIdsForInterviewPacks(packRoute.packIds);
    const started = performance.now();
    const execution =
      documentIds.length === 0
        ? {
            result: {
              ok: false as const,
              code: "grounding_execution_failed" as const,
              stage: "retrieval_grounding" as const,
              userSafeMessage:
                packRoute.packIds.length === 0
                  ? "No Interview Authority Pack was selected for this question."
                  : "The selected authority pack has no materialized local documents."
            },
            wallClockMs: 0
          }
        : {
            result: await port.execute({
              conversationId: "interview-i4-validation",
              userMessageId: `${item.questionId}:pack`,
              question: item.question,
              presentationProfile: "live_assist_quick",
              presentationSynthesis: "disabled",
              eligibleDocumentIds: documentIds
            }),
            wallClockMs: 0
          };
    if (documentIds.length > 0) {
      execution.wallClockMs = performance.now() - started;
    }

    const allowed = new Set(documentIds);
    const result = execution.result;
    const packCitationsBounded =
      !result.ok ||
      result.citations.every((citation) => allowed.has(citation.documentId));
    const quality = grade(item, result, packCitationsBounded);
    results.push({
      questionId: item.questionId,
      priority: PRIORITY_IDS.has(item.questionId),
      question: item.question,
      questionShape,
      selectedPacks: packRoute.packIds,
      packReasons: packRoute.reasons,
      derivedConcepts,
      expectedAuthorityPack: item.expectedAuthorityPack,
      packUnionDocumentCount: documentIds.length,
      topEvidence: result.ok ? result.retrievalSummary?.topEvidence ?? [] : [],
      retrievalSearch: result.ok
        ? {
            documents: result.retrievalSummary?.eligibleDocumentCount ?? documentIds.length,
            eligibleChunks: result.retrievalSummary?.eligibleChunkCount ?? 0,
            scoredChunks: result.retrievalSummary?.scoredChunkCount ?? 0,
            returnedCandidates:
              result.retrievalSummary?.returnedCandidateCount ?? 0
          }
        : {
            documents: documentIds.length,
            eligibleChunks: 0,
            scoredChunks: 0,
            returnedCandidates: 0
          },
      answerability: result.ok ? result.answerability : "execution_failed",
      deterministicQuickOutput: result.ok
        ? result.answerText
        : result.userSafeMessage,
      wordCount: result.ok ? wordCount(result.answerText) : 0,
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
            evidenceResolution: result.diagnostics.evidenceResolutionMs,
            presentation:
              result.diagnostics.presentationPlanningMs +
              result.diagnostics.presentationRenderMs,
            totalQuick: result.diagnostics.pipelineTotalMs,
            wallClock: execution.wallClockMs
          }
        : null,
      generationRequests: result.ok
        ? {
            factual: result.diagnostics.factualGroundingGenerationRequests,
            presentation: result.diagnostics.presentationSynthesisRequests,
            presentationStatus: result.diagnostics.presentationSynthesisStatus
          }
        : null,
      broadCorpusFallback: { used: false },
      interviewQuick: result.ok ? result.interviewQuick ?? null : null,
      quality
    });
    process.stderr.write(
      `[I4] ${item.questionId} shape=${questionShape} packs=${packRoute.packIds.join(",") || "none"} answerability=${
        result.ok ? result.answerability : "failed"
      } grade=${quality.grade}\n`
    );
  }

  const successful = results.filter((item) => item.latencyMs);
  const totalQuick = successful.map((item) => item.latencyMs!.totalQuick);
  const priority = results.filter((item) => item.priority);
  const report = {
    schemaVersion: "i4.0",
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
      priorityQuestionCount: priority.length,
      grades: {
        PASS: results.filter((item) => item.quality.grade === "PASS").length,
        PARTIAL: results.filter((item) => item.quality.grade === "PARTIAL")
          .length,
        FAIL: results.filter((item) => item.quality.grade === "FAIL").length
      },
      priorityGrades: {
        PASS: priority.filter((item) => item.quality.grade === "PASS").length,
        PARTIAL: priority.filter((item) => item.quality.grade === "PARTIAL")
          .length,
        FAIL: priority.filter((item) => item.quality.grade === "FAIL").length
      },
      packUnionCount: results.filter((item) => item.selectedPacks.length > 1)
        .length,
      broadFallbackCount: 0,
      totalQuickLatencyMs: {
        min: totalQuick.length ? Math.min(...totalQuick) : null,
        p50: percentile(totalQuick, 0.5),
        p95: percentile(totalQuick, 0.95),
        max: totalQuick.length ? Math.max(...totalQuick) : null
      },
      generationRequests: {
        factual: results.reduce(
          (total, item) => total + (item.generationRequests?.factual ?? 0),
          0
        ),
        presentation: results.reduce(
          (total, item) => total + (item.generationRequests?.presentation ?? 0),
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
