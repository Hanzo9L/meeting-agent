---
title: RTP and SRTP
level: beginner
tags:
- rtp
- srtp
- media
- udp
- rtcp
source_basis:
- stream/transport.rst
sourceId: networking_beginner
documentId: UC_Networking_Bridge__02_RTP_and_SRTP
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# RTP and SRTP

## RTP carries real-time media

**RTP (Real-time Transport Protocol)** provides common structure for real-time audio/video delivery. It commonly runs over UDP.

RTP includes information that helps the receiver interpret a real-time stream, including sequence/timing information and payload type.

## Why UDP is common

Interactive media has strict timing requirements. Retransmitting an old voice packet may make it arrive after its playback time. RTP therefore commonly uses UDP and lets the real-time application handle loss appropriately.

## Sequence numbers and timestamps

These help an endpoint detect loss/reordering and play samples at the correct time.

```text
Packet 1001  timestamp 8000
Packet 1002  timestamp 8160
Packet 1004  timestamp 8480   <- packet 1003 missing
```

A receiver can recognize the gap and use concealment rather than wait indefinitely.

## RTCP

**RTCP (RTP Control Protocol)** accompanies RTP and carries control/reporting information about media sessions. It can help describe quality, synchronization, and participant information.

## SRTP

**SRTP (Secure RTP)** protects real-time media with encryption/authentication mechanisms defined for RTP streams.

Do not confuse:

- SIP/TLS: protects signaling in designs that use SIP over TLS.
- SRTP: protects media.

A system can have secure signaling and a separate secure-media negotiation/process.

## One-way audio

One-way audio is a classic sign that signaling completed but the two media directions do not both work.

Possible causes include:

- wrong SDP media address;
- NAT translation issue;
- firewall UDP policy;
- missing route/return route;
- media anchored to unexpected SBC/relay;
- asymmetric path/stateful firewall problem;
- endpoint binding to wrong interface.

## Packet capture view

For RTP troubleshooting, identify:

```text
A -> B packets per second
B -> A packets per second
source/destination IPs
UDP ports
sequence gaps
jitter
loss
codec/payload type
DSCP markings
```

That tells you whether the problem is network transport, negotiation, or endpoint/media processing.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
