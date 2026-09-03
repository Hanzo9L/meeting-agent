---
title: OSI and TCP/IP Models
level: beginner
tags:
- osi
- tcpip
- layers
- encapsulation
source_basis:
- introduction/protocols.rst
- introduction/architecture.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__02_OSI_and_TCPIP_Models
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# OSI and TCP/IP Models

## Why models exist

The OSI and TCP/IP models are ways to organize networking functions into layers. They are useful because they give engineers a shared vocabulary and a troubleshooting framework.

You do **not** need to treat the OSI model as a law of physics. Real products sometimes blur layer boundaries.

## OSI model

| Layer | Name | Practical examples |
|---:|---|---|
| 7 | Application | HTTP, DNS, SIP |
| 6 | Presentation | Encoding, encryption concepts |
| 5 | Session | Session establishment/control concepts |
| 4 | Transport | TCP, UDP |
| 3 | Network | IPv4, IPv6, routing |
| 2 | Data Link | Ethernet, MAC addresses, VLANs |
| 1 | Physical | Copper, fiber, radio, connectors, signal |

## Practical TCP/IP stack

A more operational Internet view is often simpler:

```text
Application     HTTP / DNS / SIP / etc.
Transport       TCP / UDP
Internet        IP
Link            Ethernet / Wi-Fi
Physical        cable / fiber / radio
```

## Encapsulation example

When a SIP phone sends signaling:

```text
SIP message
  inside TCP or UDP
    inside IP
      inside Ethernet (on a wired LAN)
```

For real-time media, the stack commonly resembles:

```text
RTP/SRTP
  inside UDP
    inside IP
      inside Ethernet/Wi-Fi
```

## Troubleshooting by layer

A layered approach prevents random guessing.

**Layer 1:** Is there link, signal, power, cable integrity?

**Layer 2:** Is the switch port correct? VLAN correct? MAC learned?

**Layer 3:** Does the host have the right IP, mask, gateway? Is routing valid?

**Layer 4:** Are TCP/UDP ports reachable? Is a firewall blocking the flow?

**Layer 7:** Is DNS answering? Is SIP registering? Is the application healthy?

## Common interview trap

"What layer is a switch/router?" is usually shorthand, not a perfect definition. A classic Ethernet switch is Layer 2; a classic IP router is Layer 3. Modern devices may do both, and firewalls/SBCs can inspect multiple layers.

The useful answer is to describe **what information the device uses to make its decision**.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
