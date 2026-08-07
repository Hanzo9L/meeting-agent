function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function segmentToPattern(segment: string): string {
  let pattern = "";
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i] ?? "";
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    pattern += escapeRegex(char);
  }
  return pattern;
}

function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  let regex = "^";
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    const isLast = i === parts.length - 1;
    if (part === "**") {
      regex += isLast ? ".*" : "(?:[^/]+/)*";
      continue;
    }
    regex += segmentToPattern(part);
    if (!isLast) regex += "/";
  }
  regex += "$";
  return new RegExp(regex);
}

function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegex(glob).test(path));
}

export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function isTrackEligiblePath(path: string, includeGlobs: string[], excludeGlobs: string[]): boolean {
  const normalized = normalizeRepoPath(path);
  if (!isMarkdownPath(normalized)) return false;
  if (!matchesAny(normalized, includeGlobs)) return false;
  if (excludeGlobs.length > 0 && matchesAny(normalized, excludeGlobs)) return false;
  return true;
}

