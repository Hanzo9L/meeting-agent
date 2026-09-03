---
title: Voice VLANs and QoS
level: beginner
tags:
- voice-vlan
- qos
- dscp
- phones
source_basis:
- virtual/vlan.rst
- introduction/performance.rst
- capacity/
sourceId: networking_beginner
documentId: UC_Networking_Bridge__05_Voice_VLANs_and_QoS
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- troubleshoot
---

# Voice VLANs and QoS

## Why voice VLANs exist

A voice VLAN separates IP phones logically from ordinary endpoint traffic even when a phone and PC share the same physical access area.

Benefits can include:

- smaller broadcast domain;
- cleaner addressing and policy;
- easier DHCP/provisioning design;
- security segmentation;
- clearer QoS trust/classification boundaries.

## Typical physical arrangement

```text
PC -> phone passthrough -> switch port
             |
             +-- phone logically in Voice VLAN
PC logically in Data VLAN
```

Exact behavior depends on switch and phone configuration.

## DHCP dependency

Once placed in the intended voice VLAN, the phone still needs correct:

- IP address;
- prefix/mask;
- gateway;
- DNS;
- any deployment-specific options/provisioning discovery.

A VLAN problem can therefore present as a phone provisioning problem.

## QoS path

A packet may be marked for preferred treatment, but QoS works only if the end-to-end path respects the marking and has appropriate queues/schedulers.

```text
Phone marks/classifies
   -> access switch trusts/remarks
   -> WAN edge queues
   -> provider carries or rewrites
   -> remote edge
```

## What QoS cannot fix

QoS cannot repair:

- a broken route;
- severe physical errors;
- incorrect DNS;
- blocked firewall flows;
- bad codec configuration;
- an undersized circuit beyond reasonable contention;
- a bad Wi-Fi RF environment by itself.

It helps manage contention and prioritization.

## Troubleshooting voice quality

Correlate user experience with measurable network behavior:

- robotic/choppy voice -> loss/jitter/queueing;
- long conversational delay -> latency/buffering/path;
- quality fails only during load -> congestion/QoS;
- one-way audio -> routing/NAT/firewall/media negotiation;
- phone never registers -> start with VLAN/DHCP/DNS/reachability before codec analysis.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
