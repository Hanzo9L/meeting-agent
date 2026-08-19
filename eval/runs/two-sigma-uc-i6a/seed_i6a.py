"""I6A targeted seed: approved Microsoft Learn pages + Linux upstream pack.

Writes markdown into the existing learn-rag repo layout, then `python -m build.run
--skip-sync` parses/embeds/indexes with the frozen transform/chunker.

Does not call the full TOC crawler.
"""
from __future__ import annotations

import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import httpx
import yaml

LEARN_RAG = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN_RAG))

from build.config import REPO_DIR  # noqa: E402
from build.seed_learn import HEADERS, download_one, html_to_markdown, to_frontmatter  # noqa: E402

LEARN = "https://learn.microsoft.com/en-us/"

MICROSOFT_PATHS = [
    "microsoft-365/enterprise/urls-and-ip-address-ranges",
    "microsoftteams/microsoft-teams-online-call-flows",
    "microsoftteams/setting-up-your-phone-system",
    "microsoftteams/upgrade-framework",
    "microsoftteams/upgrade-plan-journey-evaluate-environment",
    "microsoftteams/upgrade-prepare-environment-prepare-service",
    "microsoftteams/prepare-network",
    "microsoftteams/network-planner",
    "microsoftteams/cloud-voice-landing-page",
]

LINUX_SOURCES = [
    {
        "title": "systemctl",
        "url": "https://www.freedesktop.org/software/systemd/man/latest/systemctl.html",
        "rel": "docs/freedesktop/systemctl.html.md",
        "description": "systemd service manager command",
    },
    {
        "title": "journalctl",
        "url": "https://www.freedesktop.org/software/systemd/man/latest/journalctl.html",
        "rel": "docs/freedesktop/journalctl.html.md",
        "description": "query the systemd journal",
    },
    {
        "title": "ps(1)",
        "url": "https://man7.org/linux/man-pages/man1/ps.1.html",
        "rel": "docs/man7-man1/ps.1.html.md",
        "description": "report a snapshot of current processes",
    },
    {
        "title": "grep(1)",
        "url": "https://man7.org/linux/man-pages/man1/grep.1.html",
        "rel": "docs/man7-man1/grep.1.html.md",
        "description": "print lines that match patterns",
    },
    {
        "title": "tail(1)",
        "url": "https://man7.org/linux/man-pages/man1/tail.1.html",
        "rel": "docs/man7-man1/tail.1.html.md",
        "description": "output the last part of files",
    },
    {
        "title": "chmod(1)",
        "url": "https://man7.org/linux/man-pages/man1/chmod.1.html",
        "rel": "docs/man7-man1/chmod.1.html.md",
        "description": "change file mode bits",
    },
    {
        "title": "ss(8)",
        "url": "https://man7.org/linux/man-pages/man8/ss.8.html",
        "rel": "docs/man7-man8/ss.8.html.md",
        "description": "another utility to investigate sockets",
    },
    {
        "title": "ip(8)",
        "url": "https://man7.org/linux/man-pages/man8/ip.8.html",
        "rel": "docs/man7-man8/ip.8.html.md",
        "description": "show / manipulate routing, network devices, interfaces and tunnels",
    },
    {
        "title": "ping(8)",
        "url": "https://man7.org/linux/man-pages/man8/ping.8.html",
        "rel": "docs/man7-man8/ping.8.html.md",
        "description": "send ICMP ECHO_REQUEST to network hosts",
    },
    {
        "title": "tcpdump",
        "url": "https://www.tcpdump.org/manpages/tcpdump.1.html",
        "rel": "docs/tcpdump/tcpdump.1.html.md",
        "description": "dump traffic on a network",
    },
    {
        "title": "pcap-filter(7)",
        "url": "https://www.tcpdump.org/manpages/pcap-filter.7.html",
        "rel": "docs/tcpdump/pcap-filter.7.html.md",
        "description": "packet filter syntax",
    },
    {
        "title": "Using the Python Interpreter",
        "url": "https://docs.python.org/3/tutorial/interpreter.html",
        "rel": "docs/python-tutorial/interpreter.html.md",
        "description": "invoking the Python interpreter and running scripts",
    },
]

SKIP_TAGS = {
    "script", "style", "nav", "button", "svg", "footer", "header",
    "noscript", "form", "iframe",
}


