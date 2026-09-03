---
title: Switches and VLANs
level: beginner
tags:
- switching
- vlan
- 8021q
- layer2
source_basis:
- technology/switch.rst
- virtual/vlan.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__08_Switches_and_VLANs
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Switches and VLANs

## What a switch does

A switch interconnects network links and forwards traffic toward the appropriate output port. In a classic Ethernet role, it makes Layer 2 forwarding decisions using MAC addresses.

Modern hardware can often operate as Layer 2, Layer 3, or both, so the practical question is what forwarding function is configured.

## VLANs

A **VLAN (Virtual LAN)** divides one physical switching infrastructure into separate logical Layer 2 networks.

```text
Physical switch
├── VLAN 10  Users
├── VLAN 20  Voice
└── VLAN 30  Servers
```

Devices in different VLANs do not communicate directly at Layer 2. Traffic between VLANs normally requires routing through a Layer 3 interface/router and is therefore subject to Layer 3 policy.

## Access ports vs trunks

**Access port:** normally carries traffic for one VLAN toward an endpoint.

**Trunk:** carries multiple VLANs between network devices or to systems that understand tagging.

802.1Q tagging inserts VLAN information into Ethernet frames on tagged links.

```text
Phone/PC -- access/voice configuration -- switch == tagged trunk == switch/router
```

## Broadcast domains

VLANs limit broadcast scope. A broadcast in VLAN 20 is not automatically flooded into VLAN 30. This improves isolation and limits the impact of broadcast traffic.

## Logical vs physical topology

One major value of VLANs is that logical network membership can change without physically recabling every path. Two endpoints plugged into nearby ports may still be in entirely different Layer 2 networks.

## Common failure patterns

- Endpoint on wrong access VLAN: DHCP may fail or deliver an address from the wrong subnet.
- Trunk missing a VLAN: devices work on one switch but not across the trunk.
- Native/tagging mismatch: intermittent or confusing Layer 2 behavior.
- Voice VLAN not advertised/assigned as expected: IP phone lands in data network or fails provisioning.
- Inter-VLAN routing missing: hosts receive valid IPs but cannot reach resources outside their VLAN.

## Operational distinction

A VLAN is a **Layer 2 segmentation concept**. A subnet is a **Layer 3 addressing concept**. They are often designed one-to-one, but they are not the same thing.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
