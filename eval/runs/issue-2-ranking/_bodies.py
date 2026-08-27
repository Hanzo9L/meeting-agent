import json
from pathlib import Path

d = json.loads(Path("eval/runs/issue-2-ranking/probe_raw.json").read_text(encoding="utf-8"))

# Print body previews for rank1 and likely-useful hits for selected cases
want = {
    "LIVE-H1-typed": [1],
    "LIVE-H1-stt": [1, 2, 5],
    "LIVE-Q-GEO": list(range(1, 16)),
    "HIST-Q03-ONEWAY": list(range(1, 12)),
    "HIST-Q01-ARCH": [1, 3, 4, 5, 8],
    "HIST-Q13-COPILOT": [1, 3, 5],
    "HIST-TEAMS-ROLLOUT": list(range(1, 12)),
    "LIVE-Q-CERT": [5, 7],
    "CTRL-AUDIOCODES": [1, 4],
    "LIVE-Q-SBC-FAIL": [1, 3],
}

for c in d["cases"]:
    if c["id"] not in want:
        continue
    print("=" * 80)
    print(c["id"])
    ranks = set(want[c["id"]])
    for h in c["hits_production"]:
        if h["rank"] not in ranks:
            continue
        print(f"\n--- P{h['rank']} [{h['publisher']}] {h['title']} :: {h['section']}")
        print(h["url"])
        print(h["body_preview"][:700].replace("\n", " / "))
        print()
