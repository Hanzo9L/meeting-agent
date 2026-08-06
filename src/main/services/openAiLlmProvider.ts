import OpenAI from "openai";
import type { LlmProvider, LlmRequest } from "./llmProvider";

function buildTopicPrompt(template: string, topic: string): string {
  const topicPrompt = template.replace("{TOPIC}", topic);
  return [
    topicPrompt,
    "",
    "You must answer using only the provided Microsoft Teams docs snippets.",
    "If the snippets do not contain enough information, respond exactly: Not found in Teams docs.",
    "Never invent facts, commands, modules, or parameters.",
    "Keep answers concise with at most 3 short bullet points.",
    "Mention source titles in-line when answering."
  ].join("\n");
}

function buildUserPrompt(question: string, context: LlmRequest["context"]): string {
  const sources = context
    .map(
      (item, index) =>
        `Source ${index + 1}:\nTitle: ${item.title}\nPath: ${item.path}\nExcerpt: ${item.text}`
    )
    .join("\n\n");

  return [`Question: ${question}`, "", "Sources:", sources].join("\n");
}

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamAnswer(request: LlmRequest): AsyncGenerator<string> {
    if (request.context.length === 0) {
      yield "Not found in Teams docs.";
      return;
    }

    const systemPrompt = buildTopicPrompt(request.topicPromptTemplate, request.topic);
    const userPrompt = buildUserPrompt(request.question, request.context);

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
          content: userPrompt
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
