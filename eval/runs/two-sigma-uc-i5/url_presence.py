import sqlite3
from pathlib import Path

p = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag\data\corpus.db")
con = sqlite3.connect(f"file:{p.as_posix()}?mode=ro", uri=True)
needles = [
    "pstn-connectivity",
    "cloud-voice-landing",
    "setting-up-your-phone-system",
    "upgrade-framework",
    "prepare-network",
    "online-call-flows",
    "upgrade-plan",
    "network-planner",
    "shared-calling",
    "pilot-essentials",
    "urls-and-ip-address-ranges",
]
for n in needles:
    c = con.execute(
        "SELECT COUNT(*), MIN(title) FROM parents WHERE url LIKE ?",
        (f"%{n}%",),
    ).fetchone()
    print(n, c[0], c[1])
