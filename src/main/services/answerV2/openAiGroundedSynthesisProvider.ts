import OpenAI from "openai";
import type {
  GroundedSynthesisOutput,
  GroundedSynthesisPayload,
  GroundedSynthesisProvider,
  GroundedSynthesisProviderResult
} from "./groundedAnswerSynthesis";
import { approvedSynthesisContentWords } from "./groundedAnswerSynthesis";

interface OpenAiSynthesisResponse {
  choices: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAiSynthesisClient {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<OpenAiSynthesisResponse>;
    };
  };
}

export interface GroundedSynthesisRuntimeConfig {
  provider: "openai";
  model: string;
  timeoutMs: number;
}

const DEFAULT_SYNTHESIS_MODEL = "gpt-4o-mini";
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 12_000;

export function resolveGroundedSynthesisRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): GroundedSynthesisRuntimeConfig {
  const configuredTimeout = Number(env["RELAY_SYNTHESIS_TIMEOUT_MS"]);
  return {
    provider: "openai",
    model:
      env["RELAY_SYNTHESIS_MODEL"]?.trim() || DEFAULT_SYNTHESIS_MODEL,
    timeoutMs:
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_SYNTHESIS_TIMEOUT_MS
  };
}

function parseOutput(content: string): GroundedSynthesisOutput {
  const parsed = JSON.parse(content) as Partial<GroundedSynthesisOutput>;
  if (
    parsed.schemaVersion !== "grounded-answer-synthesis-output/v1" ||
    (parsed.profile !== "helpdesk_detailed" &&
      parsed.profile !== "live_assist_quick") ||
    !Array.isArray(parsed.blocks) ||
    !Array.isArray(parsed.unsupportedAspectIds) ||
    !Array.isArray(parsed.caveatCodes)
  ) {
    throw new Error("grounded_synthesis_schema_invalid");
  }
  for (const block of parsed.blocks) {
    if (
      !block ||
      !["direct_answer", "step", "fact", "transition"].includes(
        block.blockType
      ) ||
      typeof block.text !== "string" ||
      !Array.isArray(block.supportingClaimIds) ||
      !block.supportingClaimIds.every((id) => typeof id === "string")
    ) {
      throw new Error("grounded_synthesis_schema_invalid");
    }
  }
  if (
    !parsed.unsupportedAspectIds.every((id) => typeof id === "string") ||
    !parsed.caveatCodes.every((code) => typeof code === "string")
  ) {
    throw new Error("grounded_synthesis_schema_invalid");
  }
  return parsed as GroundedSynthesisOutput;
}

function buildMessages(
  payload: GroundedSynthesisPayload
): Array<{ role: "system" | "user"; content: string }> {
  const approvedContentWordsByClaim = Object.fromEntries(
    payload.claims.map((claim) => [
      claim.claimId,
      approvedSynthesisContentWords(claim)
    ])
  );
  const scopeWords = [
    "all",
    "associated",
    "assigned",
    "can",
    "each",
    "must",
    "only",
    "user",
    "users"
  ];
  return [
    {
      role: "system",
      content: [
        "You are Relay's constrained presentation synthesizer.",
        "Write a useful, self-contained answer using only the validated claims in the JSON payload.",
        "You may paraphrase and combine claims, organize a workflow, remove source-document boilerplate, and add ordinary connective language.",
        "Every block must list every claimId that supports it.",
        "Return factual step/fact blocks only. Relay separately renders unsupported gaps, caveats, headings, and sources.",
        "Use each claimId in exactly one factual block. A response that repeats a claimId in more than one block is invalid.",
        "Do not introduce cmdlets, parameters, properties, policies, controls, products, roles, prerequisites, licenses, values, limits, or behavior absent from the supporting claims.",
        "Keep factual content words close to words present in the supporting claim and its source title. Prefer reordering, shortening, and removing boilerplate over adding synonyms or implications.",
        "Before returning each block, remove every noun, verb, adjective, and quantifier that is absent from its supporting claim text or source title, except ordinary presentation verbs such as use, read, retrieve, report, identify, find, gather, determine, and show.",
        "Never add user, users, assigned, associated, all, each, can, must, only, or similar scope/behavior words unless that exact idea appears in the supporting claim.",
        "The user message includes approvedContentWordsByClaim. Every content word in a block must appear in the union of the approved lists for that block's supporting claim IDs.",
        "Copy requiredBlockAssignments exactly for block type and supportingClaimIds. Obey forbiddenScopeWordsByClaim for each block.",
        "When answerType is procedural or configuration, use step blocks in the grounded order. Otherwise use fact blocks.",
        "Copy technical identifiers exactly. Respect every requested method.",
        "Do not infer the requested result from the question. The question is context, not evidence.",
        "A source title may be named, but its cmdlet name alone does not prove that it performs a user-specific lookup, assignment mapping, configuration step, or test. State only behavior explicitly present in the supporting claim text.",
        "In particular, general policy information does not prove a per-user policy lookup, and retrieving a tenant object does not prove association with a user.",
        "Do not turn unsupported aspects into supported statements.",
        "Return every payload unsupported aspect ID and caveat code exactly once in their top-level arrays.",
        "Do not write source URLs; Relay renders verified sources.",
        "For live_assist_quick, use 2-5 concise factual blocks. For helpdesk_detailed, put the direct supported fact first and use an ordered process only when the claims support one."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        payload,
        requiredBlockAssignments: payload.claims.map((claim) => ({
          blockType:
            payload.answerType === "procedural" ||
            payload.answerType === "configuration"
              ? "step"
              : "fact",
          supportingClaimIds: [claim.claimId]
        })),
        approvedContentWordsByClaim,
        forbiddenScopeWordsByClaim: Object.fromEntries(
          payload.claims.map((claim) => {
            const approved = new Set(
              approvedContentWordsByClaim[claim.claimId] ?? []
            );
            return [
              claim.claimId,
              scopeWords.filter((word) => !approved.has(word))
            ];
          })
        )
      })
    }
  ];
}

