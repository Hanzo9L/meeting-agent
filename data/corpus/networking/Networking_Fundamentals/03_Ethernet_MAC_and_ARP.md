---
title: Ethernet, MAC Addresses, and ARP
level: beginner
tags:
- ethernet
- mac
- arp
- layer2
source_basis:
- technology/switch.rst
- federation/hetero.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__03_Ethernet_MAC_and_ARP
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Ethernet, MAC Addresses, and ARP

## Ethernet in plain English

Ethernet is the dominant wired LAN technology. On an Ethernet LAN, devices exchange **frames**. Ethernet frames include source and destination MAC addresses.

A **MAC address** identifies a network interface at Layer 2. It is used for local delivery on an Ethernet network; routers do not use the sender's original Ethernet frame end-to-end across the Internet.

## How a switch learns

A switch observes the **source MAC address** of frames arriving on each port and builds a table such as:

```text
MAC address          Port
AA:AA:AA:AA:AA:01    1
BB:BB:BB:BB:BB:02    7
CC:CC:CC:CC:CC:03    12
```

When a frame arrives, the switch looks at the destination MAC and forwards it toward the appropriate port when known.

## The ARP problem

A host may know the destination's IP address but still need an Ethernet destination MAC address.

**ARP (Address Resolution Protocol)** maps an IPv4 address on the local network to a MAC address.

Example:

```text
PC wants 10.10.20.50
PC asks: "Who has 10.10.20.50?"
Target replies with its MAC address
PC caches the mapping temporarily
```

## What if the destination is remote?

This is the critical beginner concept.

Suppose the PC is `10.10.20.25/24` and wants `8.8.8.8`. The PC sees that `8.8.8.8` is not in local subnet `10.10.20.0/24`.

It does **not** ARP for `8.8.8.8`. Instead, it ARPs for the **default gateway's local IP address**, obtains the gateway MAC, and sends an Ethernet frame to that MAC while keeping the final destination IP as `8.8.8.8`.

```text
Ethernet destination: gateway MAC
IP destination:       8.8.8.8
```

That distinction is foundational.

## Common failures

- Wrong VLAN means the expected Layer 2 neighbors are not actually on the same broadcast domain.
- Duplicate IP addresses can create unstable ARP mappings.
- A missing ARP response may indicate VLAN, cabling, switch-port, host, or local firewall issues.
- Stale ARP entries can briefly point traffic to the wrong MAC after changes.

## Useful commands

Windows:

```powershell
arp -a
getmac
ipconfig /all
```

Linux/macOS commonly use:

```bash
ip neigh
ip link
```

The exact command is less important than knowing what you are trying to prove: **Can I reach the expected Layer 2 neighbor, and does IP-to-MAC resolution make sense?**

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
