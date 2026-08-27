import json
from pathlib import Path

d = json.loads(Path("eval/runs/issue-2-ranking/probe_raw.json").read_text(encoding="utf-8"))
print("FINGERPRINTS")
for k, v in d["fingerprints"].items():
    print(f"  {k}: {v}")
print()
for c in d["cases"]:
    print("=" * 80)
    print(c["id"], "|", c["question"])
    qs = c["query_shaping"]
    print(" ASR:", qs["normalized_query"] if qs["asr_changed"] else "(unchanged)")
    print(" FTS:", qs["lexical_fts"][:240])
    print(
        " phrases:",
        qs["preserved_phrases"],
        "aliases:",
        qs["aliases_added"],
        "dropped:",
        qs["dropped_terms"],
    )
    print(" route:", qs["router"])
    print(" cues:", qs["cues"])
    print(" failover_added:", qs["failover_clause_added"])
    print(" top5:")
    for h in c["top5"]:
        print(
            f"  {h['rank']} {h['publisher']:11} {h['matched_by']} "
            f"{h['title'][:55]} :: {h['section'][:45]}"
        )
    mix = c["mixed_corpus_top5"]
    print(
        " mix top5",
        mix["top5_counts"],
        "pollution",
        mix["pollution"],
        mix["non_microsoft_without_substantive_relevance"],
    )
    print(
        " fused",
        c["production_fused_unique"],
        "prod_hits",
        len(c["hits_production"]),
        "wide",
        len(c["hits_wide_candidates_120"]),
    )
