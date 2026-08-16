# Relay Current-State Verification

Verified on 2026-08-15 against the working tree, production imports/wiring, freshly executed tests, `.knowledge-v2/knowledge-v2.sqlite`, and fresh hosted-embedding retrieval runs. This document describes the observed state; it does not propose a redesign or a next slice.

## 1. Git state

### Repository identity and synchronization

- Branch: `cursor/msteams-docs-knowledge-base`
- HEAD: `eac5cb8d42bd77aac109de8d77b66af183cb48b1`
- HEAD subject: `select concept-distinct evidence for broad grounded answers`
- Upstream: `origin/cursor/msteams-docs-knowledge-base`
- Upstream comparison: `0 ahead / 0 behind`
- Remote: `https://github.com/Hanzo9L/meeting-agent.git`

### Working tree

The tree is not clean.

- 12 tracked files are modified: 10 production files and 2 existing tests.
- 204 paths are untracked.
- 9 untracked source/harness/test paths exist.
- 194 untracked paths are under `eval/runs/`.
- This report is the one untracked documentation path.

Tracked modifications:

- `src/main/services/answerV2/answerPlanner.ts`
- `src/main/services/answerV2/evidenceAspectPolicy.ts`
- `src/main/services/answerV2/evidenceBundleBuilder.test.ts`
- `src/main/services/answerV2/proceduralContractCorrection.test.ts`
- `src/main/services/answerV2/types.ts`
- `src/main/services/retrievalV2/domainPolicies.ts`
- `src/main/services/retrievalV2/exactMatchRetriever.ts`
- `src/main/services/retrievalV2/hybridFusionPolicy.ts`
- `src/main/services/retrievalV2/hybridRetriever.ts`
- `src/main/services/retrievalV2/implicitCmdletSignals.ts`
- `src/main/services/retrievalV2/index.ts`
- `src/main/services/retrievalV2/queryIntentRules.ts`

Untracked source/harness/test paths:

- `eval/harness/_relayCurrentStateFullPipeline.ts`
- `eval/harness/_relayCurrentStateMethodCheck.ts`
- `eval/harness/runV1Diagnostic.ts`
- `eval/harness/runV2FusionTrace.ts`
- `src/main/services/answerV2/v1WorkflowDecomposition.test.ts`
- `src/main/services/answerV2/v1_1PowerShellReadReporting.test.ts`
- `src/main/services/retrievalV2/v1PowerShellAnchoring.test.ts`
- `src/main/services/retrievalV2/v1_2WorkflowOutputFusionPreservation.test.ts`
- `src/main/services/retrievalV2/workflowOutputPreservation.ts`

The 194 untracked `eval/runs/` paths include acceptance traces, source/corpus checks, test logs, JSON/JSONL/Markdown validation output, and scratch diagnostic scripts. They are evidence artifacts, not committed product state.

### Slice commit membership

Commit membership was checked by changed-file inspection and targeted line blame, not by subjects alone.

| Slice | State | Verified basis |
| --- | --- | --- |
| QA Assist Slice 1 | COMMITTED | `014f44ea`; QA profile, capture guard, IPC/preload/renderer, migrations, and QA tests all blame to this commit. |
| unresolved-domain Slice 2 | COMMITTED | `014f44ea`; the second Exchange unresolved-domain fail-closed test and routing implementation blame to this commit. |
| Entra K1 | COMMITTED | `014f44ea`; Entra corpus job, source registry/domain routing, validation harness/dataset, and tests are in the commit. |
| GitHub canonical citation correction K1.1 | COMMITTED | `014f44ea`; Entra GitHub-to-Learn reconstruction and rejection tests/functions are in the commit. |
| P2 heading-operation corroboration | COMMITTED | `014f44ea`; P2 tests and planner changes blame to this commit. |
| SharePoint/Copilot K2 | COMMITTED | `d9bc8b2e`; domain, sources, corpus jobs, citation mapping, routing, and tests are in the commit. |
| U1 concept-distinct evidence selection | COMMITTED | HEAD `eac5cb8d`; concept-distinct selector, tests, harness, and evidence-bundle integration are in the commit. |
| V1 multi-output workflow decomposition | UNCOMMITTED | Present in modified answer/retrieval files plus untracked `v1WorkflowDecomposition.test.ts` and `v1PowerShellAnchoring.test.ts`. |
| V1.1 read/reporting state semantics | UNCOMMITTED | Present in modified `answerPlanner.ts`, `evidenceAspectPolicy.ts`, `types.ts`, query rules, and untracked `v1_1PowerShellReadReporting.test.ts`. |
| V1.2 workflow-output fusion preservation | UNCOMMITTED | `workflowOutputPreservation.ts` and its test are untracked; integration changes in `hybridRetriever.ts`, `index.ts`, and related retrieval files are modified. |

### Last 20 commits

