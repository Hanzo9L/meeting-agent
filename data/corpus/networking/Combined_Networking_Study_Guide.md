---
sourceId: networking_beginner
documentId: Combined_Networking_Study_Guide
documentType: human-study-guide
ingest: false
format: markdown
license: CC-BY-4.0
---
# Networking for Beginners — Combined Study Guide

This file concatenates the individual corpus documents for convenient human reading or DOCX conversion. For AI/RAG ingestion, prefer the individual files.


# SECTION: Networking Fundamentals



# Networking Terminology

## The shortest useful definition of a network

A **network** is a group of devices that can exchange data. The devices may be in one room, across a company, or on opposite sides of the Internet.

The fastest way to learn networking is to stop treating the vocabulary as unrelated acronyms. Most terms describe one of four things: **a device, an address, a path, or a rule**.

## Core terms

| Term | Plain-English meaning |
|---|---|
| Host / endpoint | A device that originates or receives traffic, such as a PC, server, phone, printer, or camera. |
| NIC | Network interface card/interface. The hardware or virtual interface connecting a device to a network. |
| LAN | Local Area Network. Devices connected within a local environment. |
| WAN | Wide Area Network. Connectivity between geographically separated networks. |
| Ethernet | The dominant wired LAN technology. |
| Wi-Fi | Wireless LAN technology. |
| Frame | A Layer 2 unit of data, typically Ethernet. |
| Packet | A Layer 3 unit of data, usually an IP packet. |
| Segment / datagram | Common names for transport-layer units carried by TCP / UDP. |
| MAC address | A Layer 2 address used for local Ethernet delivery. |
| IP address | A Layer 3 logical address used for communication across IP networks. |
| Subnet | A defined range of IP addresses treated as one network. |
| Subnet mask / prefix | Tells a host which part of an IP address identifies the network. |
| Default gateway | The router a host uses when the destination is outside its local subnet. |
| Switch | Primarily forwards Ethernet frames inside a LAN. |
| Router | Forwards IP packets between networks. |
| Route | A rule describing where traffic for a destination network should go. |
| Routing table | A set of routes. |
| DNS | Converts names such as `example.com` into useful records, commonly IP addresses. |
| DHCP | Automatically supplies IP configuration to clients. |
| NAT | Rewrites addresses, commonly between private and public address space. |
| Port | A transport-layer number used to identify an application/service conversation. |
| Firewall | Enforces policy about which traffic may cross a boundary. |
| VLAN | A logical Layer 2 network that can share physical switch infrastructure with other VLANs. |
| Protocol | A defined set of rules and message formats used by communicating systems. |
| Topology | The arrangement of devices and links in a network. |
| Bandwidth | The capacity of a link or path, usually expressed in bits per second. |
| Latency | The time data takes to travel from one point to another. |
| Jitter | Variation in packet arrival timing. |
| Packet loss | Packets that never reach the destination. |

## The vocabulary in one picture

```text
PC / IP phone
  |  Ethernet frame, MAC addresses
  v
Switch ---- other local devices
  |
  |  VLAN / local subnet
  v
Router = default gateway
  |
  |  routes + firewall + often NAT
  v
Internet / WAN
  |
  v
Remote server or service
```

## A useful distinction: local delivery vs routed delivery

If two hosts are in the same IP subnet, they can normally communicate through the local Layer 2 network. If the destination is in another subnet, the sending host gives the packet to its **default gateway**. The router then decides the next path.

That single distinction explains why MAC addresses, ARP, switches, routers, gateways, and routing tables all exist.

## Check yourself

You should be able to answer these without memorizing vendor language:

1. What device usually moves traffic between IP subnets? **A router.**
2. What gives a laptop its IP configuration automatically? **DHCP.**
3. What turns a hostname into an address? **DNS.**
4. What does a switch mainly examine for ordinary Layer 2 forwarding? **MAC addresses.**
5. What does a router mainly examine for IP forwarding? **Destination IP addresses.**

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# How Networks Work

