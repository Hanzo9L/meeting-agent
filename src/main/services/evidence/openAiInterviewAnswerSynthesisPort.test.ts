import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSynthesisValidationFailureDiagnostic,
  OpenAiInterviewAnswerSynthesisPort
} from "./openAiInterviewAnswerSynthesisPort";
import type { InterviewAnswerSynthesisInput } from "./interviewAnswerSynthesisPort";

function input(): InterviewAnswerSynthesisInput {
  return {
    originalQuestion: "what does get c s online user return",
    normalizedQuestion: "What does Get-CsOnlineUser return?",
    facets: [{
      id: "cmdlet",
      label: "Cmdlet return value",
      query: "Get-CsOnlineUser return value"
    }],
    facetCoverage: [{
      facetId: "cmdlet",
      label: "Cmdlet return value",
      query: "Get-CsOnlineUser return value",
      covered: true,
      evidenceIds: ["E1"],
      sources: [{
        evidenceId: "E1",
        parentId: "get-csonlineuser",
        title: "Get-CsOnlineUser",
        section: "Description",
        publisher: "Microsoft"
      }]
    }],
    evidence: [{
      evidenceId: "E1",
      facetIds: ["cmdlet"],
      publisher: "Microsoft",
      sourceRole: "microsoft_authority",
      hit: {
        parentId: "get-csonlineuser",
        title: "Get-CsOnlineUser",
        section: "Description",
        url: "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser",
        body: "Returns information about users who have accounts homed on Microsoft Teams.",
        score: 1,
        matchedBy: ["lexical"]
      }
    }]
  };
}

test("makes one medium-reasoning structured call and records returned usage", async () => {
  let calls = 0;
  let request: Record<string, unknown> | null = null;
  const port = new OpenAiInterviewAnswerSynthesisPort({
    apiKey: "test",
    model: "account-v2-alias",
    client: {
      chat: {
        completions: {
          async create(value) {
            calls += 1;
            request = value;
            return {
              model: "resolved-model-version",
              choices: [{
                message: {
                  content: JSON.stringify({
                    directAnswer: {
                      text: "It returns information about Teams-homed users.",
                      evidenceIds: ["E1"]
                    },
                    bullets: [{
                      text: "The returned information covers users homed on Microsoft Teams.",
                      facetId: "cmdlet",
                      evidenceIds: ["E1"]
                    }],
                    unsupportedFacets: [],
                    confidence: "high"
                  })
                }
              }],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 30,
                total_tokens: 130
              }
            };
          }
        }
      }
    }
  });

  const answer = await port.synthesize(input());

  assert.equal(calls, 1);
  assert.equal(request?.["model"], "account-v2-alias");
  assert.equal(request?.["reasoning_effort"], "medium");
  assert.equal(
    (request?.["response_format"] as {
      json_schema: { strict: boolean };
    }).json_schema.strict,
    true
  );
  assert.doesNotMatch(
    JSON.stringify(request?.["response_format"]),
    /uniqueItems/
  );
  assert.match(
    JSON.stringify(request?.["messages"]),
    /what does get c s online user return/
  );
  assert.equal(answer.diagnostics.actualModel, "resolved-model-version");
  assert.equal(answer.diagnostics.inputTokens, 100);
  assert.equal(answer.diagnostics.outputTokens, 30);
});

test("deduplicates repeated evidence IDs during local validation", async () => {
  const port = new OpenAiInterviewAnswerSynthesisPort({
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
                    directAnswer: {
                      text: "It returns Teams-homed users.",
                      evidenceIds: ["E1", "E1"]
                    },
                    bullets: [{
                      text: "The result contains Teams user information.",
                      facetId: "cmdlet",
                      evidenceIds: ["E1", "E1"]
                    }],
                    unsupportedFacets: [],
                    confidence: "high"
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  const answer = await port.synthesize(input());

  assert.deepEqual(answer.directAnswer?.evidenceIds, ["E1"]);
  assert.deepEqual(answer.bullets[0]?.evidenceIds, ["E1"]);
});

test("rejects evidence IDs outside the supplied bundle", async () => {
  let calls = 0;
  const port = new OpenAiInterviewAnswerSynthesisPort({
    apiKey: "test",
    model: "account-v2-alias",
    client: {
      chat: {
        completions: {
          async create() {
            calls += 1;
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    directAnswer: {
                      text: "Unsupported binding.",
                      evidenceIds: ["E99"]
                    },
                    bullets: [{
                      text: "Unsupported binding.",
                      facetId: "cmdlet",
                      evidenceIds: ["E99"]
                    }],
                    unsupportedFacets: [],
                    confidence: "low"
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  await assert.rejects(
    () => port.synthesize(input()),
    /interview_synthesis_evidence_ids_invalid/
  );
  assert.equal(calls, 1);
});

test("rejects a bullet bound to evidence from another facet", async () => {
  const value = input();
  value.facets.push({
    id: "other",
    label: "Other",
    query: "Other"
  });
  value.facetCoverage.push({
    facetId: "other",
    label: "Other",
    query: "Other",
    covered: false,
    evidenceIds: [],
    sources: []
  });
  const port = new OpenAiInterviewAnswerSynthesisPort({
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
                    directAnswer: null,
                    bullets: [{
                      text: "Unsupported cross-facet claim.",
                      facetId: "other",
                      evidenceIds: ["E1"]
                    }],
                    unsupportedFacets: [{
                      facetId: "cmdlet",
                      reason: "Not answered."
                    }],
                    confidence: "low"
                  })
                }
              }]
            };
          }
        }
      }
    }
  });

  await assert.rejects(
    () => port.synthesize(value),
    /interview_synthesis_cross_facet_binding/
  );
});

test("cross-facet diagnostics expose the failed pair without evidence bodies", () => {
  const value = input();
  value.facets.push({
    id: "other",
    label: "Other",
    query: "Other"
  });
  const content = JSON.stringify({
    directAnswer: {
      text: "Summary.",
      evidenceIds: ["E1"]
    },
    bullets: [{
      text: "Wrong-facet claim.",
      facetId: "other",
      evidenceIds: ["E1"]
    }],
    unsupportedFacets: [{ facetId: "cmdlet", reason: "Missing." }],
    confidence: "low"
  });

  const diagnostic = buildSynthesisValidationFailureDiagnostic(
    content,
    value,
    new Error("interview_synthesis_cross_facet_binding")
  );

  assert.deepEqual(diagnostic["failedBindings"], [{
    bulletIndex: 0,
    bulletFacetId: "other",
    evidenceId: "E1",
    evidenceFacetIds: ["cmdlet"],
    title: "Get-CsOnlineUser",
    section: "Description"
  }]);
  assert.doesNotMatch(JSON.stringify(diagnostic), /Returns information/);
});
