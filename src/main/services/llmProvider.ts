export interface LlmRequest {
  topic: string;
  topicPromptTemplate: string;
  question: string;
}

export interface LlmProvider {
  streamAnswer(request: LlmRequest): AsyncGenerator<string>;
}
