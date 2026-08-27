import json
from pathlib import Path

d = json.loads(Path("eval/runs/issue-2-ranking/probe_raw.json").read_text(encoding="utf-8"))

needles = {
    "LIVE-H1-typed": ["get-csonlineuser", "synopsis", "returns information about users"],
    "LIVE-H1-stt": ["get-csonlineuser", "ps(1)", "voicerouting"],
    "LIVE-H2": ["issues with outbound", "some users are unable", "direct routing"],
    "LIVE-Q-SBC-FAIL": ["trunk failover", "sip signaling", "fqdn", "sip.pstnhub", "geographic"],
    "LIVE-Q-GEO": ["trunk failover", "sip signaling", "fqdn", "geo", "redundan", "multiple", "datacenter"],
    "HIST-Q03-ONEWAY": ["one-way", "one way", "media bypass", "call analytics", "media path"],
    "HIST-Q01-ARCH": ["plan direct routing", "overview", "configure direct routing"],
    "LIVE-H4-POOR-AUDIO": ["call analytics", "cqd", "direct routing", "media"],
    "HIST-Q13-COPILOT": ["oversharing", "sharepoint advanced", "restricted", "step 3"],
    "HIST-TEAMS-ROLLOUT": ["upgrade framework", "adoption", "pilot", "voice", "plan for teams"],
    "LIVE-Q-CERT": ["public trusted certificate", "sbc certificate"],
    "CTRL-AUDIOCODES": ["mediant", "direct routing", "plan direct routing"],
    "CTRL-LINUX": ["systemctl", "journalctl", "systemd"],
}

for c in d["cases"]:
    print("=" * 80)
    print(c["id"])
    keys = needles.get(c["id"], [])
    print("-- production --")
    for h in c["hits_production"]:
        blob = f"{h['title']} {h['section']} {h['url']} {h['body_preview']}".lower()
        if any(k in blob for k in keys):
            print(
                f"  P{h['rank']:02d} [{h['publisher']}] {h['title'][:50]} :: {h['section'][:40]}"
            )
    print("-- wide120 not in prod urls --")
    prod_urls = {h["url"] + h["section"] for h in c["hits_production"]}
    for h in c["hits_wide_candidates_120"]:
        blob = f"{h['title']} {h['section']} {h['url']} {h['body_preview']}".lower()
        key = h["url"] + h["section"]
        if key in prod_urls:
            continue
        if any(k in blob for k in keys):
            print(
                f"  W{h['rank']:02d} [{h['publisher']}] {h['title'][:50]} :: {h['section'][:40]}"
            )
