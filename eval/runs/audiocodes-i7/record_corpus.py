"""Record I7 pre/post corpus metrics. Read-only."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
DB = LEARN / "data" / "corpus.db"
INDEX = LEARN / "data" / "hnsw.bin"
OUT_DIR = Path(r"C:\Users\joegc\projects\meeting-agent\eval\runs\audiocodes-i7")


def fingerprint(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "corpus_before.json"
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    docs_sql = "SELECT COUNT(DISTINCT repo || '::' || path) c FROM parents"
    payload = {
        "parents": con.execute("SELECT COUNT(*) c FROM parents").fetchone()["c"],
        "children": con.execute("SELECT COUNT(*) c FROM children").fetchone()["c"],
        "documents": con.execute(docs_sql).fetchone()["c"],
        "sqliteBytes": DB.stat().st_size,
        "hnswBytes": INDEX.stat().st_size,
        "corpusFingerprint": fingerprint(DB),
        "indexFingerprint": fingerprint(INDEX),
        "searchHash": hashlib.sha256((LEARN / "service" / "search.py").read_bytes()).hexdigest()[:16],
        "scopeHash": hashlib.sha256((LEARN / "service" / "scope_select.py").read_bytes()).hexdigest()[:16],
        "repos": [dict(r) for r in con.execute(
            "SELECT repo, COUNT(*) n FROM parents GROUP BY repo ORDER BY n DESC"
        )],
    }
    payload["vectors"] = payload["children"]
    out = OUT_DIR / name
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
