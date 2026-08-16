import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  attemptGroundedSynthesis,
  renderGroundedSynthesis,
  validateGroundedSynthesisOutput,
  type GroundedSynthesisOutput,
  type GroundedSynthesisPayload
} from "./groundedAnswerSynthesis";
import {
  OpenAiGroundedSynthesisProvider,
  resolveGroundedSynthesisRuntimeConfig
} from "./openAiGroundedSynthesisProvider";

function payload(
  profile: GroundedSynthesisPayload["profile"] = "helpdesk_detailed"
): GroundedSynthesisPayload {
  return {
    schemaVersion: "grounded-answer-synthesis/v1",
    question:
      "Use PowerShell to report Enterprise Voice and calling policy, then export CSV.",
    profile,
    answerability: "partial",
    answerType: "procedural",
    requestedMethods: ["PowerShell"],
    requestedAspects: [
      {
        aspectId: "aspect:voice",
        subject: "Enterprise Voice",
        answerObject: "configuration_state",
        operation: "get",
        supported: true,
        requestedMethods: ["PowerShell"]
      },
      {
        aspectId: "aspect:calling",
        subject: "calling policy",
        answerObject: "configuration_state",
        operation: "get",
        supported: true,
        requestedMethods: ["PowerShell"]
      },
      {
        aspectId: "aspect:csv",
        subject: "CSV export",
        answerObject: "output_transformation",
        operation: "export",
        supported: false,
        requestedMethods: []
      }
    ],
    claims: [
      {
        claimId: "claim:voice",
        aspectId: "aspect:voice",
        aspectSubject: "Enterprise Voice",
        text:
          "Get-CsOnlineUser returns users and includes the EnterpriseVoiceEnabled property.",
        mandatory: true,
        requestedMethods: ["PowerShell"],
        sources: [
          {
            claimId: "claim:voice",
            evidenceId: "evidence:voice",
            sourceId: "ms-teams-powershell",
            sourceTitle: "Get-CsOnlineUser",
            canonicalUrl:
              "https://learn.microsoft.com/powershell/module/teams/get-csonlineuser",
            authorityRole: "teams_powershell_cmdlet_primary"
          }
        ]
      },
      {
        claimId: "claim:calling",
        aspectId: "aspect:calling",
        aspectSubject: "calling policy",
        text:
          "Get-CsTeamsCallingPolicy returns information about calling policies.",
        mandatory: true,
        requestedMethods: ["PowerShell"],
        sources: [
          {
            claimId: "claim:calling",
            evidenceId: "evidence:calling",
            sourceId: "ms-teams-powershell",
            sourceTitle: "Get-CsTeamsCallingPolicy",
            canonicalUrl:
              "https://learn.microsoft.com/powershell/module/teams/get-csteamscallingpolicy",
            authorityRole: "teams_powershell_cmdlet_primary"
          }
        ]
      }
    ],
    unsupportedAspects: [
      {
        aspectId: "aspect:csv",
        subject: "CSV export",
        detail: "CSV serialization is outside the verified authority set."
      }
    ],
    caveats: [{ code: "partial_coverage", text: "Coverage is partial." }]
  };
}

function validOutput(
  profile: GroundedSynthesisOutput["profile"] = "helpdesk_detailed"
): GroundedSynthesisOutput {
  return {
    schemaVersion: "grounded-answer-synthesis-output/v1",
    profile,
    blocks: [
      {
        blockType: "direct_answer",
        text:
          "Use PowerShell to report validated Enterprise Voice and calling policy information from the Teams cmdlets.",
        supportingClaimIds: ["claim:voice", "claim:calling"]
      }
    ],
    unsupportedAspectIds: ["aspect:csv"],
    caveatCodes: ["partial_coverage"]
  };
}

test("G1 accepts attributed paraphrase and combines grounded claims", () => {
  const input = payload();
  const output = validOutput();
  const validation = validateGroundedSynthesisOutput(input, output);
  assert.deepEqual(validation, { valid: true, issues: [] });
  const rendered = renderGroundedSynthesis(input, output);
  assert.ok(rendered.answerText.includes("Use PowerShell"));
  assert.ok(rendered.answerText.includes("CSV serialization"));
  assert.equal(rendered.proofFactRanges.length, 2);
  for (const range of rendered.proofFactRanges) {
    assert.equal(
      rendered.answerText.slice(range.startOffset, range.endOffset),
      output.blocks[0]!.text
    );
  }
});

test("G1 rejects unknown claims and newly invented technical primitives", () => {
  const input = payload();
  const output = validOutput();
  output.blocks = [
    {
      blockType: "step",
      text:
        "Run Set-CsUser with the TenantId parameter, then read Enterprise Voice.",
      supportingClaimIds: ["claim:voice", "claim:unknown"]
    }
  ];
  const validation = validateGroundedSynthesisOutput(input, output);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some((issue) =>
      issue.startsWith("unknown_claim_id:claim:unknown")
    )
  );
  assert.ok(
    validation.issues.some((issue) =>
      issue.includes("unattributed_technical_token:set-csuser")
    )
  );
});

test("G1 rejects new product behavior even when identifiers are grounded", () => {
  const output = validOutput();
  output.blocks = [
    {
      blockType: "step",
      text:
        "Get-CsTeamsCallingPolicy assigns a calling policy to each user.",
      supportingClaimIds: ["claim:calling"]
    },
    {
      blockType: "fact",
      text:
        "Get-CsOnlineUser reports the EnterpriseVoiceEnabled property.",
      supportingClaimIds: ["claim:voice"]
    }
  ];
  const validation = validateGroundedSynthesisOutput(payload(), output);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.includes("unattributed_content_word:assign")
  );
  assert.ok(
    validation.issues.includes("unattributed_content_word:user")
  );
});

