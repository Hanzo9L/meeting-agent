"""Inspect I6A sample parents for quality. Read-only."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
DB = LEARN / "data" / "corpus.db"
OUT = Path(__file__).resolve().parent / "quality_inspection.json"

NEEDLES = [
    "urls-and-ip-address-ranges",
    "microsoft-teams-online-call-flows",
    "setting-up-your-phone-system",
    "upgrade-framework",
    "upgrade-plan-journey-evaluate-environment",
    "upgrade-prepare-environment-prepare-service",
    "prepare-network",
    "network-planner",
    "cloud-voice-landing-page",
    "systemctl.html",
    "journalctl.html",
    "ps.1.html",
    "ss.8.html",
    "tcpdump.1.html",
    "interpreter.html",
]

con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
samples = []
for needle in NEEDLES:
    rows = con.execute(
        """
        SELECT repo, title, section, url, path, ms_service, length(body) AS body_len,
               substr(body, 1, 400) AS preview
        FROM parents WHERE url LIKE ? OR path LIKE ?
        ORDER BY section LIMIT 4
        """,
        (f"%{needle}%", f"%{needle}%"),
    ).fetchall()
    samples.append(
        {
            "needle": needle,
            "n": len(rows),
            "rows": [dict(r) for r in rows],
        }
    )

linux_n = con.execute("SELECT COUNT(*) c FROM parents WHERE repo='linux'").fetchone()["c"]
linux_urls = [
    dict(r)
    for r in con.execute(
        "SELECT title, section, url, length(body) body_len FROM parents WHERE repo='linux' ORDER BY title"
    )
]
payload = {
    "linuxParents": linux_n,
    "linuxUrls": linux_urls,
    "samples": samples,
}
OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print("linux parents", linux_n)
for row in linux_urls:
    print(row["title"], row["url"], row["body_len"])
print("--- sample counts ---")
for item in samples:
    print(item["needle"], "parents", item["n"], "url0", item["rows"][0]["url"] if item["rows"] else None)
