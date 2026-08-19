"""Compare I4 vs I6A top-5 URLs for regression flags."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(r"C:\Users\joegc\projects\meeting-agent")
i4 = json.loads((ROOT / "eval/runs/two-sigma-uc-i4/results.json").read_text(encoding="utf-8"))
raw = json.loads((ROOT / "eval/runs/two-sigma-uc-i6a/eval_raw.json").read_text(encoding="utf-8"))
out = ROOT / "eval/runs/two-sigma-uc-i6a/regression_compare.json"

rows = []
for row in raw["full"]:
    i4_urls = [s.get("url") for s in row.get("i4_top5") or []]
    i6_urls = [s.get("url") for s in row.get("top5") or []]
    i4_titles = [s.get("title") for s in row.get("i4_top5") or []]
    i6_titles = [s.get("title") for s in row.get("top5") or []]
    linux = [t for t in i6_titles if t and any(x in t.lower() for x in ("systemctl", "journalctl", "tcpdump", "ss(8)", "ps(1)", "grep", "chmod", "ping(8)", "ip(8)", "pcap"))]
    same_top1 = (i4_urls[:1] == i6_urls[:1])
    overlap = len(set(i4_urls) & set(i6_urls))
    rows.append(
        {
            "id": row["id"],
            "i4_verdict": row["i4_verdict"],
            "same_top1": same_top1,
            "url_overlap": overlap,
            "linux_in_top5": linux,
            "i4_top1": i4_titles[:1],
            "i6_top1": i6_titles[:1],
            "i6_titles": i6_titles,
        }
    )

changed = [r for r in rows if not r["same_top1"] or r["url_overlap"] < 3]
linux_pollute = [r for r in rows if r["linux_in_top5"] and r["id"] not in {"TSUC20", "TSUC22"}]
print("top1 changed or overlap<3:")
for r in changed:
    print(r["id"], r["i4_verdict"], "overlap", r["url_overlap"], "linux", r["linux_in_top5"])
    print("  i4", r["i4_top1"])
    print("  i6", r["i6_top1"])
print("linux pollute non-linux scenarios:", [r["id"] for r in linux_pollute])
(out).write_text(json.dumps({"rows": rows, "changed": changed, "linux_pollute": linux_pollute}, indent=2), encoding="utf-8")
