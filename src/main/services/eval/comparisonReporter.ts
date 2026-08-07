import type { SideBySideRunArtifact, SideBySideQuestionResult } from "./sideBySideTypes";

function fmtBool(value: boolean): string {
  return value ? "yes" : "no";
}

function fmtNum(value: number | null): string {
  if (value === null) return "n/a";
  return Number(value.toFixed(3)).toString();
}

function fmtPct(value: number | null): string {
  if (value === null) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function directRoutingSection(question: SideBySideQuestionResult): string[] {
  const lines: string[] = [];
  lines.push("## Q-001 Direct Routing Deep Dive");
  lines.push("");
  lines.push(`- Intent understood: ${fmtBool(question.v2.queryIntent.domains.includes("teams_admin"))}`);
  lines.push(
    `- Routed Teams Admin + Teams PowerShell: ${fmtBool(
      question.v2.retrievalScope.eligibleSources.some((s) => s.sourceId === "ms-teams-admin") &&
        question.v2.retrievalScope.eligibleSources.some((s) => s.sourceId === "ms-teams-powershell")
    )}`
  );
  const top10 = question.v2.fusedCandidates.slice(0, 10);
  const adminRank = top10.find((candidate) => candidate.sourceId === "ms-teams-admin")?.rank ?? null;
  const psRank = top10.find((candidate) => candidate.sourceId === "ms-teams-powershell")?.rank ?? null;
  lines.push(`- First Teams Admin rank: ${adminRank ?? "n/a"}`);
  lines.push(`- First Teams PowerShell rank: ${psRank ?? "n/a"}`);
  const methods = top10
    .map((candidate) => `${candidate.rank}:${candidate.methods.join("+")}`)
    .slice(0, 5);
  lines.push(`- Top method contributions: ${methods.join(", ") || "none"}`);
  lines.push(
    `- Unrelated-source leakage count (Top10): ${question.comparison.v2Metrics.inappropriateSourceLeakageCount}`
  );
  lines.push(`- V2 retrieval latency (ms): ${fmtNum(question.v2.retrievalDiagnostics.totalLatencyMs)}`);
  lines.push(
    `- Stage latency (intent/router/exact/lexical/semantic/fusion/total): ${fmtNum(question.v2.stageLatencyMs.queryIntent)}/${fmtNum(question.v2.stageLatencyMs.domainRouter)}/${fmtNum(question.v2.stageLatencyMs.exact)}/${fmtNum(question.v2.stageLatencyMs.lexical)}/${fmtNum(question.v2.stageLatencyMs.semantic)}/${fmtNum(question.v2.stageLatencyMs.fusion)}/${fmtNum(question.v2.stageLatencyMs.totalHybridRetrieval)}`
  );
  lines.push("");
  lines.push("| Rank | Source | Methods | Section | URL |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const candidate of top10) {
    lines.push(
      `| ${candidate.rank} | ${candidate.sourceId} | ${candidate.methods.join("+")} | ${candidate.sectionId} | ${candidate.canonicalUrl} |`
    );
  }
  lines.push("");
  return lines;
}

function cmdletSection(question: SideBySideQuestionResult): string[] {
  const lines: string[] = [];
  lines.push("## Cmdlet Deep Dive");
  lines.push("");
  lines.push(`- Extracted cmdlet(s): ${(question.v2.queryIntent.commandNames ?? []).join(", ") || "none"}`);
  lines.push(
    `- Exact directives: ${question.v2.retrievalScope.exactMatchDirectives.map((d) => `${d.type}:${d.value}`).join(", ") || "none"}`
  );
  lines.push(`- Exact-match success: ${fmtBool(question.comparison.v2Metrics.exactCmdletMatchSuccess === true)}`);
  const exactTop = question.v2.fusedCandidates.find((candidate) => candidate.methods.includes("exact"));
  lines.push(`- First exact candidate rank: ${exactTop?.rank ?? "n/a"}`);
  lines.push(`- First exact candidate source: ${exactTop?.sourceId ?? "n/a"}`);
  lines.push(`- Lexical reinforcement present: ${fmtBool((exactTop?.lexicalScore ?? null) !== null)}`);
  lines.push(`- Semantic reinforcement present: ${fmtBool((exactTop?.semanticSimilarity ?? null) !== null)}`);
  lines.push("| Rank | Source | Methods | Exact | LexRank | SemRank | URL |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const candidate of question.v2.fusedCandidates.slice(0, 10)) {
    lines.push(
      `| ${candidate.rank} | ${candidate.sourceId} | ${candidate.methods.join("+")} | ${candidate.exactMatchState ?? "n/a"} | ${candidate.lexicalRank ?? "n/a"} | ${candidate.semanticRank ?? "n/a"} | ${candidate.canonicalUrl} |`
    );
  }
  lines.push("");
  return lines;
}

function questionBlock(question: SideBySideQuestionResult): string[] {
  const lines: string[] = [];
  lines.push(`### ${question.question.questionId}`);
  lines.push("");
  lines.push(`- Question: ${question.question.question}`);
  lines.push(
    `- Legacy Top source: ${question.legacy.retrievedSources[0]?.sourceDomain ?? "none"} (latency ${fmtNum(
      question.legacy.result.latenciesMs.retrieval
    )}ms)`
  );
  lines.push(
    `- V2 Top source: ${question.v2.fusedCandidates[0]?.sourceId ?? "none"} (latency ${fmtNum(
      question.v2.retrievalDiagnostics.totalLatencyMs
    )}ms)`
  );
  lines.push(
    `- Expected-source hit Top1 (legacy/v2): ${fmtBool(
      question.comparison.legacyMetrics.expectedSourceHitTop1
    )}/${fmtBool(question.comparison.v2Metrics.expectedSourceHitTop1)}`
  );
  lines.push(
    `- Expected-source first rank (legacy/v2): ${question.comparison.legacyMetrics.firstExpectedSourceRank ?? "n/a"}/${
      question.comparison.v2Metrics.firstExpectedSourceRank ?? "n/a"
    }`
  );
  lines.push(
    `- Domain routing correct (v2): ${fmtBool(question.comparison.v2Metrics.domainRoutingCorrect)}`
  );
  lines.push(
    `- Authority correct Top1 (legacy/v2): ${fmtBool(
      question.comparison.legacyMetrics.authorityCorrectTop1
    )}/${fmtBool(question.comparison.v2Metrics.authorityCorrectTop1)}`
  );
  lines.push(
    `- Leakage count Top10 (legacy/v2): ${question.comparison.legacyMetrics.inappropriateSourceLeakageCount}/${question.comparison.v2Metrics.inappropriateSourceLeakageCount}`
  );
  lines.push(
    `- Recall@1/3/5/10 (legacy): ${fmtPct(question.comparison.legacyMetrics.recallAt1)}/${fmtPct(question.comparison.legacyMetrics.recallAt3)}/${fmtPct(question.comparison.legacyMetrics.recallAt5)}/${fmtPct(question.comparison.legacyMetrics.recallAt10)}`
  );
  lines.push(
    `- Recall@1/3/5/10 (v2): ${fmtPct(question.comparison.v2Metrics.recallAt1)}/${fmtPct(question.comparison.v2Metrics.recallAt3)}/${fmtPct(question.comparison.v2Metrics.recallAt5)}/${fmtPct(question.comparison.v2Metrics.recallAt10)}`
  );
  lines.push(
    `- Stage latency (intent/router/exact/lexical/semantic/fusion/total): ${fmtNum(question.v2.stageLatencyMs.queryIntent)}/${fmtNum(question.v2.stageLatencyMs.domainRouter)}/${fmtNum(question.v2.stageLatencyMs.exact)}/${fmtNum(question.v2.stageLatencyMs.lexical)}/${fmtNum(question.v2.stageLatencyMs.semantic)}/${fmtNum(question.v2.stageLatencyMs.fusion)}/${fmtNum(question.v2.stageLatencyMs.totalHybridRetrieval)}`
  );
  lines.push(
    `- Scope warnings: ${
      [
        ...question.v2.retrievalScope.routingWarnings,
        ...question.v2.semanticDiagnostics.warnings,
        ...question.v2.fusionDiagnostics.warnings.map((warning) => warning.code)
      ].join(", ") || "none"
    }`
  );
  lines.push("");
  lines.push("| Rank | Source | Section | Heading | Methods | Exact | LexRank | SemRank | FusionScore | URL |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const candidate of question.v2.fusedCandidates.slice(0, 5)) {
    lines.push(
      `| ${candidate.rank} | ${candidate.sourceId} | ${candidate.sectionId} | ${candidate.headingPath.join(" > ")} | ${candidate.methods.join("+")} | ${candidate.exactMatchState ?? "n/a"} | ${candidate.lexicalRank ?? "n/a"} | ${candidate.semanticRank ?? "n/a"} | ${fmtNum(candidate.fusionScore)} | ${candidate.canonicalUrl} |`
    );
  }
  lines.push("");
  return lines;
}

export function toSideBySideMarkdown(artifact: SideBySideRunArtifact): string {
  const lines: string[] = [];
  lines.push(`# WB-17 Side-by-side Retrieval Report (${artifact.runId})`);
  lines.push("");
  lines.push(`- Dataset: \`${artifact.datasetPath}\``);
  lines.push(`- Legacy artifact: \`${artifact.legacyArtifactPath}\``);
  lines.push(`- Corpus mode: \`${artifact.corpus.mode}\``);
  lines.push(
    `- Corpus docs/chunks/embeddings: ${artifact.corpus.documentCount}/${artifact.corpus.chunkCount}/${artifact.corpus.embeddingCount}`
  );
  lines.push(`- Corpus classification reasons: ${artifact.corpus.classificationReasons.join("; ")}`);
  lines.push(
    `- Source distribution docs: ${Object.entries(artifact.corpus.documentsBySource)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );
  lines.push(
    `- Source distribution chunks: ${Object.entries(artifact.corpus.chunksBySource)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );
  lines.push(
    `- Source distribution embeddings: ${Object.entries(artifact.corpus.embeddingsBySource)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );
  lines.push("");
  if (artifact.corpus.mode === "fixture") {
    lines.push(
      "**Fixture corpus — validates retrieval plumbing only. Results must not be interpreted as production retrieval quality.**"
    );
    lines.push("");
  }
  lines.push("## Aggregate");
  lines.push("");
  lines.push(
    `- Expected-source hit Top1/3/5/10 (legacy): ${artifact.summary.legacy.expectedSourceHitTop1}/${artifact.summary.legacy.expectedSourceHitTop3}/${artifact.summary.legacy.expectedSourceHitTop5}/${artifact.summary.legacy.expectedSourceHitTop10}`
  );
  lines.push(
    `- Expected-source hit Top1/3/5/10 (v2): ${artifact.summary.v2.expectedSourceHitTop1}/${artifact.summary.v2.expectedSourceHitTop3}/${artifact.summary.v2.expectedSourceHitTop5}/${artifact.summary.v2.expectedSourceHitTop10}`
  );
  lines.push(`- MRR (legacy/v2): ${fmtNum(artifact.summary.legacy.mrr)}/${fmtNum(artifact.summary.v2.mrr)}`);
  lines.push(
    `- Mean Recall@5 (legacy/v2): ${fmtNum(artifact.summary.legacy.meanRecallAt5)}/${fmtNum(artifact.summary.v2.meanRecallAt5)}`
  );
  lines.push(
    `- Mean Recall@10 (legacy/v2): ${fmtNum(artifact.summary.legacy.meanRecallAt10)}/${fmtNum(artifact.summary.v2.meanRecallAt10)}`
  );
  lines.push(
    `- Exact cmdlet success (legacy/v2): ${artifact.summary.legacy.exactCmdletSuccess.success}/${artifact.summary.legacy.exactCmdletSuccess.total} vs ${artifact.summary.v2.exactCmdletSuccess.success}/${artifact.summary.v2.exactCmdletSuccess.total}`
  );
  lines.push(
    `- Domain routing correctness (v2): ${artifact.summary.v2.domainRoutingCorrect}/${artifact.summary.totalQuestions}`
  );
  lines.push(
    `- Authority correctness Top1 (legacy/v2): ${artifact.summary.legacy.authorityCorrectTop1}/${artifact.summary.v2.authorityCorrectTop1}`
  );
  lines.push(
    `- Leakage questions (legacy/v2): ${artifact.summary.legacy.leakageQuestions}/${artifact.summary.v2.leakageQuestions}`
  );
  lines.push(
    `- p50 retrieval latency v2 total(ms): ${fmtNum(artifact.summary.v2.p50TotalLatencyMs)}`
  );
  lines.push(
    `- p95 retrieval latency legacy/v2 total(ms): ${fmtNum(
      artifact.summary.legacy.p95RetrievalLatencyMs
    )}/${fmtNum(artifact.summary.v2.p95TotalLatencyMs)}`
  );
  lines.push(
    `- p50/p95 V2 semantic latency(ms): ${fmtNum(artifact.summary.v2.p50SemanticLatencyMs)}/${fmtNum(artifact.summary.v2.p95SemanticLatencyMs)}`
  );
  lines.push(
    `- p50/p95 V2 fusion stage latency(ms): ${fmtNum(artifact.summary.v2.p50HybridFusionLatencyMs)}/${fmtNum(artifact.summary.v2.p95HybridFusionLatencyMs)}`
  );
  lines.push(
    `- Retrieval-method contribution (first expected hit): ${Object.entries(artifact.summary.methodContribution)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "none"}`
  );
  lines.push("");
  const q001 = artifact.questions.find((q) => q.question.questionId === "Q-001");
  if (q001) lines.push(...directRoutingSection(q001));
  const cmdletQ = artifact.questions.find((q) => q.question.questionId === "Q-003");
  if (cmdletQ) lines.push(...cmdletSection(cmdletQ));
  lines.push("## Per-question Review");
  lines.push("");
  for (const question of artifact.questions) {
    lines.push(...questionBlock(question));
  }
  lines.push("## Calling Plans Supplemental");
  lines.push("");
  lines.push(`- ${artifact.supplementalCallingPlans.note}`);
  lines.push("");
  for (const query of artifact.supplementalCallingPlans.queries) {
    lines.push(`### ${query.queryId}`);
    lines.push("");
    lines.push(`- Query: ${query.question}`);
    lines.push(
      `- Stage latency (intent/router/exact/lexical/semantic/fusion/total): ${fmtNum(query.stageLatencyMs.queryIntent)}/${fmtNum(query.stageLatencyMs.domainRouter)}/${fmtNum(query.stageLatencyMs.exact)}/${fmtNum(query.stageLatencyMs.lexical)}/${fmtNum(query.stageLatencyMs.semantic)}/${fmtNum(query.stageLatencyMs.fusion)}/${fmtNum(query.stageLatencyMs.totalHybridRetrieval)}`
    );
    lines.push(
      `- Scope warnings: ${[
        ...query.retrievalScope.routingWarnings,
        ...query.semanticDiagnostics.warnings,
        ...query.fusionDiagnostics.warnings.map((warning) => warning.code)
      ].join(", ") || "none"}`
    );
    lines.push("| Rank | Source | Methods | Section | URL |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const candidate of query.topCandidates) {
      lines.push(
        `| ${candidate.rank} | ${candidate.sourceId} | ${candidate.methods.join("+")} | ${candidate.sectionId} | ${candidate.canonicalUrl} |`
      );
    }
    lines.push("");
  }
  lines.push("## Warnings");
  lines.push("");
  if (artifact.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of artifact.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  return lines.join("\n");
}
