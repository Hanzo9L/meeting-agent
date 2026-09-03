---
title: UC Troubleshooting Flow
level: beginner
tags:
- uc
- troubleshooting
- sip
- rtp
- sbc
source_basis:
- operations/dhcp.rst
- naming/dns.rst
- stream/session.rst
- stream/transport.rst
sourceId: networking_beginner
documentId: UC_Networking_Bridge__06_UC_Troubleshooting_Flow
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# UC Troubleshooting Flow

## A repeatable voice troubleshooting method

Start with the symptom, but trace the dependencies from the bottom upward.

## 1. Endpoint attachment

```text
Power / PoE
Link
Switch port
VLAN
```

If the phone has no valid network attachment, nothing higher matters.

## 2. IP configuration

Verify:

```text
IP address
mask/prefix
default gateway
DNS
DHCP lease/source
```

If the phone self-assigns or receives an unexpected subnet, stop here and fix it.

## 3. Name resolution and service reachability

Can it resolve the exact service names it needs? Can it reach the gateway and remote service addresses?

## 4. Signaling

For SIP-based systems:

```text
REGISTER succeeds?
INVITE leaves?
Expected proxy/SBC receives it?
Response code?
TLS handshake if used?
Authentication/policy?
```

## 5. Media negotiation

Inspect SDP or equivalent negotiation:

```text
codec
media IP
media UDP port
security mode
selected media relay/SBC
```

## 6. Media transport

Prove both directions separately:

```text
A ---> B RTP/SRTP packets?
A <--- B RTP/SRTP packets?
```

If only one direction flows, focus on that direction's route, NAT, firewall state, and negotiated destination.

## 7. Quality

If media flows but sounds poor, measure:

- latency;
- jitter;
- packet loss;
- bursts vs steady loss;
- DSCP/QoS treatment;
- interface/queue drops;
- Wi-Fi health;
- media path/relay location.

## Symptom shortcuts

| Symptom | Start here |
|---|---|
| No IP | VLAN / DHCP |
| IP but no registration | DNS / routing / firewall / signaling service |
| Registered, cannot place call | signaling route/policy/SIP response |
| Call connects, no audio | media negotiation / firewall / NAT / RTP |
| One-way audio | directional media path / NAT / routing / firewall |
| Choppy audio | loss / jitter / congestion / QoS |
| Calls fail only externally | edge firewall/NAT/SBC/media traversal |
| Calls drop at repeatable interval | state/keepalive/session timer/NAT timeout possibilities |

## The final habit

For every failed call, be able to draw two paths:

```text
SIGNALING PATH
Endpoint -> proxy/SBC -> service/carrier

MEDIA PATH
Endpoint -> peer/SBC/relay -> remote endpoint
```

Those paths may not be the same. Treating them separately is one of the biggest leaps from beginner troubleshooting to competent UC troubleshooting.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
