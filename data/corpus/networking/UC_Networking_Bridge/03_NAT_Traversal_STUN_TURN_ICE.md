---
title: 'NAT Traversal: STUN, TURN, and ICE'
level: beginner
tags:
- nat
- stun
- turn
- ice
- media
source_basis:
- federation/scale.rst
- virtual/vpn.rst
sourceId: networking_beginner
documentId: UC_Networking_Bridge__03_NAT_Traversal_STUN_TURN_ICE
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# NAT Traversal: STUN, TURN, and ICE

## The NAT traversal problem

Two endpoints may each have only private addresses that are not globally routable.

```text
Endpoint A 10.0.0.20 -- NAT A -- Internet -- NAT B -- 192.168.5.40 Endpoint B
```

Neither endpoint can simply advertise its private IP and expect the other to send Internet traffic directly to it.

## STUN

**STUN** helps a client discover how it appears from outside its NAT, including the public-facing mapped address/port observed by a STUN server.

Think: **What address does the outside world see for me?**

STUN by itself does not guarantee that two endpoints can establish a direct path through every type of NAT/firewall.

## TURN

**TURN** provides a relay when direct peer-to-peer connectivity is not viable.

```text
Endpoint A -> TURN relay -> Endpoint B
```

Relay traffic consumes infrastructure bandwidth, but it provides a dependable fallback when direct media is impossible.

## ICE

**ICE (Interactive Connectivity Establishment)** coordinates candidate gathering and connectivity checks. Candidates can include:

- host/local addresses;
- server-reflexive addresses learned through STUN;
- relay addresses obtained through TURN.

ICE tests candidates and selects a working pair according to its process.

Think:

```text
STUN = discover external mapping
TURN = relay when needed
ICE  = gather/test/select viable paths
```

## Why this matters in UC

A call may work on an internal corporate LAN but fail from a home network, hotel, guest Wi-Fi, or restrictive firewall because NAT behavior and allowed UDP paths differ.

Troubleshooting should therefore ask:

- Which candidate/path was selected?
- Direct or relay?
- Did the firewall allow connectivity checks?
- Did NAT mappings stay alive?
- Did both media directions use the same expected boundary?

NAT traversal is fundamentally a **path discovery and reachability problem**, not magic inside the voice application.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