## The core idea

Networking is the process of getting data from one application to another application, possibly across many different physical networks.

The data is broken into manageable units, wrapped with addressing and control information, and passed through devices that make forwarding decisions.

## What happens when you open a website

Assume a laptop joins a corporate network and browses to a site.

```text
1. Link comes up
2. DHCP provides IP configuration
3. DNS resolves the website name
4. Laptop decides whether the destination is local or remote
5. Remote destination -> send toward default gateway
6. Switch forwards the Ethernet frame toward the gateway
7. Router/firewall forwards the IP packet toward the Internet
8. NAT may translate the source address
9. Remote server receives the request
10. Return traffic follows a viable path back
```

Each step depends on the previous one. A DNS problem can look like "the Internet is down" even when routing works. A bad default gateway can prevent remote access even though local devices communicate normally.

## Encapsulation

Different networking layers add information needed for their job.

A simplified outbound stack looks like this:

```text
Application data
   ↓
TCP/UDP header + application data
   ↓
IP header + TCP/UDP data
   ↓
Ethernet header + IP packet
   ↓
Bits/signals on cable or radio
```

At the receiver, these layers are removed in reverse order. This is called **encapsulation** and **decapsulation**.

## Why layers matter

Layering lets one part of networking change without redesigning everything else. An application can use IP regardless of whether the local link is Ethernet, Wi-Fi, fiber, or another technology.

It also gives you a troubleshooting strategy:

- Is the physical/link layer working?
- Does the device have valid IP configuration?
- Can it reach its gateway?
- Can it resolve DNS?
- Can it establish the needed TCP/UDP flow?
- Is the application itself responding?

## Best effort does not mean "bad"

IP is generally described as a **best-effort** service. It attempts to deliver packets but does not itself guarantee that every packet arrives, arrives once, or arrives in order. Higher-layer protocols and applications handle those requirements when needed.

That design is especially important for real-time media. Voice may prefer a late packet to be discarded rather than retransmitted after it is useful.

## The key operational question

For almost any network problem, ask:

**What path is this packet supposed to take, and what decision does each device make along that path?**

That question naturally leads to DHCP, DNS, switching, routing, NAT, firewalls, and transport protocols.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# OSI and TCP/IP Models

## Why models exist

The OSI and TCP/IP models are ways to organize networking functions into layers. They are useful because they give engineers a shared vocabulary and a troubleshooting framework.

You do **not** need to treat the OSI model as a law of physics. Real products sometimes blur layer boundaries.

## OSI model

| Layer | Name | Practical examples |
|---:|---|---|
| 7 | Application | HTTP, DNS, SIP |
| 6 | Presentation | Encoding, encryption concepts |
| 5 | Session | Session establishment/control concepts |
| 4 | Transport | TCP, UDP |
| 3 | Network | IPv4, IPv6, routing |
| 2 | Data Link | Ethernet, MAC addresses, VLANs |
| 1 | Physical | Copper, fiber, radio, connectors, signal |

## Practical TCP/IP stack

A more operational Internet view is often simpler:

```text
Application     HTTP / DNS / SIP / etc.
Transport       TCP / UDP
Internet        IP
Link            Ethernet / Wi-Fi
Physical        cable / fiber / radio
```

## Encapsulation example

When a SIP phone sends signaling:

```text
SIP message
  inside TCP or UDP
    inside IP
      inside Ethernet (on a wired LAN)
```

For real-time media, the stack commonly resembles:

```text
RTP/SRTP
  inside UDP
    inside IP
      inside Ethernet/Wi-Fi
```

## Troubleshooting by layer

A layered approach prevents random guessing.

**Layer 1:** Is there link, signal, power, cable integrity?

**Layer 2:** Is the switch port correct? VLAN correct? MAC learned?

**Layer 3:** Does the host have the right IP, mask, gateway? Is routing valid?

