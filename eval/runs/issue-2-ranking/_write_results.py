import json
from pathlib import Path

raw = json.loads(Path("eval/runs/issue-2-ranking/probe_raw.json").read_text(encoding="utf-8"))

judgments = {
    "LIVE-H1-typed": {
        "first_useful": {
            "rank": 1,
            "title": "Get-CsOnlineUser",
            "section": "Get-CsOnlineUser",
            "why": "Authored SYNOPSIS/DESCRIPTION of the asked cmdlet",
        },
        "actual_top_ranked_domain": "Microsoft Teams PowerShell",
        "parent_quality": "genuinely relevant cmdlet page (synopsis/syntax/description)",
        "primary_cause": "OTHER",
        "secondary_cause": "adjacent Get-* siblings in ranks 2-5",
        "likely_smallest_fix": "NO_CHANGE_NEEDED",
        "notes": "I9 overlay failure used the STT string, not this typed string",
    },
    "LIVE-H1-stt": {
        "first_useful": {
            "rank": 2,
            "title": "Get-CsOnlineUser",
            "section": "Get-CsOnlineUser",
            "why": "Correct cmdlet; rank 1 is VoiceRoutingPolicy",
        },
        "actual_top_ranked_domain": "Microsoft Teams PowerShell (wrong cmdlet) + Linux man page at rank 5",
        "parent_quality": "rank1 real but different cmdlet; rank5 Linux ps(1) chrome",
        "primary_cause": "RANK1_WRONG_TOP5_GOOD",
        "secondary_cause": "MIXED_CORPUS_POLLUTION; QUERY_SHAPE_WEAK",
        "likely_smallest_fix": "BOUNDED_QUERY_SHAPE",
        "notes": "No ASR alias for gixonline; scope NONE; I9 overlay match",
    },
    "LIVE-H2": {
        "first_useful": {
            "rank": 1,
            "title": "Issues with outbound calls",
            "section": "Some users are unable to make calls",
            "why": "Frozen Priority-14 GT outbound Direct Routing section",
        },
        "actual_top_ranked_domain": "Microsoft Teams Phone troubleshooting",
        "parent_quality": "rank1 correct; peers include setup/AA/roles adjacent pages",
        "primary_cause": "OTHER",
        "secondary_cause": "QUERY_SHAPE_WEAK",
        "likely_smallest_fix": "UI_PEER_SOURCES_ONLY",
        "notes": "No Direct Routing/PSTN phrase in FTS",
    },
    "LIVE-Q-SBC-FAIL": {
        "first_useful": {
            "rank": 3,
            "title": "Trunk failover on outbound calls",
            "section": "Overview",
            "why": "Microsoft trunk/SBC failover overview; rank1 is a narrower H2",
        },
        "actual_top_ranked_domain": "Microsoft Direct Routing trunk failover",
        "parent_quality": "rank1 network-error subsection is related but too narrow vs overview",
        "primary_cause": "RANK1_WRONG_TOP5_GOOD",
        "secondary_cause": "SOURCE_FRAGMENT_QUALITY",
        "likely_smallest_fix": "UI_PEER_SOURCES_ONLY",
        "notes": "failover clause added because fails+sbc; Plan DR SIP FQDN failover is rank 24",
    },
    "LIVE-Q-GEO": {
        "first_useful": {
            "rank": None,
            "title": "Plan Direct Routing",
            "section": "SIP signaling: FQDNs, ports, failover mechanism",
            "why": "Microsoft geo/SIP proxy FQDN failover; not in production fused 44; wide candidates=120 rank 32",
            "production_rank": None,
            "wide120_rank": 32,
        },
        "actual_top_ranked_domain": "AudioCodes Mediant 1+1 HA",
        "parent_quality": "vendor pair HA, not Microsoft geographic trunk redundancy",
        "primary_cause": "MIXED_CORPUS_POLLUTION",
        "secondary_cause": "QUERY_SHAPE_WEAK; CORRECT_BELOW_TOP5",
        "likely_smallest_fix": "BOUNDED_QUERY_SHAPE",
        "notes": "FTS only geographic/redundancy/look/like; ASR strips filler 'like'; country-code table is lexical accident",
    },
    "HIST-Q03-ONEWAY": {
        "first_useful": {
            "rank": 39,
            "title": "Use Call Analytics to troubleshoot poor call quality",
            "section": "Troubleshoot user call quality problems",
            "why": "Best adjacent Microsoft media-quality page; no one-way-audio parent exists",
        },
        "actual_top_ranked_domain": "Microsoft Direct Routing monitoring / media bypass; AudioCodes pairing at 4",
        "parent_quality": "no dedicated runbook; aliases pull media bypass; GCC High conferencing is a false friend",
        "primary_cause": "SOURCE_MISSING",
        "secondary_cause": "QUERY_SHAPE_WEAK; MIXED_CORPUS_POLLUTION",
        "likely_smallest_fix": "TARGETED_SOURCE_ADD",
        "notes": "Read-only corpus scan: zero parents mention one-way audio",
    },
    "HIST-Q01-ARCH": {
        "first_useful": {
            "rank": 5,
            "title": "Plan Direct Routing",
            "section": "Overview",
            "why": "Microsoft DR+SBC planning overview",
        },
        "actual_top_ranked_domain": "AudioCodes vendor implementation notes",
        "parent_quality": "vendor prerequisite tables and analog-device Step 1 PowerShell vs Microsoft overview",
        "primary_cause": "MIXED_CORPUS_POLLUTION",
        "secondary_cause": "RANK1_WRONG_TOP5_GOOD",
        "likely_smallest_fix": "SOURCE_FILTER",
        "notes": "Configure Direct Routing Overview is rank 8",
    },
    "LIVE-H4-POOR-AUDIO": {
        "first_useful": {
            "rank": 1,
            "title": "Use Call Analytics to troubleshoot poor call quality",
            "section": "Troubleshoot user call quality problems",
            "why": "Matches the isolation question; matches I9 overlay",
        },
        "actual_top_ranked_domain": "Microsoft Call Analytics / CQD",
        "parent_quality": "rank1 good; rank5 Rooms hardware is a different failure domain",
        "primary_cause": "OTHER",
        "secondary_cause": "SOURCE_FRAGMENT_QUALITY on CQD dimension tables / Rooms peer",
        "likely_smallest_fix": "UI_PEER_SOURCES_ONLY",
        "notes": "",
    },
    "HIST-Q13-COPILOT": {
        "first_useful": {
            "rank": 5,
            "title": "Get ready for Microsoft 365 Copilot with SharePoint Advanced Management",
            "section": "Step 3: Prevent accidental oversharing",
            "why": "Governance/oversharing; rank3 is backup/restore",
        },
        "actual_top_ranked_domain": "Microsoft SharePoint/OneDrive generic rollout",
        "parent_quality": "rollout/pilot landing pages; backup step is Copilot-branded but wrong step",
        "primary_cause": "RANK1_WRONG_TOP5_GOOD",
        "secondary_cause": "QUERY_SHAPE_WEAK; SOURCE_FRAGMENT_QUALITY",
        "likely_smallest_fix": "BOUNDED_QUERY_SHAPE",
        "notes": "Copilot forces unscoped search by design",
    },
    "HIST-TEAMS-ROLLOUT": {
        "first_useful": {
            "rank": 5,
            "title": "Prepare your service for an upgrade to Microsoft Teams",
            "section": "Onboarding checklists and landing pages for Microsoft Teams",
            "why": "Closest adoption/upgrade program parent in production list",
        },
        "actual_top_ranked_domain": "Microsoft Teams network planning",
        "parent_quality": "network prep adjacent; Rooms Update Rings is lexical accident",
        "primary_cause": "QUERY_SHAPE_WEAK",
        "secondary_cause": "SOURCE_FRAGMENT_QUALITY",
        "likely_smallest_fix": "BOUNDED_QUERY_SHAPE",
        "notes": "FTS is roll/out/Teams/large/organization only",
    },
    "LIVE-Q-CERT": {
        "first_useful": {
            "rank": 7,
            "title": "Plan Direct Routing",
            "section": "Public trusted certificate for the SBC",
            "why": "Microsoft SBC certificate requirement",
        },
        "actual_top_ranked_domain": "AudioCodes wildcard CSR procedures",
        "parent_quality": "vendor implementation + What's New changelog vs Microsoft requirement section",
        "primary_cause": "MIXED_CORPUS_POLLUTION",
        "secondary_cause": "QUERY_SHAPE_WEAK",
        "likely_smallest_fix": "BOUNDED_QUERY_SHAPE",
        "notes": "Single-token FTS 'certificate'; no follow-up context resolver",
    },
    "CTRL-AUDIOCODES": {
        "first_useful": {
            "rank": 4,
            "title": "AudioCodes Mediant SBC to Microsoft Teams Direct Routing with Local Media Optimization",
            "section": "2 SIP Trunk to Teams",
            "why": "Actual vendor DR procedure; rank1 is terminology glossary",
        },
        "actual_top_ranked_domain": "AudioCodes (expected)",
        "parent_quality": "glossary/chrome first; procedure later",
        "primary_cause": "SOURCE_FRAGMENT_QUALITY",
        "secondary_cause": None,
        "likely_smallest_fix": "SOURCE_QUALITY_CLEANUP",
        "notes": "Control case: vendor SHOULD appear. Microsoft Plan DR not in top 5",
    },
    "CTRL-LINUX": {
        "first_useful": {
            "rank": 1,
            "title": "systemctl",
            "section": "systemctl",
            "why": "Linux service control; expected",
        },
        "actual_top_ranked_domain": "Linux systemctl plus Microsoft CQD/Teams meeting in top 5",
        "parent_quality": "rank1 good; Microsoft CQD pages are reverse pollution",
        "primary_cause": "MIXED_CORPUS_POLLUTION",
        "secondary_cause": "QUERY_SHAPE_WEAK",
        "likely_smallest_fix": "BOUNDED_QUERY_SHAPE",
        "notes": "Control case for Linux SHOULD appear; Microsoft still occupies 3 of top 5",
    },
}

