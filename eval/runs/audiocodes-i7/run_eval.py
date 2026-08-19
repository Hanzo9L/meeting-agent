"""I7 retrieval eval. Frozen R0.4 + I6B query shape. No ranking changes."""
from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN))
os.chdir(LEARN)

from service.scope_select import select_scope  # noqa: E402
from service.search import SearchEngine  # noqa: E402

ROOT = Path(r"C:\Users\joegc\projects\meeting-agent")
AC = ROOT / "eval/datasets/audiocodes_direct_routing_scenarios.json"
TSUC = ROOT / "eval/datasets/two_sigma_uc_systems_engineer_scenarios.json"
I6B = ROOT / "eval/runs/two-sigma-uc-i6b/results.json"
OUT = ROOT / "eval/runs/audiocodes-i7"


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return ordered[idx]


def classify(hit) -> str:
    blob = f"{hit.title}\n{hit.url}\n{hit.repo}\n{hit.ms_service}\n{hit.ms_collection}".lower()
    if hit.repo == "audiocodes" or "audiocodes" in blob:
        return "AudioCodes"
    if hit.repo == "linux" or "linux" in (hit.ms_service or ""):
        return "Linux"
    return "Microsoft"


def hit_dict(hit, rank: int) -> dict:
    tier = classify(hit)
    return {
        "rank": rank,
        "title": hit.title,
        "section": hit.section,
        "url": hit.url,
        "repo": hit.repo,
        "ms_service": hit.ms_service,
        "ms_collection": hit.ms_collection,
        "authority_tier": "Tier 2 — certified SBC vendor" if tier == "AudioCodes" else (
            "Linux upstream" if tier == "Linux" else "Tier 1 — Microsoft"
        ),
        "publisher_guess": tier,
        "score": round(hit.score, 6),
        "matched_by": list(hit.matched_by),
        "title_has_audiocodes": "audiocodes" in (hit.title or "").lower(),
        "url_is_audiocodes": "audiocodes.com" in (hit.url or "").lower(),
        "looks_like_microsoft_learn": "learn.microsoft.com" in (hit.url or "").lower(),
    }


def search_one(engine: SearchEngine, question: str, top_k: int = 5) -> dict:
    t0 = time.perf_counter()
    scope = select_scope(question)
    route_ms = (time.perf_counter() - t0) * 1000
    hits, timing = engine.search(question, top_k=top_k, **scope.search_kwargs())
    ranked = [hit_dict(hit, i) for i, hit in enumerate(hits, 1)]
    pubs = [h["publisher_guess"] for h in ranked]
    return {
        "scope": {
            "confidence": scope.confidence,
            "service": scope.service,
            "repo": scope.repo,
            "reason": scope.reason,
        },
        "latency_ms": round(timing.total_ms, 3),
        "route_ms": round(route_ms, 3),
        "top5": ranked[:5],
        "hits": ranked,
        "microsoft_authority_present": any(p == "Microsoft" for p in pubs[:5]),
        "vendor_authority_present": any(p == "AudioCodes" for p in pubs[:5]),
        "vendor_specificity_clear": all(
            (h["title_has_audiocodes"] or h["url_is_audiocodes"])
            and not h["looks_like_microsoft_learn"]
            for h in ranked[:5]
            if h["publisher_guess"] == "AudioCodes"
        ) if any(p == "AudioCodes" for p in pubs[:5]) else None,
    }


def main() -> None:
    ac = json.loads(AC.read_text(encoding="utf-8"))
    tsuc = json.loads(TSUC.read_text(encoding="utf-8"))
    i6b = json.loads(I6B.read_text(encoding="utf-8"))
    i6b_by = {r["id"]: r for r in i6b["rows"]}
    engine = SearchEngine()
    engine.search("warmup Direct Routing SBC", top_k=5)

    ac_rows = []
    for scenario in ac["scenarios"]:
        result = search_one(engine, scenario["question"], top_k=5)
        row = {
            "id": scenario["id"],
            "intent": scenario["intent"],
            "question": scenario["question"],
            "expected_microsoft_themes": scenario["expected_microsoft_themes"],
            "expected_audiocodes_themes": scenario["expected_audiocodes_themes"],
            "must_not_do": scenario["must_not_do"],
            **result,
        }
        ac_rows.append(row)
        print(
            scenario["id"],
            "MS" if row["microsoft_authority_present"] else "-",
            "AC" if row["vendor_authority_present"] else "-",
            [f"{h['rank']}:{h['publisher_guess'][:2]}:{h['title'][:48]}" for h in row["top5"]],
        )

    cross = {}
    for sid in ("TSUC04", "TSUC13"):
        scenario = next(s for s in tsuc["scenarios"] if s["id"] == sid)
        result = search_one(engine, scenario["question"], top_k=10)
        prev = i6b_by[sid]
        result["i6b_top5"] = prev["top5"]
        result["question"] = scenario["question"]
        cross[sid] = result
        print(sid, [f"{h['rank']}:{h['publisher_guess'][:2]}:{h['title'][:50]}" for h in result["top5"]])

    # discard warmup already done; measure 30-bank
    bank = []
    lats = []
    pollution = []
    for scenario in tsuc["scenarios"]:
        result = search_one(engine, scenario["question"], top_k=5)
        lats.append(result["latency_ms"])
        prev = i6b_by[scenario["id"]]
        prev_keys = [(h["title"], h["section"], h["url"]) for h in prev["top5"]]
        now_keys = [(h["title"], h["section"], h["url"]) for h in result["top5"]]
        ac_in = [h for h in result["top5"] if h["publisher_guess"] == "AudioCodes"]
        row = {
            "id": scenario["id"],
            "question": scenario["question"],
            "i6b_grade": prev["i6b_grade"],
            "latency_ms": result["latency_ms"],
            "top5_changed": prev_keys != now_keys,
            "audiocodes_in_top5": [h["title"] for h in ac_in],
            "microsoft_authority_present": result["microsoft_authority_present"],
            "vendor_authority_present": result["vendor_authority_present"],
            "top5": result["top5"],
            "i6b_top5": prev["top5"],
        }
        bank.append(row)
        if ac_in and scenario["id"] not in {"TSUC04", "TSUC05", "TSUC07", "TSUC13"}:
            # vendor on a question that is not SBC-config/HA/media is potential pollution
            pollution.append(scenario["id"])

    payload = {
        "phase": "I7",
        "audiocodes_scenarios": ac_rows,
        "tsuc_crosscheck": cross,
        "bank30": bank,
        "pollution_candidate_ids": pollution,
        "latency": {
            "bank30": {
                "n": len(lats),
                "p50": round(percentile(lats, 50), 3),
                "p95": round(percentile(lats, 95), 3),
                "max": round(max(lats), 3),
                "mean": round(statistics.mean(lats), 3),
            },
            "i6b_clean_warm": (i6b.get("latency") or {}).get("bank30_clean_warm"),
        },
        "top5_changed_ids": [r["id"] for r in bank if r["top5_changed"]],
    }
    (OUT / "eval_raw.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("latency", payload["latency"])
    print("changed", payload["top5_changed_ids"])
    print("pollution_candidates", pollution)


if __name__ == "__main__":
    main()
