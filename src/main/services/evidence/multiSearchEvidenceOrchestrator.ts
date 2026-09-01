import { deriveEvidenceProvenance } from "@shared/evidenceCard";
import type { QuestionFacet } from "../questionUnderstandingPort";
import type {
  EvidenceParentResult,
  EvidenceSearchClient,
  EvidenceSearchFailure,
  EvidenceSearchResult,
  EvidenceSearchSuccess
} from "./evidenceTypes";

const MAX_RETRIEVAL_QUERIES = 4;
const MAX_AGGREGATED_RESULTS = 5;

export interface FacetEvidenceSource {
  evidenceId: string;
  parentId: string;
  title: string;
  section: string;
  publisher: string;
}

export interface FacetCoverage {
  facetId: string;
  label: string;
  query: string;
  covered: boolean;
  evidenceIds: string[];
  sources: FacetEvidenceSource[];
}

export interface BoundEvidence {
  evidenceId: string;
  facetIds: string[];
  hit: EvidenceParentResult;
  publisher: string;
  sourceRole: string;
}

export interface MultiSearchEvidenceSuccess {
  ok: true;
  result: EvidenceSearchSuccess;
  facets: QuestionFacet[];
  facetCoverage: FacetCoverage[];
  evidence: BoundEvidence[];
}

export interface MultiSearchEvidenceFailure {
  ok: false;
  failure: EvidenceSearchFailure;
}

export type MultiSearchEvidenceResult =
  | MultiSearchEvidenceSuccess
  | MultiSearchEvidenceFailure;

interface PlannedSearch {
  facet: QuestionFacet;
  result: EvidenceSearchResult;
}

interface SelectedHit {
  hit: EvidenceParentResult;
  facetIds: Set<string>;
}

function normalizedUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/g, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function searchesShareSnapshot(
  searches: EvidenceSearchSuccess[]
): boolean {
  const first = searches[0];
  return Boolean(
    first &&
    searches.every(
      (search) =>
        search.engine === first.engine &&
        search.corpusFingerprint === first.corpusFingerprint &&
        search.indexFingerprint === first.indexFingerprint
    )
  );
}

function fallbackFacet(question: string): QuestionFacet {
  return {
    id: "facet-1",
    label: "Complete question",
    query: question
  };
}

export class MultiSearchEvidenceOrchestrator {
  constructor(private readonly search: EvidenceSearchClient) {}

  async execute(params: {
    question: string;
    facets?: QuestionFacet[];
  }): Promise<MultiSearchEvidenceResult> {
    const facets = (params.facets ?? [])
      .map((facet) => ({ ...facet, query: facet.query.trim() }))
      .filter((facet) => facet.query)
      .slice(0, MAX_RETRIEVAL_QUERIES);
    if (facets.length === 0) facets.push(fallbackFacet(params.question));

    const planned: PlannedSearch[] = await Promise.all(
      facets.map(async (facet) => {
        try {
          return {
            facet,
            result: await this.search.search(facet.query)
          };
        } catch (error) {
          return {
            facet,
            result: {
              ok: false,
              code: "evidence_search_threw",
              message:
                error instanceof Error
                  ? error.message
                  : "Evidence search failed."
            }
          };
        }
      })
    );
    const successful = planned.filter(
      (entry): entry is PlannedSearch & {
        result: EvidenceSearchSuccess;
      } => entry.result.ok
    );
    if (successful.length === 0) {
      return {
        ok: false,
        failure: (planned[0]?.result as EvidenceSearchFailure | undefined) ?? {
          ok: false,
          code: "empty_plan",
          message: "Microsoft evidence retrieval is unavailable."
        }
      };
    }
    if (!searchesShareSnapshot(successful.map((entry) => entry.result))) {
      return {
        ok: false,
        failure: {
          ok: false,
          code: "evidence_snapshot_mismatch",
          message:
            "Evidence searches returned incompatible corpus snapshots."
        }
      };
    }

    const selected: SelectedHit[] = [];
    const selectedByParent = new Map<string, number>();
    const selectedByUrl = new Map<string, number>();
    const maximumDepth = Math.max(
      ...successful.map((entry) => entry.result.results.length)
    );
    for (let rank = 0; rank < maximumDepth; rank += 1) {
      for (const entry of successful) {
        const hit = entry.result.results[rank];
        if (!hit) continue;
        const existingIndex =
          selectedByParent.get(hit.parentId) ??
          selectedByUrl.get(normalizedUrlKey(hit.url));
        if (existingIndex !== undefined) {
          const existing = selected[existingIndex];
          if (existing) {
            existing.facetIds.add(entry.facet.id);
            existing.hit.matchedBy = Array.from(
              new Set([...existing.hit.matchedBy, ...hit.matchedBy])
            );
          }
          continue;
        }
        if (selected.length >= MAX_AGGREGATED_RESULTS) continue;
        const index = selected.length;
        selectedByParent.set(hit.parentId, index);
        selectedByUrl.set(normalizedUrlKey(hit.url), index);
        selected.push({
          hit: { ...hit, matchedBy: [...hit.matchedBy] },
          facetIds: new Set([entry.facet.id])
        });
      }
    }

    const evidence: BoundEvidence[] = selected.map((item, index) => {
      const provenance = deriveEvidenceProvenance(item.hit);
      return {
        evidenceId: `E${index + 1}`,
        facetIds: [...item.facetIds],
        hit: item.hit,
        publisher: provenance.publisher,
        sourceRole: provenance.sourceRole
      };
    });
    const evidenceByFacet = new Map<string, BoundEvidence[]>();
    for (const item of evidence) {
      for (const facetId of item.facetIds) {
        const current = evidenceByFacet.get(facetId) ?? [];
        current.push(item);
        evidenceByFacet.set(facetId, current);
      }
    }
    const facetCoverage: FacetCoverage[] = facets.map((facet) => {
      const matches = evidenceByFacet.get(facet.id) ?? [];
      return {
        facetId: facet.id,
        label: facet.label,
        query: facet.query,
        covered: matches.length > 0,
        evidenceIds: matches.map((item) => item.evidenceId),
        sources: matches.map((item) => ({
          evidenceId: item.evidenceId,
          parentId: item.hit.parentId,
          title: item.hit.title,
          section: item.hit.section,
          publisher: item.publisher
        }))
      };
    });
    const first = successful[0]!.result;
    const result: EvidenceSearchSuccess = {
      ok: true,
      query: params.question,
      route:
        successful.length === 1
          ? first.route
          : {
              ...first.route,
              reason: `semantic_compound_plan:${successful.length}`
            },
      results: evidence.map((item) => item.hit),
      timing: {
        total_ms: Math.max(
          ...successful.map(
            (entry) => entry.result.timing.total_ms ?? 0
          )
        ),
        facet_count: successful.length
      },
      topK: MAX_AGGREGATED_RESULTS,
      engine: first.engine,
      corpusFingerprint: first.corpusFingerprint,
      indexFingerprint: first.indexFingerprint
    };
    return {
      ok: true,
      result,
      facets,
      facetCoverage,
      evidence
    };
  }
}
