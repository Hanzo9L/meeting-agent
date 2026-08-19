"""I6B retrieval eval. Query-shape only. Does not change corpus, HNSW, or fusion."""
from __future__ import annotations

import hashlib
import json
import os
import statistics
import sys
import time
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN))
os.chdir(LEARN)

from eval.evaluate_priority14 import first_match, load_ground_truth  # noqa: E402
from eval.run_r0_1 import QUESTIONS, Q04_SECTION, Q04_URL, Q14_URL  # noqa: E402
from service.scope_select import select_scope  # noqa: E402
from service.search import SearchEngine, build_fts_query  # noqa: E402

ROOT = Path(r"C:\Users\joegc\projects\meeting-agent")
DATASET = ROOT / "eval/datasets/two_sigma_uc_systems_engineer_scenarios.json"
I6A = ROOT / "eval/runs/two-sigma-uc-i6a/results.json"
OUT_DIR = ROOT / "eval/runs/two-sigma-uc-i6b"
TARGETS = ["TSUC04", "TSUC13", "TSUC26", "TSUC27"]
GT_PATH = LEARN / "eval/ground_truth/priority14_retrieval.json"

FTS_BEFORE = {
    "TSUC04": (
        '"direct routing" OR "design" OR "global" OR "organization" OR '
        '"place" OR "SBCs" OR "happens" OR "if" OR "SBC" OR "carrier" OR "fails"'
    ),
    "TSUC13": '"direct routing" OR "one" OR "way" OR "audio" OR "Teams" OR "call"',
    "TSUC26": (
        '"Which Teams PowerShell" OR "Auto Attendants" OR "Call Queues" OR '
        '"cmdlets" OR "inspect" OR "resource" OR "accounts"'
    ),
    "TSUC27": (
        '"Teams Voice" OR "phase" OR "global" OR "rollout" OR "reduce" OR '
        '"risk" OR "during" OR "major" OR "UC" OR "migration"'
    ),
}

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


