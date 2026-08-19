"""I5 targeted corpus lookups. Read-only."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DB = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag\data\corpus.db")
OUT = Path(__file__).resolve().parent / "targeted_lookups.json"


def main() -> None:
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    def q(sql: str, params=()):
        return [dict(r) for r in con.execute(sql, params)]

    payload = {
        "repo_counts": q(
            "SELECT repo, COUNT(*) n FROM parents GROUP BY repo ORDER BY n DESC"
        ),
        "failover_sections": q(
            """
            SELECT title, section, url, substr(body, 1, 1800) AS body
            FROM parents
            WHERE section LIKE '%failover%' OR body LIKE '%failover mechanism%'
               OR title LIKE '%failover%'
            ORDER BY title, section
            LIMIT 20
            """
        ),
        "priority_voice_route": q(
            """
            SELECT title, section, url
            FROM parents
            WHERE (title LIKE '%Voice Route%' OR title LIKE '%voice routing%'
                   OR url LIKE '%voice-routing%' OR url LIKE '%voice-route%')
              AND (body LIKE '%Priority%' OR body LIKE '%priority%' OR section LIKE '%priority%')
            LIMIT 20
            """
        ),
        "pstn_usage": q(
            """
            SELECT title, section, url
            FROM parents
            WHERE title LIKE '%PSTN usage%' OR url LIKE '%pstn-usage%'
               OR body LIKE '%PSTN usage%'
            LIMIT 15
            """
        ),
        "geo_terms": q(
            """
            SELECT title, section, url
            FROM parents
            WHERE body LIKE '%geo-redundan%' OR body LIKE '%geographic redundan%'
               OR body LIKE '%geographically redundant%' OR body LIKE '%carrier diversity%'
               OR body LIKE '%multiple SBCs%' OR body LIKE '%multiple Session Border%'
            LIMIT 20
            """
        ),
        "one_way_exact": q(
            """
            SELECT title, section, url
            FROM parents
            WHERE body LIKE '%one-way audio%' OR body LIKE '%one way audio%'
               OR body LIKE '%one-way media%' OR title LIKE '%one-way%'
            """
        ),
        "urls_ip_ranges": q(
            """
            SELECT title, section, url
            FROM parents
            WHERE url LIKE '%urls-and-ip%' OR title LIKE '%URLs and IP%'
               OR title LIKE '%Office 365 URLs%' OR title LIKE '%Microsoft 365 URLs%'
            """
        ),
        "call_analytics": q(
            """
            SELECT DISTINCT title, url
            FROM parents
            WHERE title LIKE '%Call Analytics%' OR url LIKE '%call-analytics%'
               OR title LIKE '%Advanced Call Analytics%'
            """
        ),
        "rollout_titles": q(
            """
            SELECT DISTINCT title, url
            FROM parents
            WHERE title LIKE '%Plan for Teams%' OR title LIKE '%Teams Phone%'
               OR title LIKE '%upgrade to Teams%' OR title LIKE '%Prepare your organization%'
               OR title LIKE '%network planner%' OR title LIKE '%Network readiness%'
               OR title LIKE '%coexistence%' OR url LIKE '%upgrade-to-teams%'
               OR url LIKE '%teams-phone%' OR url LIKE '%prepare-network%'
               OR url LIKE '%network-planner%' OR url LIKE '%phone-system%'
            LIMIT 40
            """
        ),
        "application_instance_body": q(
            """
            SELECT title, url, substr(body, 1, 1200) AS body
            FROM parents WHERE title = 'Get-CsOnlineApplicationInstance'
            """
        ),
        "callqueue_body": q(
            """
            SELECT title, url, substr(body, 1, 400) AS body
            FROM parents WHERE title = 'Get-CsCallQueue'
            """
        ),
        "python_terms": {
            "python": q(
                "SELECT COUNT(*) n FROM parents WHERE title LIKE '%python%' OR body LIKE '%python %'"
            )[0]["n"],
            "systemctl": q(
                "SELECT COUNT(*) n FROM parents WHERE body LIKE '%systemctl%'"
            )[0]["n"],
            "journalctl": q(
                "SELECT COUNT(*) n FROM parents WHERE body LIKE '%journalctl%'"
            )[0]["n"],
            "ss_listen": q(
                "SELECT COUNT(*) n FROM parents WHERE body LIKE '%ss -l%' OR body LIKE '%ss -tuln%'"
            )[0]["n"],
        },
        "sba": q(
            "SELECT title, section, url FROM parents WHERE url LIKE '%survivable%' LIMIT 10"
        ),
        "manage_voice_routing": q(
            """
            SELECT title, section, url
            FROM parents
            WHERE url LIKE '%manage-voice-routing-policies%'
               OR url LIKE '%direct-routing-voice-routing%'
            LIMIT 20
            """
        ),
    }
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("wrote", OUT)
    print("geo_terms", len(payload["geo_terms"]))
    print("one_way", payload["one_way_exact"])
    print("urls_ip", payload["urls_ip_ranges"])
    print("call_analytics", payload["call_analytics"])
    print("rollout_n", len(payload["rollout_titles"]))
    print("python_terms", payload["python_terms"])
    print("failover_n", len(payload["failover_sections"]))


if __name__ == "__main__":
    main()