1. `eac5cb8d` — 2026-08-14 20:26 -04:00 — select concept-distinct evidence for broad grounded answers
2. `d9bc8b2e` — 2026-08-14 17:55 -04:00 — feat: add SharePoint and Copilot governance knowledge domain
3. `014f44ea` — 2026-08-14 16:49 -04:00 — feat: QA Assist session profile, Entra domain activation, and procedural facet closure
4. `e33eef20` — 2026-08-10 21:41 -04:00 — fix: reconcile procedural method constraints and operation planning
5. `afaf0e19` — 2026-08-09 21:58 -04:00 — feat: add source-bound answer context and presentation profiles
6. `eb6bb44c` — 2026-08-09 15:06 -04:00 — fix: reject incomplete Live Assist question fragments before promotion
7. `7a55e7a7` — 2026-08-09 14:49 -04:00 — fix: deduplicate cross-source Live Assist utterances before promotion
8. `22aaf504` — 2026-08-09 12:40 -04:00 — fix: assemble Deepgram utterances before question promotion
9. `a57485ed` — 2026-08-09 12:04 -04:00 — feat: consolidate Relay into single-window application shell
10. `a98d0f7f` — 2026-08-09 11:44 -04:00 — feat: integrate live assist with Relay conversations
11. `5116fb2e` — 2026-08-09 10:29 -04:00 — feat: connect Relay helpdesk to grounded answer pipeline
12. `6d0a2f1a` — 2026-08-09 09:15 -04:00 — feat: add deterministic citation mapping and validation
13. `fd90a3e6` — 2026-08-09 08:38 -04:00 — feat: add deterministic extractive answer assembly
14. `541ffc13` — 2026-08-09 08:27 -04:00 — feat: add minimal source-bound answer planning
15. `3971aa04` — 2026-08-09 07:58 -04:00 — feat: add proposition-aware coverage-first evidence resolution
16. `f3ab63e9` — 2026-08-08 21:14 -04:00 — chore: ignore local knowledge-v2 database artifacts
17. `c266cf55` — 2026-08-08 21:08 -04:00 — feat: checkpoint R2/R2.1 proposition-aware evidence coverage
18. `88ad9c0f` — 2026-08-08 20:09 -04:00 — feat: add persistent helpdesk chat shell
19. `0d717f07` — 2026-08-08 19:52 -04:00 — feat: add grounding boundary and conversation persistence foundation
20. `dc79a5d1` — 2026-08-08 15:43 -04:00 — Checkpoint WB-18 through WB-20.2 grounding pipeline.

## 2. Current production architecture

### Typed / pasted Helpdesk

The reachable path is:

1. `src/renderer/helpdesk/App.tsx` — `submitMessage()` chooses `typed`/`pasted` and calls `window.helpdeskApi.submitMessage`.
2. `src/preload/helpdeskApi.ts` — `createHelpdeskApi().submitMessage()` invokes `IPC_CHANNELS.helpdeskSubmitMessage`.
3. `src/main/ipc/helpdeskIpc.ts` — the `helpdeskSubmitMessage` handler validates origin/content and calls `HelpdeskService.submitMessage`.
4. `src/main/services/conversations/helpdeskService.ts` — `submitTurn()` atomically persists the user message plus answer run, serializes execution, and calls the injected `AnswerExecutionPort`.
5. `src/main/index.ts` — `initializeRelay()` constructs `HelpdeskService(conversationStore, new GroundedAnswerExecutionPort())`; this is the reachable production adapter.
6. `src/main/services/conversations/answerExecutionPort.ts` — `GroundedAnswerExecutionPort.execute()` calls `runQuestionToEvidenceBundle`, `buildAnswerPlan`, `assembleDeterministicAnswer`, `mapAnswerCitations`, `buildExplanationContext`, and `presentGroundedAnswer`.
7. `src/main/services/answerV2/inspectEvidence.ts` — `runQuestionToEvidenceBundle()` resolves the live SQLite path, creates `HostedOpenAiEmbeddingProvider`, then executes:
   - `extractQueryIntent()` in `retrievalV2/queryIntentRules.ts`
   - `routeQueryIntent()` in `retrievalV2/domainPolicies.ts`
   - `retrieveHybridCandidates()` in `retrievalV2/hybridRetriever.ts`
   - `buildEvidenceBundle()` in `answerV2/evidenceBundleBuilder.ts`
8. `retrieveHybridCandidates()` runs exact, lexical, and semantic retrieval, deduplicates and scores fused candidates, applies `applyPostFusionCaps()`, then the uncommitted V1.2 `applyWorkflowOutputPreservation()`, retaining a fixed 24-candidate cap.
9. V1 workflow decomposition/read semantics are enforced while deriving R2 aspects in `evidenceAspectPolicy.ts`; V1.2 operates only at the fusion boundary.
10. R2 is the `EvidenceBundle`; R3 is `buildAnswerPlan()`; R4 is `assembleDeterministicAnswer()`. Citation mapping is WB-21 `mapAnswerCitations()`. Presentation is deterministic `presentGroundedAnswer()`.
11. `HelpdeskService.executeStartedTurn()` persists only successful validated assistant output/citations/context through the SQLite conversation store; failures persist the run failure and no factual assistant message.
12. IPC returns the refreshed conversation view; `App.tsx` renders it.

Persistence caveats verified after tracing the complete write boundary:

- WB-21 factual ranges are relative to `factualAnswerText`, but `HelpdeskService` persists `result.answerText` (the reformatted profile presentation) with those unchanged offsets. The store validates only numeric bounds, so ranges can be rejected or point at the wrong presented text.
- Distinct Explanation Context references are converted to citation records with range `0..0`. `SqliteConversationStore.appendGroundedAssistantMessage()` rejects every zero-length range (`end <= start`), so any non-deduplicated context reference makes the otherwise validated answer fail persistence.
- The durable record does not include the full R2 bundle, R3 plan/source spans, or R4 extractive provenance. It retains answer text, answerability, reduced citations, and snapshot identity/hash metadata.
- Production constructs `GroundedAnswerExecutionPort()` without a knowledge database path. Its resolver therefore uses `<process.cwd()>/.knowledge-v2/knowledge-v2.sqlite`, not Electron `userData`. The package manifest includes only `dist-electron`, renderer output, and `package.json`; it includes neither the populated database nor the source migration directory used by `runQuestionToEvidenceBundle()`. The audited live corpus is consequently a workspace corpus, not proven packaged-runtime corpus wiring.

