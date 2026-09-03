---
title: Firewalls
level: beginner
tags:
- firewall
- acl
- stateful
- security
source_basis:
- secure/
- virtual/datacenter.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__13_Firewalls
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Firewalls

## What a firewall does

A firewall enforces traffic policy between security zones, networks, hosts, or applications. It can permit, deny, inspect, log, or otherwise control flows.

## Stateless vs stateful

A **stateless ACL** evaluates packets independently against rules.

A **stateful firewall** tracks connection/flow state. When an allowed connection is initiated, return traffic can be associated with that state rather than treated as unrelated inbound traffic.

## A rule is more than a port number

Good firewall thinking includes:

```text
Source network/host
Destination network/host
Protocol (TCP/UDP/etc.)
Source port if relevant
Destination port/range
Direction
Connection state
Application inspection if enabled
NAT relationship if applicable
```

## Why "open port 5060" is not a complete voice solution

Real-time communication can involve separate signaling and media flows. Media may use dynamically negotiated UDP ports and may take a different path than signaling.

A firewall can therefore allow registration/signaling while blocking or mishandling media.

## Firewalls and asymmetric routing

Stateful firewalls expect to observe enough of a flow to maintain state. If outbound traffic passes through Firewall A but return traffic arrives through Firewall B, stateful inspection can fail even though IP routing technically reaches both endpoints.

## Application-layer inspection

Some firewalls include application helpers/ALGs that modify or interpret protocols such as SIP. These features can help in some environments but can also interfere with modern SIP/SBC designs. Troubleshooting should establish whether such inspection is active rather than assume it is benign.

## Troubleshooting discipline

When testing a suspected firewall issue, define the exact flow:

```text
Who initiates?
From what IP/subnet?
To what destination?
TCP or UDP?
Which destination port/range?
What translated addresses are visible on each side?
Where should return traffic go?
```

Then inspect logs/state/captures against that flow. "The firewall is open" is not a test result.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
