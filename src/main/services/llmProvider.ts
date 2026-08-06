export interface LlmContextChunk {
  title: string;
  path: string;
  text: string;
}

export interface LlmRequest {
  topic: string;
  topicPromptTemplate: string;
  question: string;
  context: LlmContextChunk[];
}

export interface LlmProvider {
  streamAnswer(request: LlmRequest): AsyncGenerator<string>;
}
