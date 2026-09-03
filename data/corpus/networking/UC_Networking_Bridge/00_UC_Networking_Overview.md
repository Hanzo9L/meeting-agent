---
title: UC Networking Overview
level: beginner
tags:
- uc
- voice
- sip
- rtp
source_basis:
- stream/session.rst
- stream/transport.rst
- operations/dhcp.rst
sourceId: networking_beginner
documentId: UC_Networking_Bridge__00_UC_Networking_Overview
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# UC Networking Overview

## The most important idea in voice networking

A modern IP call is not "one connection." It usually consists of multiple dependencies and often separate signaling and media paths.

```text
Device startup
  -> VLAN / Ethernet / Wi-Fi
  -> DHCP
  -> DNS
  -> IP routing
  -> firewall/NAT
  -> signaling (often SIP or platform-specific HTTPS/TLS)
  -> media negotiation
  -> RTP/SRTP media path
```

A call can register successfully and still have no audio because registration proves only part of the path.

## Control vs media

**Signaling/control** handles tasks such as registration, locating users, inviting participants, negotiating capabilities, and ending sessions.

**Media** carries the actual audio/video packets.

SIP is a classic signaling protocol. RTP is a classic real-time media transport protocol.

## Why network fundamentals matter

- DHCP may place the phone on the network and supply DNS/gateway information.
- DNS may locate services.
- Routing determines where signaling and media packets travel.
- NAT changes addresses and ports at boundaries.
- Firewalls enforce allowed flows.
- QoS affects real-time traffic during congestion.
- VLANs separate voice and data broadcast domains.
- SBCs control SIP/media boundaries and interconnect dissimilar networks.

## A practical call-path sketch

```text
Desk phone
  |
Voice VLAN
  |
Access switch
  |
Default gateway
  |
Core / WAN
  |
Firewall / NAT
  |
SBC or cloud edge
  |\
  | \__ signaling service
  |
  \____ media peer / relay
```

When troubleshooting, annotate this diagram with actual IP addresses, NAT translations, interfaces, DNS names, ports, and expected QoS markings.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
