---
title: "One-Way Audio Troubleshooting"
level: "beginner-to-intermediate"
tags: [one-way-audio, rtp, srtp, nat, firewall, sdp, troubleshooting]
source_basis:
  - "federation/scale.rst"
  - "stream/session.rst"
  - "stream/transport.rst"
sourceId: "networking_beginner"
documentId: "Troubleshooting_Playbooks__00_One_Way_Audio"
documentType: "playbook"
ingest: true
format: "markdown"
license: "CC-BY-4.0"
retrievalIntents: [troubleshoot, explain]
---

# One-Way Audio Troubleshooting

## The core idea

A call can signal successfully while media fails in one direction because **SIP signaling and RTP/SRTP media are separate traffic flows**. One-way audio means one media direction is reaching its destination and the other is not.

Do not start by assuming "SIP is broken" just because the call sounds wrong. If the call established, first prove what happened to each media direction.

## Why NAT can create one-way audio

NAT changes addresses and often ports at a network boundary. SIP/SDP may advertise the IP address and UDP port where an endpoint expects to receive media. If the advertised address is private, stale, incorrectly rewritten, or inconsistent with the NAT/firewall state, the remote side may send RTP to a destination that cannot actually receive it.

A simplified failure looks like this:

```text
Phone A                 NAT/Firewall                 Phone B
10.1.10.20                                        203.0.113.50

SIP succeeds -------------------------------------------->

A advertises media: 10.1.10.20:40000
B sends RTP to 10.1.10.20:40000  X  not routable from Internet

A sends RTP outward -------------------------------> B receives audio
A receives nothing <------------------------------- X
```

The exact failure can also be caused by firewall policy, missing return routing, NAT state expiration, or an SBC/media relay choosing or advertising the wrong path.

## Troubleshooting sequence

1. **Confirm the symptom precisely.** Ask which direction is silent.

   ```text
   A can hear B, but B cannot hear A
   ```

   means **B -> A media works** and **A -> B media is the suspect direction** from the listener's perspective. Be explicit about sender and receiver so you do not troubleshoot the wrong leg.

2. **Separate signaling from media.** Confirm the call reached an established state. For SIP, that generally means the INVITE/response/ACK sequence completed.

   Then stop treating signaling success as media proof.

3. **Read the negotiated media information.** Inspect SDP or the platform's media-negotiation equivalent. Record, for each side:

   - media IP address;
   - RTP/SRTP UDP port;
   - codec;
   - encryption mode;
   - whether media should be direct, SBC-anchored, or relay-based.

   Look immediately for private/unreachable addresses or an unexpected media relay.

4. **Prove RTP/SRTP directionally.** Use packet capture, SBC traces, media telemetry, or platform diagnostics to answer two separate questions:

   ```text
   A ---> B packets present?
   B ---> A packets present?
   ```

   Do not settle for "RTP exists." You need to know **which direction** exists.

5. **Follow the failing direction hop by hop.** For the missing direction, inspect:

   ```text
   Sender interface
     -> local route/default gateway
     -> source NAT / PAT mapping
     -> firewall policy and session state
     -> WAN/Internet path
     -> destination NAT if applicable
     -> SBC/media relay
     -> receiving endpoint/interface
   ```

   At each boundary ask: **Did packets arrive? What address/port did they have when they arrived? What address/port did they leave with?**

6. **Check stateful devices and timers.** If audio initially works and later becomes one-way, check:

   - NAT mapping timeout;
   - firewall UDP session timeout;
   - keepalive behavior;
   - media re-negotiation after hold/transfer;
   - SBC session state.

7. **Check asymmetry.** Stateful firewalls may expect both directions of a flow to traverse the same stateful boundary. Asymmetric routing can make perfectly valid packets look unrelated to an existing session.

## Fast diagnosis matrix

| Observation | Likely focus |
|---|---|
| SIP completes, no RTP either direction | SDP/media negotiation, firewall, relay/SBC selection |
| RTP exists A -> B only | B -> A route/NAT/firewall/advertised destination |
| RTP exists both directions but one side hears nothing | codec/media processing, SRTP/keying, endpoint issue |
| Internal calls work, external calls fail | NAT/firewall/SBC/media traversal |
| Audio works then fails after repeatable time | NAT/firewall state timers, keepalives, re-INVITE/media change |
| Failure starts after hold/transfer | changed SDP, changed media port/address, SBC anchoring |

## Interview-ready explanation

**NAT can cause one-way audio because the call signaling may complete even when the media address or port advertised for one endpoint is not reachable from the other side. RTP is directional UDP traffic, so I would inspect SDP, prove RTP in both directions separately, and then trace the missing leg through routing, NAT, firewall state, and any SBC or media relay.**

---

**Source note:** Beginner-oriented synthesis and operational guidance. See `../ATTRIBUTION.md` and `../SOURCES.md`.
