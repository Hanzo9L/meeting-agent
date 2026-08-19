"""I7 AudioCodes / Mediant Direct Routing vendor pack seed.

Writes official AudioCodes markdown into learn-rag repos/audiocodes, then the
existing `python -m build.run --skip-sync` path indexes it.

Does not change search.py, scope_select.py, query shaping, chunk sizes, or HNSW.
"""
from __future__ import annotations

import io
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yaml

LEARN_RAG = Path(r"C:\Users\joegc\projects\learn-rag\learn-rag")
sys.path.insert(0, str(LEARN_RAG))

from build.config import REPO_DIR  # noqa: E402

HEADERS = {
    "User-Agent": "learn-rag-r0-benchmark/1.0",
    "Accept": "text/html,application/pdf,application/xhtml+xml,*/*",
}

SKIP_TAGS = {
    "script", "style", "nav", "button", "svg", "footer", "header",
    "noscript", "form", "iframe",
}

PDF_FOOTER = re.compile(
    r"^(contents sbc|configuration note|audiocodes mediant|"
    r"document #:|page \d+|-\s*\d+\s*-$)",
    re.I,
)
PDF_SECTION = re.compile(
    r"^((?:\d+\.)+\d+|[A-Z]\.\d+)\s+[A-Z0-9].{5,140}$"
)
PDF_CHAPTER = re.compile(r"^(\d+)\s+[A-Z][A-Za-z'].{8,90}$")

