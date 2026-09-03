/**
 * EXAMPLE ONLY.
 * Adapt to the project's corpus-job API and existing job conventions.
 */

const sourceId = "networking_beginner";

const ingestRoots = [
  "Networking_Fundamentals",
  "UC_Networking_Bridge",
  "Troubleshooting_Playbooks",
];

// Guardrail: ingest only Markdown topic files whose front matter has ingest: true.
// Preserve heading structure so the existing chunker can populate heading_path.
// Do not flatten Markdown to plain text before chunking.
// Do not ingest Combined_Networking_Study_Guide.md; it duplicates topic content.

export const networkingBeginnerCorpusJob = {
  sourceId,
  format: "markdown",
  ingestRoots,
  frontMatterRequired: ["sourceId", "documentId", "documentType", "ingest"],
  chunking: {
    preserveHeadings: true,
    emitHeadingPath: true,
  },
};
