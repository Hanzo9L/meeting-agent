import { createHash } from "node:crypto";
import {
  EVIDENCE_CARD_KIND,
  EVIDENCE_RESOLVER_POLICY,
  EVIDENCE_SNAPSHOT_SCHEMA,
  buildPersonalResponseBlock,
  deriveEvidenceProvenance,
  encodeEvidenceCardContent,
  evidenceCitationAuthority,
  excerptParentBody,
  isPersonalResponseMode,
  listEvidenceCardSources,
  type EvidenceCardPayload,
  type EvidenceCardSource,
  type EvidenceSynthesisDiagnostic,
  type InterviewAnswerPayload,
  type LiveAnswerFallback,
  type PersonalResponseBlock,
  type ResponseMode
} from "@shared/evidenceCard";
import type { AnswerExecutionCitation } from "../conversations/answerExecutionPort";
import type { ContextReference } from "../answerV2/explanationContextTypes";
import type {
  EvidenceParentResult,
  EvidenceSearchSuccess
} from "./evidenceTypes";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toCardSource(
  hit: EvidenceParentResult,
  retrievalRank: number
): EvidenceCardSource {
  return {
    ...hit,
    ...deriveEvidenceProvenance(hit),
    preview: excerptParentBody(hit.body),
    retrievalRank
  };
}

export function buildEvidenceCardPayload(
  result: EvidenceSearchSuccess,
  presentation?: {
    responseMode?: ResponseMode;
    personal?: PersonalResponseBlock | null;
    interviewAnswer?: InterviewAnswerPayload | null;
    synthesis?: EvidenceSynthesisDiagnostic;
    liveFallback?: LiveAnswerFallback | null;
  }
): EvidenceCardPayload {
  const [primaryHit, ...rest] = result.results;
  const responseMode = presentation?.responseMode ?? "technical_evidence";
  const personal = isPersonalResponseMode(responseMode)
    ? presentation?.personal ?? buildPersonalResponseBlock(null)
    : null;
  return {
    version: 1,
    kind: EVIDENCE_CARD_KIND,
    query: result.query,
    route: result.route,
    primary: primaryHit ? toCardSource(primaryHit, 1) : null,
    additional: rest.map((hit, index) => toCardSource(hit, index + 2)),
    responseMode,
    personal,
    interviewAnswer: presentation?.interviewAnswer ?? null,
    synthesis: presentation?.synthesis,
    liveFallback: presentation?.liveFallback ?? null
  };
}

export function buildEvidenceSnapshot(params: {
  result: EvidenceSearchSuccess;
  createdAt: string;
}): {
  snapshotId: string;
  snapshotHash: string;
  schemaVersion: string;
  resolverPolicyVersion: string;
  corpusRevisionHash: string;
  createdAt: string;
} {
  const parentIds = params.result.results.map((hit) => hit.parentId);
  const canonicalUrls = params.result.results.map((hit) => hit.url);
  const body = JSON.stringify({
    engine: params.result.engine,
    corpusFingerprint: params.result.corpusFingerprint,
    indexFingerprint: params.result.indexFingerprint,
    query: params.result.query,
    route: params.result.route,
    parentIds,
    canonicalUrls,
    retrievedAt: params.createdAt
  });
  const snapshotHash = sha256(body);
  return {
    snapshotId: `evidence:${snapshotHash.slice(0, 32)}`,
    snapshotHash,
    schemaVersion: EVIDENCE_SNAPSHOT_SCHEMA,
    resolverPolicyVersion: EVIDENCE_RESOLVER_POLICY,
    corpusRevisionHash: params.result.corpusFingerprint || "unknown",
    createdAt: params.createdAt
  };
}

export function mapEvidenceCitations(params: {
  visibleText: string;
  payload: EvidenceCardPayload;
}): AnswerExecutionCitation[] {
  const citations: AnswerExecutionCitation[] = [];
  let searchFrom = 0;
  for (const source of listEvidenceCardSources(params.payload)) {
    if (source.preview.length === 0) continue;
    const start = params.visibleText.indexOf(source.preview, searchFrom);
    if (start < 0) continue;
    searchFrom = start + source.preview.length;
    const authority = evidenceCitationAuthority(source);
    citations.push({
      citationId: `citation:${source.parentId}`,
      factualRangeId: `evidence-preview:${source.parentId}`,
      claimId: null,
      answerRange: {
        startOffset: start,
        endOffset: start + source.preview.length
      },
      evidenceId: source.parentId,
      spanId: source.parentId,
      supportingSpanIds: [],
      documentId: source.parentId,
      sourceTitle: source.title,
      canonicalUrl: source.url,
      sourceId: authority.sourceId,
      authorityRole: authority.authorityRole,
      headingPath: [source.title, source.section].filter(Boolean),
      sectionId: source.parentId,
      sourceStatus: authority.sourceStatus,
      preview: true
    });
  }
  return citations;
}

export function mapEvidenceContextReferences(
  payload: EvidenceCardPayload
): ContextReference[] {
  const sources = [
    ...(payload.primary ? [payload.primary] : []),
    ...payload.additional
  ];
  return sources.map((source, index) => {
    const end = Math.max(source.body.length, 1);
    const authority = evidenceCitationAuthority(source);
    return {
      contextBlockId: `evidence-parent:${source.parentId}`,
      evidenceId: source.parentId,
      documentId: source.parentId,
      chunkId: source.parentId,
      sourceTitle: source.title,
      canonicalUrl: source.url,
      sourceId: authority.sourceId,
      authorityRole: authority.authorityRole,
      headingPath: [source.title, source.section].filter(Boolean),
      sectionId: source.parentId,
      sourceStartOffset: 0,
      sourceEndOffset: end,
      sourceContentHash: sha256(source.body),
      contextType: "supporting_context",
      preview: index === 0 && payload.primary !== null
    };
  });
}

export function persistEvidenceCard(
  result: EvidenceSearchSuccess,
  presentation?: {
    responseMode?: ResponseMode;
    personal?: PersonalResponseBlock | null;
    interviewAnswer?: InterviewAnswerPayload | null;
    synthesis?: EvidenceSynthesisDiagnostic;
    liveFallback?: LiveAnswerFallback | null;
  }
): {
  content: string;
  payload: EvidenceCardPayload;
  snapshot: ReturnType<typeof buildEvidenceSnapshot>;
  citations: AnswerExecutionCitation[];
  contextReferences: ContextReference[];
} {
  const payload = buildEvidenceCardPayload(result, presentation);
  const content = encodeEvidenceCardContent(payload);
  const visibleText = content.slice(
    0,
    content.indexOf("\n\n\u0000RELAY_EVIDENCE_PAYLOAD\u0000\n")
  );
  const createdAt = new Date().toISOString();
  return {
    content,
    payload,
    snapshot: buildEvidenceSnapshot({ result, createdAt }),
    citations: mapEvidenceCitations({ visibleText, payload }),
    contextReferences: mapEvidenceContextReferences(payload)
  };
}
