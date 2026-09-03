---
title: DHCP
level: beginner
tags:
- dhcp
- ip-configuration
- dora
- udp
source_basis:
- operations/dhcp.rst
sourceId: networking_beginner
documentId: Networking_Fundamentals__06_DHCP
documentType: explainer
ingest: true
format: markdown
license: CC-BY-4.0
retrievalIntents:
- explain
- reference
---

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