### QA Assist

The reachable path is:

1. `App.tsx` exposes `Start QA Assist` and calls `helpdeskApi.startQaAssist`.
2. Main starts a `qa_assist` live session and `sourceModeForProfile()` forces `"system"` regardless of settings.
3. `startLoopbackCapture("system", ...)` in `renderer/audio-capture/captureLoopbackAudio.ts` creates only the system stream. Its loop chooses `requestSystemStream`; `requestMicrophoneStream()`/`getUserMedia()` is unreachable for this mode.
4. Main validates `startCapture`; QA requests containing `microphone` are rejected before `PipelineManager.start()`.
5. `PipelineManager` creates one `DeepgramSttProvider` for the system source. Audio chunks are streamed to Deepgram; `DeepgramUtteranceProcessor` assembles complete utterances.
6. Cross-source arbitration exists but system-only mode has no cross-source delay/competition.
7. `isCompleteEnoughForPromotion()` and `looksLikeQuestion()` gate promotion.
8. The accepted system question goes to `LiveAssistService.acceptQuestion()`, then `HelpdeskService.submitLiveQuestion()`, then the same `GroundedAnswerExecutionPort` with `live_assist_quick` presentation.
9. Projection/conversation events return the result to the Helpdesk renderer and optional overlay.

Confirmed contracts:

- System-only is forced in main, not inferred by renderer.
- No microphone `MediaStream` or microphone STT provider is constructed in the normal QA path.
- Main and `LiveAssistService` both reject microphone input defensively.
- `captureSource="system"`, `inputOrigin="live_transcript"`, QA profile, and session ID are persisted.
- Raw PCM is held/transmitted in memory and sent to Deepgram; no raw-audio database/file persistence path was found.
- Interim/final transcript UI events are ephemeral. Only an accepted question is promoted to a durable user message; there is no continuous transcript table/write.

## 3. Legacy / LLM reachability

- `src/main/services/openAiLlmProvider.ts` still contains a legacy `chat.completions.create()` path.
- `src/main/services/answerV2/openAiGroundedAnswerGenerator.ts` still contains claim-realization `chat.completions.create()`.
- `inspectGroundedAnswer.ts` can instantiate `OpenAiGroundedAnswerGenerator`, but it is an inspection/evaluation path.
- Neither class is imported by `src/main/index.ts`, `HelpdeskService`, `GroundedAnswerExecutionPort`, or the production R2/R3/R4 path.
- Production factual answers use hosted OpenAI only for the query embedding in semantic retrieval. That is retrieval, not answer generation.
- `GroundedAnswerExecutionPort` hard-codes `answerGenerationRequestCount: 0`; fresh R4 diagnostics also reported `requestCount: 0`.

Therefore, legacy answer generation exists in the repository but is not reachable from current factual production Helpdesk/QA Assist wiring. Current factual answer-generation LLM request count is **zero**.

## 4. Current knowledge sources and real corpus

Live database: `.knowledge-v2/knowledge-v2.sqlite`, schema 2, 1,430 active documents, 29,916 active chunks, and 29,914 embedding rows (`openai/text-embedding-3-small`, schema `v1`, 1,536 dimensions). Two Entra chunks lack embedding rows. The persisted `knowledge_chunks.embedding_state` remains `pending` even when a compatible row exists, so readiness below is based on the actual `chunk_embeddings` join, not that stale state column.

| Source | Product/domains | Authority role | Transport | Sync enabled | Default eligible | Active docs | Active chunks | Embedding-ready | Current status / revision evidence |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `ms-teams-admin` | Teams / `teams_admin` | `teams_admin_primary` | Learn MCP | yes | yes | 101 | 2,056 | 2,056 (100%) | POPULATED AND ACTIVE. Latest sampled document fingerprint `0d14a745...`; no sync checkpoint row. |
| `ms-teams-powershell` | Teams / `teams_powershell`, `teams_admin` | `teams_powershell_cmdlet_primary` | GitHub | yes | yes | 622 | 15,026 | 15,026 (100%) | POPULATED AND ACTIVE. Corpus URLs pin commit `5ce493d6...`; checkpoint status `error`, `documents_failed:1`, last sync 2026-08-07. |
| `ms-graph-docs` | Graph / `graph`, `teams_admin` | `graph_api_primary` | GitHub | no | yes | 0 | 0 | 0 | REGISTERED BUT EMPTY. |
| `ms-entra-docs` | Entra / `entra`, `teams_admin` | `entra_identity_primary` | GitHub | yes | yes | 658 | 11,189 | 11,187 (99.98%) | POPULATED AND ACTIVE. Checkpoint status `error`, `documents_failed:3`, last sync 2026-08-14; latest sampled fingerprint `956c3144...`. |
| `ms-m365-docs` | M365 / `m365`, `teams_admin` | `m365_tenant_primary` | GitHub | no | yes | 0 | 0 | 0 | REGISTERED BUT EMPTY. |
| `ms-teams-dev-docs` | Teams / `teams_dev` | `teams_dev_specialized` | GitHub | yes | no | 0 | 0 | 0 | REGISTERED BUT EMPTY and not default eligible. |
| `ms-sharepoint-docs` | SharePoint / `sharepoint` | `sharepoint_admin_primary` | Learn MCP | no | yes | 16 | 230 | 230 (100%) | POPULATED AND ACTIVE despite sync disabled; latest sampled fingerprint `ebe98530...`. |
| `ms-sharepoint-powershell` | SharePoint / `sharepoint` | `sharepoint_powershell_cmdlet_primary` | GitHub | yes | yes | 33 | 1,415 | 1,415 (100%) | POPULATED AND ACTIVE. Checkpoint `ok`, revision `998703fb...`, last sync 2026-08-14. |

