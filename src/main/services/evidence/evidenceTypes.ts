export interface EvidenceRoute {
  confidence: string;
  service: string | null;
  repo: string | null;
  reason: string;
}

export interface EvidenceParentResult {
  parentId: string;
  title: string;
  section: string;
  url: string;
  body: string;
  score: number;
  matchedBy: string[];
  repo?: string;
  publisher?: "Microsoft" | "AudioCodes" | "Linux";
  sourceRole?:
    | "microsoft_authority"
    | "vendor_implementation_reference"
    | "upstream_reference";
}

export interface EvidenceTiming {
  embed_ms?: number;
  vector_ms?: number;
  lexical_ms?: number;
  fuse_ms?: number;
  fetch_ms?: number;
  rerank_ms?: number;
  total_ms?: number;
  fts_query?: string;
  [key: string]: unknown;
}

export interface EvidenceSearchSuccess {
  ok: true;
  query: string;
  route: EvidenceRoute;
  results: EvidenceParentResult[];
  timing: EvidenceTiming;
  topK: number;
  corpusFingerprint: string;
  indexFingerprint: string;
  engine: string;
}

export interface EvidenceSearchFailure {
  ok: false;
  code: string;
  message: string;
}

export type EvidenceSearchResult = EvidenceSearchSuccess | EvidenceSearchFailure;

export interface EvidenceSearchClient {
  search(query: string): Promise<EvidenceSearchResult>;
}