cases = []
for c in raw["cases"]:
    j = judgments[c["id"]]
    top5 = [
        {
            "rank": h["rank"],
            "title": h["title"],
            "section": h["section"],
            "repo": h["repo"],
            "publisher": h["publisher"],
            "score": h["score"],
            "matched_by": h["matched_by"],
            "url": h["url"],
        }
        for h in c["top5"]
    ]
    cases.append(
        {
            "id": c["id"],
            "raw_question": c["question"],
            "source": c["source"],
            "route": c["query_shaping"]["router"],
            "expected_domain": c["expected_domain"],
            "actual_top_ranked_domain": j["actual_top_ranked_domain"],
            "current_top_5": top5,
            "first_useful_source_and_rank": j["first_useful"],
            "query_shaping_trace": c["query_shaping"],
            "mixed_corpus_check": c["mixed_corpus_top5"],
            "parent_quality_check": j["parent_quality"],
            "primary_cause": j["primary_cause"],
            "secondary_cause": j["secondary_cause"],
            "likely_smallest_fix_category": j["likely_smallest_fix"],
            "notes": j["notes"],
            "production_fused_unique": c["production_fused_unique"],
        }
    )

out = {
    "phase": "ISSUE2_RANKING_FORENSIC",
    "production_modified": False,
    "fingerprints": raw["fingerprints"],
    "relay_live_path": {
        "top_k": 5,
        "candidates": 30,
        "vector_query": "raw question text",
        "asr_applied_to_search": False,
        "asr_applied_to_scope_cues": True,
    },
    "decision_gate": "E",
    "decision_gate_label": "MULTIPLE CAUSES — NEED ONE SMALL FIX PER CLASS",
    "cases": cases,
}
Path("eval/runs/issue-2-ranking/results.json").write_text(
    json.dumps(out, indent=2), encoding="utf-8"
)
print("wrote results.json", len(cases), "cases")