**Layer 4:** Are TCP/UDP ports reachable? Is a firewall blocking the flow?

**Layer 7:** Is DNS answering? Is SIP registering? Is the application healthy?

## Common interview trap

"What layer is a switch/router?" is usually shorthand, not a perfect definition. A classic Ethernet switch is Layer 2; a classic IP router is Layer 3. Modern devices may do both, and firewalls/SBCs can inspect multiple layers.

The useful answer is to describe **what information the device uses to make its decision**.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# Ethernet, MAC Addresses, and ARP

## Ethernet in plain English

Ethernet is the dominant wired LAN technology. On an Ethernet LAN, devices exchange **frames**. Ethernet frames include source and destination MAC addresses.

A **MAC address** identifies a network interface at Layer 2. It is used for local delivery on an Ethernet network; routers do not use the sender's original Ethernet frame end-to-end across the Internet.

## How a switch learns

A switch observes the **source MAC address** of frames arriving on each port and builds a table such as:

```text
MAC address          Port
AA:AA:AA:AA:AA:01    1
BB:BB:BB:BB:BB:02    7
CC:CC:CC:CC:CC:03    12
```

When a frame arrives, the switch looks at the destination MAC and forwards it toward the appropriate port when known.

## The ARP problem

A host may know the destination's IP address but still need an Ethernet destination MAC address.

**ARP (Address Resolution Protocol)** maps an IPv4 address on the local network to a MAC address.

Example:

```text
PC wants 10.10.20.50
PC asks: "Who has 10.10.20.50?"
Target replies with its MAC address
PC caches the mapping temporarily
```

## What if the destination is remote?

This is the critical beginner concept.

Suppose the PC is `10.10.20.25/24` and wants `8.8.8.8`. The PC sees that `8.8.8.8` is not in local subnet `10.10.20.0/24`.

It does **not** ARP for `8.8.8.8`. Instead, it ARPs for the **default gateway's local IP address**, obtains the gateway MAC, and sends an Ethernet frame to that MAC while keeping the final destination IP as `8.8.8.8`.

```text
Ethernet destination: gateway MAC
IP destination:       8.8.8.8
```

That distinction is foundational.

## Common failures

- Wrong VLAN means the expected Layer 2 neighbors are not actually on the same broadcast domain.
- Duplicate IP addresses can create unstable ARP mappings.
- A missing ARP response may indicate VLAN, cabling, switch-port, host, or local firewall issues.
- Stale ARP entries can briefly point traffic to the wrong MAC after changes.

## Useful commands

Windows:

```powershell
arp -a
getmac
ipconfig /all
```

Linux/macOS commonly use:

```bash
ip neigh
ip link
```

The exact command is less important than knowing what you are trying to prove: **Can I reach the expected Layer 2 neighbor, and does IP-to-MAC resolution make sense?**

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




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




# DHCP

## What DHCP does

**DHCP (Dynamic Host Configuration Protocol)** automates host network configuration. A DHCP server can provide more than an IP address; commonly it supplies:

- IPv4 address;
- subnet mask/prefix;
- default gateway/router;
- DNS server addresses;
- lease duration;
- additional options used by particular device types.

Without DHCP, an administrator would have to configure many endpoints manually.

## DORA

A common way to remember the initial IPv4 lease exchange is **DORA**:

```text
Client                           DHCP server
  |                                  |
  |--- DHCPDISCOVER ---------------->|
  |<-- DHCPOFFER --------------------|
  |--- DHCPREQUEST ----------------->|
  |<-- DHCPACK ----------------------|
```

The client initially does not yet have normal IP configuration, so discovery uses broadcast behavior on the local network.

## DHCP relay

Routers normally do not forward ordinary Layer 2/IP broadcasts from one subnet to another. Organizations therefore do not need a DHCP server in every VLAN.

A **DHCP relay** on or near the routed interface receives the local client request and forwards it to a remote DHCP server.

