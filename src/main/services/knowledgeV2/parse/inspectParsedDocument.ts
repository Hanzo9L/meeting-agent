import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCanonicalDocument } from "./parser";
import type { AcquiredDocumentInput, CanonicalSection } from "./types";

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function flattenSections(sections: CanonicalSection[]): CanonicalSection[] {
  const output: CanonicalSection[] = [];
  const stack = [...sections];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    output.push(current);
    stack.unshift(...current.children);
  }
  return output;
}

async function main(): Promise<void> {
  const fixturePath = resolve(
    getArg("--fixture") ?? "src/main/services/knowledgeV2/parse/fixtures/teams-admin-learn-direct-routing.json"
  );
  const raw = await readFile(fixturePath, "utf8");
  const input = JSON.parse(raw) as AcquiredDocumentInput;
  const parsed = parseCanonicalDocument(input);
  if (!parsed.document) {
    console.log(
      JSON.stringify(
        {
          success: false,
          fixturePath,
          fatalErrors: parsed.fatalErrors
        },
        null,
        2
      )
    );
    return;
  }
  const sections = flattenSections(parsed.document.sections);
  const headingTree = sections.map((section) => ({
    path: section.headingPath,
    kind: section.sectionKind
  }));
  const allBlocks = sections.flatMap((section) => section.blocks);
  const output = {
    success: parsed.success,
    fixturePath,
    sourceId: parsed.document.sourceId,
    transport: parsed.document.transport,
    title: parsed.document.normalizedMetadata.title,
    normalizedMetadata: parsed.document.normalizedMetadata,
    rawMetadataCount: Object.keys(parsed.document.frontMatter).length,
    sectionCount: sections.length,
    blockCount: allBlocks.length,
    codeBlockCount: allBlocks.filter((block) => block.kind === "code_block").length,
    tableCount: allBlocks.filter((block) => block.kind === "table").length,
    calloutCount: allBlocks.filter((block) => block.kind === "callout").length,
    headingTree,
    warnings: parsed.warnings,
    fatalErrors: parsed.fatalErrors,
    provenance: parsed.document.sourceRevision
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      { error: error instanceof Error ? error.message : "Parsed document inspect failed." },
      null,
      2
    )
  );
  process.exitCode = 1;
});

