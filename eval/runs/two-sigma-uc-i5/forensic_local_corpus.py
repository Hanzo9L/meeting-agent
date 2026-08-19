"""I5 forensic local-corpus inspection. Read-only. Does not ingest or change R0.4."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

LEARN_RAG = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
DB = LEARN_RAG / "data" / "corpus.db"
OUT = Path(__file__).resolve().parent / "local_corpus_forensics.json"

sys.path.insert(0, str(LEARN_RAG))
os.chdir(LEARN_RAG)

from service.scope_select import select_scope  # noqa: E402
from service.search import SearchEngine  # noqa: E402


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def like_docs(con: sqlite3.Connection, patterns: list[str], limit: int = 40) -> list[dict]:
    clauses = []
    params: list[str] = []
    for pattern in patterns:
        clauses.append(
            "(title LIKE ? OR section LIKE ? OR body LIKE ? OR url LIKE ?)"
        )
        params.extend([pattern, pattern, pattern, pattern])
    sql = f"""
        SELECT parent_id, title, section, url, repo, ms_service,
               length(body) AS body_len
        FROM parents
        WHERE {" OR ".join(clauses)}
        ORDER BY title, section
        LIMIT {limit}
    """
    rows = []
    for row in con.execute(sql, params):
        rows.append(dict(row))
    return rows


def count_term(con: sqlite3.Connection, term: str) -> int:
    return con.execute(
        """
        SELECT COUNT(*) FROM parents
        WHERE title LIKE ? OR section LIKE ? OR body LIKE ? OR url LIKE ?
        """,
        (term, term, term, term),
    ).fetchone()[0]


def exact_title(con: sqlite3.Connection, title: str) -> list[dict]:
    return [
        dict(row)
        for row in con.execute(
            """
            SELECT parent_id, title, section, url, repo
            FROM parents
            WHERE title = ?
            ORDER BY section
            """,
            (title,),
        )
    ]


def search_ranks(engine: SearchEngine, question: str, needles: list[str], top_k: int = 100) -> dict:
    scope = select_scope(question)
    hits, timing = engine.search(question, top_k=top_k, **scope.search_kwargs())
    ranked = []
    found: dict[str, int | None] = {needle: None for needle in needles}
    for index, hit in enumerate(hits, start=1):
        blob = f"{hit.title}\n{hit.section}\n{hit.url}".lower()
        ranked.append(
            {
                "rank": index,
                "title": hit.title,
                "section": hit.section,
                "url": hit.url,
            }
        )
        for needle in needles:
            if found[needle] is None and needle.lower() in blob:
                found[needle] = index
    return {
        "question": question,
        "scope": {
            "confidence": scope.confidence,
            "service": scope.service,
            "repo": scope.repo,
            "reason": scope.reason,
        },
        "returned": len(hits),
        "timing_ms": round(timing.total_ms, 2),
        "needle_ranks": found,
        "top25": ranked[:25],
    }


def main() -> None:
    con = connect()
    parent_count = con.execute("SELECT COUNT(*) FROM parents").fetchone()[0]
    linux_terms = [
        "%systemctl%",
        "%journalctl%",
        "%tcpdump%",
        "/linux/",
        "man7.org",
        "freedesktop.org",
    ]
    linux_hits = {}
    for term in linux_terms:
        linux_hits[term] = count_term(con, term)

    cmdlets = [
        "Get-CsAutoAttendant",
        "Get-CsCallQueue",
        "Get-CsOnlineApplicationInstance",
        "Get-CsOnlineUser",
        "Get-CsOnlineVoiceRoutingPolicy",
        "Get-CsOnlineVoiceRoute",
        "Get-CsOnlinePstnUsage",
        "Get-CsOnlinePSTNGateway",
    ]
    cmdlet_presence = {name: exact_title(con, name) for name in cmdlets}

    families = {
        "geo_failover": like_docs(
            con,
            [
                "%geo-redundan%",
                "%geographic redundan%",
                "%high availability%",
                "%SBC fail%",
                "%carrier fail%",
                "%voice route priority%",
                "%paired SBC%",
                "%multiple SBC%",
                "%survivability%",
                "%Local Media Optimization%",
            ],
            50,
        ),
        "sip_options_health": like_docs(con, ["%SIP OPTIONS%", "%Direct Routing Health%"], 20),
        "one_way_audio": like_docs(
            con,
            [
                "%one-way audio%",
                "%one way audio%",
                "%media path%",
                "%media bypass%",
                "%RTP%",
                "%firewall%Direct Routing%",
            ],
            40,
        ),
        "ports_ip": like_docs(
            con,
            ["%Office 365 URLs and IP address ranges%", "%Teams%UDP%3478%", "%media ports%"],
            20,
        ),
        "rollout": like_docs(
            con,
            [
                "%roll out Teams%",
                "%upgrade to Teams%",
                "%Teams Phone planning%",
                "%network readiness%",
                "%pilot%",
                "%coexistence%",
                "%cutover%",
            ],
            40,
        ),
        "aa_cq_cmdlet_paths": like_docs(
            con,
            [
                "%get-csautoattendant%",
                "%get-cscallqueue%",
                "%get-csonlineapplicationinstance%",
            ],
            20,
        ),
    }

    engine = SearchEngine()
    q04 = "How would you design Direct Routing for a global organization? Where would you place the SBCs, and what happens if an SBC or carrier fails?"
    q13 = "How would you troubleshoot one-way audio on a Teams Direct Routing call?"
    q20 = "How would you use the Linux command line to investigate a failed service, including status, processes, and recent logs?"
    q22 = "How would you identify listening sockets and capture basic network evidence on Linux while diagnosing a UC-related service?"
    q25 = "How would you design a PowerShell or Python script from scratch to identify and remediate a systemic voice-routing misconfiguration?"
    q26 = "Which Teams PowerShell cmdlets inspect resource accounts, Auto Attendants, and Call Queues?"
    q27 = "How would you phase a global Teams Voice rollout and reduce risk during a major UC migration?"

    searches = {
        "TSUC04": search_ranks(
            engine,
            q04,
            [
                "direct-routing-plan",
                "direct-routing-media-optimization",
                "direct-routing-sbc-multiple-tenants",
                "direct-routing-monitor-and-troubleshoot",
                "geo",
                "failover",
                "survivability",
            ],
        ),
        "TSUC13": search_ranks(
            engine,
            q13,
            [
                "direct-routing-plan-media-bypass",
                "direct-routing-protocols-sip",
                "issues-with-inbound-calls",
                "office-365-urls-ip-address-ranges",
                "monitor-troubleshoot-teams-meetings-calls",
                "one-way",
                "media bypass",
            ],
        ),
        "TSUC20": search_ranks(engine, q20, ["systemctl", "journalctl", "linux", "sharepoint"]),
        "TSUC22": search_ranks(engine, q22, ["tcpdump", "ss(", "linux", "monitor-troubleshoot", "cqd"]),
        "TSUC25": search_ranks(
            engine,
            q25,
            [
                "get-csonlinevoiceroute",
                "idempotent",
                "error handling",
                "logging",
            ],
        ),
        "TSUC26": search_ranks(
            engine,
            q26,
            [
                "get-csautoattendant",
                "get-cscallqueue",
                "get-csonlineapplicationinstance",
                "get-csonlineuser",
                "set-csphonenumberassignment",
            ],
        ),
        "TSUC27": search_ranks(
            engine,
            q27,
            [
                "aa-cq-manage-voice-applications-policies",
                "upgrade-to-teams-plan",
                "teams-phone",
                "prepare-network",
                "pilot",
                "rollout",
            ],
        ),
    }

    payload = {
        "parent_count": parent_count,
        "linux_term_counts": linux_hits,
        "cmdlet_presence": {
            name: [{"title": r["title"], "url": r["url"], "section": r["section"]} for r in rows]
            for name, rows in cmdlet_presence.items()
        },
        "family_hits": {
            key: [
                {"title": r["title"], "section": r["section"], "url": r["url"]}
                for r in rows[:25]
            ]
            for key, rows in families.items()
        },
        "family_counts": {key: len(rows) for key, rows in families.items()},
        "r04_ranks": searches,
    }
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")
    print("parents", parent_count)
    print("linux_term_counts", json.dumps(linux_hits))
    print("cmdlets", {k: len(v) for k, v in cmdlet_presence.items()})
    for sid, result in searches.items():
        print(sid, "scope", result["scope"]["confidence"], result["scope"]["service"], "needles", result["needle_ranks"])


if __name__ == "__main__":
    main()
