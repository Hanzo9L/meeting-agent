"""Read-only Issue-2 ranking probe. Does not modify learn-rag or Relay production."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN))

from service.asr_normalize import normalize as asr_normalize  # noqa: E402
from service.query_cues import classify  # noqa: E402
from service.scope_select import select_scope  # noqa: E402
from service.search import (  # noqa: E402
    FUNCTION_WORDS,
    PHRASE_ALIASES,
    STOPWORDS,
    TECHNICAL_PHRASES,
    WEAK_UNIGRAMS,
    SearchEngine,
    build_fts_query,
)

OUT = Path(__file__).resolve().parent
CASES = [
    {
        "id": "LIVE-H1-typed",
        "question": "What does Get-CsOnlineUser return?",
        "source": "I9 live typed equivalent; I8 L5",
        "expected_domain": "Microsoft Teams PowerShell / Get-CsOnlineUser cmdlet reference",
        "wrong_because": "I9 overlay ranked Get-CsOnlineVoiceRoutingPolicy first; Linux ps(1) also listed on STT form",
    },
    {
        "id": "LIVE-H1-stt",
        "question": "What does Gixonline user return?",
        "source": "I9 accepted STT for spoken Get-CsOnlineUser",
        "expected_domain": "Microsoft Teams PowerShell / Get-CsOnlineUser cmdlet reference",
        "wrong_because": "STT mangling; overlay rank1 VoiceRoutingPolicy + Linux ps(1)",
    },
    {
        "id": "LIVE-H2",
        "question": "A user can use Teams but cannot call external numbers. How do you troubleshoot?",
        "source": "I9 H2 accepted",
        "expected_domain": "Microsoft Teams Phone / Direct Routing outbound PSTN troubleshooting",
        "wrong_because": "historically adjacent AA/CQ or Calling Plan pages can outrank outbound-call diagnosis",
    },
    {
        "id": "LIVE-Q-SBC-FAIL",
        "question": "What happens if the SBC fails?",
        "source": "I9 rapid Q2 accepted",
        "expected_domain": "Microsoft Direct Routing trunk failover / SBC resiliency",
        "wrong_because": "broad architecture; vendor HA or random SIP fragments may lead",
    },
    {
        "id": "LIVE-Q-GEO",
        "question": "What would geographic redundancy look like?",
        "source": "I9 rapid Q3 accepted",
        "expected_domain": "Microsoft Direct Routing geo-redundant SBC / multiple SIP proxy FQDNs / carrier diversity",
        "wrong_because": "no product names; generic redundancy wording; mixed corpus risk",
    },
    {
        "id": "HIST-Q03-ONEWAY",
        "question": "How would you troubleshoot one-way audio on a Teams Direct Routing call?",
        "source": "Priority-14 Q03 SOURCE_GAP; interview family",
        "expected_domain": "Microsoft Direct Routing media path / one-way audio / media bypass / Call Analytics",
        "wrong_because": "no dedicated one-way-audio section; aliases pull media bypass/CQD/call flows",
    },
    {
        "id": "HIST-Q01-ARCH",
        "question": "Explain Direct Routing and the role of the SBC.",
        "source": "I9 rapid Q1 / Priority-14 Q01",
        "expected_domain": "Microsoft Direct Routing plan/configure overview (SBC role)",
        "wrong_because": "narrow analog-device or vendor config can beat overview",
    },
    {
        "id": "LIVE-H4-POOR-AUDIO",
        "question": "A user is complaining of poor audio. How would you determine where the problem is?",
        "source": "I9 H4 accepted",
        "expected_domain": "Microsoft Call Analytics / CQD path isolation, not a random codec page",
        "wrong_because": "broad; may miss Direct Routing media vs client vs network isolation",
    },
    {
        "id": "HIST-Q13-COPILOT",
        "question": "What would you secure or review in SharePoint and OneDrive before rolling out Microsoft 365 Copilot?",
        "source": "Priority-14 Q13 / interview Copilot rollout",
        "expected_domain": "Microsoft SharePoint Advanced Management / oversharing / Copilot governance",
        "wrong_because": "generic rollout/pilot pages can dominate over DAG/oversharing",
    },
    {
        "id": "HIST-TEAMS-ROLLOUT",
        "question": "How would you roll out Teams to a large organization?",
        "source": "interview pack Enterprise Teams Rollout",
        "expected_domain": "Microsoft Teams adoption/planning/rollout architecture, not Rooms/AA fragments",
        "wrong_because": "isolated Rooms/AA/SharePoint hits win on rollout/organization wording",
    },
    {
        "id": "LIVE-Q-CERT",
        "question": "What does the certificate do?",
        "source": "I8 live Q2 follow-up without DR context",
        "expected_domain": "Microsoft Direct Routing public trusted SBC certificate (if in DR session); otherwise underspecified",
        "wrong_because": "no session context; Entra/TLS/SBC/Linux openssl may collide",
    },
    {
        "id": "CTRL-AUDIOCODES",
        "question": "How would you configure an AudioCodes Mediant SBC for Teams Direct Routing?",
        "source": "I8 L3 / I9 H3 control (vendor SHOULD appear)",
        "expected_domain": "AudioCodes Mediant Direct Routing implementation plus Microsoft DR plan",
        "wrong_because": "control case; vendor hits are expected",
    },
    {
        "id": "CTRL-LINUX",
        "question": "A Linux service is failing intermittently. How would you investigate it?",
        "source": "I8 L6 / I9 H5 control (Linux SHOULD appear)",
        "expected_domain": "Linux systemd/journal/service troubleshooting",
        "wrong_because": "control case; Linux hits are expected",
    },
]


def sha16(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def publisher_of(hit) -> str:
    repo = str(getattr(hit, "repo", "") or "")
    url = str(getattr(hit, "url", "") or "")
    service = str(getattr(hit, "ms_service", "") or "").lower()
    collection = str(getattr(hit, "ms_collection", "") or "").lower()
    host = (urlparse(url).hostname or "").lower()
    if (
        repo == "audiocodes"
        or host.endswith("audiocodes.com")
        or service == "audiocodes-sbc"
        or collection == "certified_sbc_vendor"
    ):
        return "AudioCodes"
    if (
        repo == "linux"
        or service == "linux-upstream"
        or host.endswith("man7.org")
        or host.endswith("freedesktop.org")
        or host.endswith("tcpdump.org")
        or host == "docs.python.org"
    ):
        return "Linux"
    return "Microsoft"


def query_shape(raw: str) -> dict:
    normalized = asr_normalize(raw)
    fts = build_fts_query(raw)
    fts_norm = build_fts_query(normalized)
    clauses = re.findall(r'"([^"]+)"', fts)
    clauses_l = [c.lower() for c in clauses]
    raw_tokens = re.findall(r"[A-Za-z0-9\-]+", raw)
    preserved = [p for p in TECHNICAL_PHRASES if p in clauses_l]
    aliases_added = []
    for phrase, aliases in PHRASE_ALIASES.items():
        if phrase in clauses_l:
            for alias in aliases:
                if alias.lower() in clauses_l and alias.lower() not in raw.lower():
                    aliases_added.append(alias)
    weak = WEAK_UNIGRAMS | STOPWORDS | FUNCTION_WORDS
    dropped = []
    for tok in raw_tokens:
        low = tok.lower()
        if low in weak or len(low) <= 1:
            continue
        if low not in clauses_l and tok not in clauses:
            # hyphenated tokens may be split
            parts = tok.replace("-", " ").split()
            if not any(p.lower() in clauses_l for p in parts) and tok.lower() not in " ".join(clauses_l):
                dropped.append(tok)
    cues = classify(raw)
    scope = select_scope(raw)
    return {
        "raw_question": raw,
        "normalized_query": normalized,
        "asr_changed": normalized != raw.strip(),
        "preserved_phrases": preserved,
        "aliases_added": aliases_added,
        "dropped_terms": dropped,
        "router": {
            "confidence": scope.confidence,
            "service": scope.service,
            "repo": scope.repo,
            "subservice": scope.subservice,
            "reason": scope.reason,
            "search_kwargs": scope.search_kwargs(),
        },
        "cues": {
            "topic": cues.topic,
            "service": cues.service,
            "subservice": cues.subservice,
            "repo": cues.repo,
            "service_confident": cues.service_confident,
        },
        "lexical_terms": clauses,
        "lexical_fts": fts,
        "lexical_fts_after_asr": fts_norm,
        "vector_query_text": raw,
        "vector_uses_raw_not_fts": True,
        "failover_clause_added": "failover" in clauses_l,
    }


def hit_dict(hit, rank: int) -> dict:
    body = hit.body or ""
    return {
        "rank": rank,
        "title": hit.title,
        "section": hit.section,
        "repo": hit.repo,
        "publisher": publisher_of(hit),
        "ms_service": hit.ms_service,
        "ms_collection": hit.ms_collection,
        "score": hit.score,
        "matched_by": list(hit.matched_by),
        "url": hit.url,
        "parent_id": hit.parent_id,
        "body_chars": len(body),
        "body_preview": body[:1600],
    }


def mixed_check(hits: list[dict], expected_domain: str) -> dict:
    counts = {"Microsoft": 0, "AudioCodes": 0, "Linux": 0}
    for hit in hits[:5]:
        counts[hit["publisher"]] = counts.get(hit["publisher"], 0) + 1
    expected = expected_domain.lower()
    unexpected = []
    for hit in hits[:5]:
        pub = hit["publisher"]
        relevant = True
        if pub == "Linux" and "linux" not in expected:
            relevant = False
        if pub == "AudioCodes" and "audiocodes" not in expected and "vendor" not in expected:
            # vendor DR config is relevant only if question names vendor or asks how to configure that SBC
            relevant = "audiocodes" in expected or "mediant" in expected
        if not relevant:
            unexpected.append(
                {
                    "rank": hit["rank"],
                    "publisher": pub,
                    "title": hit["title"],
                    "section": hit["section"],
                }
            )
    return {
        "top5_counts": counts,
        "non_microsoft_without_substantive_relevance": unexpected,
        "pollution": bool(unexpected),
    }


def main() -> None:
    fingerprints = {
        "service/search.py": sha16(LEARN / "service/search.py"),
        "service/scope_select.py": sha16(LEARN / "service/scope_select.py"),
        "service/query_cues.py": sha16(LEARN / "service/query_cues.py"),
        "service/asr_normalize.py": sha16(LEARN / "service/asr_normalize.py"),
        "data/corpus.db": sha16(LEARN / "data/corpus.db"),
        "data/hnsw.bin": sha16(LEARN / "data/hnsw.bin"),
        "query_shaping_file": "service/search.py::build_fts_query + PHRASE_ALIASES/TECHNICAL_PHRASES; service/asr_normalize.py; service/scope_select.py",
    }
    engine = SearchEngine(
        db_path=LEARN / "data/corpus.db",
        index_path=LEARN / "data/hnsw.bin",
    )
    engine.search("warmup query for the graph", top_k=1)

    cases_out = []
    for case in CASES:
        q = case["question"]
        shape = query_shape(q)
        kwargs = shape["router"]["search_kwargs"]
        hits_prod, timing = engine.search(q, top_k=100, candidates=30, **kwargs)
        records = [hit_dict(h, i) for i, h in enumerate(hits_prod, 1)]
        fused_n = len(engine.last_fused_ids)
        # Diagnostic-only wider candidate pool; production unchanged.
        hits_wide, _ = engine.search(q, top_k=100, candidates=120, **kwargs)
        wide_records = [hit_dict(h, i) for i, h in enumerate(hits_wide, 1)]
        cases_out.append(
            {
                **case,
                "query_shaping": shape,
                "production_candidate_cap": 30,
                "production_fused_unique": fused_n,
                "timing_ms": {
                    "embed": timing.embed_ms,
                    "vector": timing.vector_ms,
                    "lexical": timing.lexical_ms,
                    "fuse": timing.fuse_ms,
                    "total": timing.total_ms,
                },
                "hits_production": records,
                "hits_wide_candidates_120": wide_records,
                "top5": records[:5],
                "top10": records[:10],
                "top25": records[:25],
                "mixed_corpus_top5": mixed_check(records, case["expected_domain"]),
            }
        )
        print(f"=== {case['id']} fused={fused_n} hits={len(records)} ===", flush=True)
        for hit in records[:8]:
            print(
                f"  {hit['rank']:2d} [{hit['publisher'][:3]}] {hit['score']:.4f} "
                f"{hit['matched_by']} | {hit['title'][:60]} :: {hit['section'][:50]}",
                flush=True,
            )

    payload = {"fingerprints": fingerprints, "relay_top_k": 5, "cases": cases_out}
    (OUT / "probe_raw.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("wrote", OUT / "probe_raw.json", flush=True)


if __name__ == "__main__":
    main()
