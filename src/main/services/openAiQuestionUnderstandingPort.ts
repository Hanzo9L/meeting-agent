import { performance } from "node:perf_hooks";
import OpenAI from "openai";
import type {
  QuestionFacet,
  QuestionUnderstandingInput,
  QuestionUnderstandingPort,
  QuestionUnderstandingResult
} from "./questionUnderstandingPort";
import {
  resolveV2OpenAiModel,
  V2_REASONING_EFFORT
} from "./v2OpenAiRuntime";

const DEFAULT_TIMEOUT_MS = 10_000;

export const QUESTION_UNDERSTANDING_SYSTEM_PROMPT = [
  "You are Relay's live interview question-understanding gate.",
  "Decide whether the accumulated transcript expresses the speaker's complete intended prompt or is likely to continue after an acoustic pause.",
  "For live interview speech, prefer waiting for the complete thought over answering a broad opening clause too early.",
  "When uncertain between COMPLETE and CONTINUE, choose CONTINUE.",
  "Distinguish a specific, self-contained technical ask from a broad conversational lead-in.",
  "A broad lead-in that names only a general subject, implementation, migration, architecture, or approach without narrowing scope, constraints, requested detail, or outcome should usually CONTINUE even if it is grammatically complete.",
  "A conversational lead-in becomes specific enough to COMPLETE when it supplies a concrete purpose, workload, affected users, operating scale, constraint, failure scenario, architecture component, comparison, or requested outcome; do not require an extra explicit subquestion after that meaningful narrowing detail.",
  "When a broad lead-in is followed by a because-clause and the transcript ends at that rationale or context, choose CONTINUE: the speaker is supplying motivation before the final scope or compound ask. Concrete detail inside that because-clause does not by itself close the thought.",
  "Examples that should lean CONTINUE: 'Tell me how you implemented Teams'; 'Walk me through your Direct Routing architecture'; 'Tell me about your PowerShell automation'.",
  "Examples that should normally COMPLETE: 'What does Get-CsOnlineUser return?'; 'Explain the role of an SBC in Direct Routing.'; 'How would you troubleshoot a user who cannot call external numbers?'; 'Tell me about your PowerShell automation for auditing Teams Voice users at scale'.",
  "These examples illustrate broadness and specificity; do not match or hard-code their exact wording.",
  "Use CONTINUE for dangling clauses, setup without the requested task, unfinished lists, conjunctions, or context that clearly anticipates a later request.",
  "Use COMPLETE only when the full interviewer thought and requested task are present with enough specificity to answer usefully.",
  "For COMPLETE, normalize ASR punctuation and obvious disfluencies without adding technical facts or changing intent.",
  "Decompose a compound prompt into 1-4 independently searchable facets. Preserve material constraints and context, and keep shared context in each query when needed.",
  "For CONTINUE, return null normalizedQuestion and no facets.",
  "Never answer the technical question."
].join("\n");

type UnderstandingClient = {
  chat: {
    completions: {
      create(request: Record<string, unknown>): Promise<{
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        choices?: Array<{
          message?: { content?: string | null };
        }>;
      }>;
    };
  };
};

interface RawUnderstanding {
  decision?: unknown;
  normalizedQuestion?: unknown;
  facets?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : undefined;
}

function parseFacets(value: unknown): QuestionFacet[] {
  if (!Array.isArray(value)) return [];
  const facets: QuestionFacet[] = [];
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const query = cleanText(record["query"], 1_000);
    if (!query) continue;
    facets.push({
      id: cleanText(record["id"], 80) ?? `facet-${facets.length + 1}`,
      query,
      label: cleanText(record["label"], 160) ?? query
    });
  }
  return facets;
}

function parseResult(content: string): Omit<
  QuestionUnderstandingResult,
  "diagnostics"
> {
  const raw = JSON.parse(content) as RawUnderstanding;
  if (raw.decision !== "continue" && raw.decision !== "complete") {
    throw new Error("question_understanding_decision_invalid");
  }
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0;
  const reason = cleanText(raw.reason, 500);
  if (!reason) throw new Error("question_understanding_reason_invalid");
  if (raw.decision === "continue") {
    return { decision: "continue", confidence, reason };
  }
  const normalizedQuestion = cleanText(raw.normalizedQuestion, 2_000);
  if (!normalizedQuestion) {
    throw new Error("question_understanding_normalized_question_missing");
  }
  const facets = parseFacets(raw.facets);
  return {
    decision: "complete",
    normalizedQuestion,
    facets:
      facets.length > 0
        ? facets
        : [{
            id: "facet-1",
            query: normalizedQuestion,
            label: "Complete question"
          }],
    confidence,
    reason
  };
}

export class OpenAiQuestionUnderstandingPort
implements QuestionUnderstandingPort {
  private readonly client: UnderstandingClient;
  private readonly model: string;
  private readonly reasoningEffort: "low" | "medium";

  constructor(params: {
    apiKey: string;
    model?: string;
    reasoningEffort?: "low" | "medium";
    timeoutMs?: number;
    client?: UnderstandingClient;
  }) {
    this.model = resolveV2OpenAiModel(params.model);
    this.reasoningEffort =
      params.reasoningEffort ?? V2_REASONING_EFFORT;
    this.client =
      params.client ??
      (new OpenAI({
        apiKey: params.apiKey,
        maxRetries: 0,
        timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS
      }) as unknown as UnderstandingClient);
  }

  async understand(
    input: QuestionUnderstandingInput
  ): Promise<QuestionUnderstandingResult> {
    const requestStartedAtMs = Date.now();
    const started = performance.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      reasoning_effort: this.reasoningEffort,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "relay_question_understanding",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: {
                type: "string",
                enum: ["continue", "complete"]
              },
              normalizedQuestion: { type: ["string", "null"] },
              facets: {
                type: "array",
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    query: { type: "string" },
                    label: { type: "string" }
                  },
                  required: ["id", "query", "label"]
                }
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1
              },
              reason: { type: "string" }
            },
            required: [
              "decision",
              "normalizedQuestion",
              "facets",
              "confidence",
              "reason"
            ]
          }
        }
      },
      messages: [
        {
          role: "system",
          content: QUESTION_UNDERSTANDING_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: [
            `Source: ${input.source}`,
            `Acoustic utterances accumulated: ${input.utteranceCount}`,
            "Accumulated transcript:",
            input.text
          ].join("\n")
        }
      ]
    });
    const responseCompletedAtMs = Date.now();
    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("question_understanding_empty_response");
    return {
      ...parseResult(content),
      diagnostics: {
        provider: "openai",
        model: this.model,
        latencyMs: performance.now() - started,
        reasoningEffort: this.reasoningEffort,
        requestStartedAtMs,
        responseCompletedAtMs,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null
      }
    };
  }
}
