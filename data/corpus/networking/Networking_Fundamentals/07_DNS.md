---
title: DNS
level: beginner
tags:
- dns
- name-resolution
- records
- caching
source_basis:
- naming/dns.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__07_DNS
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# DNS

## What DNS does

**DNS (Domain Name System)** is a distributed, hierarchical naming system. It lets applications use names while the network ultimately communicates using addresses and other record data.

The beginner shorthand "DNS converts names to IP addresses" is useful, but DNS can return many types of information.

## Common record types

| Record | Purpose |
|---|---|
| A | Name to IPv4 address |
| AAAA | Name to IPv6 address |
| CNAME | Alias to another canonical name |
| MX | Mail exchanger information |
| NS | Authoritative name server information |
| SRV | Service location information, including target/port/priority/weight |
| TXT | Text data used for many verification/policy purposes |

## Hierarchy

DNS names are hierarchical:

```text
host.department.example.com
                     ^  ^
                  domain TLD
```

The global system is divided into administrative **zones**, served by authoritative name servers.

## Recursive resolution in simplified form

A client usually asks a recursive resolver, not every authoritative server itself.

```text
Client -> recursive DNS resolver
              |
              +-> root/TLD/authoritative chain as needed
              |
Client <- final/cached answer
```

Resolvers cache answers according to the record's **TTL (time to live)**. Caching reduces repeated work but explains why DNS changes may not appear everywhere instantly.

## DNS vs connectivity

This distinction is vital:

```text
ping 8.8.8.8 works
ping example.com fails
```

That strongly suggests IP connectivity may exist while name resolution is failing.

The reverse is also possible: DNS can return a valid address even though routing or a firewall prevents reaching it.

## UC relevance

SIP and other communications systems may use DNS to locate services, proxies, gateways, or cloud endpoints. A voice problem can therefore begin as a DNS problem before any signaling or media session exists.

## Useful checks

Windows:

```powershell
ipconfig /all
nslookup example.com
Resolve-DnsName example.com
```

Linux/macOS examples:

```bash
dig example.com
nslookup example.com
```

## Troubleshooting sequence

1. Confirm the client has the intended DNS server(s).
2. Query the exact name.
3. Check whether the result is correct and current.
4. Compare behavior using a known IP destination.
5. Remember that cached answers can persist until TTL expiry.
6. If service discovery is involved, inspect SRV/CNAME chains rather than only A records.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
