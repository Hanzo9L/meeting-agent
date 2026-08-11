import type {
  EvidenceAspect,
  EvidenceItem,
  EvidenceMethodConstraint
} from "./types";

const CMDLET_PATTERN = /\b[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+\b/;

export function evidenceSatisfiesMethodConstraint(
  evidence: EvidenceItem,
  constraint: EvidenceMethodConstraint
): boolean {
  const hasRole = constraint.authorityRoles.some((role) =>
    evidence.source.authorityRoles.includes(role)
  );
  const hasDomain = constraint.domains.includes(
    evidence.source.sourceDomain as (typeof constraint.domains)[number]
  );

  if (constraint.kind === "powershell" || constraint.kind === "pnp_powershell") {
    // Admin-only material quoting a command does not satisfy a PowerShell method.
    // Exact command assertions require PowerShell authority/domain.
    return (hasRole || hasDomain) && CMDLET_PATTERN.test(evidence.text);
  }
  if (constraint.kind === "graph") {
    return hasRole || hasDomain;
  }
  if (constraint.kind === "teams_admin_center") {
    return (
      hasDomain ||
      hasRole ||
      /\badmin\s+center\b/i.test(evidence.text) ||
      /\badmin\s+center\b/i.test(evidence.source.title)
    );
  }
  return hasRole || hasDomain;
}

export function aspectMethodConstraintsSatisfied(
  aspect: EvidenceAspect,
  evidenceItems: EvidenceItem[]
): boolean {
  const required = aspect.methodConstraints.filter(
    (constraint) => constraint.required
  );
  if (required.length === 0) return true;
  return required.every((constraint) =>
    evidenceItems.some((evidence) =>
      evidenceSatisfiesMethodConstraint(evidence, constraint)
    )
  );
}

export function methodGapsForBundle(params: {
  aspects: EvidenceAspect[];
  supportedMandatoryAspectIds: string[];
  evidenceByAspect: Record<string, string[]>;
  evidence: EvidenceItem[];
}): EvidenceAspect[] {
  const evidenceById = new Map(
    params.evidence.map((item) => [item.evidenceId, item])
  );
  return params.aspects.filter((aspect) => {
    if (aspect.requirement !== "mandatory") return false;
    if (!params.supportedMandatoryAspectIds.includes(aspect.aspectId)) {
      return false;
    }
    const evidenceIds = params.evidenceByAspect[aspect.aspectId] ?? [];
    const items = evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is EvidenceItem => Boolean(item));
    return !aspectMethodConstraintsSatisfied(aspect, items);
  });
}