SOURCES = [
    {
        "family": "A",
        "kind": "pdf",
        "title": "AudioCodes Mediant SBC with Microsoft Teams Direct Routing (Enterprise Model)",
        "url": "https://www.audiocodes.com/media/13253/connecting-audiocodes-sbc-to-microsoft-teams-direct-routing-enterprise-model-configuration-note.pdf",
        "topics": [
            "teams-direct-routing", "sip", "tls", "certificate", "signaling",
            "media", "routing", "proxy-set", "ip-group",
        ],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-plan",
            "https://learn.microsoft.com/microsoftteams/direct-routing-configure",
            "https://learn.microsoft.com/microsoftteams/direct-routing-connect-the-sbc",
        ],
        "description": (
            "AudioCodes official configuration note: connecting a Mediant SBC to "
            "Microsoft Teams Direct Routing Enterprise model. Publisher=AudioCodes; "
            "vendor=audiocodes; authority=certified_sbc_vendor; product_family=mediant; "
            "domain=direct-routing; source_role=vendor_implementation_reference. "
            "Covers TLS context, certificates, SIP interfaces, proxy sets, IP groups, "
            "media realms, and IP-to-IP routing."
        ),
    },
    {
        "family": "D",
        "kind": "pdf",
        "title": "AudioCodes Mediant SBC to Microsoft Teams Direct Routing with Local Media Optimization",
        "url": "https://www.audiocodes.com/media/15757/mediant-sbc-to-microsoft-teams-direct-routing-with-local-media-optimization.pdf",
        "topics": ["teams-direct-routing", "media", "media-bypass", "sip", "signaling"],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-media-optimization",
            "https://learn.microsoft.com/microsoftteams/microsoft-teams-online-call-flows",
        ],
        "description": (
            "AudioCodes official configuration note for Teams Direct Routing with "
            "Local Media Optimization. Publisher=AudioCodes; vendor=audiocodes; "
            "authority=certified_sbc_vendor; product_family=mediant; domain=direct-routing; "
            "source_role=vendor_implementation_reference."
        ),
    },
    {
        "family": "C",
        "kind": "html",
        "title": "AudioCodes Mediant SBC: Overview of High Availability Mode",
        "url": "https://techdocs.audiocodes.com/session-border-controller-sbc/mediant-software-sbc/user-manual/version-740/content/um/HA%20Overview.htm",
        "topics": ["ha", "redundancy", "failover"],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-plan",
            "https://learn.microsoft.com/microsoftteams/direct-routing-sbc-multiple-tenants",
        ],
        "description": (
            "AudioCodes Mediant Software SBC User's Manual 7.40: 1+1 HA overview, "
            "maintenance interface, and call continuity on switchover. "
            "Publisher=AudioCodes; vendor=audiocodes; authority=certified_sbc_vendor; "
            "product_family=mediant; domain=direct-routing; source_role=vendor_implementation_reference."
        ),
    },
    {
        "family": "C",
        "kind": "html",
        "title": "AudioCodes Mediant SBC: Device Switchover upon Failure",
        "url": "https://techdocs.audiocodes.com/session-border-controller-sbc/mediant-software-sbc/user-manual/version-740/content/um/Device%20Switchover%20upon%20Failure.htm",
        "topics": ["ha", "redundancy", "failover"],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-trunk-failover",
            "https://learn.microsoft.com/microsoftteams/direct-routing-voice-routing",
        ],
        "description": (
            "AudioCodes Mediant Software SBC User's Manual 7.40: HA switchover on "
            "active-device failure, preempt mode, keep-alive, and link-loss behavior. "
            "Publisher=AudioCodes; vendor=audiocodes; authority=certified_sbc_vendor; "
            "product_family=mediant; domain=direct-routing; source_role=vendor_implementation_reference."
        ),
    },
    {
        "family": "C",
        "kind": "html",
        "title": "AudioCodes Mediant SBC: Quick-and-Easy Initial HA Configuration",
        "url": "https://techdocs.audiocodes.com/session-border-controller-sbc/mediant-software-sbc/user-manual/version-740/content/um/Fast-and-Easy%20Initial%20Configuration.htm",
        "topics": ["ha", "redundancy"],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-plan",
        ],
        "description": (
            "AudioCodes Mediant Software SBC User's Manual 7.40: initial 1+1 HA setup "
            "using shared ini parameters, MAC identity, maintenance interface, and preempt. "
            "Publisher=AudioCodes; vendor=audiocodes; authority=certified_sbc_vendor; "
            "product_family=mediant; domain=direct-routing; source_role=vendor_implementation_reference."
        ),
    },
    {
        "family": "C",
        "kind": "html",
        "title": "AudioCodes Mediant SBC: Initialize HA on the Devices",
        "url": "https://techdocs.audiocodes.com/session-border-controller-sbc/mediant-software-sbc/user-manual/version-740/Content/UM/Step%203_%20Initialize%20HA%20on%20the%20Devices.htm",
        "topics": ["ha", "redundancy", "failover"],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-plan",
        ],
        "description": (
            "AudioCodes Mediant Software SBC User's Manual 7.40: cabling, power-up, "
            "HA synchronization, and Operational status after initializing an HA pair. "
            "Publisher=AudioCodes; vendor=audiocodes; authority=certified_sbc_vendor; "
            "product_family=mediant; domain=direct-routing; source_role=vendor_implementation_reference."
        ),
    },
    {
        "family": "E",
        "kind": "html",
        "title": "AudioCodes Mediant SBC: Viewing Proxy Set Status",
        "url": "https://techdocs.audiocodes.com/session-border-controller-sbc/mediant-software-sbc/user-manual/version-740/Content/UM/Viewing%20Proxy%20Set%20Status.htm",
        "topics": ["sip", "signaling", "failover"],
        "microsoft_crossref": [
            "https://learn.microsoft.com/microsoftteams/direct-routing-monitor-and-troubleshoot",
            "https://learn.microsoft.com/microsoftteams/direct-routing-connect-the-sbc",
        ],
        "description": (
            "AudioCodes Mediant Software SBC User's Manual 7.40: Proxy Set ONLINE/OFFLINE "
            "status from SIP OPTIONS keep-alive success and failure counts. "
            "Publisher=AudioCodes; vendor=audiocodes; authority=certified_sbc_vendor; "
            "product_family=mediant; domain=direct-routing; source_role=vendor_implementation_reference."
        ),
    },
]


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
            self.parts.append(f"\n\n{'#' * max(2, int(tag[1]))} ")
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


