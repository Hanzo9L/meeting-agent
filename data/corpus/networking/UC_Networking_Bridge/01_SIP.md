---
title: SIP
level: beginner
tags:
- sip
- signaling
- sdp
- voip
source_basis:
- stream/session.rst
sourceId: networking_beginner
documentId: UC_Networking_Bridge__01_SIP
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# SIP

## What SIP is

**SIP (Session Initiation Protocol)** is a signaling protocol used to establish, modify, and end communication sessions. It is commonly paired with RTP for VoIP media.

SIP is not the audio itself.

## Basic conceptual flow

```text
Caller                         Callee
  |---- INVITE ----------------->|
  |<--- 100 Trying --------------|
  |<--- 180 Ringing -------------|
  |<--- 200 OK ------------------|
  |---- ACK -------------------->|
  |==== RTP/SRTP media =========>|
  |<=== RTP/SRTP media ==========|
  |---- BYE -------------------->|
  |<--- 200 OK ------------------|
```

Real deployments often include proxies, SBCs, gateways, and cloud services between the endpoints.

## SIP URIs

SIP commonly identifies users/resources using URI-style names such as:

```text
sip:user@example.com
```

This identifies the user or service, not necessarily a fixed device location.

## SDP

SIP messages often carry **SDP (Session Description Protocol)** data describing proposed media characteristics such as:

- media type;
- codecs;
- IP address/connection information;
- UDP ports;
- other session attributes.

This is why a SIP signaling capture can reveal a one-way-audio problem: the signaling may advertise a private or unreachable media address.

## Registration and proxies

SIP can register a user's current contact location with a registrar. Proxies route requests toward appropriate endpoints or services.

DNS can also participate in locating SIP infrastructure.

## Signaling path can differ from media path

A SIP proxy may participate in call setup while media flows directly between endpoints or through a separate relay/SBC. Therefore:

**Successful SIP does not prove successful RTP.**

## Common troubleshooting questions

- Did registration succeed?
- Did the INVITE reach the expected destination?
- What response code came back?
- What codec/media address/port did SDP negotiate?
- Did an SBC or firewall rewrite anything?
- Does media flow after ACK/200 OK?
- Does BYE come from a real user action, timeout, or network failure?

Understanding the message sequence is more useful than memorizing every SIP header.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
