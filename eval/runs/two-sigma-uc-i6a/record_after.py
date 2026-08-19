"""Record I6A post-ingest corpus metrics."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

LEARN = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
DB = LEARN / "data" / "corpus.db"
INDEX = LEARN / "data" / "hnsw.bin"
BEFORE = Path(__file__).resolve().parent / "corpus_before.json"
OUT = Path(__file__).resolve().parent / "corpus_after.json"


def fingerprint(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
parents = con.execute("SELECT COUNT(*) FROM parents").fetchone()[0]
children = con.execute("SELECT COUNT(*) FROM children").fetchone()[0]
docs = con.execute("SELECT COUNT(DISTINCT repo || '::' || path) FROM parents").fetchone()[0]
repos = [
    {"repo": r[0], "n": r[1]}
    for r in con.execute("SELECT repo, COUNT(*) n FROM parents GROUP BY repo ORDER BY n DESC")
]
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
before = json.loads(BEFORE.read_text(encoding="utf-8"))
delta = {
    k: payload[k] - before[k]
    for k in ("parents", "children", "documents", "vectors", "sqliteBytes", "hnswBytes")
}
payload["deltaFromBefore"] = delta
OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
print(json.dumps(payload, indent=2))
