import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { KnowledgeChunk } from "./types";

const SKIP_PATH_SEGMENTS = new Set(["archive", "assets", "includes", ".git"]);
const MAX_CHUNK_LENGTH = 1200;

type ParsedDoc = {
  title: string;
  description: string;
  msTopic: string;
  body: string;
};

function parseFrontmatter(markdown: string): ParsedDoc {
  if (!markdown.startsWith("---\n")) {
    return {
      title: "",
      description: "",
      msTopic: "",
      body: markdown
    };
  }

  const endMarker = "\n---\n";
  const end = markdown.indexOf(endMarker, 4);
  if (end === -1) {
    return {
      title: "",
      description: "",
      msTopic: "",
      body: markdown
    };
  }

  const frontmatter = markdown.slice(4, end);
  const body = markdown.slice(end + endMarker.length);
  const fields = new Map<string, string>();

  for (const line of frontmatter.split("\n")) {
    const match = /^([A-Za-z0-9._-]+)\s*:\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1]?.toLowerCase() ?? "";
    let value = match[2] ?? "";
    value = value.replace(/^['"]|['"]$/g, "");
    fields.set(key, value);
  }

  return {
    title: fields.get("title") ?? "",
    description: fields.get("description") ?? "",
    msTopic: fields.get("ms.topic") ?? "",
    body
  };
}

function normalizeText(input: string): string {
  return input
    .replace(/`{3}[\s\S]*?`{3}/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_\-|:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSections(markdownBody: string): Array<{ heading: string; text: string }> {
  const lines = markdownBody.split("\n");
  const sections: Array<{ heading: string; text: string }> = [];
  let heading = "";
  let buffer: string[] = [];

  const flush = (): void => {
    const text = normalizeText(buffer.join("\n"));
    if (text) sections.push({ heading, text });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,2})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      flush();
      heading = headingMatch[2]?.trim() ?? "";
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections;
}

function chunkSectionText(sectionText: string): string[] {
  if (sectionText.length <= MAX_CHUNK_LENGTH) return [sectionText];
  const words = sectionText.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= MAX_CHUNK_LENGTH) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = word;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function collectMarkdownFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = `${currentDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_PATH_SEGMENTS.has(entry.name.toLowerCase())) continue;
      files.push(...(await collectMarkdownFiles(rootDir, absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

export async function buildKnowledgeChunks(rootDir: string): Promise<{
  chunks: KnowledgeChunk[];
  docCount: number;
}> {
  const files = await collectMarkdownFiles(rootDir);
  const chunks: KnowledgeChunk[] = [];
  let chunkIndex = 0;

  for (const filePath of files) {
    const markdown = await readFile(filePath, "utf8");
    const parsed = parseFrontmatter(markdown);
    const sections = splitSections(parsed.body);
    const relPath = relative(rootDir, filePath).replace(/\\/g, "/");

    for (const section of sections) {
      const sectionChunks = chunkSectionText(section.text);
      for (const text of sectionChunks) {
        const id = `${relPath}#${chunkIndex}`;
        chunkIndex += 1;
        const searchText = `${parsed.title} ${parsed.description} ${parsed.msTopic} ${relPath} ${section.heading} ${text}`
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

        chunks.push({
          id,
          path: relPath,
          title: parsed.title || relPath,
          description: parsed.description,
          msTopic: parsed.msTopic,
          heading: section.heading,
          text,
          searchText
        });
      }
    }
  }

  return { chunks, docCount: files.length };
}

