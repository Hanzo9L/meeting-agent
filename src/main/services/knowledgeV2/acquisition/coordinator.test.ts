import test from "node:test";
import assert from "node:assert/strict";
import { SourceAcquisitionCoordinator } from "./coordinator";
import type { AcquisitionResult, SourceAcquisitionAdapter } from "./types";

function fakeResult(
  transport: "github" | "learn_mcp",
  sourceId: string,
  trackId: string
): AcquisitionResult {
  return {
    sourceId,
    trackId,
    transport,
    startCheckpoint: null,
    endCheckpoint: null,
    added: [],
    modified: [],
    unchanged: [],
    deleted: [],
    errors: []
  };
}

test("routes Teams Admin acquisition through learn_mcp transport", async () => {
  const calls: string[] = [];
  const githubAdapter: SourceAcquisitionAdapter = {
    async acquire() {
      calls.push("github");
      return fakeResult("github", "ms-teams-admin", "ga");
    }
  };
  const learnAdapter: SourceAcquisitionAdapter = {
    async acquire() {
      calls.push("learn_mcp");
      return fakeResult("learn_mcp", "ms-teams-admin", "ga");
    }
  };
  const coordinator = new SourceAcquisitionCoordinator({
    githubAdapter,
    learnMcpAdapter: learnAdapter
  });
  const result = await coordinator.acquire({ sourceId: "ms-teams-admin", trackId: "ga" });
  assert.equal(result.transport, "learn_mcp");
  assert.deepEqual(calls, ["learn_mcp"]);
});

test("routes Teams PowerShell acquisition through github transport", async () => {
  const calls: string[] = [];
  const githubAdapter: SourceAcquisitionAdapter = {
    async acquire() {
      calls.push("github");
      return fakeResult("github", "ms-teams-powershell", "ga");
    }
  };
  const learnAdapter: SourceAcquisitionAdapter = {
    async acquire() {
      calls.push("learn_mcp");
      return fakeResult("learn_mcp", "ms-teams-powershell", "ga");
    }
  };
  const coordinator = new SourceAcquisitionCoordinator({
    githubAdapter,
    learnMcpAdapter: learnAdapter
  });
  const result = await coordinator.acquire({ sourceId: "ms-teams-powershell", trackId: "ga" });
  assert.equal(result.transport, "github");
  assert.deepEqual(calls, ["github"]);
});

test("returns explicit source_not_found error for invalid source", async () => {
  const coordinator = new SourceAcquisitionCoordinator({
    githubAdapter: { acquire: async () => fakeResult("github", "x", "ga") },
    learnMcpAdapter: { acquire: async () => fakeResult("learn_mcp", "x", "ga") }
  });
  const result = await coordinator.acquire({ sourceId: "missing-source", trackId: "ga" });
  assert.equal(result.errors[0]?.code, "source_not_found");
});

