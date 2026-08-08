import OpenAI from "openai";
import { buildGroundedPrompt } from "../llm/groundedPromptBuilder";
import type {
  ClaimRealization,
  ClaimRealizationTask,
  GenerateGroundedAnswerOptions,
  AnswerPlan
} from "./types";
import type { ClaimRealizationProvider, ClaimRealizationResult } from "./answerGenerator";

function parseClaimRealization(content: string): ClaimRealization {
  const parsed = JSON.parse(content) as ClaimRealization;
  if (typeof parsed?.claimId !== "string" || typeof parsed?.text !== "string") {
    throw new Error("claim_realization_schema_invalid");
  }
  if (!parsed.text.trim()) throw new Error("claim_realization_schema_invalid");
  return parsed;
}

export class OpenAiGroundedAnswerGenerator implements ClaimRealizationProvider {
  readonly providerId = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(params: { apiKey: string; model?: string }) {
    this.client = new OpenAI({ apiKey: params.apiKey });
    this.model = params.model ?? "gpt-4o-mini";
  }

  async realizeClaim(
    task: ClaimRealizationTask,
    context: {
      question: string;
      answerType: AnswerPlan["answerType"];
      answerability: "answered" | "partial";
    },
    options?: GenerateGroundedAnswerOptions
  ): Promise<ClaimRealizationResult> {
    const prompt = buildGroundedPrompt({
      task,
      context,
      correction: options?.correction,
    });
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? 900,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "claim_realization",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              claimId: { type: "string" },
              text: { type: "string" }
            },
            required: ["claimId", "text"]
          }
        }
      } as unknown as { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    });
    const content = response.choices[0]?.message?.content ?? "{}";
    const realization = parseClaimRealization(content);
    return {
      realization,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null
      }
    };
  }
}
