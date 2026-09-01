import type { V2ReadinessStatus } from "@shared/types";
import type {
  InterviewAnswerSynthesisInput,
  InterviewAnswerSynthesisPort,
  SynthesizedInterviewAnswer
} from "./evidence/interviewAnswerSynthesisPort";
import { OpenAiInterviewAnswerSynthesisPort } from "./evidence/openAiInterviewAnswerSynthesisPort";
import {
  classifyQuestionUnderstandingFailure,
  QuestionUnderstandingFailure,
  type QuestionUnderstandingInput,
  type QuestionUnderstandingPort,
  type QuestionUnderstandingResult
} from "./questionUnderstandingPort";
import { OpenAiQuestionUnderstandingPort } from "./openAiQuestionUnderstandingPort";
import { resolveV2OpenAiModel } from "./v2OpenAiRuntime";

interface V2ProviderFactories {
  understanding(params: {
    apiKey: string;
    model: string;
  }): QuestionUnderstandingPort;
  synthesis(params: {
    apiKey: string;
    model: string;
  }): InterviewAnswerSynthesisPort;
}

const defaultFactories: V2ProviderFactories = {
  understanding: ({ apiKey, model }) =>
    new OpenAiQuestionUnderstandingPort({ apiKey, model }),
  synthesis: ({ apiKey, model }) =>
    new OpenAiInterviewAnswerSynthesisPort({ apiKey, model })
};

export class V2ProviderRuntime {
  private understanding: QuestionUnderstandingPort | null = null;
  private synthesis: InterviewAnswerSynthesisPort | null = null;
  private readiness: V2ReadinessStatus = {
    state: "misconfigured",
    model: null,
    semanticReady: false,
    synthesisReady: false,
    reason: "not_initialized"
  };

  constructor(
    private readonly options: {
      getApiKey(): string;
      model?: string;
      factories?: V2ProviderFactories;
    }
  ) {}

  refresh(): V2ReadinessStatus {
    this.understanding = null;
    this.synthesis = null;
    const apiKey = this.options.getApiKey().trim();
    if (!apiKey) {
      this.readiness = {
        state: "misconfigured",
        model: null,
        semanticReady: false,
        synthesisReady: false,
        reason: "api_key_missing"
      };
      return this.getReadiness();
    }

    let model: string;
    try {
      model = resolveV2OpenAiModel(this.options.model);
    } catch {
      this.readiness = {
        state: "misconfigured",
        model: null,
        semanticReady: false,
        synthesisReady: false,
        reason: "model_not_configured"
      };
      return this.getReadiness();
    }

    try {
      const factories = this.options.factories ?? defaultFactories;
      this.understanding = factories.understanding({ apiKey, model });
      this.synthesis = factories.synthesis({ apiKey, model });
      this.readiness = {
        state: "ready",
        model,
        semanticReady: true,
        synthesisReady: true,
        reason: null
      };
    } catch {
      this.understanding = null;
      this.synthesis = null;
      this.readiness = {
        state: "provider_error",
        model,
        semanticReady: false,
        synthesisReady: false,
        reason: "provider_construction_failed"
      };
    }
    return this.getReadiness();
  }

  getReadiness(): V2ReadinessStatus {
    return { ...this.readiness };
  }

  async understand(
    input: QuestionUnderstandingInput
  ): Promise<QuestionUnderstandingResult> {
    if (!this.understanding || !this.readiness.semanticReady) {
      throw new QuestionUnderstandingFailure(
        this.readiness.reason ?? "question_understanding_unavailable",
        "permanent"
      );
    }
    try {
      return await this.understanding.understand(input);
    } catch (error) {
      const failure = classifyQuestionUnderstandingFailure(error);
      if (failure.kind === "permanent") {
        this.understanding = null;
        this.synthesis = null;
        this.readiness = {
          state: "provider_error",
          model: this.readiness.model,
          semanticReady: false,
          synthesisReady: false,
          reason: failure.code
        };
      }
      throw failure;
    }
  }

  async synthesize(
    input: InterviewAnswerSynthesisInput
  ): Promise<SynthesizedInterviewAnswer> {
    if (!this.synthesis || !this.readiness.synthesisReady) {
      throw new Error(this.readiness.reason ?? "interview_synthesis_unavailable");
    }
    return this.synthesis.synthesize(input);
  }
}
