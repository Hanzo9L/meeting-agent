import OpenAI from "openai";
import type { LlmProvider, LlmRequest } from "./llmProvider";

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamAnswer(request: LlmRequest): AsyncGenerator<string> {
    const systemPrompt = request.topicPromptTemplate.replace("{TOPIC}", request.topic);

    const stream = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
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
