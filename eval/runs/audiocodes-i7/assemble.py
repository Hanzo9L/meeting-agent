import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(r"C:\Users\joegc\projects\meeting-agent\eval\runs\audiocodes-i7")
seed = json.loads((OUT / "seed_log.json").read_text(encoding="utf-8"))
before = json.loads((OUT / "corpus_before.json").read_text(encoding="utf-8"))
after = json.loads((OUT / "corpus_after.json").read_text(encoding="utf-8"))
raw = json.loads((OUT / "eval_raw.json").read_text(encoding="utf-8"))

GRADES = {
    "AC01": ("GOOD", "Microsoft Connect-SBC plus AudioCodes pairing/prerequisites. Titles/URLs are AudioCodes-branded."),
    "AC02": ("PARTIAL", "Strong Mediant bring-up/pairing/routing steps. Microsoft Learn layer absent from top 5 (MS objects appear only as copied into the AudioCodes note)."),
    "AC03": ("GOOD", "Microsoft public-trusted-certificate requirements plus AudioCodes TLS/root/intermediate install procedures."),
    "AC04": ("PARTIAL", "Exact Mediant TLS Context / CSR / root-store steps. Microsoft requirement page not in top 5."),
    "AC05": ("GOOD", "Microsoft media-bypass/call-flow plus AudioCodes SIP interface and call-scenario pages."),
    "AC06": ("PARTIAL", "HA overview and initialize-HA surfaced. Product-series filler also in top 5. Microsoft multi-SBC/routing layer absent."),
    "AC07": ("GOOD", "AudioCodes switchover/HA overview plus Microsoft trunk-failover. Layers stay distinct."),
    "AC08": ("PARTIAL", "Microsoft SIP OPTIONS / TLS connectivity. AudioCodes Proxy Set Status did not enter top 5."),
    "AC09": ("PARTIAL", "Microsoft Connect-SBC / PowerShell / supported SBCs present, but rank 1 is AudioCodes IP Profiles (wrong object layer)."),
    "AC10": ("PARTIAL", "Microsoft certified-SBC list and 'configure according to the SBC vendor specification' support the split. Vendor implementation not in top 5."),
    "AC11": ("PARTIAL", "Vendor-specific version/GUI/cert pages only. Microsoft transferable SIP/TLS/routing authority missing."),
    "AC12": ("PARTIAL", "Microsoft LMO site/mode pages plus AudioCodes failover appendix. Does not clearly separate HA-pair vs geo routing."),
}

FAMILY = {
    "A": {
        "name": "Teams Direct Routing configuration on Mediant",
        "microsoft": [
            "Direct Routing architecture / connect the SBC",
            "voice routing policy, PSTN usage, voice route, PSTN gateway",
        ],
    },
    "B": {
        "name": "TLS / certificates (covered inside Enterprise config note)",
        "microsoft": ["Plan Direct Routing: public trusted certificate for the SBC"],
    },
    "C": {
        "name": "HA / redundancy / failover",
        "microsoft": [
            "multi-SBC / trunk failover / voice-route priority",
            "not the same as a vendor 1+1 HA pair",
        ],
    },
    "D": {
        "name": "Media / signaling / LMO",
        "microsoft": ["media bypass", "call flows", "Local Media Optimization"],
    },
    "E": {
        "name": "Troubleshooting / Proxy Set status (SIP OPTIONS keep-alive)",
        "microsoft": ["Monitor Direct Routing", "SBC connectivity / SIP OPTIONS"],
    },
}

manifest = {
    "phase": "I7",
    "pack": "audiocodes-mediant-direct-routing",
    "authority_model": {
        "tier1": "Microsoft — Direct Routing architecture, interoperability, routing, certificates, connectivity",
        "tier2": "AudioCodes — Mediant-specific GUI/CLI, object names, HA implementation",
        "not_merged": True,
    },
    "metadata_fields": {
        "publisher": "AudioCodes",
        "vendor": "audiocodes",
        "authority": "certified_sbc_vendor",
        "product_family": "mediant",
        "domain": "direct-routing",
        "source_role": "vendor_implementation_reference",
        "stored_in": "frontmatter + ms.service=audiocodes-sbc + ms.collection=certified_sbc_vendor + title prefix AudioCodes",
    },
    "families": FAMILY,
    "documents": seed,
    "rejected": [
        "Hosting-model config note (multi-tenant, wrong interview scenario)",
        "CUCM interop note (out of scope)",
        "Full 900-page Mediant user manuals",
        "blogs / reseller / YouTube",
    ],
}
(OUT / "source_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

delta = {
    "before": before,
    "after": after,
    "delta": {
        "documents": after["documents"] - before["documents"],
        "parents": after["parents"] - before["parents"],
        "children": after["children"] - before["children"],
        "vectors": after["vectors"] - before["vectors"],
        "sqliteBytes": after["sqliteBytes"] - before["sqliteBytes"],
        "hnswBytes": after["hnswBytes"] - before["hnswBytes"],
    },
    "searchHashUnchanged": before["searchHash"] == after["searchHash"] == "252e9b3ced85b9b0",
    "scopeHashUnchanged": before["scopeHash"] == after["scopeHash"] == "2a8caaabd00f4b08",
}
(OUT / "corpus_delta.json").write_text(json.dumps(delta, indent=2), encoding="utf-8")

ac_rows = []
counts = {"GOOD": 0, "PARTIAL": 0, "MISS": 0}
for row in raw["audiocodes_scenarios"]:
    grade, why = GRADES[row["id"]]
    counts[grade] += 1
    ac_rows.append({**{k: row[k] for k in row if k != "hits"}, "grade": grade, "why": why})

results = {
    "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "phase": "I7",
    "writeStatus": {
        "relay": "EVAL ARTIFACTS ONLY",
        "learn_rag": "TARGETED VENDOR SOURCE/CORPUS ARTIFACTS ONLY",
    },
    "frozen": {
        "searchHash": after["searchHash"],
        "scopeHash": after["scopeHash"],
        "i6bQueryShape": "252e9b3ced85b9b0",
    },
    "audiocodesCounts": counts,
    "bank30": {
        "GOOD": 23,
        "PARTIAL": 5,
        "MISS": 0,
        "PERSONAL": 2,
        "gradeChanges": [],
        "top5ChangedIds": raw["top5_changed_ids"],
        "audiocodesPollutionIds": [r["id"] for r in raw["bank30"] if r["audiocodes_in_top5"]],
    },
    "latency": raw["latency"],
    "audiocodes_scenarios": ac_rows,
    "tsuc_crosscheck": raw["tsuc_crosscheck"],
    "decision": "B",
}
(OUT / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print("counts", counts)
print("delta", delta["delta"])