```text
Phone/PC -- VLAN 120 -- L3 interface/relay ---- routed network ---- DHCP server
```

If an entire VLAN suddenly cannot obtain addresses while other VLANs can, the relay/interface configuration is an important place to look.

## Leases

Dynamic addresses are leased for a period rather than permanently owned by the client. Clients renew leases so the server can safely reuse addresses that are no longer active.

## Why DHCP matters for phones

Desk phones often depend on DHCP not only for basic IP connectivity but also for vendor-specific discovery or provisioning information. Exact options vary by platform and deployment. A phone that powers up but never reaches its provisioning service may have a DHCP/VLAN problem rather than an application problem.

## Common symptoms

- `169.254.x.x` IPv4 address: the host likely failed to obtain normal DHCP configuration.
- Correct IP but wrong gateway: DHCP scope/options may be wrong.
- Correct IP but names fail: verify DHCP-provided DNS servers.
- One VLAN fails, others work: inspect scope exhaustion, VLAN, relay/helper, ACL/firewall, and routing.
- Intermittent conflicts: check for unauthorized/static addresses overlapping the DHCP pool.

## Troubleshooting sequence

```text
Link up?
  ↓
Correct VLAN?
  ↓
Client sends discover?
  ↓
Relay sees/forwards it?
  ↓
Server has available scope?
  ↓
Offer returns to correct subnet?
  ↓
Client receives valid IP/mask/gateway/DNS?
```

DHCP is a great example of why network troubleshooting should follow the packet path rather than start at the application.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# DNS

## What DNS does

**DNS (Domain Name System)** is a distributed, hierarchical naming system. It lets applications use names while the network ultimately communicates using addresses and other record data.

The beginner shorthand "DNS converts names to IP addresses" is useful, but DNS can return many types of information.

## Common record types

| Record | Purpose |
|---|---|
| A | Name to IPv4 address |
| AAAA | Name to IPv6 address |
| CNAME | Alias to another canonical name |
| MX | Mail exchanger information |
| NS | Authoritative name server information |
| SRV | Service location information, including target/port/priority/weight |
| TXT | Text data used for many verification/policy purposes |

## Hierarchy

DNS names are hierarchical:

```text
host.department.example.com
                     ^  ^
                  domain TLD
```

The global system is divided into administrative **zones**, served by authoritative name servers.

## Recursive resolution in simplified form

A client usually asks a recursive resolver, not every authoritative server itself.

```text
Client -> recursive DNS resolver
              |
              +-> root/TLD/authoritative chain as needed
              |
Client <- final/cached answer
```

Resolvers cache answers according to the record's **TTL (time to live)**. Caching reduces repeated work but explains why DNS changes may not appear everywhere instantly.

## DNS vs connectivity

This distinction is vital:

```text
ping 8.8.8.8 works
ping example.com fails
```

That strongly suggests IP connectivity may exist while name resolution is failing.

The reverse is also possible: DNS can return a valid address even though routing or a firewall prevents reaching it.

## UC relevance

SIP and other communications systems may use DNS to locate services, proxies, gateways, or cloud endpoints. A voice problem can therefore begin as a DNS problem before any signaling or media session exists.

## Useful checks

Windows:

```powershell
ipconfig /all
nslookup example.com
Resolve-DnsName example.com
```

Linux/macOS examples:

```bash
dig example.com
nslookup example.com
```

## Troubleshooting sequence

1. Confirm the client has the intended DNS server(s).
2. Query the exact name.
3. Check whether the result is correct and current.
4. Compare behavior using a known IP destination.
5. Remember that cached answers can persist until TTL expiry.
6. If service discovery is involved, inspect SRV/CNAME chains rather than only A records.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# Switches and VLANs

## What a switch does

A switch interconnects network links and forwards traffic toward the appropriate output port. In a classic Ethernet role, it makes Layer 2 forwarding decisions using MAC addresses.

Modern hardware can often operate as Layer 2, Layer 3, or both, so the practical question is what forwarding function is configured.

