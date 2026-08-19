import json
from pathlib import Path

raw = json.loads(
    Path(r"C:\Users\joegc\projects\meeting-agent\eval\runs\audiocodes-i7\eval_raw.json").read_text(
        encoding="utf-8"
    )
)
lines = []
for row in raw["audiocodes_scenarios"]:
    lines.append(
        f"{row['id']} MS={row['microsoft_authority_present']} AC={row['vendor_authority_present']} clear={row['vendor_specificity_clear']}"
    )
    for h in row["top5"]:
        lines.append(
            f"  {h['rank']} [{h['publisher_guess']}] {h['title'][:68]} || {h['section'][:80]}"
        )
lines.append("---BANK CHANGED---")
for row in raw["bank30"]:
    if not row["top5_changed"] and not row["audiocodes_in_top5"]:
        continue
    lines.append(
        f"{row['id']} {row['i6b_grade']} changed={row['top5_changed']} AC={row['audiocodes_in_top5']}"
    )
    lines.append("  I6B " + " | ".join(x["title"][:36] for x in row["i6b_top5"]))
    lines.append(
        "  I7  "
        + " | ".join(h["publisher_guess"][:2] + ":" + h["title"][:36] for h in row["top5"])
    )
lines.append("---TSUC04/13---")
for sid, row in raw["tsuc_crosscheck"].items():
    lines.append(sid)
    for h in row["top5"]:
        lines.append(
            f"  {h['rank']} [{h['publisher_guess']}] {h['title'][:68]} || {h['section'][:70]}"
        )
out = Path(r"C:\Users\joegc\projects\meeting-agent\eval\runs\audiocodes-i7\inspect_dump.txt")
out.write_text("\n".join(lines), encoding="utf-8")
print("wrote", out)
