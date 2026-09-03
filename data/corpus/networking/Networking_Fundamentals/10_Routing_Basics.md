---
title: Routing Basics
level: beginner
tags:
- routing
- igp
- bgp
- control-plane
- routes
source_basis:
- routing/design.rst
- routing/linkstate.rst
- routing/distancevector.rst
- federation/scale.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__10_Routing_Basics
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Routing Basics

## Routing vs forwarding

**Routing** is the process of discovering/selecting paths. **Forwarding** is the act of moving each packet according to the resulting forwarding table.

This distinction maps closely to:

```text
Control plane -> learns topology and routes
Data plane    -> forwards packets quickly
```

## Static and dynamic routes

**Static route:** configured manually. Simple and predictable, but does not automatically adapt to every failure.

**Dynamic routing:** routers exchange information and update routes as topology changes.

## Interior vs exterior routing

Within an organization or routing domain, protocols such as OSPF or IS-IS are examples of **interior gateway protocols (IGPs)**.

Between autonomous systems on the Internet, **BGP** is the major interdomain routing protocol.

A beginner does not need to master their packet formats. Understand what problem each class solves.

## Cost and best path

Routing can be modeled as a graph:

```text
A ---- B ---- D
 \    /       |
  \  /        |
    C --------
```

Links may have costs. The routing system selects a preferred path according to the protocol's rules and policy.

## Convergence

When a link fails, routers need time to learn the new topology and agree on new forwarding information. This process is called **convergence**.

During convergence, temporary loss, loops, or suboptimal paths can occur.

## Longest-prefix match

Forwarding uses the most specific matching IP prefix.

```text
10.0.0.0/8      -> Router A
10.10.0.0/16    -> Router B
10.10.20.0/24   -> Router C
```

Traffic to `10.10.20.50` uses the `/24` entry because it is most specific.

## Routing is bidirectional in practice

Successful communication requires a viable **return path**. You can have a perfectly valid forward route and still fail because the remote side does not know how to return traffic, or a firewall sees an unexpected asymmetric path.

## Useful commands

Windows:

```powershell
route print
tracert example.com
Get-NetRoute
```

Linux:

```bash
ip route
traceroute example.com
```

The purpose is not just to collect output; it is to compare **expected path vs actual path**.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