There are no unregistered source IDs in the live database.

## 5. Current trust contracts

### Domain

| Contract | Implemented / enforcer | Tests | Caveat |
| --- | --- | --- | --- |
| Unresolved domain fails closed | Yes: `extractQueryIntent()`, `routeQueryIntent()` produce no selected domains/eligible sources and `domain_unresolved_no_authoritative_scope`. | `queryIntent.test.ts`, `domainRouter.test.ts`, `retrievalWb16.test.ts`, answer tests. | The fallback aspect can still be derived, but no source can satisfy it without an authoritative route. |
| Never defaults unresolved to Teams | Yes: no-domain and Exchange tests return `[]`. | Same tests; fresh 123/123 retrieval suite passed. | Literal incidental Teams-like words must still be maintained in deterministic rules. |
| Detected-domain authority isolation | Yes: route scope plus aspect `requiredDomains`/`requiredRoles`, enforced during candidate evaluation. | K1/K2 domain and evidence tests. | Registry priority lists contain cross-domain sources, but eligibility/authority checks prevent incidental authority from satisfying the primary domain. |
| Cross-domain incidental mention cannot satisfy primary authority | Yes: `authoritySatisfied` in candidate-aspect evaluation. | K2 Teams-vs-SharePoint and Entra-vs-SharePoint tests. | Requires correct domain detection first. |

### Method

| Contract | Implemented / enforcer | Tests | Caveat |
| --- | --- | --- | --- |
| PowerShell represented as method constraint | Yes: `deriveRequiredEvidenceAspects()` attaches required `powershell` constraints for applicable requests. | `proceduralContractCorrection.test.ts`, V1/V1.1 tests. | It is metadata on an aspect, not a peer aspect. |
| Method authority roles | Yes: required domain `teams_powershell`, role `teams_powershell_cmdlet_primary`. | V1/V1.1 method tests. | Aspect authority requirement separately allows `teams_admin_primary` OR PowerShell. |
| Method satisfaction | Function exists: `aspectMethodConstraintsSatisfied()` in `methodConstraintPolicy.ts`. | Method-policy tests and fresh live method diagnostic. | **Mismatch:** R2 supported-aspect classification does not consistently gate on this function. |
| Admin evidence vs PowerShell request | Intended fail-closed contract exists in tests. | `implicit cmdlet requires authoritative cmdlet identity`, V1.9/V1.1.4. | Live phone-number output is marked supported from `teams_admin_primary` alone while `aspectMethodConstraintsSatisfied=false`. |

### Evidence / answerability

| Contract | Implemented / enforcer | Tests | Caveat |
| --- | --- | --- | --- |
| Direct/supporting/contextual | Yes: candidate-aspect support classification in `evidenceAspectPolicy.ts`. | `evidenceBundleBuilder.test.ts`, `evidenceAspectPolicy.test.ts`. | Coarse lexical/facet rules can disagree with R3 exact-span checks. |
| Authority satisfaction | Yes: aspect authority requirements and candidate source metadata. | K2 authority tests, exact-identity tests. | OR authority roles let Teams Admin satisfy a Teams output even when a separate PowerShell method is required. |
| Broad concept-distinct selection | Yes: `isBroadSelectionAspect`, `computeConceptSignature`, `areConceptsRedundant`, coverage-first selection. | `evidenceConceptDistinctness.test.ts`, U1 tests. | R3 still plans by required facets, not by selected concept count. |
| Required-output workflow decomposition | Yes, uncommitted V1: six mandatory aspects are produced. | Untracked `v1WorkflowDecomposition.test.ts`. | Narrowly gated by population enumeration plus reporting/export shape. |
| Hybrid output preservation | Yes, uncommitted V1.2: `applyWorkflowOutputPreservation()`. | Untracked 23-test V1.2 suite; included in fresh 123 retrieval tests. | Preserves topical candidates, not necessarily read-method/facet-satisfying candidates. |
| Read/reporting `configuration_state` + `state` | Yes, uncommitted V1.1 in R2/R3. | Untracked V1.1 tests; fresh answer suite. | Subject morphology and method enforcement still produce live mismatches. |
| Write/configuration distinct | Yes: write operations retain `configuration_behavior`/configuration-operation/procedure requirements. | V1.1 write/read tests. | No regression found in fresh tests. |

### Planning / assembly

| Contract | Implemented / enforcer | Tests | Caveat |
| --- | --- | --- | --- |
| Heading-operation corroboration | Yes: `headingOperationCorroborationSpan()` in `answerPlanner.ts`. | P2 tests. | Same-evidence only; cannot replace substantive body evidence. |
| Exact source-bound claims | Yes: planner stores offsets, hashes, evidence/chunk/document IDs. | `answerPlanner.test.ts`, assembler tests. | Planner phrase/facet scoring is stricter/different from R2. |
| R3 integrity validation | Yes: `validateAnswerPlanIntegrity()`. | `answerPlanIntegrity` paths exercised by planner/assembler tests. | Current workflow plan is invalid because calling-policy `state` is supported by R2 but unplanned by R3. |
| R4 fail-closed deterministic assembly | Yes: `assembleDeterministicAnswer()`. | `deterministicAnswerAssembler.test.ts`; fresh answer tests. | It rejects the whole current workflow response; it does not emit the otherwise planned partial claims. |

