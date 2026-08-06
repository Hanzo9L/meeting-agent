import OpenAI from "openai";
import type { LlmProvider, LlmRequest } from "./llmProvider";

function buildLockedSystemPrompt(template: string, topic: string): string {
  const topicPrompt = template.replace("{TOPIC}", topic);
  return [
    topicPrompt,
    "",
    "Policy:",
    "1) You are strictly scoped to the topic above.",
    "2) If the question is outside topic, respond exactly: Out of scope for current topic.",
    "3) Do not invent facts, commands, modules, or parameters.",
    "4) If unsure but in-scope, respond exactly: I am not fully certain. Please verify in official documentation.",
    "5) Keep in-scope answers concise: max 3 short bullet points.",
    "6) Prefer concrete, actionable output over explanation."
  ].join("\n");
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamAnswer(request: LlmRequest): AsyncGenerator<string> {
    const systemPrompt = buildLockedSystemPrompt(request.topicPromptTemplate, request.topic);

    const stream = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      stream: true,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: request.question
        }
      ]
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        yield token;
      }
    }
  }
}
