import { createHash } from "node:crypto";
import type {
  AnswerPlan,
  EvidenceBundle,
  GroundingDecisionBoundaryIssue,
  GroundingDecisionBoundaryValidation,
  GroundingDecisionSnapshot,
  GroundingDecisionSnapshotBinding,
  GroundingResolverPolicyVersion,
  GroundingSnapshotSchemaVersion
} from "./types";

export const GROUNDING_SNAPSHOT_SCHEMA_VERSION: GroundingSnapshotSchemaVersion =
  "grounding-decision-snapshot/v1";
export const GROUNDING_RESOLVER_POLICY_VERSION: GroundingResolverPolicyVersion =
  "proposition-aware-evidence-policy/r2.2";

export type EvidenceBundleDecisionState = Omit<EvidenceBundle, "decisionSnapshot">;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function sourceRevisionInputs(bundle: EvidenceBundleDecisionState): Array<Record<string, unknown>> {
  return bundle.evidence
    .map((evidence) => ({
      sourceId: evidence.source.sourceId,
      trackId: evidence.source.trackId,
      documentId: evidence.documentId,
      chunkId: evidence.chunkId,
      sourcePath: evidence.source.sourcePath,
      sourceRevision: evidence.source.sourceRevision
    }))
    .sort((left, right) =>
      `${left.sourceId}:${left.trackId}:${left.documentId}:${left.chunkId}`.localeCompare(
        `${right.sourceId}:${right.trackId}:${right.documentId}:${right.chunkId}`
      )
    );
}

function evidenceInputs(bundle: EvidenceBundleDecisionState): Array<Record<string, unknown>> {
  return bundle.evidence.map((evidence) => ({
    evidenceId: evidence.evidenceId,
    chunkId: evidence.chunkId,
    documentId: evidence.documentId,
    source: evidence.source,
    location: evidence.location,
    text: evidence.text,
    supportTypes: evidence.supportTypes,
    retrieval: evidence.retrieval,
    selectionReason: evidence.selectionReason
  }));
}

export function createGroundingDecisionSnapshot(
  bundle: EvidenceBundleDecisionState,
  createdAt = new Date().toISOString()
): GroundingDecisionSnapshot {
  const questionHash = hash(bundle.question);
  const intentHash = hash(bundle.intent);
  const scopeHash = hash(bundle.scope);
  const evidenceSetHash = hash(evidenceInputs(bundle));
  const revisions = sourceRevisionInputs(bundle);
  const corpusRevisionHash = hash(revisions);
  const snapshotHash = hash({
    schemaVersion: GROUNDING_SNAPSHOT_SCHEMA_VERSION,
    resolverPolicyVersion: GROUNDING_RESOLVER_POLICY_VERSION,
    questionHash,
    intentHash,
    scopeHash,
    evidenceSetHash,
    corpusRevisionHash,
    rejectedCandidates: bundle.rejectedCandidates,
    conflicts: bundle.conflicts,
    freshness: bundle.freshness,
    exactIdentifierValidation: bundle.exactIdentifierValidation,
    aspectCoverage: bundle.aspectCoverage,
    authorityCoverage: bundle.authorityCoverage,
    answerability: bundle.answerability
  });

  return Object.freeze({
    snapshotId: `grounding:${snapshotHash.slice(0, 24)}`,
    snapshotHash,
    schemaVersion: GROUNDING_SNAPSHOT_SCHEMA_VERSION,
    resolverPolicyVersion: GROUNDING_RESOLVER_POLICY_VERSION,
    corpusRevisionHash,
    createdAt,
    questionHash,
    intentHash,
    scopeHash,
    evidenceSetHash,
    sourceRevisionCount: revisions.length
  });
}

export function bindEvidenceBundleSnapshot(
  bundle: EvidenceBundleDecisionState,
  createdAt?: string
): EvidenceBundle {
  return {
    ...bundle,
    decisionSnapshot: createGroundingDecisionSnapshot(bundle, createdAt)
  };
}

export function snapshotBinding(
  snapshot: GroundingDecisionSnapshot
): GroundingDecisionSnapshotBinding {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
    schemaVersion: snapshot.schemaVersion,
    resolverPolicyVersion: snapshot.resolverPolicyVersion,
    corpusRevisionHash: snapshot.corpusRevisionHash
  };
}

function currentDecisionState(bundle: EvidenceBundle): EvidenceBundleDecisionState {
  const { decisionSnapshot: _snapshot, ...decisionState } = bundle;
  return decisionState;
}

export function validateGroundingDecisionBoundary(params: {
  bundle: EvidenceBundle;
  plan: AnswerPlan;
}): GroundingDecisionBoundaryValidation {
  const issues: GroundingDecisionBoundaryIssue[] = [];
  const stored = params.bundle.decisionSnapshot;
  const recomputed = createGroundingDecisionSnapshot(
    currentDecisionState(params.bundle),
    stored.createdAt
  );
  const binding = params.plan.snapshotBinding;

  if (stored.snapshotHash !== recomputed.snapshotHash) {
    issues.push({
      code: "bundle_snapshot_hash_mismatch",
      message: "EvidenceBundle decision content no longer matches its snapshot hash."
    });
  }
  if (stored.snapshotId !== recomputed.snapshotId) {
    issues.push({
      code: "bundle_snapshot_id_mismatch",
      message: "EvidenceBundle decision content no longer matches its snapshot identity."
    });
  }
  if (binding.snapshotId !== stored.snapshotId) {
    issues.push({
      code: "plan_snapshot_id_mismatch",
      message: "AnswerPlan and EvidenceBundle reference different grounding snapshots."
    });
  }
  if (binding.snapshotHash !== stored.snapshotHash) {
    issues.push({
      code: "plan_snapshot_hash_mismatch",
      message: "AnswerPlan and EvidenceBundle carry different snapshot hashes."
    });
  }
  if (
    binding.schemaVersion !== stored.schemaVersion ||
    stored.schemaVersion !== GROUNDING_SNAPSHOT_SCHEMA_VERSION
  ) {
    issues.push({
      code: "snapshot_schema_version_mismatch",
      message: "Grounding snapshot schema versions do not match the active schema."
    });
  }
  if (
    binding.resolverPolicyVersion !== stored.resolverPolicyVersion ||
    stored.resolverPolicyVersion !== GROUNDING_RESOLVER_POLICY_VERSION
  ) {
    issues.push({
      code: "resolver_policy_version_mismatch",
      message: "Grounding resolver policy versions do not match the active policy."
    });
  }
  if (
    binding.corpusRevisionHash !== stored.corpusRevisionHash ||
    stored.corpusRevisionHash !== recomputed.corpusRevisionHash
  ) {
    issues.push({
      code: "corpus_revision_mismatch",
      message: "AnswerPlan and EvidenceBundle do not share the same corpus revision."
    });
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