### Citation

| Contract | Implemented / enforcer | Tests | Caveat |
| --- | --- | --- | --- |
| WB-21 mapping | Yes: `mapAnswerCitations()`. | `citationMapper.test.ts`. | Runs only after valid R4 assembly. |
| Learn MCP canonical URL | Yes: persisted canonical Learn URL with trusted source/revision checks. | Teams/SharePoint Learn tests. | Missing/untrusted provenance fails closed. |
| GitHub → Learn reconstruction | Yes: `resolveCanonicalCitationUrl()` with registry mappings; bespoke Teams PowerShell reconstruction retained. | `canonicalCitationUrl.test.ts`. | Graph/M365 mappings are deliberately absent and fail closed. |
| Malformed/untrusted URL rejection | Yes. | malformed path, wrong repo/source, non-Microsoft host, provenance mismatch tests. | Current failed workflow reaches no citation stage. |

### Generation

Implemented production contract: factual answer generation performs zero LLM requests. Enforcers are the production import graph and `GroundedAnswerExecutionPort`'s deterministic R4 call. Fresh diagnostics: `requestCount=0`; typecheck and answer tests passed.

## 6. Exact PowerShell workflow — current production truth

Question:

> Write or describe a PowerShell process that identifies all Teams users with Enterprise Voice enabled, determines their assigned phone number, voice-routing policy, dial plan, and calling policy, and exports the results to CSV.

Production intent selected `teams_powershell` and `teams_admin`; expected answer type `configuration`; operations included `get` and `grant`. Exact directives were optional entities for calling policy, dial plan, voice routing policy, enterprise voice, and phone number. CSV had no exact directive. Hybrid populations were 64 exact, 2,400 lexical, 1,300 semantic, capped at 24.

Every Teams output has `operation=null`, `answerObject=configuration_state`, required facet `state`, required PowerShell method (`teams_powershell`, `teams_powershell_cmdlet_primary`), and an authority OR of `teams_admin_primary` / `teams_powershell_cmdlet_primary` across Teams admin/PowerShell domains. CSV is `fact`, facet `behavior`, with no method/authority requirement.

### Per-output trace

#### 1. Enterprise Voice enabled state

- Aspect: `mandatory:entity:enterprise-voice:general`
- Directive: `entity:enterprise voice` (optional).
- Exact: 10 weak incidental metadata hits; zero useful exact candidates for the directive.
- Lexical: `Set-CsUser/-EnterpriseVoiceEnabled` rank 205; `Get-CsOnlineUser` rank 459; `Get-CsOnlineVoiceUser` rank 1,172.
- Semantic: `Set-CsUser/-EnterpriseVoiceEnabled` rank 59; `Get-CsOnlineUser` rank 73; `Get-CsOnlineVoiceUser` rank 118.
- Pre-cap/final: V1.2 fired and inserted `Set-CsUser/-EnterpriseVoiceEnabled` at final rank 24, fusion score about 21.5. The useful read documents did not survive top 24.
- R2: `Set-CsUser` was contextual, authority satisfied, matched no `state`, missing `state`; no evidence selected; aspect unsupported. Method satisfaction false.
- R3: no planned claim/span; `insufficient_evidence`.
- R4/citation: no realized text/citation because final assembly failed.

#### 2. Assigned phone number

- Aspect: `mandatory:entity:phone-number:general`.
- Directive: `entity:phone number` (optional).
- Exact/lexical/semantic: both Teams Admin phone-number material and PowerShell candidates surfaced. `Get-CsPhoneNumberPolicyAssignment` survived at rank 3 but was rejected by R2 as low topical relevance/insufficient direct support for the requested assigned number.
- Pre-cap/final: directive was already considered satisfied; V1.2 did not reserve another candidate. Selected Teams Admin candidate `Get Microsoft Teams Calling Plan phone numbers for your tenant`, final rank 7, methods exact+lexical+semantic.
- R2: direct, matched `state`, no missing facets, `authoritySatisfied=true`; aspect marked supported.
- Method: **`aspectMethodConstraintsSatisfied=false`** because selected authority is only `teams_admin_primary`.
- R3: planned an Admin Center procedure for acquiring new numbers, source span from `Get new phone numbers`, not a PowerShell read of each user's assigned number.
- R4/citation: no realized text/citation because plan integrity failed globally.

#### 3. Voice-routing policy

- Aspect: `mandatory:policy:voice-routing-policy:general`.
- Directive: `entity:voice routing policy` (optional).
- Exact: generic/admin metadata hits; no exact canonical cmdlet identity requirement.
- Lexical/semantic: `Get-CsOnlineVoiceRoutingPolicy` was lexical rank 8 and semantic rank 76.
- Pre-cap/final: V1.2 preserved its DESCRIPTION chunk; final rank 22, fusion score 36.20.
- R2: direct, matched `state`, no missing facets, authority and method satisfied; selected canonical PowerShell evidence.
- R3: planned only “Online voice routing policies are used in Microsoft Phone System Direct Routing scenarios.” That is concept/claim salience, not how to determine each user's assigned policy.
- R4/citation: no realized text/citation because plan integrity failed globally.

#### 4. Dial plan