class _GenericExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0
        self.href = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.skip:
            self.skip += 1
            return
        attrs_d = dict(attrs)
        ident = " ".join(filter(None, [attrs_d.get("id"), attrs_d.get("class")]))
        lowered = ident.lower()
        if tag in SKIP_TAGS or "navbar" in lowered or "footer" in lowered:
            self.skip = 1
            return
        if tag in {"h1", "h2", "h3", "h4"}:
            self.parts.append(f"\n\n{'#' * int(tag[1])} ")
        elif tag in {"p", "li", "tr", "pre"}:
            self.parts.append("\n")
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "a":
            self.href = attrs_d.get("href") or ""
        elif tag == "code":
            self.parts.append(" `")

    def handle_endtag(self, tag: str) -> None:
        if self.skip:
            self.skip -= 1
            return
        if tag == "a" and self.href:
            self.parts.append(f" ({self.href})")
            self.href = ""
        elif tag == "code":
            self.parts.append("` ")
        elif tag in {"h1", "h2", "h3", "h4", "p", "li", "pre"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        text = re.sub(r"\s+", " ", data)
        if text.strip():
            self.parts.append(text)


def linux_html_to_markdown(html: str) -> str:
    body = html_to_markdown(html)
    if len(body) >= 200:
        return body
    lower = html.lower()
    chunk = html
    for marker in ('role="main"', "<main", 'id="content"'):
        idx = lower.find(marker)
        if idx >= 0:
            start = html.rfind("<", 0, idx + 1)
            chunk = html[start if start >= 0 else idx :]
            break
    else:
        start = lower.find("<body")
        if start >= 0:
            chunk = html[start:]
    parser = _GenericExtractor()
    parser.feed(chunk)
    text = "".join(parser.parts)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def write_linux(client: httpx.Client, spec: dict) -> dict:
    dest = REPO_DIR / "linux" / spec["rel"]
    response = client.get(spec["url"], timeout=60.0)
    status = response.status_code
    final_url = str(response.url)
    if status != 200:
        return {"ok": False, "title": spec["title"], "url": spec["url"], "status": status}
    body = linux_html_to_markdown(response.text)
    if len(body) < 80:
        return {
            "ok": False,
            "title": spec["title"],
            "url": spec["url"],
            "status": status,
            "reason": f"body too short ({len(body)})",
            "finalUrl": final_url,
        }
    front = {
        "title": spec["title"],
        "description": spec["description"],
        "ms.topic": "reference",
        "ms.service": "linux-upstream",
        "ms.subservice": "linux_upstream_primary",
        "ms.date": "",
        "ms.collection": "",
        "audience": "itpro",
        "source_url": spec["url"],
    }
    dumped = yaml.safe_dump(front, sort_keys=False, allow_unicode=True).strip()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(f"---\n{dumped}\n---\n\n{body}\n", encoding="utf-8")
    return {
        "ok": True,
        "title": spec["title"],
        "url": spec["url"],
        "finalUrl": final_url,
        "path": str(dest),
        "chars": len(body),
    }


def main() -> None:
    results = {"microsoft": [], "linux": []}
    with httpx.Client(headers=HEADERS, follow_redirects=True) as client:
        for path in MICROSOFT_PATHS:
            ok = download_one(client, path)
            url = urljoin(LEARN, path)
            results["microsoft"].append({"path": path, "url": url, "ok": ok})
            print(("ok" if ok else "FAIL"), path)
            time.sleep(0.05)
        for spec in LINUX_SOURCES:
            row = write_linux(client, spec)
            results["linux"].append(row)
            print(("ok" if row["ok"] else "FAIL"), spec["title"], row.get("chars") or row.get("reason") or row.get("status"))
            time.sleep(0.05)
    out = Path(__file__).resolve().parent / "seed_log.json"
    out.write_text(__import__("json").dumps(results, indent=2), encoding="utf-8")
    ms_ok = sum(1 for r in results["microsoft"] if r["ok"])
    lx_ok = sum(1 for r in results["linux"] if r["ok"])
    print(f"[i6a seed] microsoft {ms_ok}/{len(MICROSOFT_PATHS)} linux {lx_ok}/{len(LINUX_SOURCES)}")
    if ms_ok != len(MICROSOFT_PATHS) or lx_ok != len(LINUX_SOURCES):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
