---
title: Subnetting
level: beginner
tags:
- subnetting
- cidr
- mask
- ipv4
source_basis:
- federation/scale.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__05_Subnetting
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Subnetting

## What subnetting answers

Subnetting answers two practical questions:

1. Which addresses belong to the same IP network?
2. When must a host use a router to reach the destination?

## The easiest starting point: /24

For `192.168.50.25/24`:

```text
Network:    192.168.50.0
Typical hosts: 192.168.50.1 - 192.168.50.254
Broadcast:  192.168.50.255
Mask:       255.255.255.0
```

A host at `192.168.50.25/24` sees `192.168.50.80` as local. It sees `192.168.51.80` as remote and sends that traffic to its default gateway.

## Common prefix sizes

| Prefix | Mask | Total addresses | Typical usable IPv4 host addresses* |
|---:|---|---:|---:|
| /24 | 255.255.255.0 | 256 | 254 |
| /25 | 255.255.255.128 | 128 | 126 |
| /26 | 255.255.255.192 | 64 | 62 |
| /27 | 255.255.255.224 | 32 | 30 |
| /28 | 255.255.255.240 | 16 | 14 |
| /29 | 255.255.255.248 | 8 | 6 |
| /30 | 255.255.255.252 | 4 | 2 |

\*Traditional subnet calculation. Some special contexts use addressing differently.

## A /26 example

A `/26` breaks a /24 into blocks of 64 addresses:

```text
192.168.10.0/26
192.168.10.64/26
192.168.10.128/26
192.168.10.192/26
```

`192.168.10.70/26` belongs to the `192.168.10.64/26` subnet.

## Why this matters operationally

If two devices appear physically adjacent but their IP configuration places them in different subnets, they need Layer 3 routing between them.

If the subnet mask is wrong, a host may incorrectly believe a remote device is local and attempt ARP instead of using the gateway. This can create confusing failures where some destinations work and others do not.

## You do not need mental binary gymnastics for every job

Understand the concept first. In production, engineers routinely use calculators and tooling. The important skill is recognizing what a prefix means and spotting impossible or inconsistent configurations.

## Check yourself

For `10.50.8.25/24`, is `10.50.8.200` local? **Yes.**

Is `10.50.9.10` local? **No.** It normally needs the default gateway.

For `10.50.8.25/16`, is `10.50.9.10` local? **Yes.** The prefix changed the answer.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
