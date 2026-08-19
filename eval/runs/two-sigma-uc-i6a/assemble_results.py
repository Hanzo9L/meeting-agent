"""Assemble I6A results.json with human grades."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(r"C:\Users\joegc\projects\meeting-agent")
raw = json.loads((ROOT / "eval/runs/two-sigma-uc-i6a/eval_raw.json").read_text(encoding="utf-8"))
delta = json.loads((ROOT / "eval/runs/two-sigma-uc-i6a/corpus_delta.json").read_text(encoding="utf-8"))

HUMAN = {
    "TSUC01": "GOOD",
    "TSUC02": "GOOD",
    "TSUC03": "GOOD",
    "TSUC04": "PARTIAL",
    "TSUC05": "GOOD",
    "TSUC06": "GOOD",
    "TSUC07": "GOOD",
    "TSUC08": "GOOD",
    "TSUC09": "GOOD",
    "TSUC10": "GOOD",
    "TSUC11": "GOOD",
    "TSUC12": "GOOD",
    "TSUC13": "PARTIAL",
    "TSUC14": "GOOD",
    "TSUC15": "GOOD",
    "TSUC16": "GOOD",
    "TSUC17": "GOOD",
    "TSUC18": "GOOD",
    "TSUC19": "GOOD",
    "TSUC20": "GOOD",
    "TSUC21": "GOOD",
    "TSUC22": "GOOD",
    "TSUC23": "GOOD",
    "TSUC24": "GOOD",
    "TSUC25": "PARTIAL",
    "TSUC26": "PARTIAL",
    "TSUC27": "PARTIAL",
    "TSUC28": "GOOD",
    "TSUC29": "PERSONAL",
    "TSUC30": "PERSONAL",
}

I4_MAP = {
    "well_served": "GOOD",
    "partial": "PARTIAL",
    "corpus_gap": "MISS",
    "story_required": "PERSONAL",
}

WHY = {
    "TSUC04": "Top 5 identical to I4. Trunk failover still not in top 40. New Phone System landing at rank 22 only. Source expansion did not surface already-local resiliency pages.",
    "TSUC13": "Top 5 still GCC High / licensing / ringback. Call-flows and URLs/IP are in the corpus but not in top 50. Media bypass remains rank 14.",
    "TSUC20": "systemctl rank 1, ps rank 2, ss rank 4. Residual SharePoint/CQD noise at 3 and 5. A senior engineer can speak from the Linux parents.",
    "TSUC22": "ss rank 1 and tcpdump rank 4 replace CQD-as-Linux false positives. Residual Teams quality page at rank 2. Corpus gap closed.",
    "TSUC25": "No corpus change. Cmdlet pages still cannot answer script-methodology. Interview context only.",
    "TSUC26": "Control unchanged: AutoAttendant 1, CallQueue 6, ApplicationInstance absent from pool.",
    "TSUC27": "Top 5 still AA/CQ. New planning pages entered at ranks 8, 13, 22, 28 — coverage improved, ranking did not.",
    "TSUC02": "Top 1 shifted to Set up Teams Phone / choose PSTN option. Still valid PSTN-failure evidence; not a regression.",
}

rows = []
counts = {"GOOD": 0, "PARTIAL": 0, "MISS": 0, "PERSONAL": 0}
for row in raw["full"]:
    sid = row["id"]
    i4 = I4_MAP[row["i4_verdict"]]
    i6 = HUMAN[sid]
    counts[i6] += 1
    item = {
        "id": sid,
        "intent": row["intent"],
        "category": row["category"],
        "question": row["question"],
        "route": row["scope"],
        "latency_ms": row["latency_ms"],
        "i4_grade": i4,
        "i6a_grade": i6,
        "changed": i4 != i6,
        "why": WHY.get(sid, "Previously GOOD technical case; top evidence remains interview-usable."),
        "top5": [
            {
                "rank": h["rank"],
                "title": h["title"],
                "section": h["section"],
                "url": h["url"],
                "score": h["score"],
                "matched_by": h["matched_by"],
            }
            for h in row["top5"]
        ],
    }
    if sid in raw["weak"]:
        item["first_useful"] = raw["weak"][sid]["useful"]
        item["i4_top5"] = raw["weak"][sid]["i4_top5"]
    rows.append(item)

payload = {
    "generatedAt": "2026-08-19T19:30:00.000Z",
    "phase": "I6A",
    "engine": {
        "engine": "learn-rag-r0.4",
        "searchHash": "8702daf1ee2b2843",
        "scopeHash": "2a8caaabd00f4b08",
        "corpusFingerprintBefore": delta["before"]["corpusFingerprint"],
        "corpusFingerprintAfter": delta["after"]["corpusFingerprint"],
        "indexFingerprintBefore": delta["before"]["indexFingerprint"],
        "indexFingerprintAfter": delta["after"]["indexFingerprint"],
    },
    "countsBefore": {
        "GOOD": 21,
        "PARTIAL": 6,
        "MISS": 1,
        "PERSONAL": 2,
    },
    "countsAfter": counts,
    "latency": raw["latency"],
    "i4LatencyMs": {"p50": 17, "p95": 21, "max": 118, "note": "I4 runner elapsedMs including child startup on first query"},
    "rows": rows,
}
out = ROOT / "eval/runs/two-sigma-uc-i6a/results.json"
out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(counts)
print("wrote", out)