## VLANs

A **VLAN (Virtual LAN)** divides one physical switching infrastructure into separate logical Layer 2 networks.

```text
Physical switch
├── VLAN 10  Users
├── VLAN 20  Voice
└── VLAN 30  Servers
```

Devices in different VLANs do not communicate directly at Layer 2. Traffic between VLANs normally requires routing through a Layer 3 interface/router and is therefore subject to Layer 3 policy.

## Access ports vs trunks

**Access port:** normally carries traffic for one VLAN toward an endpoint.

**Trunk:** carries multiple VLANs between network devices or to systems that understand tagging.

802.1Q tagging inserts VLAN information into Ethernet frames on tagged links.

```text
Phone/PC -- access/voice configuration -- switch == tagged trunk == switch/router
```

## Broadcast domains

VLANs limit broadcast scope. A broadcast in VLAN 20 is not automatically flooded into VLAN 30. This improves isolation and limits the impact of broadcast traffic.

## Logical vs physical topology

One major value of VLANs is that logical network membership can change without physically recabling every path. Two endpoints plugged into nearby ports may still be in entirely different Layer 2 networks.

## Common failure patterns

- Endpoint on wrong access VLAN: DHCP may fail or deliver an address from the wrong subnet.
- Trunk missing a VLAN: devices work on one switch but not across the trunk.
- Native/tagging mismatch: intermittent or confusing Layer 2 behavior.
- Voice VLAN not advertised/assigned as expected: IP phone lands in data network or fails provisioning.
- Inter-VLAN routing missing: hosts receive valid IPs but cannot reach resources outside their VLAN.

## Operational distinction

A VLAN is a **Layer 2 segmentation concept**. A subnet is a **Layer 3 addressing concept**. They are often designed one-to-one, but they are not the same thing.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




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




# NAT and PAT

## Why NAT exists

**Network Address Translation (NAT)** rewrites address information as traffic crosses a network boundary. A common use is allowing hosts with private IPv4 addresses to communicate with the public Internet.

## The common home/enterprise pattern

```text
Inside host: 10.10.20.25:53000
        |
        v
NAT/firewall public IP: 198.51.100.20:62001
        |
        v
Internet server: 203.0.113.50:443
```

The NAT device remembers the translation in a state table so reply traffic can be mapped back to the correct internal host.

## PAT / NAPT

When many inside hosts share one public address, transport-layer port numbers help distinguish flows. This is commonly called **PAT (Port Address Translation)** or NAPT.

Example table:

```text
Inside local           Outside translated
10.10.20.25:53000  ->  198.51.100.20:62001
10.10.20.26:53000  ->  198.51.100.20:62002
```

## NAT is not the same as a firewall

They often exist on the same appliance, but they solve different problems:

- NAT changes addressing/ports.
- A firewall decides whether traffic is allowed according to policy/state.

Do not assume "NAT protects us" is a complete firewall design.

## Why NAT complicates real-time communications

A device behind NAT may advertise its private address inside application signaling. A remote peer cannot directly route to that private address.

Also, NAT mappings are often created by outbound traffic and age out after inactivity. Inbound peer-to-peer communication becomes more complicated.

This is why real-time systems use techniques such as STUN, TURN, ICE, media relays, and SBCs.

## Static NAT and port forwarding

An organization may intentionally create a fixed mapping so inbound traffic to a public address/port reaches a particular internal service. This must be paired with appropriate security policy.

## Troubleshooting clues

- Signaling works but one-way audio: inspect advertised media addresses and NAT behavior.
- Calls drop after a repeatable idle interval: consider state/NAT timeout behavior.
- Internal calls work, external calls fail: focus on the edge boundary, NAT, firewall, and media traversal.
- One direction works but the other does not: remember that NAT/firewall state and return routing are directional concerns.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




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



# SECTION: UC Networking Bridge



# UC Networking Overview

## The most important idea in voice networking

