---
title: QoS, Latency, Jitter, and Loss
level: beginner
tags:
- qos
- latency
- jitter
- loss
- voice
source_basis:
- introduction/performance.rst
- capacity/
sourceId: networking_beginner
documentId: Networking_Fundamentals__15_QoS_Latency_Jitter_and_Loss
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# QoS, Latency, Jitter, and Loss

## Four performance concepts

### Bandwidth

Capacity of a link/path, normally measured in bits per second.

### Latency

Time required for data to travel. It includes propagation, transmission, queuing, and processing effects.

### Jitter

Variation in packet arrival timing. Voice packets arriving at wildly inconsistent intervals can sound bad even if average latency looks acceptable.

### Packet loss

Packets that never arrive. Small amounts may be concealed by codecs; sustained or bursty loss damages voice/video quality quickly.

## Why real-time traffic is different

File transfer can usually wait for retransmission. Interactive voice cannot wait indefinitely for an old packet because the conversation has already moved on.

For voice, **timeliness can matter more than perfect delivery**.

## QoS

**Quality of Service (QoS)** is a set of techniques for classifying and treating traffic according to importance and requirements.

A common model:

```text
Classify -> Mark -> Queue/Schedule -> Monitor
```

DSCP markings are commonly used at Layer 3 to indicate desired treatment. A marking alone does nothing if network devices ignore or overwrite it.

## Congestion is where QoS matters most

If a link is empty, prioritization has little to do. When queues form, the scheduler decides which packets leave first and which may be dropped.

This is why a voice problem can appear only during backups, large transfers, market opens, all-hands meetings, or other periods of contention.

## Jitter buffers

Real-time endpoints use playback/jitter buffers to smooth variable arrival times. Larger buffers can absorb more jitter but also add delay. This is a tradeoff, not free performance.

## Practical troubleshooting

Look for:

- interface utilization and drops;
- queue drops;
- WAN latency changes;
- packet-loss bursts;
- DSCP preservation end to end;
- Wi-Fi retransmission/interference;
- VPN/tunnel overhead;
- oversubscribed uplinks;
- different signaling and media paths.

The goal is not merely to prove "bandwidth is high." A 1-Gbps link can still deliver poor voice if queues, loss, jitter, or path instability are wrong.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
