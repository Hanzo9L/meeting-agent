import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAiQuestionUnderstandingPort,
  QUESTION_UNDERSTANDING_SYSTEM_PROMPT
} from "./openAiQuestionUnderstandingPort";

test("requests strict bounded question understanding without answer synthesis", async () => {
  let request: Record<string, unknown> | null = null;
  const port = new OpenAiQuestionUnderstandingPort({
    apiKey: "test",
    model: "gpt-5.6-sol",
    client: {
      chat: {
        completions: {
          async create(input) {
            request = input;
            return {
              usage: {
                prompt_tokens: 100,
                completion_tokens: 25,
                total_tokens: 125
              },
              choices: [{
                message: {
                  content: JSON.stringify({
                    decision: "complete",
                    normalizedQuestion:
                      "How do Calling Plans and Direct Routing differ?",
                    facets: [
                      {
                        id: "calling-plans",
                        query: "Microsoft Teams Calling Plans",
                        label: "Calling Plans"
                      },
                      {
                        id: "direct-routing",
                        query: "Microsoft Teams Direct Routing",
                        label: "Direct Routing"
                      }
                    ],
                    confidence: 0.95,
                    reason: "Both comparison subjects are present."
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  const result = await port.understand({
    text: "how do calling plans and direct routing differ",
    source: "system",
    utteranceCount: 1
  });

  assert.equal(result.decision, "complete");
  assert.equal(result.facets?.length, 2);
  assert.equal(result.diagnostics?.reasoningEffort, "medium");
  assert.equal(result.diagnostics?.inputTokens, 100);
  assert.equal(result.diagnostics?.outputTokens, 25);
  assert.equal(result.diagnostics?.totalTokens, 125);
  assert.equal(
    typeof result.diagnostics?.requestStartedAtMs,
    "number"
  );
  assert.equal(
    typeof result.diagnostics?.responseCompletedAtMs,
    "number"
  );
  assert.equal(request?.["model"], "gpt-5.6-sol");
  assert.equal(request?.["reasoning_effort"], "medium");
  const format = request?.["response_format"] as {
    json_schema?: { strict?: boolean };
  };
  assert.equal(format.json_schema?.strict, true);
  assert.match(
    JSON.stringify(request),
    /Never answer the technical question/
  );
  assert.match(
    QUESTION_UNDERSTANDING_SYSTEM_PROMPT,
    /When uncertain between COMPLETE and CONTINUE, choose CONTINUE/
  );
  assert.match(
    QUESTION_UNDERSTANDING_SYSTEM_PROMPT,
    /specific, self-contained technical ask.*broad conversational lead-in/
  );
  assert.match(
    QUESTION_UNDERSTANDING_SYSTEM_PROMPT,
    /broad lead-in is followed by a because-clause/
  );
  assert.match(
    QUESTION_UNDERSTANDING_SYSTEM_PROMPT,
    /do not match or hard-code their exact wording/
  );
});

test("benchmark callers can request low effort without changing the production default", async () => {
  let request: Record<string, unknown> | null = null;
  const port = new OpenAiQuestionUnderstandingPort({
    apiKey: "test",
    model: "gpt-5.6-sol",
    reasoningEffort: "low",
    client: {
      chat: {
        completions: {
          async create(input) {
            request = input;
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    decision: "continue",
                    normalizedQuestion: null,
                    facets: [],
                    confidence: 1,
                    reason: "waiting"
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  const result = await port.understand({
    text: "Tell me about Direct Routing",
    source: "system",
    utteranceCount: 1
  });

  assert.equal(request?.["reasoning_effort"], "low");
  assert.equal(result.diagnostics?.reasoningEffort, "low");
});

test("T1-T8 completion policy receives only the minimal boundary context", async () => {
  const cases = [
    "Tell me how you implemented Teams",
    "Tell me how you implemented Teams because we have a large conference room environment",
    "Tell me how you implemented Teams because we have a large conference room environment and how did Exchange and the room resource accounts fit into that migration",
    "What does Get-CsOnlineUser return?",
    "Explain the role of an SBC in Direct Routing.",
    "How would you troubleshoot a user who cannot call external numbers?",
    "Walk me through your Direct Routing architecture and how you designed SBC failover across regions",
    "Tell me about your PowerShell automation for auditing Teams Voice users at scale"
  ];
  const requests: Record<string, unknown>[] = [];
  const port = new OpenAiQuestionUnderstandingPort({
    apiKey: "test",
    model: "gpt-5.6-sol",
    client: {
      chat: {
        completions: {
          async create(input) {
            requests.push(input);
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    decision: "continue",
                    normalizedQuestion: null,
                    facets: [],
                    confidence: 0.8,
                    reason: "test"
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  for (const text of cases) {
    await port.understand({
      text,
      source: "system",
      utteranceCount: 1
    });
  }

  assert.equal(requests.length, cases.length);
  for (const [index, request] of requests.entries()) {
    const messages = request["messages"] as Array<{
      role: string;
      content: string;
    }>;
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[0]?.content, QUESTION_UNDERSTANDING_SYSTEM_PROMPT);
    assert.equal(messages[1]?.role, "user");
    assert.match(messages[1]?.content ?? "", new RegExp(
      cases[index]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ));
    assert.doesNotMatch(
      messages[1]?.content ?? "",
      /evidence|source document|conversation history/i
    );
  }
});

test("bounds provider facets to four and supplies a fallback query", async () => {
  const facets = Array.from({ length: 6 }, (_, index) => ({
    id: `facet-${index}`,
    query: `query ${index}`,
    label: `Facet ${index}`
  }));
  const port = new OpenAiQuestionUnderstandingPort({
    apiKey: "test",
    model: "account-v2-alias",
    client: {
      chat: {
        completions: {
          async create() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    decision: "complete",
                    normalizedQuestion: "Normalized question?",
                    facets,
                    confidence: 2,
                    reason: "Complete."
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  const result = await port.understand({
    text: "question",
    source: "system",
    utteranceCount: 1
  });

  assert.equal(result.facets?.length, 4);
  assert.equal(result.confidence, 1);
});
