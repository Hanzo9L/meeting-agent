# Gap Analysis: Current vs Future Microsoft AI Assistant

## Target direction being assessed

Future system concept requires:

- Authoritative multi-source Microsoft knowledge (Teams admin, Teams PowerShell, Graph, Entra, M365, Learn MCP)
- Structured markdown ingestion preserving metadata/frontmatter
- Semantic structure awareness
- Hybrid retrieval + reranking
- Domain-aware query routing
- Current-document verification
- Evidence-based answers with reliable citations
- Extensibility beyond Teams

## Capability gap matrix

| Current capability | Future requirement | Gap | Severity | Recommended disposition |
|---|---|---|---|---|
| Single KB source (`msteams-docs` developer platform subset) | Multi-domain authoritative source hierarchy | Missing most required domains (admin, Graph, Entra, PowerShell, M365) | Critical | REPLACE knowledge-source model |
| Sparse git sync + local markdown chunk cache | Source-specific ingestion pipelines with metadata normalization and provenance | No source adapters, no authority tiering, no provenance ledger | Critical | REBUILD ingestion layer |
| Frontmatter parsed (`title`, `description`, `ms.topic`) | Full metadata preservation + semantic doc structure | Partial metadata only, no section semantics beyond headers | High | REFACTOR parser/index schema |
| Lexical scoring retriever | Hybrid retrieval (lexical + semantic + rerank) | No embeddings, no vector retrieval, no reranker | Critical | REPLACE retrieval engine |
| Heuristic question detection | Domain/intent-aware query routing | No route classifier, no domain disambiguation | High | REPLACE router/gating logic |
| Prompt-grounded response from top chunks | Evidence-based answering with verification | No claim verification or contradiction checks | High | REFACTOR answer orchestration |
| Source links to GitHub paths | Reliable citations mapped to authoritative docs | Links are helpful but not confidence-scored nor authority-ranked | Medium | REFACTOR citation subsystem |
| Manual KB sync and static local cache | Freshness strategy + current-document verification | No staleness SLA, no per-answer freshness check | High | REFACTOR sync/validation |
| Local settings-based keys, no identity | Enterprise auth patterns and tenant-aware policy | No tenant identity, RBAC, delegated access, compliance hooks | High | REPLACE auth/governance layer for prod |
| In-memory conversation feed only | Durable conversation/context memory strategy | No persisted threads or retrieval-aware dialogue memory | Medium | REFACTOR conversation state layer |
| Main-process monolithic orchestration | Modular services with testable boundaries | Tight coupling limits scaling and correctness evolution | High | REFACTOR architecture boundaries |
| No MCP/tool use for Microsoft Learn | Learn MCP integration and tool-augmented retrieval | MCP not present in retrieval/runtime path | High | ADD tool integration layer |

## Knowledge architecture deep-dive

### Strengths

- Uses official markdown docs as a grounding source.
- Maintains local cache for low-latency lookup.
- Exposes source links to users.
- Keeps retrieval in main process for deterministic app-local behavior.

### Weaknesses

- Not authoritative for admin-heavy queries (source mismatch).
- Retrieval quality bounded by lexical overlap.
- No semantic similarity, no rerank, no recency weighting.
- No hybrid strategy across heterogeneous Microsoft sources.
- No confidence model and weak fallback semantics.
- No formal citation validation (path link only).
- No ingestion tests or quality gates.

## Product gaps beyond code

- **Trust model gap:** “Official docs grounding” is implied but not guaranteed across all Microsoft domains.
- **Scope expectation gap:** User asks broad admin questions, but current corpus is mostly developer platform docs.
- **Conversational continuity gap:** Improved recently, but still no robust thread memory model for long sessions.
- **Operational gap:** No instrumentation for answer quality, retrieval misses, hallucination rates, or latency budgets.

## Highest-risk architectural decisions to make next

1. **Authority hierarchy design**
   - How to rank/conflict-resolve sources across Teams admin, Graph, Entra, PowerShell, Learn.
2. **Retrieval architecture choice**
   - Hybrid retrieval stack (lexical, embedding model, vector store, reranker) and hosting model.
3. **Verification and citation contract**
   - Define what “evidence-based” means and when to refuse answering.
4. **Conversation memory strategy**
   - Decide what context persists, for how long, and how it impacts retrieval and safety.
5. **Runtime topology**
   - What remains in Electron local app vs what moves to a service layer for maintainability and scale.

