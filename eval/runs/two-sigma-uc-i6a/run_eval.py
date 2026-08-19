"""I6A retrieval eval against frozen R0.4. Does not change search.py."""
from __future__ import annotations

import json
import os
import sqlite3
import statistics
import sys
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN))
os.chdir(LEARN)

from service.scope_select import select_scope  # noqa: E402
from service.search import SearchEngine  # noqa: E402

ROOT = Path(r"C:\Users\joegc\projects\meeting-agent")
DATASET = ROOT / "eval/datasets/two_sigma_uc_systems_engineer_scenarios.json"
I4 = ROOT / "eval/runs/two-sigma-uc-i4/results.json"
OUT_DIR = ROOT / "eval/runs/two-sigma-uc-i6a"
WEAK = ["TSUC04", "TSUC13", "TSUC20", "TSUC22", "TSUC26", "TSUC27"]

USEFUL_NEEDLES = {
    "TSUC04": [
        "direct-routing-trunk-failover",
        "direct-routing-voice-routing",
        "direct-routing-plan",
        "survivable-branch",
        "pstn-connectivity",
        "cloud-voice-landing",
        "setting-up-your-phone-system",
    ],
    "TSUC13": [
        "microsoft-teams-online-call-flows",
        "urls-and-ip-address-ranges",
        "direct-routing-plan-media-bypass",
        "direct-routing-protocols-media",
        "use-call-analytics",
        "set-up-call-analytics",
        "prepare-network",
        "direct-routing-configure-media-bypass",
        "monitor-call-quality",
    ],
    "TSUC20": ["systemctl", "journalctl", "ps.1", "grep.1", "tail.1", "linux"],
    "TSUC22": ["ss.8", "tcpdump", "pcap-filter", "ip.8", "ping.8", "linux"],
    "TSUC26": [
        "get-csautoattendant",
        "get-cscallqueue",
        "get-csonlineapplicationinstance",
    ],
    "TSUC27": [
        "upgrade-framework",
        "prepare-network",
        "network-planner",
        "cloud-voice-landing",
        "pstn-connectivity",
        "setting-up-your-phone-system",
        "upgrade-plan-journey",
        "upgrade-prepare-environment",
        "aa-cq-",
    ],
}


def hit_dict(hit, rank: int) -> dict:
    return {
        "rank": rank,
        "title": hit.title,
        "section": hit.section,
        "url": hit.url,
        "repo": hit.repo,
        "ms_service": hit.ms_service,
        "score": hit.score,
        "matched_by": list(hit.matched_by),
        "body_len": len(hit.body or ""),
        "preview": (hit.body or "")[:240],
    }


def search_one(engine: SearchEngine, question: str, top_k: int) -> dict:
    scope = select_scope(question)
    hits, timing = engine.search(question, top_k=top_k, **scope.search_kwargs())
    ranked = [hit_dict(hit, i) for i, hit in enumerate(hits, 1)]
    return {
        "scope": {
            "confidence": scope.confidence,
            "service": scope.service,
            "repo": scope.repo,
            "reason": scope.reason,
        },
        "returned": len(hits),
        "latency_ms": round(timing.total_ms, 3),
        "top5": ranked[:5],
        "hits": ranked,
    }


def first_useful(ranked: list[dict], needles: list[str]) -> dict:
    found = {n: None for n in needles}
    for row in ranked:
        blob = f"{row['title']}\n{row['section']}\n{row['url']}".lower()
        for needle in needles:
            if found[needle] is None and needle.lower() in blob:
                found[needle] = row["rank"]
    useful_ranks = [r for r in found.values() if r is not None]
    return {
        "needle_ranks": found,
        "first_useful_rank": min(useful_ranks) if useful_ranks else None,
        "in_top5": {k: v for k, v in found.items() if v is not None and v <= 5},
        "in_top10": {k: v for k, v in found.items() if v is not None and v <= 10},
        "in_top25": {k: v for k, v in found.items() if v is not None and v <= 25},
        "in_top50": {k: v for k, v in found.items() if v is not None and v <= 50},
    }


def main() -> None:
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    i4 = json.loads(I4.read_text(encoding="utf-8"))
    i4_by_id = {row["id"]: row for row in i4["rows"]}
    engine = SearchEngine()

    weak_detail = {}
    for sid in WEAK:
        scenario = next(s for s in dataset["scenarios"] if s["id"] == sid)
        result = search_one(engine, scenario["question"], top_k=50)
        result["question"] = scenario["question"]
        result["useful"] = first_useful(result["hits"], USEFUL_NEEDLES[sid])
        result["top5"] = result["hits"][:5]
        result["i4_top5"] = i4_by_id[sid].get("sources", [])
        result["i4_verdict"] = i4_by_id[sid].get("verdict")
        weak_detail[sid] = {
            k: result[k]
            for k in (
                "question",
                "scope",
                "returned",
                "latency_ms",
                "top5",
                "useful",
                "i4_top5",
                "i4_verdict",
            )
        }
        print(sid, "lat", result["latency_ms"], "first_useful", result["useful"]["first_useful_rank"])
        for hit in result["top5"]:
            print(f"  {hit['rank']} {hit['title'][:70]} | {hit['section'][:50]}")

    full_rows = []
    latencies = []
    for scenario in dataset["scenarios"]:
        result = search_one(engine, scenario["question"], top_k=5)
        latencies.append(result["latency_ms"])
        i4_row = i4_by_id[scenario["id"]]
        full_rows.append(
            {
                "id": scenario["id"],
                "intent": scenario["intent"],
                "category": scenario["category"],
                "question": scenario["question"],
                "scope": result["scope"],
                "latency_ms": result["latency_ms"],
                "top5": result["top5"],
                "i4_verdict": i4_row.get("verdict"),
                "i4_top5": [
                    {"rank": s.get("rank"), "title": s.get("title"), "url": s.get("url")}
                    for s in i4_row.get("sources", [])
                ],
            }
        )

    latencies_sorted = sorted(latencies)
    n = len(latencies_sorted)
    p50 = latencies_sorted[int(0.50 * (n - 1))]
    p95 = latencies_sorted[int(0.95 * (n - 1))]
    payload = {
        "weak": weak_detail,
        "full": full_rows,
        "latency": {
            "n": n,
            "p50": p50,
            "p95": p95,
            "max": max(latencies),
            "mean": round(statistics.mean(latencies), 3),
        },
    }
    (OUT_DIR / "eval_raw.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("latency", payload["latency"])


if __name__ == "__main__":
    main()
