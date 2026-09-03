---
title: IP Addressing
level: beginner
tags:
- ip
- ipv4
- addressing
- cidr
source_basis:
- federation/hetero.rst
- federation/scale.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__04_IP_Addressing
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# IP Addressing

## What an IP address does

An IP address is a logical Layer 3 address. Routers use destination IP information to forward packets across networks.

IPv4 addresses are 32 bits and are usually written in dotted decimal, for example:

```text
10.20.30.40
192.168.1.25
172.16.5.9
```

## Address plus prefix

An address by itself is incomplete for routing decisions. A host also needs a prefix length or subnet mask.

```text
10.20.30.40/24
```

The `/24` means the first 24 bits represent the network prefix. In this example, the subnet is normally described as `10.20.30.0/24`.

Equivalent dotted mask:

```text
255.255.255.0
```

## Private IPv4 ranges

Common private address space includes:

```text
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
```

Private addresses are not intended to be globally routed on the public Internet. NAT is commonly used at a network boundary to allow private hosts to access public services.

## Loopback and link-local concepts

`127.0.0.0/8` is IPv4 loopback space; `127.0.0.1` is the familiar local loopback address.

Windows hosts that cannot obtain normal IPv4 configuration may self-assign from `169.254.0.0/16`. Seeing a `169.254.x.x` address is therefore an immediate clue to investigate DHCP or network attachment.

## Source and destination

Each IP packet carries a source and destination address. Routers primarily care about the destination when forwarding.

```text
Source:      10.20.30.40
Destination: 203.0.113.25
```

At a NAT boundary, the source may be rewritten to a public address for outbound traffic.

## CIDR

**Classless Inter-Domain Routing (CIDR)** uses variable-length prefixes such as `/8`, `/16`, `/24`, `/27`, or `/30`. Routers use the most specific matching prefix, often called **longest-prefix match**.

Example routing table:

```text
10.0.0.0/8       -> WAN A
10.20.30.0/24    -> WAN B
0.0.0.0/0        -> Internet gateway
```

Traffic to `10.20.30.40` matches both `/8` and `/24`; `/24` is more specific and wins.

## Operational habit

When someone gives you an IP address, immediately ask or determine:

- prefix/mask;
- default gateway;
- DNS server(s);
- VLAN/interface;
- whether the address is static or DHCP-assigned.

Those facts turn an isolated number into usable network context.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
