import json
import sqlite3
from pathlib import Path

con = sqlite3.connect(r"C:\Users\joegc\projects\learn-rag\learn-rag\data\corpus.db")
con.row_factory = sqlite3.Row
print("=== docs ===")
for r in con.execute(
    "SELECT path, title, COUNT(*) n, MIN(length(body)) minb, MAX(length(body)) maxb "
    "FROM parents WHERE repo='audiocodes' GROUP BY path ORDER BY n DESC"
):
    print(f"{r['n']:3d} parents  {r['minb']:5d}-{r['maxb']:5d}c  {r['title'][:72]}")

print("\n=== TLS sample ===")
for r in con.execute(
    "SELECT title, section, url, substr(body,1,420) b FROM parents "
    "WHERE repo='audiocodes' AND (lower(section) LIKE '%tls context%' "
    "OR lower(section) LIKE '%certificate%') LIMIT 2"
):
    print("---", r["section"][:90])
    print(r["url"])
    print(r["b"])
    print()

print("=== HA sample ===")
for r in con.execute(
    "SELECT title, section, url, length(body) n, substr(body,1,320) b FROM parents "
    "WHERE repo='audiocodes' AND (lower(title) LIKE '%high availability%' "
    "OR lower(title) LIKE '%switchover%' OR lower(section) LIKE '%switchover%')"
):
    print("---", r["title"][:70], "|", r["section"][:70], "chars", r["n"])
    print(r["url"])
    print(r["b"])
    print()

raw = json.loads(Path(r"C:\Users\joegc\projects\meeting-agent\eval\runs\audiocodes-i7\eval_raw.json").read_text(encoding="utf-8"))
print("=== AC top5 sections ===")
for row in raw["audiocodes_scenarios"]:
    print(row["id"], "MS", row["microsoft_authority_present"], "AC", row["vendor_authority_present"], "clear", row["vendor_specificity_clear"])
    for h in row["top5"]:
        print(f"  {h['rank']} [{h['publisher_guess']}] {h['title'][:62]} | {h['section'][:70]}")
    print()

print("=== changed TSUC ===")
for row in raw["bank30"]:
    if not row["top5_changed"]:
        continue
    print(row["id"], row["i6b_grade"], "AC", row["audiocodes_in_top5"])
    print("  I6B:", [x["title"][:40] for x in row["i6b_top5"]])
    print("  I7 :", [h["publisher_guess"][:2] + ":" + h["title"][:40] for h in row["top5"]])
