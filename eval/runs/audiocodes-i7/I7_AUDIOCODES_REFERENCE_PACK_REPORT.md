# I7 — AudioCodes / Mediant Direct Routing Reference Pack

Bounded vendor-authority corpus expansion. Retrieval, R0.4, query shaping, router, fusion, Relay UI, STT, and answer generation were not changed. No commit.

**RELAY WRITE STATUS: EVAL ARTIFACTS ONLY**  
**LEARN-RAG WRITE STATUS: TARGETED VENDOR SOURCE/CORPUS ARTIFACTS ONLY**

---

## 1. Workspace / freeze verification

### Relay

- cwd: `C:\Users\joegc\projects\meeting-agent`
- branch: `cursor/msteams-docs-knowledge-base`
- HEAD: `e1e4dab31146115df2d722f311b1fd5023a28f37`
- Working tree remains intentionally dirty. This phase added only `eval/datasets/audiocodes_direct_routing_scenarios.json` and `eval/runs/audiocodes-i7/`.

### learn-rag

- cwd: `C:\Users\joegc\projects\learn-rag\learn-rag`
- branch: `master`
- HEAD: `b967fb899eda18f1a5a56bcef2b7f80d717fa1a3`

| File | sha256[:16] | I7 action |
| --- | --- | --- |
| `service/search.py` (I6B query shape) | `252e9b3ced85b9b0` | **not modified** |
| `service/scope_select.py` | `2a8caaabd00f4b08` | **not modified** |

Allowed corpus-pipeline edits only:

- `build/config.py` — new `audiocodes` skip_git repo (same pattern as I6A linux)
- `build/transform.py` — honor frontmatter `source_url` so official AudioCodes URLs stay canonical

No aliases, no AudioCodes router scope, no ranking change.

---

## 2. Authoritative sources selected

Official AudioCodes only:

- `audiocodes.com/media/*.pdf` configuration notes
- `techdocs.audiocodes.com` Mediant Software SBC User's Manual 7.40 HTML

Rejected: hosting-model (multi-tenant), CUCM interop, blogs, reseller guides, YouTube, unofficial PDF mirrors, full 900-page user manuals.

Microsoft certified-SBC / Direct Routing pages were **already in the corpus** (`direct-routing-border-controllers`, Plan/Configure/Connect SBC). Not re-ingested.

---

## 3. Exact documents ingested (7)

| Family | Document | URL |
| --- | --- | --- |
| A+B | Mediant SBC with Teams Direct Routing **Enterprise Model** configuration note | https://www.audiocodes.com/media/13253/connecting-audiocodes-sbc-to-microsoft-teams-direct-routing-enterprise-model-configuration-note.pdf |
| D | Mediant SBC to Teams Direct Routing with **Local Media Optimization** | https://www.audiocodes.com/media/15757/mediant-sbc-to-microsoft-teams-direct-routing-with-local-media-optimization.pdf |
| C | Overview of High Availability Mode | https://techdocs.audiocodes.com/session-border-controller-sbc/mediant-software-sbc/user-manual/version-740/content/um/HA%20Overview.htm |
| C | Device Switchover upon Failure | https://techdocs.audiocodes.com/.../Device%20Switchover%20upon%20Failure.htm |
| C | Quick-and-Easy Initial HA Configuration | https://techdocs.audiocodes.com/.../Fast-and-Easy%20Initial%20Configuration.htm |
| C | Initialize HA on the Devices | https://techdocs.audiocodes.com/.../Step%203_%20Initialize%20HA%20on%20the%20Devices.htm |
| E | Viewing Proxy Set Status (SIP OPTIONS keep-alive) | https://techdocs.audiocodes.com/.../Viewing%20Proxy%20Set%20Status.htm |

TLS/certificate implementation is inside the Enterprise note (family B), not a separate document.

---

## 4. Microsoft cross-reference by family

| Vendor family | Microsoft “what must be true” |
| --- | --- |
| A Mediant DR config (TLS Context, SIP Interface, Proxy Set, IP Group, routing) | Connect the SBC; Direct Routing architecture; voice routing policy / PSTN usage / voice route / PSTN gateway |
| B TLS / certificates | Plan Direct Routing: public trusted certificate for the SBC (CN/SAN/FQDN, trusted CA) |
| C 1+1 HA pair / switchover | Multi-SBC placement, trunk failover, voice-route priority. **A Mediant HA pair is not geographic redundancy.** |
| D SIP/media/LMO | Microsoft call flows, media bypass, Local Media Optimization |
| E Proxy Set ONLINE/OFFLINE via OPTIONS | Monitor Direct Routing; SIP OPTIONS / TLS connectivity troubleshooting |