export class OpenAiGroundedSynthesisProvider
  implements GroundedSynthesisProvider
{
  readonly providerId = "openai_grounded_presentation";
  private readonly client: OpenAiSynthesisClient;
  private readonly model: string;

  constructor(params: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    client?: OpenAiSynthesisClient;
  }) {
    const config = resolveGroundedSynthesisRuntimeConfig({
      ...process.env,
      RELAY_SYNTHESIS_MODEL: params.model,
      RELAY_SYNTHESIS_TIMEOUT_MS:
        params.timeoutMs === undefined ? undefined : String(params.timeoutMs)
    });
    if (params.client) {
      this.client = params.client;
    } else {
      if (!params.apiKey) {
        throw new Error("grounded_synthesis_api_key_missing");
      }
      this.client = new OpenAI({
        apiKey: params.apiKey,
        maxRetries: 0,
        timeout: config.timeoutMs
      }) as unknown as OpenAiSynthesisClient;
    }
    this.model = config.model;
  }

  async synthesize(
    payload: GroundedSynthesisPayload
  ): Promise<GroundedSynthesisProviderResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_tokens: payload.profile === "live_assist_quick" ? 700 : 1_600,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "grounded_answer_synthesis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              schemaVersion: {
                type: "string",
                enum: ["grounded-answer-synthesis-output/v1"]
              },
              profile: {
                type: "string",
                enum: ["helpdesk_detailed", "live_assist_quick"]
              },
              blocks: {
                type: "array",
                minItems: payload.claims.length,
                maxItems: payload.claims.length,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    blockType: {
                      type: "string",
                      enum: [
                        "step",
                        "fact"
                      ]
                    },
                    text: { type: "string", minLength: 1, maxLength: 2_000 },
                    supportingClaimIds: {
                      type: "array",
                      minItems: 1,
                      items: {
                        type: "string",
                        enum: payload.claims.map(
                          (claim) => claim.claimId
                        )
                      }
                    }
                  },
                  required: ["blockType", "text", "supportingClaimIds"]
                }
              },
              unsupportedAspectIds: {
                type: "array",
                items: { type: "string" }
              },
              caveatCodes: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: [
              "schemaVersion",
              "profile",
              "blocks",
              "unsupportedAspectIds",
              "caveatCodes"
            ]
          }
        }
      },
      messages: buildMessages(payload)
    });
    const output = parseOutput(
      response.choices[0]?.message?.content ?? "{}"
    );
    return {
      output,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null
      }
    };
  }
}

export function createConfiguredGroundedSynthesisProvider(
  env: NodeJS.ProcessEnv = process.env
): GroundedSynthesisProvider | null {
  const apiKey = env["OPENAI_API_KEY"]?.trim();
  if (!apiKey || env["RELAY_SYNTHESIS_ENABLED"] === "false") return null;
  const config = resolveGroundedSynthesisRuntimeConfig(env);
  return new OpenAiGroundedSynthesisProvider({
    apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs
  });
}
