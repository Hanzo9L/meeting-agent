"""Extra I5 rank needles. Read-only."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

LEARN_RAG = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN_RAG))
os.chdir(LEARN_RAG)

from service.scope_select import select_scope
from service.search import SearchEngine

OUT = Path(r"C:\Users\joegc\projects\meeting-agent\eval\runs\two-sigma-uc-i5\extra_ranks.json")


def ranks_for(engine, question, needles):
    scope = select_scope(question)
    hits, _ = engine.search(question, top_k=100, **scope.search_kwargs())
    found = {n: None for n in needles}
    titles = []
    for i, hit in enumerate(hits, 1):
        blob = f"{hit.title}\n{hit.section}\n{hit.url}".lower()
        titles.append({"rank": i, "title": hit.title, "url": hit.url})
        for n in needles:
            if found[n] is None and n.lower() in blob:
                found[n] = i
    return {
        "scope": {"confidence": scope.confidence, "service": scope.service, "reason": scope.reason},
        "returned": len(hits),
        "needle_ranks": found,
        "all_titles": titles,
    }


def main():
    con = sqlite3.connect(f"file:{(LEARN_RAG / 'data' / 'corpus.db').as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    teams_ps = [dict(r) for r in con.execute(
        "SELECT title, url FROM parents WHERE repo = 'teams-ps' ORDER BY title"
    )]
    engine = SearchEngine()
    q04 = "How would you design Direct Routing for a global organization? Where would you place the SBCs, and what happens if an SBC or carrier fails?"
    q13 = "How would you troubleshoot one-way audio on a Teams Direct Routing call?"
    q26 = "Which Teams PowerShell cmdlets inspect resource accounts, Auto Attendants, and Call Queues?"
    q26b = "Get-CsOnlineApplicationInstance Get-CsAutoAttendant Get-CsCallQueue resource accounts"
    payload = {
        "teams_ps_parents": teams_ps,
        "TSUC04": ranks_for(
            engine,
            q04,
            [
                "direct-routing-trunk-failover-on-outbound-call",
                "direct-routing-voice-routing",
                "direct-routing-survivable-branch",
                "direct-routing-plan",
                "set-csonlinepstngateway",
            ],
        ),
        "TSUC13": ranks_for(
            engine,
            q13,
            [
                "use-call-analytics-to-troubleshoot-poor-call-quality",
                "set-up-call-analytics",
                "direct-routing-plan-media-bypass",
                "direct-routing-protocols-media",
                "direct-routing-configure-media-bypass",
                "monitor-call-quality-qos",
            ],
        ),
        "TSUC26": ranks_for(
            engine,
            q26,
            ["get-csautoattendant", "get-cscallqueue", "get-csonlineapplicationinstance"],
        ),
        "TSUC26_cmdlet_named": ranks_for(
            engine,
            q26b,
            ["get-csautoattendant", "get-cscallqueue", "get-csonlineapplicationinstance"],
        ),
    }
    # drop bulky all_titles except TSUC26
    payload["TSUC04"].pop("all_titles")
    payload["TSUC13"].pop("all_titles")
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("teams-ps", len(teams_ps))
    for row in teams_ps:
        print(" ", row["title"])
    print("TSUC04", payload["TSUC04"]["needle_ranks"], "n", payload["TSUC04"]["returned"])
    print("TSUC13", payload["TSUC13"]["needle_ranks"], "n", payload["TSUC13"]["returned"])
    print("TSUC26", payload["TSUC26"]["needle_ranks"], "n", payload["TSUC26"]["returned"])
    print("TSUC26 named", payload["TSUC26_cmdlet_named"]["needle_ranks"], "n", payload["TSUC26_cmdlet_named"]["returned"])
    print("named titles", payload["TSUC26_cmdlet_named"]["all_titles"])


if __name__ == "__main__":
    main()