A modern IP call is not "one connection." It usually consists of multiple dependencies and often separate signaling and media paths.

```text
Device startup
  -> VLAN / Ethernet / Wi-Fi
  -> DHCP
  -> DNS
  -> IP routing
  -> firewall/NAT
  -> signaling (often SIP or platform-specific HTTPS/TLS)
  -> media negotiation
  -> RTP/SRTP media path
```

A call can register successfully and still have no audio because registration proves only part of the path.

## Control vs media

**Signaling/control** handles tasks such as registration, locating users, inviting participants, negotiating capabilities, and ending sessions.

**Media** carries the actual audio/video packets.

SIP is a classic signaling protocol. RTP is a classic real-time media transport protocol.

## Why network fundamentals matter

- DHCP may place the phone on the network and supply DNS/gateway information.
- DNS may locate services.
- Routing determines where signaling and media packets travel.
- NAT changes addresses and ports at boundaries.
- Firewalls enforce allowed flows.
- QoS affects real-time traffic during congestion.
- VLANs separate voice and data broadcast domains.
- SBCs control SIP/media boundaries and interconnect dissimilar networks.

## A practical call-path sketch

```text
Desk phone
  |
Voice VLAN
  |
Access switch
  |
Default gateway
  |
Core / WAN
  |
Firewall / NAT
  |
SBC or cloud edge
  |\
  | \__ signaling service
  |
  \____ media peer / relay
```

When troubleshooting, annotate this diagram with actual IP addresses, NAT translations, interfaces, DNS names, ports, and expected QoS markings.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# SIP

## What SIP is

**SIP (Session Initiation Protocol)** is a signaling protocol used to establish, modify, and end communication sessions. It is commonly paired with RTP for VoIP media.

SIP is not the audio itself.

## Basic conceptual flow

```text
Caller                         Callee
  |---- INVITE ----------------->|
  |<--- 100 Trying --------------|
  |<--- 180 Ringing -------------|
  |<--- 200 OK ------------------|
  |---- ACK -------------------->|
  |==== RTP/SRTP media =========>|
  |<=== RTP/SRTP media ==========|
  |---- BYE -------------------->|
  |<--- 200 OK ------------------|
```

Real deployments often include proxies, SBCs, gateways, and cloud services between the endpoints.

## SIP URIs

SIP commonly identifies users/resources using URI-style names such as:

```text
sip:user@example.com
```

This identifies the user or service, not necessarily a fixed device location.

## SDP

SIP messages often carry **SDP (Session Description Protocol)** data describing proposed media characteristics such as:

- media type;
- codecs;
- IP address/connection information;
- UDP ports;
- other session attributes.

This is why a SIP signaling capture can reveal a one-way-audio problem: the signaling may advertise a private or unreachable media address.

## Registration and proxies

SIP can register a user's current contact location with a registrar. Proxies route requests toward appropriate endpoints or services.

DNS can also participate in locating SIP infrastructure.

## Signaling path can differ from media path

A SIP proxy may participate in call setup while media flows directly between endpoints or through a separate relay/SBC. Therefore:

**Successful SIP does not prove successful RTP.**

## Common troubleshooting questions

- Did registration succeed?
- Did the INVITE reach the expected destination?
- What response code came back?
- What codec/media address/port did SDP negotiate?
- Did an SBC or firewall rewrite anything?
- Does media flow after ACK/200 OK?
- Does BYE come from a real user action, timeout, or network failure?

Understanding the message sequence is more useful than memorizing every SIP header.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# RTP and SRTP

## RTP carries real-time media

**RTP (Real-time Transport Protocol)** provides common structure for real-time audio/video delivery. It commonly runs over UDP.

RTP includes information that helps the receiver interpret a real-time stream, including sequence/timing information and payload type.

## Why UDP is common

Interactive media has strict timing requirements. Retransmitting an old voice packet may make it arrive after its playback time. RTP therefore commonly uses UDP and lets the real-time application handle loss appropriately.

