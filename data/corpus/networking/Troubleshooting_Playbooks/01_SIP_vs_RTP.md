---
title: "SIP Signaling vs RTP Media"
level: "beginner"
tags: [sip, rtp, srtp, signaling, media, troubleshooting]
source_basis:
  - "stream/session.rst"
  - "stream/transport.rst"
sourceId: "networking_beginner"
documentId: "Troubleshooting_Playbooks__01_SIP_vs_RTP"
documentType: "playbook"
ingest: true
format: "markdown"
license: "CC-BY-4.0"
retrievalIntents: [explain, troubleshoot]
---

# SIP Signaling vs RTP Media

## Short answer

**SIP sets up and controls the call. RTP/SRTP carries the actual voice or video.**

They are related, but they are not the same flow and do not necessarily take the same network path.

## What SIP does

SIP is commonly responsible for session-control actions such as:

- finding/reaching the called party or service;
- starting a session with INVITE;
- reporting call progress such as ringing;
- negotiating session characteristics through SDP;
- modifying a session;
- ending a session with BYE.

Conceptually:

```text
Caller -> SIP proxy/SBC/service -> Callee
```

## What RTP/SRTP does

RTP carries real-time media such as voice. SRTP adds security protections for that media.

Conceptually:

```text
Caller ===== RTP/SRTP =====> Callee
Caller <==== RTP/SRTP ====== Callee
```

In many deployments the media instead traverses an SBC or relay:

```text
Caller ===> SBC/media relay ===> Callee
```

## Why the distinction matters

A call can ring and connect even if audio cannot flow. That happens because the signaling path succeeded while the media path did not.

Likewise, a signaling proxy can be healthy while a separate firewall rule, NAT mapping, SBC media interface, or UDP path prevents audio.

This leads to a critical troubleshooting rule:

> **Successful signaling does not prove successful media.**

## What SDP contributes

SIP often carries SDP, which tells the other side about proposed media parameters. Depending on the system, SDP may include:

- media IP address;
- UDP port;
- codec choices;
- encryption/media attributes.

If those media coordinates are wrong or unreachable, SIP can still appear healthy while RTP fails.

## How to troubleshoot the two paths

Draw them separately.

```text
SIGNALING
Endpoint -> proxy/SBC -> service -> remote signaling endpoint

MEDIA
Endpoint -> firewall/NAT -> SBC/relay/peer -> remote media endpoint
```

For signaling, inspect requests, responses, registration, authentication, DNS, TLS, and policy.

For media, inspect negotiated IP/port, RTP/SRTP packet flow in both directions, NAT, firewall state, routing, QoS, loss, jitter, and media-relay selection.

## Interview-ready explanation

**SIP is the control plane for the call: it establishes, modifies, and tears down the session, often carrying SDP to negotiate media. RTP or SRTP is the media plane carrying the actual audio/video, usually over UDP. Because the signaling and media paths can be different, a call can connect successfully and still have no audio or one-way audio.**

---

**Source note:** Beginner-oriented synthesis and operational guidance. See `../ATTRIBUTION.md` and `../SOURCES.md`.