def sha16(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return ordered[idx]


def hit_dict(hit, rank: int) -> dict:
    return {
        "rank": rank,
        "title": hit.title,
        "section": hit.section,
        "url": hit.url,
        "repo": hit.repo,
        "ms_service": hit.ms_service,
        "score": round(hit.score, 6),
        "matched_by": list(hit.matched_by),
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


def search_one(engine: SearchEngine, question: str, top_k: int) -> dict:
    t0 = time.perf_counter()
    scope = select_scope(question)
    route_ms = (time.perf_counter() - t0) * 1000
    hits, timing = engine.search(question, top_k=top_k, **scope.search_kwargs())
    ranked = [hit_dict(hit, i) for i, hit in enumerate(hits, 1)]
    return {
        "scope": {
            "confidence": scope.confidence,
            "service": scope.service,
            "repo": scope.repo,
            "reason": scope.reason,
        },
        "fts_query": timing.fts_query or engine.last_fts_query,
        "returned": len(hits),
        "route_ms": round(route_ms, 3),
        "latency_ms": round(timing.total_ms, 3),
        "wall_ms": round(route_ms + timing.total_ms, 3),
        "top5": ranked[:5],
        "top10": ranked[:10],
        "hits": ranked,
    }


def slim_p14(hits) -> list[dict]:
    return [
        {
            "rank": i + 1,
            "title": h.title,
            "section": h.section,
            "url": h.url,
        }
        for i, h in enumerate(hits)
    ]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    i6a = json.loads(I6A.read_text(encoding="utf-8"))
    i6a_by_id = {row["id"]: row for row in i6a["rows"]}
    gt = {q["question_id"]: q for q in load_ground_truth(GT_PATH)["questions"]}
    qmap = {s["id"]: s["question"] for s in dataset["scenarios"]}

    engine = SearchEngine()
    engine.search("warmup Direct Routing SBC", top_k=5)

    query_change = {
        "baseline_hashes": {
            "search.py_before": "8702daf1ee2b2843",
            "search.py_after": sha16(LEARN / "service/search.py"),
            "scope_select.py": sha16(LEARN / "service/scope_select.py"),
        },
        "targets": {},
    }
    target_detail = {}
    target_latencies = []
    for sid in TARGETS:
        question = qmap[sid]
        result = search_one(engine, question, top_k=50)
        useful = first_useful(result["hits"], USEFUL_NEEDLES[sid])
        target_latencies.append(result["latency_ms"])
        target_detail[sid] = {
            "question": question,
            "scope": result["scope"],
            "fts_before": FTS_BEFORE[sid],
            "fts_after": result["fts_query"],
            "latency_ms": result["latency_ms"],
            "i6a_latency_ms": i6a_by_id[sid]["latency_ms"],
            "top5": result["top5"],
            "top10": result["top10"],
            "useful": useful,
            "i6a_useful": i6a_by_id[sid].get("first_useful"),
            "i6a_top5": i6a_by_id[sid]["top5"],
        }
        query_change["targets"][sid] = {
            "fts_before": FTS_BEFORE[sid],
            "fts_after": result["fts_query"],
            "route": result["scope"],
        }
        print(sid, "lat", result["latency_ms"], "useful", useful["needle_ranks"])
        for hit in result["top5"]:
            print(f"  {hit['rank']} {hit['title'][:72]} | {hit['section'][:48]}")

    named_cmdlet = (
        "Which Teams PowerShell cmdlets inspect Get-CsAutoAttendant "
        "Get-CsCallQueue Get-CsOnlineApplicationInstance?"
    )
    control = search_one(engine, named_cmdlet, top_k=10)
    control["useful"] = first_useful(control["hits"], USEFUL_NEEDLES["TSUC26"])
    target_detail["TSUC26_named_cmdlet_control"] = {
        "question": named_cmdlet,
        "scope": control["scope"],
        "fts_after": control["fts_query"],
        "top5": control["top5"],
        "useful": control["useful"],
    }

    full_rows = []
    latencies = []
    for scenario in dataset["scenarios"]:
        result = search_one(engine, scenario["question"], top_k=5)
        latencies.append(result["latency_ms"])
        prev = i6a_by_id[scenario["id"]]
        prev_keys = [
            (h["title"], h["section"], h["url"]) for h in prev["top5"]
        ]
        now_keys = [
            (h["title"], h["section"], h["url"]) for h in result["top5"]
        ]
        full_rows.append(
            {
                "id": scenario["id"],
                "intent": scenario["intent"],
                "category": scenario["category"],
                "question": scenario["question"],
                "route": result["scope"],
                "latency_ms": result["latency_ms"],
                "fts_query": result["fts_query"],
                "i6a_grade": prev["i6a_grade"],
                "i6a_latency_ms": prev["latency_ms"],
                "top5_changed": prev_keys != now_keys,
                "top5": result["top5"],
                "i6a_top5": [
                    {
                        "rank": h["rank"],
                        "title": h["title"],
                        "section": h["section"],
                        "url": h["url"],
                    }
                    for h in prev["top5"]
                ],
            }
        )

    p14_rows = []
    p14_lat = []
    for qid, question in QUESTIONS:
        spec = gt[qid]
        t0 = time.perf_counter()
        decision = select_scope(question)
        route_ms = (time.perf_counter() - t0) * 1000
        hits, timing = engine.search(question, top_k=5, **decision.search_kwargs())
        p14_lat.append(timing.total_ms)
        records = slim_p14(hits)
        if spec["status"] == "SOURCE_GAP":
            grade = {
                "rank_grade": "SOURCE_GAP",
                "top1_correct": False,
                "top3_correct": False,
                "top5_correct": False,
                "match": None,
            }
        else:
            targets = spec["acceptable_sources"]
            m1 = first_match(records, targets, 1)
            m3 = first_match(records, targets, 3)
            m5 = first_match(records, targets, 5)
            if m1:
                rg = "TOP1_CORRECT"
            elif m3:
                rg = "TOP3_CORRECT"
            elif m5:
                rg = "TOP5_CORRECT"
            else:
                rg = "MISS"
            grade = {
                "rank_grade": rg,
                "top1_correct": bool(m1),
                "top3_correct": bool(m3),
                "top5_correct": bool(m5),
                "match": m5,
            }
        q04 = None
        if qid == "Q04":
            q04 = next(
                (
                    h
                    for h in records
                    if h["url"].rstrip("/").lower() == Q04_URL
                    and (h.get("section") or "") == Q04_SECTION
                ),
                None,
            )
        q14 = None
        if qid == "Q14":
            q14 = next(
                (
                    h
                    for h in records
                    if h["url"].rstrip("/").lower()
                    == Q14_URL
                ),
                None,
            )
        rec = {
            "question_id": qid,
            "question": question,
            "scope": "SCOPED" if decision.scoped else "GLOBAL",
            "confidence": decision.confidence,
            "service": decision.service,
            "fts_query": timing.fts_query,
            "latency_ms": round(timing.total_ms, 3),
            "route_ms": round(route_ms, 3),
            "hits": records,
            **grade,
            "q04_overview": q04,
            "q14_get_csonlineuser": q14,
        }
        p14_rows.append(rec)
        print(
            qid,
            rec["scope"],
            rec["confidence"],
            rec["rank_grade"],
            [h["title"][:40] for h in records[:3]],
        )

    answerable = [r for r in p14_rows if r["rank_grade"] != "SOURCE_GAP"]
    n = len(answerable)
    top1 = sum(1 for r in answerable if r["top1_correct"])
    top3 = sum(1 for r in answerable if r["top3_correct"])
    top5 = sum(1 for r in answerable if r["top5_correct"])

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": "I6B",
        "engine": {
            "engine": "learn-rag-r0.4",
            "searchHashBefore": "8702daf1ee2b2843",
            "searchHashAfter": sha16(LEARN / "service/search.py"),
            "scopeHash": sha16(LEARN / "service/scope_select.py"),
        },
        "targets": target_detail,
        "rows": full_rows,
        "latency": {
            "targets": {
                "n": len(target_latencies),
                "p50": round(percentile(target_latencies, 50), 3),
                "p95": round(percentile(target_latencies, 95), 3),
                "max": round(max(target_latencies), 3),
                "mean": round(statistics.mean(target_latencies), 3),
            },
            "bank30": {
                "n": len(latencies),
                "p50": round(percentile(latencies, 50), 3),
                "p95": round(percentile(latencies, 95), 3),
                "max": round(max(latencies), 3),
                "mean": round(statistics.mean(latencies), 3),
            },
            "priority14": {
                "n": len(p14_lat),
                "p50": round(percentile(p14_lat, 50), 3),
                "p95": round(percentile(p14_lat, 95), 3),
                "max": round(max(p14_lat), 3),
                "mean": round(statistics.mean(p14_lat), 3),
            },
            "i6a_bank30": i6a.get("latency"),
        },
        "priority14": {
            "top1": f"{top1}/{n}",
            "top3": f"{top3}/{n}",
            "top5": f"{top5}/{n}",
            "top1_n": top1,
            "top3_n": top3,
            "top5_n": top5,
            "answerable_n": n,
            "questions": p14_rows,
        },
        "top5_changed_ids": [r["id"] for r in full_rows if r["top5_changed"]],
    }
    (OUT_DIR / "eval_raw.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )
    query_change["latency"] = payload["latency"]
    query_change["priority14"] = {
        "top1": payload["priority14"]["top1"],
        "top3": payload["priority14"]["top3"],
        "top5": payload["priority14"]["top5"],
    }
    (OUT_DIR / "query_change.json").write_text(
        json.dumps(query_change, indent=2), encoding="utf-8"
    )
    print("latency", payload["latency"])
    print("priority14", query_change["priority14"])
    print("top5_changed", payload["top5_changed_ids"])


if __name__ == "__main__":
    main()