## Sequence numbers and timestamps

These help an endpoint detect loss/reordering and play samples at the correct time.

```text
Packet 1001  timestamp 8000
Packet 1002  timestamp 8160
Packet 1004  timestamp 8480   <- packet 1003 missing
```

A receiver can recognize the gap and use concealment rather than wait indefinitely.

## RTCP

**RTCP (RTP Control Protocol)** accompanies RTP and carries control/reporting information about media sessions. It can help describe quality, synchronization, and participant information.

## SRTP

**SRTP (Secure RTP)** protects real-time media with encryption/authentication mechanisms defined for RTP streams.

Do not confuse:

- SIP/TLS: protects signaling in designs that use SIP over TLS.
- SRTP: protects media.

A system can have secure signaling and a separate secure-media negotiation/process.

## One-way audio

One-way audio is a classic sign that signaling completed but the two media directions do not both work.

Possible causes include:

- wrong SDP media address;
- NAT translation issue;
- firewall UDP policy;
- missing route/return route;
- media anchored to unexpected SBC/relay;
- asymmetric path/stateful firewall problem;
- endpoint binding to wrong interface.

## Packet capture view

For RTP troubleshooting, identify:

```text
A -> B packets per second
B -> A packets per second
source/destination IPs
UDP ports
sequence gaps
jitter
loss
codec/payload type
DSCP markings
```

That tells you whether the problem is network transport, negotiation, or endpoint/media processing.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# NAT Traversal: STUN, TURN, and ICE

## The NAT traversal problem

Two endpoints may each have only private addresses that are not globally routable.

```text
Endpoint A 10.0.0.20 -- NAT A -- Internet -- NAT B -- 192.168.5.40 Endpoint B
```

Neither endpoint can simply advertise its private IP and expect the other to send Internet traffic directly to it.

## STUN

**STUN** helps a client discover how it appears from outside its NAT, including the public-facing mapped address/port observed by a STUN server.

Think: **What address does the outside world see for me?**

STUN by itself does not guarantee that two endpoints can establish a direct path through every type of NAT/firewall.

## TURN

**TURN** provides a relay when direct peer-to-peer connectivity is not viable.

```text
Endpoint A -> TURN relay -> Endpoint B
```

Relay traffic consumes infrastructure bandwidth, but it provides a dependable fallback when direct media is impossible.

## ICE

**ICE (Interactive Connectivity Establishment)** coordinates candidate gathering and connectivity checks. Candidates can include:

- host/local addresses;
- server-reflexive addresses learned through STUN;
- relay addresses obtained through TURN.

ICE tests candidates and selects a working pair according to its process.

Think:

```text
STUN = discover external mapping
TURN = relay when needed
ICE  = gather/test/select viable paths
```

## Why this matters in UC

A call may work on an internal corporate LAN but fail from a home network, hotel, guest Wi-Fi, or restrictive firewall because NAT behavior and allowed UDP paths differ.

Troubleshooting should therefore ask:

- Which candidate/path was selected?
- Direct or relay?
- Did the firewall allow connectivity checks?
- Did NAT mappings stay alive?
- Did both media directions use the same expected boundary?

NAT traversal is fundamentally a **path discovery and reachability problem**, not magic inside the voice application.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




# Session Border Controller Fundamentals

## What an SBC is

A **Session Border Controller (SBC)** sits at a real-time communications boundary and controls signaling and often media between networks, tenants, carriers, or platforms.

An SBC is not merely "a voice firewall," although security is one of its roles.

## Common SBC functions

Depending on design/product, an SBC may provide:

- SIP interworking and normalization;
- topology hiding;
- signaling policy;
- media anchoring/relay;
- NAT traversal assistance;
- codec negotiation/transcoding in some platforms;
- TLS/SRTP termination or mediation;
- admission control;
- carrier/PSTN interconnect;
- survivability or routing logic;
- logging, call traces, and quality telemetry.