test("G1 requires unsupported gaps and caveats to survive synthesis", () => {
  const output = validOutput();
  output.unsupportedAspectIds = [];
  output.caveatCodes = [];
  const validation = validateGroundedSynthesisOutput(payload(), output);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes("unsupported_aspect_coverage_invalid"));
  assert.ok(validation.issues.includes("caveat_coverage_invalid"));
});

test("G1 permits only non-technical ungrounded connective blocks", () => {
  const output = validOutput();
  output.blocks.unshift({
    blockType: "transition",
    text: "First, use the Teams Admin Center.",
    supportingClaimIds: []
  });
  const validation = validateGroundedSynthesisOutput(payload(), output);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.includes(
      "connective_contains_technical_token:admin"
    )
  );
});

test("G1 Quick enforces a concise 2-5 factual-block envelope", () => {
  const input = payload("live_assist_quick");
  const output = validOutput("live_assist_quick");
  assert.equal(
    validateGroundedSynthesisOutput(input, output).valid,
    false
  );
  output.blocks = [
    {
      blockType: "step",
      text:
        "Use PowerShell with Get-CsOnlineUser to read Enterprise Voice.",
      supportingClaimIds: ["claim:voice"]
    },
    {
      blockType: "step",
      text:
        "Use Get-CsTeamsCallingPolicy to read calling policy information.",
      supportingClaimIds: ["claim:calling"]
    }
  ];
  assert.deepEqual(validateGroundedSynthesisOutput(input, output), {
    valid: true,
    issues: []
  });
});

test("G1 model and timeout are configurable outside the contract", () => {
  assert.deepEqual(
    resolveGroundedSynthesisRuntimeConfig({
      RELAY_SYNTHESIS_MODEL: "benchmark-model",
      RELAY_SYNTHESIS_TIMEOUT_MS: "1234"
    }),
    { provider: "openai", model: "benchmark-model", timeoutMs: 1234 }
  );
});

test("G1 provider failure and invalid output fall back deterministically", async () => {
  const providerFailure = await attemptGroundedSynthesis({
    payload: payload(),
    provider: {
      providerId: "failing",
      async synthesize() {
        throw new Error("timed_out");
      }
    }
  });
  assert.equal(providerFailure.rendered, null);
  assert.equal(providerFailure.status, "provider_failed");
  assert.equal(providerFailure.requestCount, 1);

  const invalid = validOutput();
  invalid.blocks[0]!.supportingClaimIds = ["claim:unknown"];
  const validationFailure = await attemptGroundedSynthesis({
    payload: payload(),
    provider: {
      providerId: "invalid",
      async synthesize() {
        return {
          output: invalid,
          usage: { inputTokens: null, outputTokens: null }
        };
      }
    }
  });
  assert.equal(validationFailure.rendered, null);
  assert.equal(validationFailure.status, "validation_failed");
});

test("G1 bypasses insufficient evidence without a provider request", async () => {
  let requests = 0;
  const result = await attemptGroundedSynthesis({
    payload: null,
    provider: {
      providerId: "must-not-run",
      async synthesize() {
        requests += 1;
        return {
          output: validOutput(),
          usage: { inputTokens: null, outputTokens: null }
        };
      }
    }
  });
  assert.equal(requests, 0);
  assert.equal(result.requestCount, 0);
  assert.equal(result.status, "bypassed_insufficient_evidence");
});

test("OpenAI synthesis adapter requests strict structured authored blocks", async () => {
  let request: Record<string, unknown> | null = null;
  const provider = new OpenAiGroundedSynthesisProvider({
    model: "test-model",
    client: {
      chat: {
        completions: {
          async create(params) {
            request = params;
            return {
              choices: [
                { message: { content: JSON.stringify(validOutput()) } }
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 }
            };
          }
        }
      }
    }
  });
  const result = await provider.synthesize(payload());
  assert.equal(result.output.blocks[0]?.text, validOutput().blocks[0]?.text);
  assert.equal(request?.["model"], "test-model");
  assert.equal(
    (request?.["response_format"] as { type: string }).type,
    "json_schema"
  );
  const messages = request?.["messages"] as Array<{
    role: string;
    content: string;
  }>;
  const userRequest = JSON.parse(messages[1]!.content) as {
    payload: GroundedSynthesisPayload;
  };
  assert.equal(userRequest.payload.claims.length, 2);
  assert.doesNotMatch(messages[1]!.content, /chunkId|exactText|retrievedChunk/);
});

test("production reaches only the separate constrained synthesis adapter", () => {
  const main = readFileSync(resolve("src/main/index.ts"), "utf8");
  const execution = readFileSync(
    resolve("src/main/services/conversations/answerExecutionPort.ts"),
    "utf8"
  );
  const adapter = readFileSync(
    resolve(
      "src/main/services/answerV2/openAiGroundedSynthesisProvider.ts"
    ),
    "utf8"
  );
  assert.match(main, /createConfiguredGroundedSynthesisProvider/);
  assert.match(execution, /attemptGroundedSynthesis/);
  assert.doesNotMatch(
    `${main}\n${execution}\n${adapter}`,
    /OpenAiGroundedAnswerGenerator|OpenAiLlmProvider|generateGroundedAnswer/
  );
});