- Aspect: `mandatory:policy:dial-plan:general`.
- Directive: `entity:dial plan` (optional).
- Exact/lexical/semantic: `Get-CsTenantDialPlan` SYNOPSIS surfaced in all three channels.
- Pre-cap/final: already survived without reservation; final rank 4, fusion score 48.3.
- R2: direct, matched `state`, no missing facets, authority/method satisfied; selected `Get-CsTenantDialPlan`.
- R3: planned “Use the Get-CsTenantDialPlan cmdlet to retrieve a tenant dial plan.”
- R4/citation: no realized text/citation because plan integrity failed globally.

#### 5. Calling policy

- Aspect: `mandatory:policy:calling-policy:general`.
- Directive: `entity:calling policy` (optional).
- Exact: generic/admin weak hits; canonical `Get-CsTeamsCallingPolicy` was not in the 64 exact candidates.
- Lexical/semantic: `Get-CsTeamsCallingPolicy` appeared at lexical rank 119 and semantic rank 124.
- Pre-cap/final: V1.2 preserved the DESCRIPTION chunk; final rank 23, fusion score 33.4.
- R2: direct, matched `state`, no missing facets, authority/method satisfied; selected DESCRIPTION text: “Returns information about the teams calling policies configured for use in your organization.”
- R3: no span scored as covering `state`; no claim; unsupported reason `source_span_unavailable`.
- Integrity: `required_facet_unplanned` for this aspect.
- R4/citation: no realized text/citation.

#### 6. CSV export

- Aspect: `mandatory:entity:csv-export:output-transformation`.
- Directive: none.
- Exact/lexical/semantic/final: no authoritative `Export-Csv`/generic PowerShell-core evidence was selected.
- R2: only unrelated contextual candidates; missing `behavior`, authority false; no selected evidence.
- R3: no claim; typed as `missing_authority` with an explicit generic-PowerShell-corpus caveat.
- R4/citation: no realized text/citation.

### Final production result

- R2 bundle answerability: `partial`.
- R2 supported: phone number, calling policy, dial plan, voice-routing policy.
- R2 unsupported: CSV export, Enterprise Voice.
- R3 planned: dial plan, phone-number Admin Center procedure, voice-routing concept sentence.
- R3 omitted calling policy despite R2 support.
- R4: **failed closed** with `answer_plan_integrity_failed`.
- Production `GroundedAnswerExecutionPort`: returns `grounded_answer_validation_failed` at `extractive_assembly`.
- Helpdesk Detailed answer: **none produced**.
- Live Assist Quick answer: **none produced**.
- Citations: **none produced**.
- Fresh direct run latency: 5,459.5 ms total (5,452.0 ms retrieval/evidence). Other same-day current-state runs ranged roughly 3.18–5.01 seconds; latency is retrieval/hosted-embedding dominated.
- Answer-generation LLM request count: **0**.

## 7. Enterprise Voice reconciliation

The assertion “Enterprise Voice is genuinely absent from the corpus” is false.

Direct read-only SQL inspection found populated, embedded Teams PowerShell chunks:

1. `Get-CsOnlineUser` DESCRIPTION explicitly says returned data includes whether the user is enabled for Enterprise Voice and assigned per-user policies.
2. `Get-CsOnlineUser -Filter` explicitly documents:
   `-Filter 'EnterpriseVoiceEnabled -eq $True'`.
3. `Get-CsOnlineVoiceUser` DESCRIPTION maps `EnterpriseVoiceStatus` to the replacement:
   `Get-CsOnlineUser -Filter {(EnterpriseVoiceEnabled -eq $True) ...}`.
4. The same document maps output field `EnterpriseVoiceEnabled` to `Get-CsOnlineUser`.
5. `Get-CsOnlineVoiceUser -EnterpriseVoiceStatus` documents `All`, `Enabled`, `Disabled`.
6. `Set-CsUser -EnterpriseVoiceEnabled` exists, but it is write/deprecated material, not the requested read/reporting primitive.

All are `ms-teams-powershell`, role `teams_powershell_cmdlet_primary`, active and backed by embedding rows. The parser/chunker preserved the decisive text.

Retrieval path:

- No useful exact hit.
- Useful material enters lexical (`Get-CsOnlineUser` 459, `Get-CsOnlineVoiceUser` 1,172) and semantic (73, 118).
- The read candidates do not enter final top 24.
- V1.2 instead preserves `Set-CsUser/-EnterpriseVoiceEnabled` because its structured heading compactly matches “enterprise voice.”
- That write candidate reaches R2 but is rejected for missing read/reporting `state`.

Real blocker classification:

- **information exists but retrieval query does not surface it strongly enough**
- **information surfaces but fusion drops it**
- **information reaches R2 but topical/facet rules reject it** (the preserved write candidate)

It is not “authoritative information absent from corpus,” and it is not parser/chunker loss.

## 8. Calling-policy R2 → R3 reconciliation

Selected R2 evidence:

- `ms-teams-powershell`
- `Get-CsTeamsCallingPolicy`
- DESCRIPTION
- “Returns information about the teams calling policies configured for use in your organization. Teams calling policies help determine which users are able to use calling functionality…”

R2 evaluated this as direct, topical, authority-satisfied, method-satisfied, with matched facet `state` and no missing facets.

R3 saw source-bound sentences but planned no `state` span. The planner's state scoring recognizes the `Get-` title, but its subject-presence phrase check is stricter than R2's topical/facet resolver. The evidence text uses plural “calling policies”; the derived subject is singular “calling policy.” The exact singular phrase is not present in the normalized sentence, so the candidate span is excluded before a claim is formed. The example sentence “Retrieves the calling policy…” exists in another chunk but was not the selected evidence item.

Outcome:

- planned facets: none
- missing facet: `state`
- unsupported reason: `source_span_unavailable`
- integrity: invalid, `required_facet_unplanned`
- assembly: fail closed

Classification: **R2/R3 verification-scope asymmetry plus an R3 subject/facet-scoring issue**. Fail-closed assembly is expected safe behavior after the inconsistency exists; the inconsistency itself is not merely a report error.

## 9. PowerShell method enforcement per output

| Output | Required method/role | Selected evidence | Method satisfied | Can Admin alone mark R2 supported? | Could Admin Center appear? | `missing_adjacent_authority` coexist? |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Enterprise Voice | PowerShell / `teams_powershell_cmdlet_primary` | none | no | Not in this run | no selected claim | yes in policy model |
| Phone number | PowerShell / `teams_powershell_cmdlet_primary` | Teams Admin / `teams_admin_primary` | **no** | **yes; it did** | **yes; R3 planned it** | yes |
| Voice-routing policy | PowerShell / `teams_powershell_cmdlet_primary` | `Get-CsOnlineVoiceRoutingPolicy` | yes | structurally yes because authority roles are OR-ed, though not selected here | possible under current R2 model | yes |
| Dial plan | PowerShell / `teams_powershell_cmdlet_primary` | `Get-CsTenantDialPlan` | yes | structurally yes | possible under current R2 model | yes |
| Calling policy | PowerShell / `teams_powershell_cmdlet_primary` | `Get-CsTeamsCallingPolicy` | yes | structurally yes | possible under current R2 model | yes |

Bundle-level `missing_adjacent_authority` can coexist with aspect support because adjacent-authority diagnostics and per-aspect support are separate. More importantly, a required method constraint can currently coexist with `supported` even when `aspectMethodConstraintsSatisfied=false`.

This does not match the intended P1 contract. PowerShell is represented as required, but live R2 support is not consistently gated by required-method satisfaction. Phone number proves the mismatch.

## 10. U1 / multi-concept behavior

Fresh production run for:

> How would you secure SharePoint data so it is not accessible by all Copilot users?

Results:

- Route: `sharepoint`; answerability `answered`.
- R2 selected four concept-distinct evidence items from `ms-sharepoint-docs`.
- Concepts include license/service-plan controls, restricted access control/SharePoint Advanced Management, general permission-scoped agent access, and Restricted Content Discovery/governance.
- R3 produced one first-class claim: “Currently, users with a Microsoft 365 Copilot license can use the agents.”
- The only WB-21 factual citation is `Manage access to agents in SharePoint`.
- The other selected concepts appear in `Authoritative context` / Explanation Context, including the actually relevant restricted-access-control statement.
- R4/presentation request count is zero.

The prior limitation remains: R2 selects multiple distinct concepts, but the single-facet fact-shaped aspect requires only `behavior`, so R3 realizes one first-class claim. The answer's first-class claim is also poorly aligned with the requested security action; better action-oriented evidence is demoted to context.

## 11. Current QA Assist truth

| Check | Current result |
| --- | --- |
| `Start QA Assist` exists | Yes, renderer/preload/IPC/main. |
| System-only forced | Yes, `sourceModeForProfile("qa_assist") === "system"`. |
| No mic MediaStream/provider | Yes by construction in normal QA start. |
| Defensive mic rejection | Yes at main capture start and `LiveAssistService.acceptQuestion()`. |
| Source provenance persists | Yes, accepted user message stores `captureSource=system`. |
| Profile/session persists | Yes, `qa_assist` profile and session ID are stored. |
| Same execution port | Yes, QA → `LiveAssistService` → same `HelpdeskService` instance → same `GroundedAnswerExecutionPort`. |
| Overlay optional | Yes; auto-show is settings-controlled and manual Show/Hide remains available. |
| Normal Live Assist unchanged | Verified by tests: microphone input remains accepted under `live_assist`; configured mic/system/both mode remains in use. |
| Meeting-platform identity relevant | No; capture is system-audio based and no Teams/Zoom/Webex/Meet SDK coupling exists. |

The complete QA Assist flow has **not** been demonstrated in repository evidence with real Windows loopback audio and a real Teams, Zoom, Webex, or Google Meet call. Unit/integration tests prove code contracts, not live hardware behavior.

## 12. Known defects / limitations

