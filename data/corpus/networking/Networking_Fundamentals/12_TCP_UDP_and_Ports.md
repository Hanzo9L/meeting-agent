---
title: TCP, UDP, and Ports
level: beginner
tags:
- tcp
- udp
- ports
- transport
source_basis:
- introduction/protocols.rst
- federation/hetero.rst
- reliable/
sourceId: networking_beginner
documentId: Networking_Fundamentals__12_TCP_UDP_and_Ports
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# TCP, UDP, and Ports

## Transport layer purpose

TCP and UDP provide process-to-process communication above IP. IP gets a packet to a host; transport-layer ports help identify the intended application or conversation on that host.

## TCP

TCP provides a reliable, ordered byte stream. It establishes connection state and handles loss/retransmission, sequencing, flow control, and congestion control.

Use TCP when reliable ordered delivery is more important than avoiding every delay.

Typical application examples include HTTPS and many signaling/control protocols.

## UDP

UDP is intentionally lightweight. It sends datagrams without TCP's reliability machinery.

That makes UDP well suited to applications that value timeliness and can tolerate or handle some loss, including many real-time media flows.

UDP does **not** mean "unreliable application." Applications can add exactly the behavior they need above UDP.

## Ports

TCP and UDP use 16-bit port numbers.

A flow can be described using addresses, ports, and protocol:

```text
Source IP:   10.10.20.25
Source port: 53000
Dest IP:     203.0.113.10
Dest port:   443
Protocol:    TCP
```

This information is often called a **5-tuple** when source/destination IP, source/destination port, and protocol are considered together.

## Well-known vs ephemeral ports

Servers often listen on predictable ports. Clients commonly choose temporary **ephemeral** source ports for outbound connections.

Do not memorize hundreds of port numbers. Learn to read a firewall requirement as:

**source -> destination, protocol, destination port/range, direction, state**.

## TCP handshake concept

A simplified TCP connection begins with:

```text
Client -> SYN
Server -> SYN/ACK
Client -> ACK
```

If a TCP connection fails before application data appears, look at routing, firewall policy, listening service, and return path.

## UC relevance

SIP signaling may use TCP, UDP, or TLS over TCP depending on implementation. RTP commonly runs over UDP. This is why "the call registered" does not prove that the media path is open.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
