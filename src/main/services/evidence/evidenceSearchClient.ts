import {
  deriveEvidenceProvenance,
  isAuthoritativeEvidenceUrl
} from "@shared/evidenceCard";
import { LearnRagChild, LearnRagChildError } from "./learnRagChild";
import type {
  EvidenceParentResult,
  EvidenceRoute,
  EvidenceSearchClient,
  EvidenceSearchResult,
  EvidenceTiming
} from "./evidenceTypes";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRoute(value: unknown): EvidenceRoute | null {
  const route = asRecord(value);
  if (!route) return null;
  const confidence = asString(route["confidence"]);
  const reason = asString(route["reason"]);
  if (!confidence || reason == null) return null;
  const service = route["service"];
  const repo = route["repo"];
  if (service !== null && typeof service !== "string") return null;
  if (repo !== null && typeof repo !== "string") return null;
  return {
    confidence,
    service,
    repo,
    reason
  };
}

function parseResult(value: unknown): EvidenceParentResult | null {
  const row = asRecord(value);
  if (!row) return null;
  const parentId = asString(row["parentId"]);
  const title = asString(row["title"]);
  const section = asString(row["section"]);
  const url = asString(row["url"]);
  const body = asString(row["body"]);
  const score = asNumber(row["score"]);
  const matchedBy = row["matchedBy"];
  if (
    !parentId ||
    title == null ||
    section == null ||
    !url ||
    body == null ||
    score == null ||
    !Array.isArray(matchedBy) ||
    matchedBy.some((item) => typeof item !== "string")
  ) {
    return null;
  }
  if (!isAuthoritativeEvidenceUrl(url)) return null;
  const provenance = deriveEvidenceProvenance({
    url,
    repo: asString(row["repo"]),
    publisher: asString(row["publisher"]),
    sourceRole: asString(row["sourceRole"]),
    msService: asString(row["msService"]) ?? asString(row["ms_service"]),
    msCollection:
      asString(row["msCollection"]) ?? asString(row["ms_collection"])
  });
  return {
    parentId,
    title,
    section,
    url,
    body,
    score,
    matchedBy: matchedBy as string[],
    repo: provenance.repo,
    publisher: provenance.publisher,
    sourceRole: provenance.sourceRole
  };
}

export function parseEvidenceBridgeResponse(
  payload: Record<string, unknown>,
  fallback: {
    engine: string;
    corpusFingerprint: string;
    indexFingerprint: string;
  }
): EvidenceSearchResult {
  if (payload["ok"] === false) {
    const error = asRecord(payload["error"]);
    return {
      ok: false,
      code: asString(error?.["code"]) ?? "search_failed",
      message:
        asString(error?.["message"]) ??
        "Microsoft evidence retrieval failed."
    };
  }
  if (payload["ok"] !== true) {
    return {
      ok: false,
      code: "invalid_response",
      message: "Microsoft evidence retrieval returned an invalid response."
    };
  }
  const query = asString(payload["query"]);
  const route = parseRoute(payload["route"]);
  const resultsRaw = payload["results"];
  const timing = asRecord(payload["timing"]) ?? {};
  const topK = asNumber(payload["topK"]);
  if (!query || !route || !Array.isArray(resultsRaw) || topK !== 5) {
    return {
      ok: false,
      code: "invalid_response",
      message: "Microsoft evidence retrieval returned an invalid response."
    };
  }
  if (resultsRaw.length > 5) {
    return {
      ok: false,
      code: "invalid_response",
      message: "Microsoft evidence retrieval returned an invalid response."
    };
  }
  const results: EvidenceParentResult[] = [];
  for (const row of resultsRaw) {
    const parsed = parseResult(row);
    if (!parsed) {
      return {
        ok: false,
        code: "invalid_response",
        message: "Microsoft evidence retrieval returned an invalid source."
      };
    }
    results.push(parsed);
  }
  return {
    ok: true,
    query,
    route,
    results,
    timing: timing as EvidenceTiming,
    topK,
    engine: fallback.engine,
    corpusFingerprint: fallback.corpusFingerprint,
    indexFingerprint: fallback.indexFingerprint
  };
}

export function createEvidenceSearchClient(
  child: LearnRagChild
): EvidenceSearchClient {
  return {
    async search(query: string): Promise<EvidenceSearchResult> {
      try {
        const payload = await child.request({ query });
        const ready = child.getReadyInfo();
        return parseEvidenceBridgeResponse(payload, {
          engine: ready?.engine ?? "learn-rag-r0.4",
          corpusFingerprint: ready?.corpusFingerprint ?? "",
          indexFingerprint: ready?.indexFingerprint ?? ""
        });
      } catch (error) {
        if (error instanceof LearnRagChildError) {
          return {
            ok: false,
            code: error.code,
            message: error.message
          };
        }
        return {
          ok: false,
          code: "search_failed",
          message: "Microsoft evidence retrieval failed."
        };
      }
    }
  };
}
