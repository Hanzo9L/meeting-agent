# CG-01 — Real Corpus Chunking and Index Population

Status: Planning Gap (implementation-plan omission, not architecture contradiction)

## Why this exists

WB-17 side-by-side evaluation correctly reported a fixture/empty V2 corpus (`documents=0`, `chunks=0`, `embeddings=0`), which blocks meaningful V2 retrieval-quality evaluation.

The approved architecture already expects:

- canonical document parsing
- semantic chunking
- FTS5 population
- embedding generation/reuse
- incremental refresh

However, the current approved WB sequence does not contain a single explicit work item that owns end-to-end population of a real searchable corpus from acquired canonical documents.

## Coverage check against existing approved work

- WB-06: source acquisition adapters (partial coverage)
- WB-07: canonical parser (partial coverage)
- WB-08: schema/store capability including chunk tables + FTS table (partial coverage)
- WB-09: embedding provider + persistence abstraction (partial coverage)
- WB-10: re-embedding refresh planner (partial coverage)

Missing explicit ownership in approved WB:

1. semantic chunk generation from canonical `KnowledgeDocument`
2. deterministic persistence of real `knowledge_chunks` for acquired docs
3. deterministic `knowledge_chunk_fts` population driven by chunk lifecycle
4. embedding-input construction policy for real chunks
5. first-run embedding generation + compatibility reuse in indexing workflow
6. incremental orchestration that executes acquire -> parse -> persist -> chunk -> FTS -> embedding with idempotent reruns

## Required capability (scope for CG-01)

For initial real corpus only:

- Sources: `ms-teams-admin`, `ms-teams-powershell`
- Reuse existing components (no parallel stack)
- No EvidenceBundle/answering/cutover work
- No retrieval tuning

Pipeline target:

`acquire -> parse -> save document -> semantic chunk -> persist chunks -> FTS update -> embedding reuse/generate -> indexing report`

## Proposed implementation-sized tasks (for planning and approval)

1. **Semantic Chunker Module**
   - Input: canonical parsed sections/blocks from WB-07
   - Output: deterministic `KnowledgeChunk` units with boundary rules and chunker versioning
   - Includes PowerShell-specific chunk decomposition (Synopsis/Syntax/Examples/Parameters)

2. **Chunk Persistence Writer**
   - Persist generated chunks (replace/update by document + chunk identity)
   - Maintain tombstones/invalidation for removed chunks
   - Preserve source order, heading path, section identity, metadata inheritance

3. **FTS Lifecycle Integration**
   - Ensure `knowledge_chunk_fts` rows are created/updated/deleted from real chunk lifecycle
   - No secondary text corpus

4. **Index Population Orchestrator**
   - Dev/job path for: acquire, parse, canonical persist, chunk persist, FTS sync, embedding refresh
   - Supports cancellation, batched embedding work, per-document failure isolation, progress diagnostics

5. **Incremental Refresh Verification**
   - First run / unchanged rerun / changed-doc behavior tests
   - Validate no unnecessary reparse/rechunk/re-embedding

6. **Teams Admin Discovery Strategy Definition**
   - Deterministic Learn MCP discovery/seed strategy for initial scope
   - Explicitly labeled completeness expectations (`limited_real` acceptable)

## Dependency ordering correction

Meaningful WB-17 retrieval-quality evaluation requires CG-01 completion first.

Corrected order for quality evaluation readiness:

- WB-06 -> WB-07 -> WB-08 -> WB-09 -> WB-10 -> **CG-01** -> WB-17 (quality-meaningful rerun)

WB-17 harness validation remains complete; WB-17 quality conclusions remain blocked until CG-01.

## Architecture impact

No architecture change required.

- Aligns with AD-03/AD-04/AD-09 and KNOWLEDGE_MODEL semantic chunk contract
- This is a planning omission, not an Architecture Exception

## Corpus classification expectation after CG-01

Initial output is expected to be `limited_real`, not necessarily `real`, due Teams Admin Learn MCP discovery breadth constraints.
