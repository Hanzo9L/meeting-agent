---
title: Network Topology
level: beginner
tags:
- topology
- lan
- wan
- star
- redundancy
source_basis:
- introduction/architecture.rst
- routing/design.rst
- virtual/vlan.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__14_Network_Topology
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Network Topology

## What topology means

**Network topology** is the arrangement of devices and links. It can describe physical cabling, logical Layer 2 relationships, Layer 3 routing, WAN connections, or application paths.

A topology diagram is useful only if you know which kind it represents.

## Physical vs logical

Physical:

```text
Phone -> wall jack -> access switch -> fiber -> core switch
```

Logical:

```text
Voice VLAN 120 -> gateway 10.120.0.1 -> firewall -> WAN/cloud
```

A device can be physically connected correctly but logically placed in the wrong VLAN or routing domain.

## Common shapes

### Star

Endpoints connect to a central device.

```text
    PC
     |
PC--SWITCH--Phone
     |
   Server
```

Modern Ethernet LANs often resemble stars or hierarchical stars.

### Hub-and-spoke WAN

```text
Branch A --\
Branch B ---- HQ/Hub ---- Internet/DC
Branch C --/
```

### Mesh / partial mesh

Multiple nodes have alternate paths. This increases resiliency but makes routing and troubleshooting more complex.

### Leaf-spine

Common in datacenters: leaf switches connect endpoints; each leaf typically connects to every spine, providing predictable multipath connectivity.

## Redundancy changes the troubleshooting question

With one path, "is the link up?" may be enough. With redundant paths, ask:

- Which path is active now?
- Which path does the control plane prefer?
- Is traffic asymmetric?
- Did failover converge?
- Does every security device see the expected state?

## Draw the packet path

For troubleshooting, a simple path diagram is often more valuable than a beautiful enterprise diagram:

```text
IP phone
  -> Access SW / VLAN 120
  -> Gateway
  -> Core
  -> Firewall/NAT
  -> ISP/WAN
  -> Cloud edge
  -> Signaling service
  -> Media peer/relay (possibly a different path)
```

If you cannot draw the expected path, you are not yet ready to troubleshoot the failure efficiently.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