## Why media anchoring matters

Without anchoring, endpoints may try to send RTP directly to one another. With an SBC anchoring media:

```text
Endpoint A -> SBC media interface -> Endpoint B/carrier
```

Both parties send media to the SBC, which creates a controlled boundary and can solve addressing/interworking problems.

## Signaling interface vs media interface

Do not assume every SBC flow uses one IP. Enterprise SBCs may have separate interfaces, realms, zones, or public/private legs.

A troubleshooting diagram should show:

```text
inside SIP IP
outside SIP IP
inside media IP/range
outside media IP/range
NAT public mappings
next-hop proxy/carrier
```

## SBC vs NAT vs firewall

- NAT translates addresses/ports.
- Firewall enforces traffic policy/state.
- SBC understands and controls communication sessions and may rewrite application-level signaling/media information.

They may coexist on one path but are conceptually different.

## What to inspect during a failed call

- Did the SBC receive the inbound SIP message?
- Which routing policy matched?
- What SIP message did it send out?
- Did it normalize or rewrite headers/SDP?
- Which media addresses/ports were allocated?
- Did RTP arrive on each leg?
- Was TLS/SRTP negotiation compatible?
- Did a codec or policy mismatch cause rejection?

The SBC is often the best observation point because it can expose both call signaling and media-leg behavior.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.




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




# UC Troubleshooting Flow

## A repeatable voice troubleshooting method

Start with the symptom, but trace the dependencies from the bottom upward.

## 1. Endpoint attachment

```text
Power / PoE
Link
Switch port
VLAN
```

If the phone has no valid network attachment, nothing higher matters.

## 2. IP configuration

Verify:

```text
IP address
mask/prefix
default gateway
DNS
DHCP lease/source
```

If the phone self-assigns or receives an unexpected subnet, stop here and fix it.

## 3. Name resolution and service reachability

Can it resolve the exact service names it needs? Can it reach the gateway and remote service addresses?

## 4. Signaling

For SIP-based systems:

```text
REGISTER succeeds?
INVITE leaves?
Expected proxy/SBC receives it?
Response code?
TLS handshake if used?
Authentication/policy?
```

## 5. Media negotiation

Inspect SDP or equivalent negotiation:

```text
codec
media IP
media UDP port
security mode
selected media relay/SBC
```

## 6. Media transport

Prove both directions separately:

```text
A ---> B RTP/SRTP packets?
A <--- B RTP/SRTP packets?
```

If only one direction flows, focus on that direction's route, NAT, firewall state, and negotiated destination.

## 7. Quality

If media flows but sounds poor, measure:

- latency;
- jitter;
- packet loss;
- bursts vs steady loss;
- DSCP/QoS treatment;
- interface/queue drops;
- Wi-Fi health;
- media path/relay location.

## Symptom shortcuts

| Symptom | Start here |
|---|---|
| No IP | VLAN / DHCP |
| IP but no registration | DNS / routing / firewall / signaling service |
| Registered, cannot place call | signaling route/policy/SIP response |
| Call connects, no audio | media negotiation / firewall / NAT / RTP |
| One-way audio | directional media path / NAT / routing / firewall |
| Choppy audio | loss / jitter / congestion / QoS |
| Calls fail only externally | edge firewall/NAT/SBC/media traversal |
| Calls drop at repeatable interval | state/keepalive/session timer/NAT timeout possibilities |

## The final habit

For every failed call, be able to draw two paths:

```text
SIGNALING PATH
Endpoint -> proxy/SBC -> service/carrier

MEDIA PATH
Endpoint -> peer/SBC/relay -> remote endpoint
```

Those paths may not be the same. Treating them separately is one of the biggest leaps from beginner troubleshooting to competent UC troubleshooting.

---

**Source note:** This is a beginner-oriented rewrite and synthesis. See `../ATTRIBUTION.md` and `../SOURCES.md` for upstream attribution and standards references.