def html_to_markdown(html: str) -> str:
    lower = html.lower()
    chunk = html
    for marker in ('role="main"', "<main", 'id="content"', 'id="mc-main-content"'):
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
    text = re.sub(r"(?i)www\.audiocodes\.com\s*$", "", text.strip())
    return text.strip()


def pdf_to_markdown(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    lines_out: list[str] = []
    seen_toc = False
    for page in reader.pages:
        raw = page.extract_text() or ""
        for line in raw.splitlines():
            text = re.sub(r"\s+", " ", line).strip()
            if not text:
                continue
            if PDF_FOOTER.search(text):
                continue
            if text.lower().startswith("table of contents"):
                seen_toc = True
                continue
            if seen_toc and re.match(r".+\s+\d+$", text) and "..." in text:
                continue
            if PDF_SECTION.match(text) or PDF_CHAPTER.match(text):
                lines_out.append(f"\n## {text}\n")
            else:
                lines_out.append(text)
    body = "\n".join(lines_out)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def dest_for(url: str, kind: str) -> Path:
    parsed = urlparse(url)
    path = parsed.path.lstrip("/")
    if kind == "pdf":
        rel = "docs/media/" + path.split("media/", 1)[-1]
        if not rel.endswith(".md"):
            rel += ".md"
        return REPO_DIR / "audiocodes" / rel
    rel_path = path
    if parsed.query:
        rel_path = path
    rel = "docs/techdocs/" + rel_path + ".md"
    return REPO_DIR / "audiocodes" / rel


def write_doc(spec: dict, body: str, final_url: str) -> dict:
    dest = dest_for(spec["url"], spec["kind"])
    if len(body) < 200:
        return {
            "ok": False,
            "title": spec["title"],
            "url": spec["url"],
            "reason": f"body too short ({len(body)})",
        }
    front = {
        "title": spec["title"],
        "description": spec["description"],
        "ms.topic": "vendor_implementation_reference",
        "ms.service": "audiocodes-sbc",
        "ms.subservice": "mediant",
        "ms.date": "",
        "ms.collection": "certified_sbc_vendor",
        "audience": "itpro",
        "publisher": "AudioCodes",
        "vendor": "audiocodes",
        "authority": "certified_sbc_vendor",
        "product_family": "mediant",
        "domain": "direct-routing",
        "source_role": "vendor_implementation_reference",
        "topics": spec["topics"],
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
        "path": str(dest.relative_to(REPO_DIR)),
        "chars": len(body),
        "family": spec["family"],
        "kind": spec["kind"],
        "topics": spec["topics"],
        "microsoft_crossref": spec["microsoft_crossref"],
    }


def main() -> None:
    results = []
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=90.0) as client:
        for spec in SOURCES:
            response = client.get(spec["url"])
            status = response.status_code
            final_url = str(response.url)
            if status != 200:
                row = {
                    "ok": False,
                    "title": spec["title"],
                    "url": spec["url"],
                    "status": status,
                    "finalUrl": final_url,
                }
                results.append(row)
                print("FAIL", spec["title"], status)
                continue
            if spec["kind"] == "pdf":
                body = pdf_to_markdown(response.content)
            else:
                body = html_to_markdown(response.text)
            row = write_doc(spec, body, final_url)
            row["status"] = status
            results.append(row)
            print(("ok" if row["ok"] else "FAIL"), spec["title"], row.get("chars") or row.get("reason"))
            time.sleep(0.1)
    out = Path(__file__).resolve().parent / "seed_log.json"
    out.write_text(__import__("json").dumps(results, indent=2), encoding="utf-8")
    ok = sum(1 for r in results if r.get("ok"))
    print(f"[i7 seed] {ok}/{len(SOURCES)}")
    if ok != len(SOURCES):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
