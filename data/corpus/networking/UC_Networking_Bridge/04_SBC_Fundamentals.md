---
title: Session Border Controller Fundamentals
level: beginner
tags:
- sbc
- sip
- media
- border
- voice
source_basis:
- stream/session.rst
- stream/transport.rst
- federation/scale.rst
sourceId: networking_beginner
documentId: UC_Networking_Bridge__04_SBC_Fundamentals
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# Session Border Controller Fundamentals

## What an SBC is

A **Session Border Controller (SBC)** sits at a real-time communications boundary and controls signaling and often media between networks, tenants, carriers, or platforms.

An SBC is not merely "a voice firewall," although security is one of its roles.

## Common SBC functions

Depending on design/product, an SBC may provide:

- SIP interworking and normalization;
- topology hiding;
- signaling policy;
- media anchoring/relay;
- NAT traversal assistance;
- codec negotiation/transcoding in some platforms;
- TLS/SRTP termination or mediation;
- admission control;
- carrier/PSTN interconnect;
- survivability or routing logic;
- logging, call traces, and quality telemetry.

## Why media anchoring matters

Without anchoring, endpoints may try to send RTP directly to one another. With an SBC anchoring media:

```text
Endpoint A -> SBC media interface -> Endpoint B/carrier
```

Both parties send media to the SBC, which creates a controlled boundary and can solve addressing/interworking problems.

## Signaling interface vs media interface

Do not assume every SBC flow uses one IP. Enterprise SBCs may have separate interfaces, realms, zones, or public/private legs.

A troubleshooting diagram should show:

```text
inside SIP IP
outside SIP IP
inside media IP/range
outside media IP/range
NAT public mappings
next-hop proxy/carrier
```

## SBC vs NAT vs firewall

- NAT translates addresses/ports.
- Firewall enforces traffic policy/state.
- SBC understands and controls communication sessions and may rewrite application-level signaling/media information.

They may coexist on one path but are conceptually different.

## What to inspect during a failed call

- Did the SBC receive the inbound SIP message?
- Which routing policy matched?
- What SIP message did it send out?
- Did it normalize or rewrite headers/SDP?
- Which media addresses/ports were allocated?
- Did RTP arrive on each leg?
- Was TLS/SRTP negotiation compatible?
- Did a codec or policy mismatch cause rejection?

The SBC is often the best observation point because it can expose both call signaling and media-leg behavior.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
