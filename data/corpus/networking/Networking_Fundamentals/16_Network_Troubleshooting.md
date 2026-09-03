---
title: Network Troubleshooting
level: beginner
tags:
- troubleshooting
- ping
- traceroute
- dns
- packet-capture
source_basis:
- operations/
- introduction/performance.rst
- routing/design.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__16_Network_Troubleshooting
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

# Network Troubleshooting

## Troubleshoot from evidence, not from the loudest symptom

A good network troubleshooter creates a hypothesis and proves or disproves each dependency in order.

## Step 1: Define the failure precisely

Bad: "Network is broken."

Better:

- one user or many?
- one VLAN/site or every site?
- IP connectivity or only names?
- signaling or media?
- one direction or both?
- constant or time-dependent?
- did anything change?

## Step 2: Check local configuration

```text
Link / Wi-Fi association
VLAN
IP address
Subnet mask/prefix
Default gateway
DNS servers
DHCP vs static
```

Windows starting points:

```powershell
ipconfig /all
Get-NetIPConfiguration
route print
arp -a
```

## Step 3: Test progressively farther away

A useful progression:

```text
1. Loopback / local stack
2. Own IP/interface
3. Same-subnet neighbor
4. Default gateway
5. Remote IP destination
6. DNS by name
7. Application TCP/UDP flow
8. Full application transaction
```

Each successful step narrows the fault domain.

## Step 4: Follow the route

```powershell
tracert destination
```

or:

```bash
traceroute destination
```

Do not assume every hop must reply to traceroute. Use it as path evidence, not as an absolute health test.

## Step 5: Separate DNS from IP

If address-based access works but name-based access fails, focus on DNS.

If DNS returns a correct address but the connection fails, focus on routing, firewalls, listening service, NAT, or return path.

## Step 6: Inspect ports and state

For TCP, determine whether the handshake completes. For UDP, determine whether packets leave, arrive, and receive expected replies. Firewalls can allow one flow and block another.

## Step 7: Packet capture when necessary

A capture answers questions that logs may not:

```text
Did the client send it?
What source/destination did it actually use?
Did DNS reply?
Did the TCP SYN receive SYN/ACK?
Did SIP advertise the expected media address?
Did RTP flow both directions?
Were packets retransmitted, reordered, or lost?
```

Wireshark is powerful because it lets you inspect actual protocol behavior rather than infer it from an application's error message.

## Golden rule

**Start where the failure is known, then move one dependency at a time.**

Random configuration changes create new variables. A packet-path method creates evidence.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.
