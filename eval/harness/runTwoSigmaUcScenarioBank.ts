import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceSearchClient } from "../../src/main/services/evidence/evidenceSearchClient.ts";
import { LearnRagChild } from "../../src/main/services/evidence/learnRagChild.ts";
import type { EvidenceSearchResult } from "../../src/main/services/evidence/evidenceTypes.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_PATH = join(
  ROOT,
  "eval/datasets/two_sigma_uc_systems_engineer_scenarios.json"
);
const OUT_DIR = join(ROOT, "eval/runs/two-sigma-uc-i4");

interface Scenario {
  id: string;
  category: string;
  question: string;
  intent: string;
  domains: string[];
  expected_themes: string[];
  source: string;
  must_not_do: string[];
}

function blobOf(result: EvidenceSearchResult): string {
  if (!result.ok) return "";
  return result.results
    .map((hit) => `${hit.title}\n${hit.section}\n${hit.body}`)
    .join("\n")
    .toLowerCase();
}

function themeHits(themes: string[], blob: string): string[] {
  return themes.filter((theme) => {
    const lower = theme.toLowerCase();
    if (blob.includes(lower)) return true;
    const tokens = lower
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
    if (tokens.length === 0) return false;
    const matched = tokens.filter((token) => blob.includes(token)).length;
    return matched >= Math.min(tokens.length, Math.max(2, Math.ceil(tokens.length * 0.6)));
  });
}

function verdict(params: {
  intent: string;
  category: string;
  ok: boolean;
  hits: string[];
  themes: string[];
}): string {
  if (params.intent === "behavioral_story") return "story_required";
  if (params.category === "windows_linux_operational" && params.category && params.themes.some((t) => /systemctl|journalctl|tcpdump/.test(t))) {
    if (params.hits.length === 0) return "corpus_gap";
  }
  if (!params.ok) return "retrieval_failed";
  if (params.hits.length >= 2) return "well_served";
  if (params.hits.length === 1) return "partial";
  return "corpus_or_ranking_gap";
}

const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8")) as {
  scenarios: Scenario[];
};
if (dataset.scenarios.length !== 30) {
  throw new Error(`expected 30 scenarios, found ${dataset.scenarios.length}`);
}

const child = new LearnRagChild({ startTimeoutMs: 120_000 });
const client = createEvidenceSearchClient(child);
await child.start();
const ready = child.getReadyInfo();

const rows = [];
for (const scenario of dataset.scenarios) {
  const started = Date.now();
  const result = await client.search(scenario.question);
  const elapsedMs = Date.now() - started;
  const blob = blobOf(result);
  const hits = result.ok ? themeHits(scenario.expected_themes, blob) : [];
  const sources = result.ok
    ? result.results.map((hit, index) => ({
        rank: index + 1,
        title: hit.title,
        section: hit.section,
        url: hit.url
      }))
    : [];
  rows.push({
    id: scenario.id,
    category: scenario.category,
    intent: scenario.intent,
    source: scenario.source,
    question: scenario.question,
    ok: result.ok,
    elapsedMs,
    route: result.ok ? result.route : null,
    error: result.ok ? null : { code: result.code, message: result.message },
    themeHits: hits,
    themeMisses: scenario.expected_themes.filter((theme) => !hits.includes(theme)),
    verdict: verdict({
      intent: scenario.intent,
      category: scenario.category,
      ok: result.ok,
      hits,
      themes: scenario.expected_themes
    }),
    sources
  });
  console.info(
    `${scenario.id} ${rows.at(-1)?.verdict} ${elapsedMs}ms hits=${hits.length}/${scenario.expected_themes.length}`
  );
}

child.dispose();
await child.waitUntilStopped();

const counts = rows.reduce<Record<string, number>>((acc, row) => {
  acc[row.verdict] = (acc[row.verdict] ?? 0) + 1;
  return acc;
}, {});

const report = {
  generatedAt: new Date().toISOString(),
  dataset: "eval/datasets/two_sigma_uc_systems_engineer_scenarios.json",
  engine: ready,
  frozenHashes: {
    searchHash: ready?.searchHash ?? null,
    scopeHash: ready?.scopeHash ?? null
  },
  counts,
  wellServed: rows.filter((row) => row.verdict === "well_served").map((row) => row.id),
  partial: rows.filter((row) => row.verdict === "partial").map((row) => row.id),
  gaps: rows.filter((row) =>
    ["corpus_or_ranking_gap", "corpus_gap", "retrieval_failed"].includes(row.verdict)
  ).map((row) => row.id),
  storyRequired: rows.filter((row) => row.verdict === "story_required").map((row) => row.id),
  rows
};

await mkdir(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, "results.json");
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.info(`wrote ${outPath}`);
console.info(JSON.stringify(counts));
