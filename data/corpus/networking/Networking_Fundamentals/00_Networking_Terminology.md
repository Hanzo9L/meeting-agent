---
title: Networking Terminology
level: beginner
tags:
- networking
- terminology
- fundamentals
source_basis:
- introduction/protocols.rst
- introduction/architecture.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__00_Networking_Terminology
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Networking Terminology

## The shortest useful definition of a network

A **network** is a group of devices that can exchange data. The devices may be in one room, across a company, or on opposite sides of the Internet.

The fastest way to learn networking is to stop treating the vocabulary as unrelated acronyms. Most terms describe one of four things: **a device, an address, a path, or a rule**.

## Core terms

| Term | Plain-English meaning |
|---|---|
| Host / endpoint | A device that originates or receives traffic, such as a PC, server, phone, printer, or camera. |
| NIC | Network interface card/interface. The hardware or virtual interface connecting a device to a network. |
| LAN | Local Area Network. Devices connected within a local environment. |
| WAN | Wide Area Network. Connectivity between geographically separated networks. |
| Ethernet | The dominant wired LAN technology. |
| Wi-Fi | Wireless LAN technology. |
| Frame | A Layer 2 unit of data, typically Ethernet. |
| Packet | A Layer 3 unit of data, usually an IP packet. |
| Segment / datagram | Common names for transport-layer units carried by TCP / UDP. |
| MAC address | A Layer 2 address used for local Ethernet delivery. |
| IP address | A Layer 3 logical address used for communication across IP networks. |
| Subnet | A defined range of IP addresses treated as one network. |
| Subnet mask / prefix | Tells a host which part of an IP address identifies the network. |
| Default gateway | The router a host uses when the destination is outside its local subnet. |
| Switch | Primarily forwards Ethernet frames inside a LAN. |
| Router | Forwards IP packets between networks. |
| Route | A rule describing where traffic for a destination network should go. |
| Routing table | A set of routes. |
| DNS | Converts names such as `example.com` into useful records, commonly IP addresses. |
| DHCP | Automatically supplies IP configuration to clients. |
| NAT | Rewrites addresses, commonly between private and public address space. |
| Port | A transport-layer number used to identify an application/service conversation. |
| Firewall | Enforces policy about which traffic may cross a boundary. |
| VLAN | A logical Layer 2 network that can share physical switch infrastructure with other VLANs. |
| Protocol | A defined set of rules and message formats used by communicating systems. |
| Topology | The arrangement of devices and links in a network. |
| Bandwidth | The capacity of a link or path, usually expressed in bits per second. |
| Latency | The time data takes to travel from one point to another. |
| Jitter | Variation in packet arrival timing. |
| Packet loss | Packets that never reach the destination. |

## The vocabulary in one picture

```text
PC / IP phone
  |  Ethernet frame, MAC addresses
  v
Switch ---- other local devices
  |
  |  VLAN / local subnet
  v
Router = default gateway
  |
  |  routes + firewall + often NAT
  v
Internet / WAN
  |
  v
Remote server or service
```

## A useful distinction: local delivery vs routed delivery

If two hosts are in the same IP subnet, they can normally communicate through the local Layer 2 network. If the destination is in another subnet, the sending host gives the packet to its **default gateway**. The router then decides the next path.

That single distinction explains why MAC addresses, ARP, switches, routers, gateways, and routing tables all exist.

## Check yourself

You should be able to answer these without memorizing vendor language:

1. What device usually moves traffic between IP subnets? **A router.**
2. What gives a laptop its IP configuration automatically? **DHCP.**
3. What turns a hostname into an address? **DNS.**
4. What does a switch mainly examine for ordinary Layer 2 forwarding? **MAC addresses.**
5. What does a router mainly examine for IP forwarding? **Destination IP addresses.**

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