| Issue | Layer | Proven/Suspected | Severity | Blocks interview use? | Evidence |
| --- | --- | --- | --- | --- | --- |
| Enterprise Voice workflow state gap | Retrieval/fusion/R2 | Proven, but not a corpus gap | High | Yes for this workflow | Authoritative indexed read text exists; useful read candidates are lexical/semantic but absent from top 24; preserved `Set-CsUser` fails `state`. |
| Calling-policy R2/R3 mismatch | R2/R3 integrity | Proven | Critical | Yes; causes whole answer failure | R2 `state` supported, R3 state unplanned, R4 `answer_plan_integrity_failed`. |
| Requested PowerShell vs Admin evidence | Method enforcement | Proven | Critical | Yes for method fidelity | Phone number supported from Admin only with `aspectMethodConstraintsSatisfied=false`; R3 plans Admin Center number acquisition. |
| CSV / `Export-Csv` authority absence | Corpus/R2 | Proven | Medium | Yes for complete requested script | No selected authoritative CSV behavior; explicit unsupported aspect. |
| Multi-concept R3 single-claim limitation | R3/presentation | Proven | High | Often | Four U1 evidence concepts become one weak first-class claim; useful controls are context only. |
| Alternate-method / claim-salience | R2/R3 | Proven | High | Often | Phone number becomes new-number Admin procedure; voice-routing becomes a conceptual sentence rather than per-user state retrieval. |
| STT cmdlet-name mangling | STT | Suspected / unproven | Unknown | Potentially | No real-audio transcript artifact proves or quantifies it; no custom Deepgram keyterm configuration is present. |
| Live meeting hardware validation | QA Assist integration | Proven absent from evidence | High | Yes before relying on it live | No real-call/Windows-loopback validation record; tests are simulated. |
| Retrieval latency | Retrieval/hosted embedding | Proven | Medium–High | Possibly | Fresh exact workflow 5.46 s; same-day runs roughly 3.18–5.01 s; semantic retrieval dominates. |
| Context-reference persistence failure | Conversation persistence | Proven | Critical | Yes when distinct Explanation Context exists | `HelpdeskService` emits context citations at `0..0`; SQLite rejects `end <= start`. The U1 answer has a distinct Restricted Content Discovery context URL and would fail at this boundary. |
| Citation offsets not remapped after presentation | Citation persistence/rendering | Proven | High | Possibly | WB-21 offsets target raw R4 text, while persisted content is profile-formatted `answerText`; no remapping occurs. |
| Knowledge corpus packaging/path gap | Runtime packaging | Proven configuration gap; packaged behavior unproven | Critical | Yes for installed builds | Production omits `databasePath`, falls back to `<cwd>/.knowledge-v2`; builder packages neither the 451 MB corpus nor source migrations. No populated DB was found under inspected Electron user-data locations. |
| Stale architecture documentation | Documentation | Proven | Medium | No direct runtime block | README still says answers stream from OpenAI; production uses deterministic R4 and can fail closed. Existing current-state docs predate V1–V1.2 working-tree changes. |
| Pre-existing indexing test | Indexing tests | Proven | Medium | No immediate read-path block | Fresh `test:cg01c`: 8 pass, 1 fail at `documentIndexingJob.test.ts:378`, lexical candidates unexpectedly empty after partial embedding failure. |

Fresh verification gates:

- `npm run typecheck`: passed.
- Retrieval V2: 123/123 passed.
- Answer V2: 209/209 passed.
- Conversations: 47/47 passed.
- Indexing CG-01C: 8/9 passed; one failure above.

## 13. Invalidated assumptions

- “Teams PowerShell source eligibility is the main workflow blocker” is incomplete: Teams PowerShell is eligible/populated and candidates surface; current blockers include fusion choice, method enforcement, R2/R3 asymmetry, and missing CSV authority.
- “Five requested outputs are not modeled” is false in the working tree: five Teams outputs plus CSV are separate mandatory aspects.
- “Cmdlet-reference evidence cannot satisfy read/reporting state” is false: dial plan, voice-routing policy, and calling policy are R2-supported from `Get-*` references.
- “Enterprise Voice is definitely missing from corpus” is false: decisive `Get-CsOnlineUser` and `Get-CsOnlineVoiceUser` chunks exist and are embedded.
- “V1.2 makes the production workflow answer usable” is false: it gets additional candidates into top 24, but current production execution fails at R4 integrity.
- “Required PowerShell method prevents Admin-only support” is false in current live R2 behavior: phone number is the counterexample.
- “U1 makes all selected concepts first-class claims” is false: multiple selected concepts remain explanation context.
- “Conditional Access was already producing a good answer” is not established by the current verification; routing/corpus/citation contracts are proven, but no end-to-end quality result was rerun here that justifies “good.”

# PROVEN

- Current branch/HEAD match upstream, while V1/V1.1/V1.2 remain uncommitted in a dirty tree.
- Production Helpdesk and QA Assist use `GroundedAnswerExecutionPort` and deterministic R2/R3/R4/citation/presentation.
- Production factual answer generation makes zero LLM requests; hosted OpenAI is used for query embeddings.
- Five corpus sources are populated; Graph, M365, and Teams Developer sources are registered but empty.
- QA Assist is system-only by construction and persists accepted-question provenance, not raw audio or a continuous transcript.
- The exact workflow decomposes into six mandatory aspects and is `partial` at R2.
- V1.2 preserves calling-policy, voice-routing-policy, and `Set-CsUser` Enterprise Voice candidates while keeping the cap at 24.
- Enterprise Voice read/reporting information exists in active embedded Teams PowerShell chunks.
- Phone-number R2 support violates the required PowerShell method contract.
- Calling policy is supported by R2 but unplanned by R3; R4 rejects the entire answer.
- The exact workflow produces no Helpdesk Detailed answer, no Live Assist Quick answer, and no citations in current production execution.
- U1 selects multiple concept-distinct items but produces one weak first-class claim.
- Distinct Explanation Context references currently cause conversation persistence failure because they are represented as invalid zero-length citation ranges.
- Factual citation offsets are not remapped from raw R4 text to persisted presentation text.
- The populated workspace knowledge database and source migrations are not included in the packaged application configuration.
- Typecheck, retrieval, answer, and conversation suites pass; one indexing test fails.

# UNPROVEN

- End-to-end QA Assist operation with real Windows system audio and a real meeting application.
- Real-world Deepgram transcription accuracy for PowerShell/cmdlet names and the magnitude of any mangling.
- Production behavior under packaged Electron credentials, permissions, device drivers, and prolonged sessions.
- That the observed 3–5.5 second retrieval latency distribution is stable across networks/machines.
- That every registered source's corpus is fresh; several sync checkpoints are absent or in error.
- That Conditional Access currently yields a useful end-to-end answer rather than only correct routing/citation mechanics.
