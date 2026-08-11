/**
 * Shared R2/R3 operation-matching semantics.
 * A required operation facet must never be vacuously true when operation is null.
 */

export const OPERATION_ALIASES: Record<string, string[]> = {
  assign: ["assign", "grant", "apply"],
  grant: ["grant", "assign", "apply"],
  remove: ["remove", "unassign", "clear", "delete"],
  get: ["get", "view", "retrieve", "list", "show", "check"],
  set: ["set", "configure", "update", "change"],
  configure: ["configure", "set", "update", "change"],
  create: ["create", "add", "new"],
  new: ["new", "create", "add"],
  enable: ["enable", "allow", "turn on"],
  disable: ["disable", "block", "turn off"],
  troubleshoot: ["troubleshoot", "diagnose", "resolve", "fix"],
  test: ["test", "validate", "diagnose", "troubleshoot"]
};

export function normalizeOperationText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeOperationText(value).split(" ").filter(Boolean);
}

/**
 * Returns true only when a concrete operation is present in text via aliases.
 * Null/empty operation never matches (no vacuous coverage).
 */
export function operationMatchesText(
  text: string,
  operation: string | null | undefined
): boolean {
  if (!operation) return false;
  const normalized = normalizeOperationText(text);
  if (!normalized) return false;
  const aliases = OPERATION_ALIASES[operation] ?? [operation];
  return aliases.some((alias) => {
    const normalizedAlias = normalizeOperationText(alias);
    if (!normalizedAlias) return false;
    if (normalized.includes(normalizedAlias)) return true;
    const aliasStem = normalizedAlias.replace(/e$/, "");
    return tokens(normalized).some(
      (term) => aliasStem.length >= 4 && term.startsWith(aliasStem)
    );
  });
}