---

## 5. Source metadata

Existing frontmatter/parent columns, no new schema:

- `publisher`: AudioCodes
- `vendor`: audiocodes
- `authority`: certified_sbc_vendor
- `product_family`: mediant
- `domain`: direct-routing
- `source_role`: vendor_implementation_reference
- `ms.service`: `audiocodes-sbc`
- `ms.collection`: `certified_sbc_vendor`
- `title` prefixed with **AudioCodes**
- `source_url`: official canonical URL

Repo slug: `audiocodes` (separate from `teams`).

---

## 6. Before / after corpus metrics

| | Before | After | Delta |
| --- | ---: | ---: | ---: |
| documents | 262 | 269 | **+7** |
| parents | 1289 | 1461 | **+172** |
| children / vectors | 2679 | 2896 | **+217** |
| corpus.db | 15,568,896 | 16,781,312 | +1.2 MB |
| hnsw.bin | 4,857,588 | 5,250,584 | +393 KB |
| search.py | `252e9b3ced85b9b0` | `252e9b3ced85b9b0` | unchanged |
| scope_select.py | `2a8caaabd00f4b08` | `2a8caaabd00f4b08` | unchanged |

Index fingerprint `fdafc1789c490573` → `6cb36a85bc36acf3`.

172 parents from 7 files: the two PDFs split on numbered sections (60 + 107). HTML HA/status pages are 1 parent each.

---

## 7. Source-quality inspection

**Kept together:** numbered TLS/CSR/root-store procedures, SIP interface tables, HA switchover bullets, OPTIONS keep-alive status fields.

**Product/version context retained:** titles say AudioCodes Mediant; Enterprise note Date Published March-24-2026; HA pages are Software SBC User's Manual 7.40.

**Canonical URLs preserved** via `source_url` (techdocs mixed case / `%20`).

**Clearly not Microsoft Learn:** `audiocodes.com` / `techdocs.audiocodes.com`.

**Defects (chunking not changed):**

- PDF revision-history rows (`## 13320 Updates…`) became false H2s.
- Occasional split headings (`## 0 OAMP+ Media +`).
- TOC dotted leaders survived in the Enterprise note preamble.
- LMO PDF is large (107 parents) and can dominate “AudioCodes” lexical hits.
- Proxy Set Status HTML is thin tables; did not retrieve for AC08.

Procedures remain readable enough for interview evidence.

---

## 8. Twelve-scenario results

Unchanged path: `select_scope(question)` then `SearchEngine.search(..., top_k=5, **kwargs)`.

| ID | Grade | MS | AC | Provenance clear |
| --- | --- | --- | --- | --- |
| AC01 configure an SBC | **GOOD** | yes | yes | yes |
| AC02 bring Mediant online | PARTIAL | no | yes | yes |
| AC03 certificate requirements | **GOOD** | yes | yes | yes |
| AC04 install/bind certs on Mediant | PARTIAL | no | yes | yes |
| AC05 SIP/RTP through the SBC | **GOOD** | yes | yes | yes |
| AC06 configure AudioCodes HA | PARTIAL | no | yes | yes |
| AC07 HA pair fails | **GOOD** | yes | yes | yes |
| AC08 SBC not connecting | PARTIAL | yes | no | n/a |
| AC09 Microsoft objects after connect | PARTIAL | yes | yes | yes |
| AC10 Microsoft vs vendor-specific | PARTIAL | yes | no | n/a |
| AC11 transferability | PARTIAL | no | yes | yes |
| AC12 geographic redundancy | PARTIAL | yes | yes | yes |

**GOOD 4 / PARTIAL 8 / MISS 0.**

Vendor-named questions (AC02, AC04, AC06) now surface Mediant procedures. Mixed architecture questions (AC01, AC03, AC05, AC07) can show both layers. Broad questions still lean one side.

---

## 9. Microsoft vs AudioCodes authority visibility

When AudioCodes appears, **every** hit has `AudioCodes` in the title and an `audiocodes.com` URL. None were labeled as Microsoft Learn.

