---
title: "Phone Has an IP Address but Will Not Register"
level: "beginner-to-intermediate"
tags: [phone, registration, dhcp, dns, routing, firewall, sip, troubleshooting]
source_basis:
  - "operations/dhcp.rst"
  - "naming/dns.rst"
  - "stream/session.rst"
sourceId: "networking_beginner"
documentId: "Troubleshooting_Playbooks__02_Phone_Has_IP_But_Will_Not_Register"
documentType: "playbook"
ingest: true
format: "markdown"
license: "CC-BY-4.0"
retrievalIntents: [troubleshoot, explain]
---

# Phone Has an IP Address but Will Not Register

## What the symptom tells you

An IP address proves only that some layer of network configuration succeeded. It does **not** prove the phone received the correct VLAN, gateway, DNS servers, provisioning information, certificates, or reachability to the voice service.

## Troubleshooting order

### 1. Validate the IP configuration

Confirm the phone has the expected:

```text
IP address
subnet mask/prefix
default gateway
DNS servers
DHCP lease/source
VLAN
```

A phone can receive a valid-looking IP from the wrong scope or VLAN.

### 2. Validate DNS

Determine the exact FQDNs the phone must reach and verify they resolve to expected addresses.

If DNS fails, registration may never leave the endpoint even though generic IP connectivity works.

### 3. Validate routing

Confirm the phone can reach its default gateway and that the network has a route toward the resolved service addresses.

### 4. Validate firewall and required transport

Check that the required signaling traffic is permitted outbound and that return traffic is allowed. Depending on the platform this might involve TCP, UDP, or TLS/TCP.

### 5. Validate time and certificates

Secure registration can fail when endpoint time is badly wrong or certificate trust/identity validation fails.

### 6. Validate provisioning/service discovery

Check whether DHCP options, provisioning URLs, configuration files, or platform discovery settings point the phone to the correct service.

### 7. Inspect the actual registration exchange

If SIP-based, answer:

```text
Does REGISTER leave the phone?
What destination does it use?
Does a response return?
What response code?
Is authentication challenged and then satisfied?
Does TLS establish successfully if used?
```

The location of the failure tells you whether to stay with networking or move into service/authentication configuration.

## Useful interpretation

| Observation | Next focus |
|---|---|
| No DNS resolution | DNS / DHCP DNS assignment |
| Resolves but cannot reach address | routing / firewall |
| TCP/TLS session never establishes | firewall / route / certificate / time |
| REGISTER leaves, no response | path / firewall / service listener |
| REGISTER gets 401/407 then succeeds | normal authentication challenge pattern |
| REGISTER repeatedly rejected | credentials, policy, identity, tenant/service config |
| Only phones on one VLAN fail | VLAN, DHCP scope/options, ACL, routing |

---

**Source note:** Beginner-oriented synthesis and operational guidance. See `../ATTRIBUTION.md` and `../SOURCES.md`.
