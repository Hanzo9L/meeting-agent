---
title: Routers and Default Gateways
level: beginner
tags:
- router
- gateway
- layer3
- forwarding
source_basis:
- federation/hetero.rst
- routing/design.rst
- technology/switch.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__09_Routers_and_Default_Gateways
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Routers and Default Gateways

## What a router does

A router forwards IP packets between networks. It examines the destination IP address, consults forwarding information, and selects an outgoing interface or next hop.

## What a default gateway does

A host does not need to know every route in the world. It normally has a route for its local subnet and a **default route** pointing to its local router.

Example host:

```text
IP:      10.20.30.25
Mask:    255.255.255.0 (/24)
Gateway: 10.20.30.1
```

Destination `10.20.30.80` is local. Destination `10.20.40.80` is remote, so the host sends the packet toward `10.20.30.1`.

## Route vs forwarding

A useful distinction from networking theory:

- **Routing** determines suitable paths and builds routing information.
- **Forwarding** is the per-packet action of looking at the destination and sending the packet according to the table.

The control plane learns/calculates. The data plane forwards.

## Default route

`0.0.0.0/0` is the IPv4 catch-all route. It matches when there is no more specific destination route.

A router might have:

```text
10.20.30.0/24 -> local LAN
10.50.0.0/16  -> corporate WAN
0.0.0.0/0     -> ISP / Internet edge
```

## TTL and routing loops

IPv4 packets contain a TTL value that is reduced as routers forward the packet. If TTL reaches zero, the packet is discarded. This prevents a routing loop from circulating a packet forever.

`traceroute`/`tracert` uses this behavior to reveal intermediate hops.

## Common failures

- Wrong client gateway: local works, remote fails.
- Missing route: router does not know where to send a destination.
- Asymmetric routing: outbound and return traffic take different paths, sometimes conflicting with stateful firewalls.
- Route precedence: a more specific route sends traffic somewhere unexpected.
- Interface/downstream failure: route exists but next hop is unavailable.

## Best question to ask

At every routed hop: **What route should match this destination, and where does that route send the packet next?**

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