Microsoft remains visible on AC01/03/05/07/08/09/10/12. Vendor-only top 5 on AC02/04/06/11 — useful for implementation, incomplete as a two-layer packet.

AC07 is the cleanest split: AudioCodes 1+1 switchover **and** Microsoft trunk failover, as different objects.

---

## 10. TSUC04 cross-check (grading standard unchanged)

I6B: PARTIAL. Failover-mechanism section rank 3. Trunk failover article not top 5.

I7 top 5: Plan DR infra, **multi-tenant SBC**, Plan DR failover mechanism (3), Plan DR overview, media-bypass FQDNs. **No AudioCodes HA in top 5.**

Vendor 1+1 HA did not become geo-redundancy evidence. PARTIAL unchanged. Microsoft failover-mechanism section remains.

---

## 11. TSUC13 cross-check (grading standard unchanged)

I6B: PARTIAL. Monitor Call Analytics 1, media bypass 2, GCC High 3.

I7: same 1–3, then AudioCodes LMO “Verifying the Pairing” at 4, outbound-calls 5. Vendor hit is pairing/LMO, not a one-way-audio runbook. PARTIAL unchanged. No synthesis.

---

## 12. Full 30-bank regression

| | I6B | I7 |
| --- | ---: | ---: |
| GOOD | 23 | **23** |
| PARTIAL | 5 | **5** |
| MISS | 0 | **0** |
| PERSONAL | 2 | **2** |

**Grade changes: none.** No previously GOOD case dropped.

Top-5 reshuffles without grade change: TSUC01, 03, 04, 05, 07, 08, 10, 11, 13, 14, 17, 18, 28. Most are Microsoft-internal reordering.

---

## 13. Vendor-pollution check

AudioCodes entered top 5 on:

| ID | I6B grade | Fit |
| --- | --- | --- |
| TSUC01 junior DR/SBC explain | GOOD | Mild. LMO config note at rank 4 among Microsoft Plan DR hits. |
| TSUC03 voice-routing chain | GOOD | **Unwanted.** Vendor config at rank 2 on a Microsoft routing-chain question. Microsoft call-routing pages still 1 and 3. |
| TSUC05 TLS/OPTIONS/certs | GOOD | On-topic vendor cert material at rank 4. |
| TSUC13 one-way audio | PARTIAL | Weak (pairing verification). |

Vendor sources did **not** dominate AA/CQ, Rooms, Copilot, Linux, or PowerShell questions.

Do not fix ranking in this phase.

---

## 14. Publisher / source-labeling capability

**Visible to a human on the current Helpdesk card:** title (contains `AudioCodes`) and URL (`audiocodes.com` / `techdocs.audiocodes.com`). Both are rendered today.

**Data-model gap (do not patch in I7):**

- Evidence cards are typed `microsoft_evidence`
- `relay_bridge` returns title/section/url/body only — no `repo`, `publisher`, `ms.service`, `ms.collection`
- There is no publisher enum on `EvidenceParent`

A small later fix: pass `repo` / `ms.service` / `ms.collection` through the bridge and label vendor vs Microsoft on the card. Until then, title+URL are the only distinction.

---

## 15. Latency

Warmed 30-bank `top_k=5`:

| | I6B clean | I7 |
| --- | ---: | ---: |
| p50 | 13.6 ms | **12.3 ms** |
| p95 | 28.4 ms | **16.8 ms** |
| max | 38.8 ms | **18.1 ms** |

No material harm. Not optimized.

---

## 16. Remaining gaps

- Named-vendor questions often drop the Microsoft layer from top 5.
- AC08 did not retrieve Proxy Set Status.
- AC10/AC11 need both layers for a clean transferability / “who owns what” packet; today they split.
- TSUC04 geo redundancy is still Microsoft-side; Mediant HA is site-local 1+1.
- PDF over-splitting (revision history as H2) adds noise parents.
- No other certified SBC vendors in the corpus, so transferability evidence is conceptual (Microsoft certified list + vendor-specific object names), not comparative.

---

## 17. Keep the pack?

**Yes, with a provenance presentation fix.** Vendor-named implementation questions now have real Mediant procedures. Microsoft authority remains in the corpus and often in the same top 5. Titles/URLs already prevent “this is Microsoft Learn.” The card schema still pretends every hit is Microsoft.

Do not expand the AudioCodes universe. Do not add vendor query rules in this phase.

---

## B. KEEP PACK WITH ONE PRESENTATION/PROVENANCE FIX
