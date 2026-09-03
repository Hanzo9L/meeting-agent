---
title: NAT and PAT
level: beginner
tags:
- nat
- pat
- private-addresses
- translation
source_basis:
- federation/scale.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__11_NAT_and_PAT
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# NAT and PAT

## Why NAT exists

**Network Address Translation (NAT)** rewrites address information as traffic crosses a network boundary. A common use is allowing hosts with private IPv4 addresses to communicate with the public Internet.

## The common home/enterprise pattern

```text
Inside host: 10.10.20.25:53000
        |
        v
NAT/firewall public IP: 198.51.100.20:62001
        |
        v
Internet server: 203.0.113.50:443
```

The NAT device remembers the translation in a state table so reply traffic can be mapped back to the correct internal host.

## PAT / NAPT

When many inside hosts share one public address, transport-layer port numbers help distinguish flows. This is commonly called **PAT (Port Address Translation)** or NAPT.

Example table:

```text
Inside local           Outside translated
10.10.20.25:53000  ->  198.51.100.20:62001
10.10.20.26:53000  ->  198.51.100.20:62002
```

## NAT is not the same as a firewall

They often exist on the same appliance, but they solve different problems:

- NAT changes addressing/ports.
- A firewall decides whether traffic is allowed according to policy/state.

Do not assume "NAT protects us" is a complete firewall design.

## Why NAT complicates real-time communications

A device behind NAT may advertise its private address inside application signaling. A remote peer cannot directly route to that private address.

Also, NAT mappings are often created by outbound traffic and age out after inactivity. Inbound peer-to-peer communication becomes more complicated.

This is why real-time systems use techniques such as STUN, TURN, ICE, media relays, and SBCs.

## Static NAT and port forwarding

An organization may intentionally create a fixed mapping so inbound traffic to a public address/port reaches a particular internal service. This must be paired with appropriate security policy.

## Troubleshooting clues

- Signaling works but one-way audio: inspect advertised media addresses and NAT behavior.
- Calls drop after a repeatable idle interval: consider state/NAT timeout behavior.
- Internal calls work, external calls fail: focus on the edge boundary, NAT, firewall, and media traversal.
- One direction works but the other does not: remember that NAT/firewall state and return routing are directional concerns.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
