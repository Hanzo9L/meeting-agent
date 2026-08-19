"""Record I6A pre-ingest corpus metrics. Read-only."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
DB = LEARN / "data" / "corpus.db"
INDEX = LEARN / "data" / "hnsw.bin"
OUT = Path(__file__).resolve().parent / "corpus_before.json"


def fingerprint(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()[:16]


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
parents = con.execute("SELECT COUNT(*) c FROM parents").fetchone()["c"]
children = con.execute("SELECT COUNT(*) c FROM children").fetchone()["c"]
docs = con.execute("SELECT COUNT(DISTINCT repo || '::' || path) c FROM parents").fetchone()["c"]
repos = [dict(r) for r in con.execute("SELECT repo, COUNT(*) n FROM parents GROUP BY repo ORDER BY n DESC")]
payload = {
    "parents": parents,
    "children": children,
    "documents": docs,
    "vectors": children,
    "sqliteBytes": DB.stat().st_size,
    "hnswBytes": INDEX.stat().st_size,
    "corpusFingerprint": fingerprint(DB),
    "indexFingerprint": fingerprint(INDEX),
    "searchHash": file_hash(LEARN / "service" / "search.py")[:16],
    "scopeHash": file_hash(LEARN / "service" / "scope_select.py")[:16],
    "repos": repos,
}
OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(json.dumps(payload, indent=2))
