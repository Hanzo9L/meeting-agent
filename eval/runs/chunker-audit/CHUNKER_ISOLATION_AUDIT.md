# Chunker Isolation Audit

Generated: 2026-08-17T01:52:48.294Z
Database: `C:\Users\joegc\projects\meeting-agent\.knowledge-v2\knowledge-v2.sqlite`
Chunker version constant: `cg01a-v1`

Scope: parsed document → production chunker only. No embeddings, retrieval, R2, R3, R4, or synthesis.

## 1. Production parser and chunker

- **Parser:** `parseCanonicalDocument` in `src/main/services/knowledgeV2/parse/parser.ts`
- **Chunker:** `chunkKnowledgeDocument` in `src/main/services/knowledgeV2/chunking/semanticChunker.ts`
- **Production call site:** `DocumentIndexingJob` passes `chunkerVersion` (default corpus jobs use `cg01a-v1`)
- **Configured max chunk size:** `2200` characters (`DEFAULT_MAX_CHUNK_CHARS`). Options allow override; floor is 600.
- **Target chunk size:** none. The chunker packs whole canonical blocks into a section slice until the next block would exceed max.
- **Overlap:** none. No previous/next window is copied into adjacent chunks.
- **Heading handling:** markdown headings become `CanonicalSection` nodes. Chunker flattens the tree (parent then children). Each chunk's `retrievalText` prefixes `Document: {title}` and `Heading Path: a -> b -> c`. Headings are not duplicated as body text.
- **List handling:** an entire ordered/unordered list is **one canonical block**. Lists are not split item-by-item unless the rendered list itself exceeds max, in which case `splitLargeText` / `splitHard` may break on blank lines then whitespace.
- **Table handling:** tables are flushed as **standalone** chunks (`chunkKind: table`).
- **Code handling:** code fences are flushed as **standalone** chunks (`chunkKind: code` unless inside PowerShell example/syntax).
- **Callouts:** blockquotes matching note/important/warning/caution/tip become `callout` blocks and pack with surrounding prose in the same section.
- **Paragraph boundaries:** splits occur between canonical blocks when adding the next block would exceed max. Oversized single blocks split on `\n{2,}` then hard-split on whitespace.
- **Semantic boundary rules:** section-kind special cases for PowerShell (synopsis/syntax/examples/parameters). Generic docs infer `chunkKind` from heading keywords (troubleshoot, configure, procedure, reference) plus presence of ordered lists. There is **no** semantic splitter beyond heading sections + block packing + max-char overflow.

## 2. Selected local Interview Authority Pack documents

### Document A

- Role: Troubleshooting / procedural (media path, SBC, media bypass)
- source ID: `ms-teams-admin`
- document ID: `3a0f81d7bdd927d626dd7e8c82317fc83609a1eba5755dd5469711375f7850b4`
- stored document ID: `3a0f81d7bdd927d626dd7e8c82317fc83609a1eba5755dd5469711375f7850b4`
- IDs match re-parse: `true`
- canonical URL: https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-media-bypass
- title: Plan for media bypass with Direct Routing
- chunkerVersion (live): `cg01a-v1`
- stored chunker_version: `cg01a-v1`
- live chunks: 34
- stored chunks: 34
- live chunk IDs match stored: `true`
- retrievalText chars: min 196 / median 447 / max 2280
- chunks with body < 200 chars: 10
- diagnostics: 12

### Document B

- Role: Conceptual / multi-concept (voice routing policy → PSTN usage → route → gateway)
- source ID: `ms-teams-admin`
- document ID: `34479d7ba3abd30a5944bac98f48a401a88270ca75e6cd7aab36982de4b96aec`
- stored document ID: `34479d7ba3abd30a5944bac98f48a401a88270ca75e6cd7aab36982de4b96aec`
- IDs match re-parse: `true`
- canonical URL: https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing
- title: Configure call routing for Direct Routing
- chunkerVersion (live): `cg01a-v1`
- stored chunker_version: `cg01a-v1`
- live chunks: 69
- stored chunks: 69
- live chunk IDs match stored: `true`
- retrievalText chars: min 235 / median 399 / max 2106
- chunks with body < 200 chars: 38
- diagnostics: 12

## 3. Per-document parsed structure and chunks

## Document A — identity

**Role:** Troubleshooting / procedural (media path, SBC, media bypass)

| Field | Value |
|---|---|
| source ID | `ms-teams-admin` |
| document ID (re-parsed) | `3a0f81d7bdd927d626dd7e8c82317fc83609a1eba5755dd5469711375f7850b4` |
| document ID (stored) | `3a0f81d7bdd927d626dd7e8c82317fc83609a1eba5755dd5469711375f7850b4` |
| canonical URL | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-plan-media-bypass |
| title | Plan for media bypass with Direct Routing |
| track | `ga` |
| transport | `learn_mcp` |
| source path | `microsoftteams/direct-routing-plan-media-bypass` |
| parser warnings | 0 |
| live chunks | 34 |
| stored chunks | 34 |
| chunk IDs match stored index | `true` |

### A. Parsed structure (before chunking)

Title: **Plan for media bypass with Direct Routing**

- **H1** `Plan for media bypass with Direct Routing` — sectionId=`sec-1` kind=`generic` headingPath=`Plan for media bypass with Direct Routing`
  - _(no blocks; heading exists for hierarchy only)_
  - **H2** `About media bypass with Direct Routing` — sectionId=`sec-2` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → About media bypass with Direct Routing`
    - block 0 `paragraph` (362 chars)
      Media bypass enables you to shorten the path of media traffic and reduce the number of hops in transit for better performance. With media bypass, media is kept between the Session Border Controller (SBC) and the client instead of sending it via the Microsoft Teams Phone. To confi…
    - block 1 `paragraph` (304 chars)
      You can control media bypass for each SBC by using the Set-CSOnlinePSTNGateway command with the -MediaBypass parameter set to true or false. If you enable media bypass, it doesn't mean that all media traffic stays within the corporate network. This article describes the call flow…
    - block 2 `paragraph` (93 chars)
      The following diagrams illustrate the difference in call flows with and without media bypass.
    - block 3 `paragraph` (185 chars)
      Without media bypass, when a client makes or receives a call, both signaling and media flowing between the SBC, the Teams Phone, and the Teams client, as shown in the following diagram:
    - block 4 `paragraph` (52 chars)
      Shows signaling and media flow without media bypass.
    - block 5 `paragraph` (201 chars)
      But let's assume that a user is in the same building or network as the SBC. For example, assume a user who is in a building in Frankfurt makes a call to a Public Switched Telephone Network (PSTN) user:
    - block 6 `unordered_list` (549 chars)
      - Without media bypass, media flows via either Amsterdam or Dublin (where Microsoft datacenters are deployed) and back to the SBC in Frankfurt.The datacenter in Europe is selected because the SBC is in Europe, and Microsoft uses the datacenter closest to the SBC. While this appro…
    - block 7 `paragraph` (49 chars)
      Shows signaling and media flow with media bypass.
    - block 8 `paragraph` (318 chars)
      Media bypass uses protocols called Interactive Connectivity Establishment (ICE) on the Teams client and ICE Lite on the SBC. These protocols enable Direct Routing to use the most direct media path for optimal quality. ICE and ICE Lite are WebRTC standards. For detailed informatio…
  - **H2** `Call flow and firewall planning` — sectionId=`sec-3` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Call flow and firewall planning`
    - block 0 `paragraph` (171 chars)
      Call flow and firewall planning depend on whether the user has direct access to the public IP address of the SBC, and whether the user is inside or outside of the network.
    - **H3** `Call flow if the user has direct access to the public IP address of the SBC` — sectionId=`sec-4` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user has direct access to the public IP address of the SBC`
      - block 0 `paragraph` (95 chars)
        If the user has direct access to the public IP address of the SBC, the call flow is as follows:
      - block 1 `unordered_list` (401 chars)
        - For media bypass, the Teams client must have access to the public IP address of the SBC even from an internal network. If direct media isn't desired, the media can flow via Transport Relays.
        - This flow is the recommended solution when a user is in the same building and/or netw…
      - block 2 `paragraph` (167 chars)
        The following diagram shows a call flow when media bypass is enabled, the client is internal, and the client can reach the public IP address of the SBC (direct media):
      - block 3 `unordered_list` (225 chars)
        - The arrows and numeric values of the paths are in accordance with Microsoft Teams call flows.
        - The SIP signaling always takes paths 4 and 4' (depending on the direction of the traffic). Media stays local and takes path 5b.
      - block 4 `paragraph` (129 chars)
        Diagram shows call flow with media bypass enabled, client is internal, and the client can reach the public IP address of the SBC.
    - **H3** `Call flow if the user doesn't have access to the public IP address of the SBC` — sectionId=`sec-5` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user doesn't have access to the public IP address of the SBC`
      - block 0 `paragraph` (111 chars)
        The following scenario describes call flow if the user doesn't have access to the public IP address of the SBC.
      - block 1 `paragraph` (297 chars)
        For example, assume the user is external, and the tenant administrator decides not to open the public IP address of the SBC to everyone in the Internet, but only to the Microsoft Cloud. The internal components of traffic can flow via the Teams Transport Relays. Consider the follo…
      - block 2 `unordered_list` (269 chars)
        - Teams Transport Relays are used.
        - For media bypass, Microsoft uses a version of Transport Relays that requires opening ports 50 000 to 59 999 between the Teams Transport Relays and the SBC (in the future we plan to move to the version that requires 3478-3481 ports).
      - block 3 `paragraph` (220 chars)
        The following diagram shows a call flow when media bypass is enabled, the client is external, and the client can't reach the public IP address of the Session Border Controller (media is relayed by Teams Transport Relay).
      - block 4 `unordered_list` (141 chars)
        - The arrows and numeric values of the paths are in accordance with Microsoft Teams call flows.
        - Media is relayed via paths 3, 3', 4 and 4'.
      - block 5 `paragraph` (130 chars)
        Diagram shows call flow when media bypass is enabled, the client is external, and the client can't reach the public IP of the SBC.
    - **H3** `Call flow if a user is outside the network and has access to the public IP of the SBC` — sectionId=`sec-6` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if a user is outside the network and has access to the public IP of the SBC`
      - block 0 `paragraph` (4 chars)
        Note
      - block 1 `paragraph` (220 chars)
        This configuration isn't recommended because it doesn't take advantage of Teams Transport Relays. Instead, you should consider the previous scenario where the user doesn't have access to the public IP address of the SBC.
      - block 2 `paragraph` (167 chars)
        The following diagram shows a call flow when media bypass is enabled, the client is external, and the client can reach the public IP address of the SBC (direct media).
      - block 3 `unordered_list` (226 chars)
        - The arrows and numeric values of the paths are in accordance with the Microsoft Teams call flows article.
        - The SIP signaling always takes paths 3 and 3' (depending on the direction of the traffic). Media flows using path 2.
      - block 4 `paragraph` (136 chars)
        Diagram shows call flow when media bypass is enabled, the client is external, and the client can reach the public IP address of the SBC.
  - **H2** `Use of Media Processors and Transport Relays` — sectionId=`sec-7` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
    - block 0 `paragraph` (128 chars)
      There are two components in the Microsoft Cloud that can be in the path of media traffic: Media Processors and Transport Relays.
    - block 1 `unordered_list` (659 chars)
      - The Media Processor is a public facing component that handles media in non-bypass cases and handles media for voice applications.Media Processors are always in the path for end user non-bypassed calls, but never in the path for bypassed calls. Media Processors are always in the…
    - block 2 `paragraph` (117 chars)
      The following diagram shows two call flows – one with media bypass enabled and the second with media bypass disabled.
    - block 3 `paragraph` (4 chars)
      Note
    - block 4 `paragraph` (81 chars)
      The diagram only illustrates traffic originating from--or destined to--end users.
    - block 5 `unordered_list` (223 chars)
      - The Media Controller is a microservice in Azure that assigns Media Processors and creates Session Description Protocol (SDP) offers.
      - The SIP Proxy is a component that translates HTTP REST signaling used in Teams to SIP.
    - block 6 `paragraph` (64 chars)
      Diagram shows call flows with media bypass enabled and disabled.
    - block 7 `paragraph` (92 chars)
      The following table summarizes the difference between Media Processors and Transport Relays.
    - block 8 `table` (61 chars)
      TABLE headers=[ | Media Processors | Transport Relays] rows=4
    - block 9 `paragraph` (18 chars)
      The IP ranges are:
    - block 10 `unordered_list` (129 chars)
      - 52.112.0.0/14 (IP addresses from 52.112.0.0 to 52.115.255.255)
      - 52.120.0.0/14 (IP addresses from 52.120.0.0 to 52.123.255.255)
    - block 11 `paragraph` (4 chars)
      Note
    - block 12 `paragraph` (124 chars)
      IP ranges presented in this document are specific to Direct Routing and might differ from the ones advised for Teams client.
    - block 13 `paragraph` (26 chars)
      * Transcoding explanation:
    - block 14 `unordered_list` (272 chars)
      - Media Processor is B2BUA, which means it can change codecs (for example, SILK from Teams client to MP and G.711 between MP and SBC).
      - Transport Relays aren't B2BUA, which means the codec is never changed between the client and the SBC--even if traffic flows via relays.
    - **H3** `Use of Teams Media Processors if trunk is configured for media bypass` — sectionId=`sec-8` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays → Use of Teams Media Processors if trunk is configured for media bypass`
      - block 0 `paragraph` (88 chars)
        Teams Media Processors are always inserted in the media path in the following scenarios:
      - block 1 `unordered_list` (150 chars)
        - Call is escalated from 1:1 to a group call
        - Call is going to a federated Teams user
        - Call is forwarded or transferred to a Skype for Business user
      - block 2 `paragraph` (118 chars)
        Ensure your SBC has access to the Media Processors and Transport Relays ranges as described in the following sections.
  - **H2** `SIP Signaling: FQDNs` — sectionId=`sec-9` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → SIP Signaling: FQDNs`
    - block 0 `paragraph` (93 chars)
      For SIP signaling, the FQDN and firewall requirements are the same as for non-bypassed cases.
    - block 1 `paragraph` (84 chars)
      Direct Routing is offered in the following Microsoft 365 or Office 365 environments:
    - block 2 `unordered_list` (85 chars)
      - Microsoft 365 or Office 365
      - Office 365 GCC
      - Office 365 GCC High
      - Office 365 DoD
    - block 3 `paragraph` (90 chars)
      Learn more about Office 365 and US Government environments such as GCC, GCC High, and DoD.
    - **H3** `Microsoft 365, Office 365, and Office 365 GCC environments` — sectionId=`sec-10` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Microsoft 365, Office 365, and Office 365 GCC environments`
      - block 0 `paragraph` (71 chars)
        The connection points for Direct Routing are the following three FQDNs:
      - block 1 `unordered_list` (588 chars)
        - sip.pstnhub.microsoft.com – Global FQDN – must be tried first. When the SBC sends a request to resolve this name, the Microsoft Azure DNS servers return an IP address pointing to the primary Azure datacenter assigned to the SBC. The assignment is based on performance metrics of…
      - block 2 `paragraph` (45 chars)
        You must place these three FQDNs in order to:
      - block 3 `unordered_list` (285 chars)
        - Provide optimal experience (less loaded and closest to the SBC datacenter assigned by querying the first FQDN).
        - Provide failover when a connection from an SBC is established to a datacenter that is experiencing a temporary issue. For more information, see Failover mechanism b…
      - block 4 `paragraph` (147 chars)
        The FQDNs sip.pstnhub.microsoft.com, sip2.pstnhub.microsoft.com, and sip3.pstnhub.microsoft.com resolve to IP addresses from the following subnets:
      - block 5 `unordered_list` (31 chars)
        - 52.112.0.0/14
        - 52.120.0.0/14
      - block 6 `paragraph` (143 chars)
        You need to open ports for all these IP ranges in your firewall to allow incoming and outgoing traffic to and from the addresses for signaling.
    - **H3** `Office 365 GCC DoD environment` — sectionId=`sec-11` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC DoD environment`
      - block 0 `paragraph` (62 chars)
        The connection point for Direct Routing is the following FQDN:
      - block 1 `paragraph` (162 chars)
        sip.pstnhub.dod.teams.microsoft.us – Global FQDN. As the Office 365 DoD environment exists only in the US data centers, there are no secondary and tertiary FQDNs.
      - block 2 `paragraph` (96 chars)
        The FQDN sip.pstnhub.dod.teams.microsoft.us resolves to an IP address from the following subnet:
      - block 3 `unordered_list` (16 chars)
        - 52.127.64.0/21
      - block 4 `paragraph` (258 chars)
        You need to open ports for all these IP ranges in your firewall to allow incoming and outgoing traffic to and from the addresses for signaling. If your firewall supports DNS names, the FQDN sip.pstnhub.dod.teams.microsoft.us resolves to all these IP subnets.
    - **H3** `Office 365 GCC High environment` — sectionId=`sec-12` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC High environment`
      - block 0 `paragraph` (62 chars)
        The connection point for Direct Routing is the following FQDN:
      - block 1 `paragraph` (156 chars)
        sip.pstnhub.gov.teams.microsoft.us – Global FQDN. As the GCC High environment exists only in the US data centers, there are no secondary and tertiary FQDNs.
      - block 2 `paragraph` (96 chars)
        The FQDN sip.pstnhub.gov.teams.microsoft.us resolves to an IP address from the following subnet:
      - block 3 `unordered_list` (16 chars)
        - 52.127.88.0/21
      - block 4 `paragraph` (258 chars)
        You need to open ports for all these IP ranges in your firewall to allow incoming and outgoing traffic to and from the addresses for signaling. If your firewall supports DNS names, the FQDN sip.pstnhub.gov.teams.microsoft.us resolves to all these IP subnets.
  - **H2** `SIP Signaling: Ports` — sectionId=`sec-13` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → SIP Signaling: Ports`
    - block 0 `paragraph` (95 chars)
      Port requirements are the same for all Office 365 environments where Direct Routing is offered:
    - block 1 `unordered_list` (85 chars)
      - Microsoft 365 or Office 365
      - Office 365 GCC
      - Office 365 GCC High
      - Office 365 DoD
    - block 2 `paragraph` (33 chars)
      You must use the following ports:
    - block 3 `table` (75 chars)
      TABLE headers=[Traffic | From | To | Source port | Destination port] rows=2
  - **H2** `Media traffic: IP and Port ranges` — sectionId=`sec-14` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges`
    - block 0 `paragraph` (181 chars)
      Media traffic flows between the SBC and Teams client if direct connectivity is available or via Teams Transport Relays if the client can't reach the SBC using the public IP address.
    - **H3** `Requirements for direct media traffic (between the Teams client and the SBC)` — sectionId=`sec-15` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
      - block 0 `paragraph` (99 chars)
        The client must have access to the specified ports (see table) on the public IP address of the SBC.
      - block 1 `paragraph` (4 chars)
        Note
      - block 2 `paragraph` (201 chars)
        If the client is in an internal network, the media flows to the public IP address of the SBC. You can configure hair pinning on your NAT device so traffic never leaves the enterprise network equipment.
      - block 3 `table` (75 chars)
        TABLE headers=[Traffic | From | To | Source port | Destination port] rows=2
      - block 4 `paragraph` (4 chars)
        Note
      - block 5 `paragraph` (157 chars)
        If you have a network device that translates the client's source ports, make sure that translated ports are opened between the network equipment and the SBC.
    - **H3** `Requirements for using Transport Relays` — sectionId=`sec-16` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using Transport Relays`
      - block 0 `paragraph` (82 chars)
        Transport Relays are in the same range as Media Processors (for non-bypass cases):
    - **H3** `Microsoft 365, Office 365, and Office 365 GCC environments` — sectionId=`sec-17` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Microsoft 365, Office 365, and Office 365 GCC environments`
      - block 0 `unordered_list` (65 chars)
        - 52.112.0.0 /14 (IP addresses from 52.112.0.1 to 52.115.255.254)
    - **H3** `Office 365 GCC DoD environment` — sectionId=`sec-18` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`
      - block 0 `unordered_list` (16 chars)
        - 52.127.64.0/21
    - **H3** `Office 365 GCC High environment` — sectionId=`sec-19` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
      - block 0 `unordered_list` (16 chars)
        - 52.127.88.0/21
      - block 1 `paragraph` (110 chars)
        The port range of the Teams Transport Relays (applicable to all environments) is shown in the following table:
      - block 2 `table` (75 chars)
        TABLE headers=[Traffic | From | To | Source port | Destination port] rows=2
      - block 3 `paragraph` (4 chars)
        Note
      - block 4 `paragraph` (155 chars)
        Microsoft recommends at least two ports per concurrent call on the SBC. Because Microsoft has two versions of Transport Relays, the following are required:
      - block 5 `unordered_list` (103 chars)
        - v4, which can only work with port range 50000 to 59999
        - v6, which works with port range 3478 to 3481
    - **H3** `Requirements for using media processors` — sectionId=`sec-20` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using media processors`
      - block 0 `paragraph` (216 chars)
        Media Processors are always in the media path for voice applications and for Web clients (for example, Teams clients in Microsoft Edge or Google Chrome). The requirements are the same as for non-bypass configuration.
      - block 1 `paragraph` (34 chars)
        The IP range for media traffic is:
    - **H3** `Office 365 and Office 365 GCC environments` — sectionId=`sec-21` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 and Office 365 GCC environments`
      - block 0 `unordered_list` (65 chars)
        - 52.112.0.0 /14 (IP addresses from 52.112.0.1 to 52.115.255.254)
    - **H3** `Office 365 GCC DoD environment` — sectionId=`sec-22` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`
      - block 0 `unordered_list` (16 chars)
        - 52.127.64.0/21
    - **H3** `Office 365 GCC High environment` — sectionId=`sec-23` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
      - block 0 `unordered_list` (16 chars)
        - 52.127.88.0/21
      - block 1 `paragraph` (104 chars)
        The port range of the Media Processors (applicable to all environments) is shown in the following table:
      - block 2 `table` (75 chars)
        TABLE headers=[Traffic | From | To | Source port | Destination port] rows=2
  - **H2** `Configure separate trunks for media bypass and non-media bypass` — sectionId=`sec-24` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
    - block 0 `paragraph` (273 chars)
      If you're migrating to media bypass from non-media bypass and want to confirm functionality before migrating all usage to media bypass, you can create a separate trunk and separate Online Voice Routing policy to route to the media bypass trunk and assign to specific users.
    - block 1 `paragraph` (31 chars)
      High-level configuration steps:
    - block 2 `unordered_list` (504 chars)
      - Identify users to test media bypass.
      - Create two separate trunks with different FQDNs: one enabled for media bypass; the other not.Both trunks point to the same SBC. The ports for TLS SIP signaling must be different. The ports for media must be the same.
      - Create a new Online…
    - block 3 `paragraph` (45 chars)
      The following example illustrates this logic.
    - block 4 `table` (106 chars)
      TABLE headers=[Set of users | Number of users | Trunk FQDN assigned in OVRP | Media bypass enabled] rows=2
    - block 5 `paragraph` (329 chars)
      Both trunks can point to the same SBC with the same public IP address. The TLS signaling ports on the SBC must be different, as shown in the following diagram. You must make sure that your certificate supports both trunks. In SAN, you need to have two names (sbc1.contoso.com and…
    - block 6 `paragraph` (68 chars)
      Shows both trunks can point to the same SBC with the same public IP.
    - block 7 `paragraph` (117 chars)
      For information about how to configure two trunks on the same SBC, see the documentation provided by your SBC vendor:
    - block 8 `unordered_list` (168 chars)
      - AudioCodes deployment documentation
      - Oracle deployment documentation
      - Ribbon Communications deployment documentation
      - TE-Systems (anynode) deployment documentation
  - **H2** `Client endpoints supported with media bypass` — sectionId=`sec-25` kind=`generic` headingPath=`Plan for media bypass with Direct Routing → Client endpoints supported with media bypass`
    - block 0 `paragraph` (118 chars)
      Media bypass is supported with all standalone Teams Desktop clients, Android and iOS clients, and Teams Phone Devices.
    - block 1 `paragraph` (406 chars)
      For all other endpoints that don't support media bypass, we convert the call to non-bypass even if it started as a bypass call. This conversion happens automatically and doesn't require any actions from the administrator. This includes Skype for Business 3PIP Phones and Teams Web…

### A. Chunker diagnostics

- `table_chunked_separately` @ `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays` (`sec-7`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays` (`sec-7`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `table_chunked_separately` @ `Plan for media bypass with Direct Routing → SIP Signaling: Ports` (`sec-13`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Plan for media bypass with Direct Routing → SIP Signaling: Ports` (`sec-13`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `table_chunked_separately` @ `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)` (`sec-15`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)` (`sec-15`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `table_chunked_separately` @ `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment` (`sec-19`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment` (`sec-19`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `table_chunked_separately` @ `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment` (`sec-23`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment` (`sec-23`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `table_chunked_separately` @ `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass` (`sec-24`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass` (`sec-24`): Section exceeded chunk size threshold and was split on safe structural boundaries.

### A. Produced chunks

#### A-00 chunk index 0

- chunk ID: `a21ee90049e3edb09e0f8c7d0a272ba60e2afb1d091f770e66bc92beb53f3df5`
- heading path: `Plan for media bypass with Direct Routing → About media bypass with Direct Routing`
- source section: `sec-2` kind=`configuration` sourceOrder=0
- structural refs: paragraph#0, paragraph#1, paragraph#2, paragraph#3, paragraph#4, paragraph#5, unordered_list#6, paragraph#7, paragraph#8
- character count (retrievalText): 2280
- character count (body): 2129
- approximate token count: 570 (chars/4)
- first ~120 characters: Media bypass enables you to shorten the path of media traffic and reduce the number of hops in transit for better perfor…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning`
- previous chunk heading: _start of document_

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> About media bypass with Direct Routing

Media bypass enables you to shorten the path of media traffic and reduce the number of hops in transit for better performance. With media bypass, media is kept between the Session Border Controller (SBC) and the client instead of sending it via the Microsoft Teams Phone. To configure media bypass, the SBC and the client must be in the same location or network.

You can control media bypass for each SBC by using the Set-CSOnlinePSTNGateway command with the -MediaBypass parameter set to true or false. If you enable media bypass, it doesn't mean that all media traffic stays within the corporate network. This article describes the call flow in different scenarios.

The following diagrams illustrate the difference in call flows with and without media bypass.

Without media bypass, when a client makes or receives a call, both signaling and media flowing between the SBC, the Teams Phone, and the Teams client, as shown in the following diagram:

Shows signaling and media flow without media bypass.

But let's assume that a user is in the same building or network as the SBC. For example, assume a user who is in a building in Frankfurt makes a call to a Public Switched Telephone Network (PSTN) user:

- Without media bypass, media flows via either Amsterdam or Dublin (where Microsoft datacenters are deployed) and back to the SBC in Frankfurt.The datacenter in Europe is selected because the SBC is in Europe, and Microsoft uses the datacenter closest to the SBC. While this approach doesn't affect call quality due to optimization of traffic flow within Microsoft networks in most geographies, the traffic has an unnecessary loop.
- With media bypass, the media is kept directly between the Teams user and the SBC as shown in the following diagram:

Shows signaling and media flow with media bypass.

Media bypass uses protocols called Interactive Connectivity Establishment (ICE) on the Teams client and ICE Lite on the SBC. These protocols enable Direct Routing to use the most direct media path for optimal quality. ICE and ICE Lite are WebRTC standards. For detailed information about these protocols, see RFC 5245.
````

#### A-01 chunk index 1

- chunk ID: `337007cf6c454864160d677dfc91a9ccf55d6a9671deb233dabb4b1ac2bef576`
- heading path: `Plan for media bypass with Direct Routing → Call flow and firewall planning`
- source section: `sec-3` kind=`configuration` sourceOrder=1
- structural refs: paragraph#0
- character count (retrievalText): 315
- character count (body): 171
- approximate token count: 79 (chars/4)
- first ~120 characters: Call flow and firewall planning depend on whether the user has direct access to the public IP address of the SBC, and wh…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user has direct access to the public IP address of the SBC`
- previous chunk heading: `Plan for media bypass with Direct Routing → About media bypass with Direct Routing`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Call flow and firewall planning

Call flow and firewall planning depend on whether the user has direct access to the public IP address of the SBC, and whether the user is inside or outside of the network.
````

#### A-02 chunk index 2

- chunk ID: `a4bcef542e32914936193609bfc4e1329efc85b390d24f2963aee143821cf70c`
- heading path: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user has direct access to the public IP address of the SBC`
- source section: `sec-4` kind=`configuration` sourceOrder=2
- structural refs: paragraph#0, unordered_list#1, paragraph#2, unordered_list#3, paragraph#4
- character count (retrievalText): 1248
- character count (body): 1025
- approximate token count: 312 (chars/4)
- first ~120 characters: If the user has direct access to the public IP address of the SBC, the call flow is as follows: - For media bypass, the…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user doesn't have access to the public IP address of the SBC`
- previous chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Call flow and firewall planning -> Call flow if the user has direct access to the public IP address of the SBC

If the user has direct access to the public IP address of the SBC, the call flow is as follows:

- For media bypass, the Teams client must have access to the public IP address of the SBC even from an internal network. If direct media isn't desired, the media can flow via Transport Relays.
- This flow is the recommended solution when a user is in the same building and/or network as the SBC – remove Microsoft Cloud components from the media path.
- Signaling always flows via the Microsoft cloud.

The following diagram shows a call flow when media bypass is enabled, the client is internal, and the client can reach the public IP address of the SBC (direct media):

- The arrows and numeric values of the paths are in accordance with Microsoft Teams call flows.
- The SIP signaling always takes paths 4 and 4' (depending on the direction of the traffic). Media stays local and takes path 5b.

Diagram shows call flow with media bypass enabled, client is internal, and the client can reach the public IP address of the SBC.
````

#### A-03 chunk index 3

- chunk ID: `79a2dabded8d748f48e3d138d088cb9d7c17b3568d00ea7bdd28483d5bd75219`
- heading path: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user doesn't have access to the public IP address of the SBC`
- source section: `sec-5` kind=`configuration` sourceOrder=3
- structural refs: paragraph#0, paragraph#1, unordered_list#2, paragraph#3, unordered_list#4, paragraph#5
- character count (retrievalText): 1403
- character count (body): 1178
- approximate token count: 351 (chars/4)
- first ~120 characters: The following scenario describes call flow if the user doesn't have access to the public IP address of the SBC. For exam…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if a user is outside the network and has access to the public IP of the SBC`
- previous chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user has direct access to the public IP address of the SBC`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Call flow and firewall planning -> Call flow if the user doesn't have access to the public IP address of the SBC

The following scenario describes call flow if the user doesn't have access to the public IP address of the SBC.

For example, assume the user is external, and the tenant administrator decides not to open the public IP address of the SBC to everyone in the Internet, but only to the Microsoft Cloud. The internal components of traffic can flow via the Teams Transport Relays. Consider the following information:

- Teams Transport Relays are used.
- For media bypass, Microsoft uses a version of Transport Relays that requires opening ports 50 000 to 59 999 between the Teams Transport Relays and the SBC (in the future we plan to move to the version that requires 3478-3481 ports).

The following diagram shows a call flow when media bypass is enabled, the client is external, and the client can't reach the public IP address of the Session Border Controller (media is relayed by Teams Transport Relay).

- The arrows and numeric values of the paths are in accordance with Microsoft Teams call flows.
- Media is relayed via paths 3, 3', 4 and 4'.

Diagram shows call flow when media bypass is enabled, the client is external, and the client can't reach the public IP of the SBC.
````

#### A-04 chunk index 4

- chunk ID: `a91fff7f52710f582b4d023c7c846e685cc7657acbeba2d267c900ed30285a49`
- heading path: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if a user is outside the network and has access to the public IP of the SBC`
- source section: `sec-6` kind=`configuration` sourceOrder=4
- structural refs: paragraph#0, paragraph#1, paragraph#2, unordered_list#3, paragraph#4
- character count (retrievalText): 994
- character count (body): 761
- approximate token count: 249 (chars/4)
- first ~120 characters: Note This configuration isn't recommended because it doesn't take advantage of Teams Transport Relays. Instead, you shou…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
- previous chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if the user doesn't have access to the public IP address of the SBC`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Call flow and firewall planning -> Call flow if a user is outside the network and has access to the public IP of the SBC

Note

This configuration isn't recommended because it doesn't take advantage of Teams Transport Relays. Instead, you should consider the previous scenario where the user doesn't have access to the public IP address of the SBC.

The following diagram shows a call flow when media bypass is enabled, the client is external, and the client can reach the public IP address of the SBC (direct media).

- The arrows and numeric values of the paths are in accordance with the Microsoft Teams call flows article.
- The SIP signaling always takes paths 3 and 3' (depending on the direction of the traffic). Media flows using path 2.

Diagram shows call flow when media bypass is enabled, the client is external, and the client can reach the public IP address of the SBC.
````

#### A-05 chunk index 5

- chunk ID: `fd595ce1c3e4f2c43daec59f934429de30dd7a5d038ca1ffae1f42515a9061b8`
- heading path: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
- source section: `sec-7` kind=`configuration` sourceOrder=5
- structural refs: paragraph#0, unordered_list#1, paragraph#2, paragraph#3, paragraph#4, unordered_list#5, paragraph#6, paragraph#7
- character count (retrievalText): 1539
- character count (body): 1382
- approximate token count: 385 (chars/4)
- first ~120 characters: There are two components in the Microsoft Cloud that can be in the path of media traffic: Media Processors and Transport…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
- previous chunk heading: `Plan for media bypass with Direct Routing → Call flow and firewall planning → Call flow if a user is outside the network and has access to the public IP of the SBC`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Use of Media Processors and Transport Relays

There are two components in the Microsoft Cloud that can be in the path of media traffic: Media Processors and Transport Relays.

- The Media Processor is a public facing component that handles media in non-bypass cases and handles media for voice applications.Media Processors are always in the path for end user non-bypassed calls, but never in the path for bypassed calls. Media Processors are always in the path for all voice applications such as Call Park, Organizational Auto Attendant, and Call Queues.
- The Transport Relay is used to connect to the closest Transport Service to send real time traffic.Transport Relays might or might not be in the path for bypassed calls--originating from or destined to end users--depending on where the user is and how the network is configured.

The following diagram shows two call flows – one with media bypass enabled and the second with media bypass disabled.

Note

The diagram only illustrates traffic originating from--or destined to--end users.

- The Media Controller is a microservice in Azure that assigns Media Processors and creates Session Description Protocol (SDP) offers.
- The SIP Proxy is a component that translates HTTP REST signaling used in Teams to SIP.

Diagram shows call flows with media bypass enabled and disabled.

The following table summarizes the difference between Media Processors and Transport Relays.
````

#### A-06 chunk index 6

- chunk ID: `625c60538bda67daff1f745802ff2b633175a1d4aeed9b5fb7ad2773741caf51`
- heading path: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
- source section: `sec-7` kind=`table` sourceOrder=6
- structural refs: table#8
- character count (retrievalText): 590
- character count (body): 433
- approximate token count: 148 (chars/4)
- first ~120 characters: | | Media Processors | Transport Relays | | --- | --- | --- | | In media path for non-bypassed calls for end users | Alw…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
- previous chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Use of Media Processors and Transport Relays

|  | Media Processors | Transport Relays |
| --- | --- | --- |
| In media path for non-bypassed calls for end users | Always | If client can't reach the Media Processor directly |
| In media path for bypassed calls for end users | Never | If client can't reach the SBC on the public IP address |
| In media path for voice applications | Always | Never |
| Can do transcoding (B2BUA)* | Yes | No, only relays audio between endpoints |
````

#### A-07 chunk index 7

- chunk ID: `f5d526563d83536494a0f3a039db360fd3d1efaae6e47ce01050e5785e0ae763`
- heading path: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`
- source section: `sec-7` kind=`configuration` sourceOrder=7
- structural refs: paragraph#9, unordered_list#10, paragraph#11, paragraph#12, paragraph#13, unordered_list#14
- character count (retrievalText): 740
- character count (body): 583
- approximate token count: 185 (chars/4)
- first ~120 characters: The IP ranges are: - 52.112.0.0/14 (IP addresses from 52.112.0.0 to 52.115.255.255) - 52.120.0.0/14 (IP addresses from 5…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays → Use of Teams Media Processors if trunk is configured for media bypass`
- previous chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Use of Media Processors and Transport Relays

The IP ranges are:

- 52.112.0.0/14 (IP addresses from 52.112.0.0 to 52.115.255.255)
- 52.120.0.0/14 (IP addresses from 52.120.0.0 to 52.123.255.255)

Note

IP ranges presented in this document are specific to Direct Routing and might differ from the ones advised for Teams client.

* Transcoding explanation:

- Media Processor is B2BUA, which means it can change codecs (for example, SILK from Teams client to MP and G.711 between MP and SBC).
- Transport Relays aren't B2BUA, which means the codec is never changed between the client and the SBC--even if traffic flows via relays.
````

#### A-08 chunk index 8

- chunk ID: `0f115c62ecdd903083aa9475975431429a9f8ddde63b3cdf601d9480b3885e35`
- heading path: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays → Use of Teams Media Processors if trunk is configured for media bypass`
- source section: `sec-8` kind=`configuration` sourceOrder=8
- structural refs: paragraph#0, unordered_list#1, paragraph#2
- character count (retrievalText): 590
- character count (body): 360
- approximate token count: 148 (chars/4)
- first ~120 characters: Teams Media Processors are always inserted in the media path in the following scenarios: - Call is escalated from 1:1 to…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs`
- previous chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Use of Media Processors and Transport Relays -> Use of Teams Media Processors if trunk is configured for media bypass

Teams Media Processors are always inserted in the media path in the following scenarios:

- Call is escalated from 1:1 to a group call
- Call is going to a federated Teams user
- Call is forwarded or transferred to a Skype for Business user

Ensure your SBC has access to the Media Processors and Transport Relays ranges as described in the following sections.
````

#### A-09 chunk index 9

- chunk ID: `721a6882673108a559ecd1e5e118d8b36070b6fd5d60bc3615e4d3df1ab44ee1`
- heading path: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs`
- source section: `sec-9` kind=`configuration` sourceOrder=9
- structural refs: paragraph#0, paragraph#1, unordered_list#2, paragraph#3
- character count (retrievalText): 491
- character count (body): 358
- approximate token count: 123 (chars/4)
- first ~120 characters: For SIP signaling, the FQDN and firewall requirements are the same as for non-bypassed cases. Direct Routing is offered…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Microsoft 365, Office 365, and Office 365 GCC environments`
- previous chunk heading: `Plan for media bypass with Direct Routing → Use of Media Processors and Transport Relays → Use of Teams Media Processors if trunk is configured for media bypass`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> SIP Signaling: FQDNs

For SIP signaling, the FQDN and firewall requirements are the same as for non-bypassed cases.

Direct Routing is offered in the following Microsoft 365 or Office 365 environments:

- Microsoft 365 or Office 365
- Office 365 GCC
- Office 365 GCC High
- Office 365 DoD

Learn more about Office 365 and US Government environments such as GCC, GCC High, and DoD.
````

#### A-10 chunk index 10

- chunk ID: `d21c42ff9ff3d85a3e09204800b6376968f1583db806d2880152575ae51811a5`
- heading path: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Microsoft 365, Office 365, and Office 365 GCC environments`
- source section: `sec-10` kind=`configuration` sourceOrder=10
- structural refs: paragraph#0, unordered_list#1, paragraph#2, unordered_list#3, paragraph#4, unordered_list#5, paragraph#6
- character count (retrievalText): 1517
- character count (body): 1322
- approximate token count: 380 (chars/4)
- first ~120 characters: The connection points for Direct Routing are the following three FQDNs: - sip.pstnhub.microsoft.com – Global FQDN – must…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC DoD environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> SIP Signaling: FQDNs -> Microsoft 365, Office 365, and Office 365 GCC environments

The connection points for Direct Routing are the following three FQDNs:

- sip.pstnhub.microsoft.com – Global FQDN – must be tried first. When the SBC sends a request to resolve this name, the Microsoft Azure DNS servers return an IP address pointing to the primary Azure datacenter assigned to the SBC. The assignment is based on performance metrics of the datacenters and geographical proximity to the SBC. The IP address returned corresponds to the primary FQDN.
- sip2.pstnhub.microsoft.com – Secondary FQDN – geographically maps to the second priority region.
- sip3.pstnhub.microsoft.com – Tertiary FQDN – geographically maps to the third priority region.

You must place these three FQDNs in order to:

- Provide optimal experience (less loaded and closest to the SBC datacenter assigned by querying the first FQDN).
- Provide failover when a connection from an SBC is established to a datacenter that is experiencing a temporary issue. For more information, see Failover mechanism below.

The FQDNs sip.pstnhub.microsoft.com, sip2.pstnhub.microsoft.com, and sip3.pstnhub.microsoft.com resolve to IP addresses from the following subnets:

- 52.112.0.0/14
- 52.120.0.0/14

You need to open ports for all these IP ranges in your firewall to allow incoming and outgoing traffic to and from the addresses for signaling.
````

#### A-11 chunk index 11

- chunk ID: `711cd78686be1273c73b6627b27cf895f955891e2f522d04ac4ef459a5f91dd3`
- heading path: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC DoD environment`
- source section: `sec-11` kind=`configuration` sourceOrder=11
- structural refs: paragraph#0, paragraph#1, paragraph#2, unordered_list#3, paragraph#4
- character count (retrievalText): 769
- character count (body): 602
- approximate token count: 193 (chars/4)
- first ~120 characters: The connection point for Direct Routing is the following FQDN: sip.pstnhub.dod.teams.microsoft.us – Global FQDN. As the…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC High environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Microsoft 365, Office 365, and Office 365 GCC environments`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> SIP Signaling: FQDNs -> Office 365 GCC DoD environment

The connection point for Direct Routing is the following FQDN:

sip.pstnhub.dod.teams.microsoft.us – Global FQDN. As the Office 365 DoD environment exists only in the US data centers, there are no secondary and tertiary FQDNs.

The FQDN sip.pstnhub.dod.teams.microsoft.us resolves to an IP address from the following subnet:

- 52.127.64.0/21

You need to open ports for all these IP ranges in your firewall to allow incoming and outgoing traffic to and from the addresses for signaling. If your firewall supports DNS names, the FQDN sip.pstnhub.dod.teams.microsoft.us resolves to all these IP subnets.
````

#### A-12 chunk index 12

- chunk ID: `e2ae84ab30fad07749228e0c3aaf2cb1982c48e2327cfd5799b1a07ca62e92f5`
- heading path: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC High environment`
- source section: `sec-12` kind=`configuration` sourceOrder=12
- structural refs: paragraph#0, paragraph#1, paragraph#2, unordered_list#3, paragraph#4
- character count (retrievalText): 764
- character count (body): 596
- approximate token count: 191 (chars/4)
- first ~120 characters: The connection point for Direct Routing is the following FQDN: sip.pstnhub.gov.teams.microsoft.us – Global FQDN. As the…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: Ports`
- previous chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC DoD environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> SIP Signaling: FQDNs -> Office 365 GCC High environment

The connection point for Direct Routing is the following FQDN:

sip.pstnhub.gov.teams.microsoft.us – Global FQDN. As the GCC High environment exists only in the US data centers, there are no secondary and tertiary FQDNs.

The FQDN sip.pstnhub.gov.teams.microsoft.us resolves to an IP address from the following subnet:

- 52.127.88.0/21

You need to open ports for all these IP ranges in your firewall to allow incoming and outgoing traffic to and from the addresses for signaling. If your firewall supports DNS names, the FQDN sip.pstnhub.gov.teams.microsoft.us resolves to all these IP subnets.
````

#### A-13 chunk index 13

- chunk ID: `fbd51dd1887715442cd0aa9939eb6bdac1148909dba348893c06fe9fdebf09cd`
- heading path: `Plan for media bypass with Direct Routing → SIP Signaling: Ports`
- source section: `sec-13` kind=`configuration` sourceOrder=13
- structural refs: paragraph#0, unordered_list#1, paragraph#2
- character count (retrievalText): 350
- character count (body): 217
- approximate token count: 88 (chars/4)
- first ~120 characters: Port requirements are the same for all Office 365 environments where Direct Routing is offered: - Microsoft 365 or Offic…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: Ports`
- previous chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: FQDNs → Office 365 GCC High environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> SIP Signaling: Ports

Port requirements are the same for all Office 365 environments where Direct Routing is offered:

- Microsoft 365 or Office 365
- Office 365 GCC
- Office 365 GCC High
- Office 365 DoD

You must use the following ports:
````

#### A-14 chunk index 14

- chunk ID: `a9f31e9c5aeee1792adb3636cbaca5410c475287b3ce91e2fbc538a9dc78277e`
- heading path: `Plan for media bypass with Direct Routing → SIP Signaling: Ports`
- source section: `sec-13` kind=`table` sourceOrder=14
- structural refs: table#3
- character count (retrievalText): 345
- character count (body): 212
- approximate token count: 87 (chars/4)
- first ~120 characters: | Traffic | From | To | Source port | Destination port | | --- | --- | --- | --- | --- | | SIP/TLS | SIP Proxy | SBC | 1…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges`
- previous chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: Ports`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> SIP Signaling: Ports

| Traffic | From | To | Source port | Destination port |
| --- | --- | --- | --- | --- |
| SIP/TLS | SIP Proxy | SBC | 1024 - 65535 | Defined on the SBC |
| SIP/TLS | SBC | SIP Proxy | Defined on the SBC | 5061 |
````

#### A-15 chunk index 15

- chunk ID: `a864069f62d638993454944909d0ae4d6ea2a306bc7e0ce1a7f9f2c4d8a87a79`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges`
- source section: `sec-14` kind=`configuration` sourceOrder=15
- structural refs: paragraph#0
- character count (retrievalText): 327
- character count (body): 181
- approximate token count: 82 (chars/4)
- first ~120 characters: Media traffic flows between the SBC and Teams client if direct connectivity is available or via Teams Transport Relays i…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
- previous chunk heading: `Plan for media bypass with Direct Routing → SIP Signaling: Ports`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges

Media traffic flows between the SBC and Teams client if direct connectivity is available or via Teams Transport Relays if the client can't reach the SBC using the public IP address.
````

#### A-16 chunk index 16

- chunk ID: `e49534a00c3ecd22a9b98b3de14531cc308420f1b9fecb03ee92743bd6d56327`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
- source section: `sec-15` kind=`configuration` sourceOrder=16
- structural refs: paragraph#0, paragraph#1, paragraph#2
- character count (retrievalText): 534
- character count (body): 308
- approximate token count: 134 (chars/4)
- first ~120 characters: The client must have access to the specified ports (see table) on the public IP address of the SBC. Note If the client i…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Requirements for direct media traffic (between the Teams client and the SBC)

The client must have access to the specified ports (see table) on the public IP address of the SBC.

Note

If the client is in an internal network, the media flows to the public IP address of the SBC. You can configure hair pinning on your NAT device so traffic never leaves the enterprise network equipment.
````

#### A-17 chunk index 17

- chunk ID: `f9eb99dd5c7acc773192bf66bfdaf9f5a2f73723aabb5c00bca2f6f03a4aafeb`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
- source section: `sec-15` kind=`table` sourceOrder=17
- structural refs: table#3
- character count (retrievalText): 440
- character count (body): 214
- approximate token count: 110 (chars/4)
- first ~120 characters: | Traffic | From | To | Source port | Destination port | | --- | --- | --- | --- | --- | | UDP/SRTP | Client | SBC | 500…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Requirements for direct media traffic (between the Teams client and the SBC)

| Traffic | From | To | Source port | Destination port |
| --- | --- | --- | --- | --- |
| UDP/SRTP | Client | SBC | 50000-50019 | Defined on the SBC |
| UDP/SRTP | SBC | Client | Defined on the SBC | 50000-50019 |
````

#### A-18 chunk index 18

- chunk ID: `55719b35c0ffccd6513a8b70713ef56a08d6009e819c6fcd37b1e7ecd4864fed`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`
- source section: `sec-15` kind=`configuration` sourceOrder=18
- structural refs: paragraph#4, paragraph#5
- character count (retrievalText): 389
- character count (body): 163
- approximate token count: 98 (chars/4)
- first ~120 characters: Note If you have a network device that translates the client's source ports, make sure that translated ports are opened…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using Transport Relays`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Requirements for direct media traffic (between the Teams client and the SBC)

Note

If you have a network device that translates the client's source ports, make sure that translated ports are opened between the network equipment and the SBC.
````

#### A-19 chunk index 19

- chunk ID: `1ad92e6acca1fecc5fa4414dbe6fd43f23167b850e4f1d36571c5b131b02a373`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using Transport Relays`
- source section: `sec-16` kind=`configuration` sourceOrder=19
- structural refs: paragraph#0
- character count (retrievalText): 271
- character count (body): 82
- approximate token count: 68 (chars/4)
- first ~120 characters: Transport Relays are in the same range as Media Processors (for non-bypass cases):
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Microsoft 365, Office 365, and Office 365 GCC environments`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for direct media traffic (between the Teams client and the SBC)`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Requirements for using Transport Relays

Transport Relays are in the same range as Media Processors (for non-bypass cases):
````

#### A-20 chunk index 20

- chunk ID: `a81c21acafd5ad201d26ddad73389a50e1f43f15aabd0ae87ce6e1e21a48a6e4`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Microsoft 365, Office 365, and Office 365 GCC environments`
- source section: `sec-17` kind=`configuration` sourceOrder=20
- structural refs: unordered_list#0
- character count (retrievalText): 273
- character count (body): 65
- approximate token count: 69 (chars/4)
- first ~120 characters: - 52.112.0.0 /14 (IP addresses from 52.112.0.1 to 52.115.255.254)
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using Transport Relays`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Microsoft 365, Office 365, and Office 365 GCC environments

- 52.112.0.0 /14 (IP addresses from 52.112.0.1 to 52.115.255.254)
````

#### A-21 chunk index 21

- chunk ID: `f3fcafc9bbeb6fd1e99544a94cf1eee2aea6c4711b3ee17620a9c63a89609d61`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`
- source section: `sec-18` kind=`configuration` sourceOrder=21
- structural refs: unordered_list#0
- character count (retrievalText): 196
- character count (body): 16
- approximate token count: 49 (chars/4)
- first ~120 characters: - 52.127.64.0/21
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Microsoft 365, Office 365, and Office 365 GCC environments`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC DoD environment

- 52.127.64.0/21
````

#### A-22 chunk index 22

- chunk ID: `3f7783798ea314d79a83594d7f7135fa007ce3c677973b813202fde48a8e8309`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- source section: `sec-19` kind=`configuration` sourceOrder=22
- structural refs: unordered_list#0, paragraph#1
- character count (retrievalText): 309
- character count (body): 128
- approximate token count: 78 (chars/4)
- first ~120 characters: - 52.127.88.0/21 The port range of the Teams Transport Relays (applicable to all environments) is shown in the following…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC High environment

- 52.127.88.0/21

The port range of the Teams Transport Relays (applicable to all environments) is shown in the following table:
````

#### A-23 chunk index 23

- chunk ID: `d0e9afa6db4a0fffa7de5ec4dd2eef05ef005c52715713b68c63f5f8bf92b06f`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- source section: `sec-19` kind=`table` sourceOrder=23
- structural refs: table#2
- character count (retrievalText): 424
- character count (body): 243
- approximate token count: 106 (chars/4)
- first ~120 characters: | Traffic | From | To | Source port | Destination port | | --- | --- | --- | --- | --- | | UDP/SRTP | Transport Relay |…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC High environment

| Traffic | From | To | Source port | Destination port |
| --- | --- | --- | --- | --- |
| UDP/SRTP | Transport Relay | SBC | 50000-59999 | Defined on the SBC |
| UDP/SRTP | SBC | Transport Relay | Defined on the SBC | 50000–59999, 3478-3481 |
````

#### A-24 chunk index 24

- chunk ID: `e007519daaa7c21849436408cc463ed824d45371d31691f688aef85a16e04449`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- source section: `sec-19` kind=`configuration` sourceOrder=24
- structural refs: paragraph#3, paragraph#4, unordered_list#5
- character count (retrievalText): 447
- character count (body): 266
- approximate token count: 112 (chars/4)
- first ~120 characters: Note Microsoft recommends at least two ports per concurrent call on the SBC. Because Microsoft has two versions of Trans…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using media processors`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC High environment

Note

Microsoft recommends at least two ports per concurrent call on the SBC. Because Microsoft has two versions of Transport Relays, the following are required:

- v4, which can only work with port range 50000 to 59999
- v6, which works with port range 3478 to 3481
````

#### A-25 chunk index 25

- chunk ID: `3fd4c59c1178e4a447e702f13eb716a703b18f5c4db1ab8279480d89a315f899`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using media processors`
- source section: `sec-20` kind=`configuration` sourceOrder=25
- structural refs: paragraph#0, paragraph#1
- character count (retrievalText): 441
- character count (body): 252
- approximate token count: 111 (chars/4)
- first ~120 characters: Media Processors are always in the media path for voice applications and for Web clients (for example, Teams clients in…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 and Office 365 GCC environments`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Requirements for using media processors

Media Processors are always in the media path for voice applications and for Web clients (for example, Teams clients in Microsoft Edge or Google Chrome). The requirements are the same as for non-bypass configuration.

The IP range for media traffic is:
````

#### A-26 chunk index 26

- chunk ID: `705efebfebb9ed9c96fa1435a0bed394fb695df1f26f39d205551212faee0380`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 and Office 365 GCC environments`
- source section: `sec-21` kind=`configuration` sourceOrder=26
- structural refs: unordered_list#0
- character count (retrievalText): 257
- character count (body): 65
- approximate token count: 65 (chars/4)
- first ~120 characters: - 52.112.0.0 /14 (IP addresses from 52.112.0.1 to 52.115.255.254)
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Requirements for using media processors`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 and Office 365 GCC environments

- 52.112.0.0 /14 (IP addresses from 52.112.0.1 to 52.115.255.254)
````

#### A-27 chunk index 27

- chunk ID: `a74562cccf82eb75c14a38b21bf1f47efaba8eefe3444ef972998b245d697ea7`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`
- source section: `sec-22` kind=`configuration` sourceOrder=27
- structural refs: unordered_list#0
- character count (retrievalText): 196
- character count (body): 16
- approximate token count: 49 (chars/4)
- first ~120 characters: - 52.127.64.0/21
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 and Office 365 GCC environments`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC DoD environment

- 52.127.64.0/21
````

#### A-28 chunk index 28

- chunk ID: `0b8d3a48ee3d19c27e8208828cc3ade032f9ef4e4f873f6140858593fe1bcf92`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- source section: `sec-23` kind=`configuration` sourceOrder=28
- structural refs: unordered_list#0, paragraph#1
- character count (retrievalText): 303
- character count (body): 122
- approximate token count: 76 (chars/4)
- first ~120 characters: - 52.127.88.0/21 The port range of the Media Processors (applicable to all environments) is shown in the following table…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC DoD environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC High environment

- 52.127.88.0/21

The port range of the Media Processors (applicable to all environments) is shown in the following table:
````

#### A-29 chunk index 29

- chunk ID: `ee8c79cb08e53769bda08c50bc00110ccf8ab6ff73e0a8c4cb50b59daacdf9b8`
- heading path: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`
- source section: `sec-23` kind=`table` sourceOrder=29
- structural refs: table#2
- character count (retrievalText): 441
- character count (body): 260
- approximate token count: 111 (chars/4)
- first ~120 characters: | Traffic | From | To | Source port | Destination port | | --- | --- | --- | --- | --- | | UDP/SRTP | Media Processor |…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Media traffic: IP and Port ranges -> Office 365 GCC High environment

| Traffic | From | To | Source port | Destination port |
| --- | --- | --- | --- | --- |
| UDP/SRTP | Media Processor | SBC | 3478-3481 and 49152–53247 | Defined on the SBC |
| UDP/SRTP | SBC | Media Processor | Defined on the SBC | 3478-3481 and 49152–53247 |
````

#### A-30 chunk index 30

- chunk ID: `d2104e4c584b8273347d66a5159b4a149e69c32ea63842b9f0d986739dc8bd88`
- heading path: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
- source section: `sec-24` kind=`configuration` sourceOrder=30
- structural refs: paragraph#0, paragraph#1, unordered_list#2, paragraph#3
- character count (retrievalText): 1035
- character count (body): 859
- approximate token count: 259 (chars/4)
- first ~120 characters: If you're migrating to media bypass from non-media bypass and want to confirm functionality before migrating all usage t…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
- previous chunk heading: `Plan for media bypass with Direct Routing → Media traffic: IP and Port ranges → Office 365 GCC High environment`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Configure separate trunks for media bypass and non-media bypass

If you're migrating to media bypass from non-media bypass and want to confirm functionality before migrating all usage to media bypass, you can create a separate trunk and separate Online Voice Routing policy to route to the media bypass trunk and assign to specific users.

High-level configuration steps:

- Identify users to test media bypass.
- Create two separate trunks with different FQDNs: one enabled for media bypass; the other not.Both trunks point to the same SBC. The ports for TLS SIP signaling must be different. The ports for media must be the same.
- Create a new Online Voice Routing policy and assign the media bypass trunk to the corresponding routes associated with the PSTN usage for this policy.
- Assign the new Online Voice Routing policy to users you've identified to test media bypass.

The following example illustrates this logic.
````

#### A-31 chunk index 31

- chunk ID: `3a0d454cf362bc274145324901fa806b449bac26817968d7801f0c91a125816d`
- heading path: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
- source section: `sec-24` kind=`table` sourceOrder=31
- structural refs: table#4
- character count (retrievalText): 435
- character count (body): 259
- approximate token count: 109 (chars/4)
- first ~120 characters: | Set of users | Number of users | Trunk FQDN assigned in OVRP | Media bypass enabled | | --- | --- | --- | --- | | User…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
- previous chunk heading: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Configure separate trunks for media bypass and non-media bypass

| Set of users | Number of users | Trunk FQDN assigned in OVRP | Media bypass enabled |
| --- | --- | --- | --- |
| Users with non-media bypass trunk | 980 | sbc1.contoso.com:5061 | false |
| Users with media bypass trunk | 20 | sbc2.contoso.com:5060 | true |
````

#### A-32 chunk index 32

- chunk ID: `61a4e4d171aacf8f91cbdbe6d9dc6fbb6f9ad623c6eaaf21307df0c8c249b120`
- heading path: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`
- source section: `sec-24` kind=`configuration` sourceOrder=32
- structural refs: paragraph#5, paragraph#6, paragraph#7, unordered_list#8
- character count (retrievalText): 864
- character count (body): 688
- approximate token count: 216 (chars/4)
- first ~120 characters: Both trunks can point to the same SBC with the same public IP address. The TLS signaling ports on the SBC must be differ…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Plan for media bypass with Direct Routing → Client endpoints supported with media bypass`
- previous chunk heading: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Configure separate trunks for media bypass and non-media bypass

Both trunks can point to the same SBC with the same public IP address. The TLS signaling ports on the SBC must be different, as shown in the following diagram. You must make sure that your certificate supports both trunks. In SAN, you need to have two names (sbc1.contoso.com and sbc2.contoso.com) or have a wildcard certificate.

Shows both trunks can point to the same SBC with the same public IP.

For information about how to configure two trunks on the same SBC, see the documentation provided by your SBC vendor:

- AudioCodes deployment documentation
- Oracle deployment documentation
- Ribbon Communications deployment documentation
- TE-Systems (anynode) deployment documentation
````

#### A-33 chunk index 33

- chunk ID: `ea0e1698582ff167904b13f2430407e39df5223ede630ee82a37b546d0ad349c`
- heading path: `Plan for media bypass with Direct Routing → Client endpoints supported with media bypass`
- source section: `sec-25` kind=`configuration` sourceOrder=33
- structural refs: paragraph#0, paragraph#1
- character count (retrievalText): 683
- character count (body): 526
- approximate token count: 171 (chars/4)
- first ~120 characters: Media bypass is supported with all standalone Teams Desktop clients, Android and iOS clients, and Teams Phone Devices. F…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: _end of document_
- previous chunk heading: `Plan for media bypass with Direct Routing → Configure separate trunks for media bypass and non-media bypass`

**Full chunk text**

````text
Document: Plan for media bypass with Direct Routing
Heading Path: Plan for media bypass with Direct Routing -> Client endpoints supported with media bypass

Media bypass is supported with all standalone Teams Desktop clients, Android and iOS clients, and Teams Phone Devices.

For all other endpoints that don't support media bypass, we convert the call to non-bypass even if it started as a bypass call. This conversion happens automatically and doesn't require any actions from the administrator. This includes Skype for Business 3PIP Phones and Teams Web Clients that support Direct Routing calling (WebRTC based clients running on Microsoft Edge, Google Chrome, Mozilla Firefox).
````

## Document B — identity

**Role:** Conceptual / multi-concept (voice routing policy → PSTN usage → route → gateway)

| Field | Value |
|---|---|
| source ID | `ms-teams-admin` |
| document ID (re-parsed) | `34479d7ba3abd30a5944bac98f48a401a88270ca75e6cd7aab36982de4b96aec` |
| document ID (stored) | `34479d7ba3abd30a5944bac98f48a401a88270ca75e6cd7aab36982de4b96aec` |
| canonical URL | https://learn.microsoft.com/en-us/microsoftteams/direct-routing-voice-routing |
| title | Configure call routing for Direct Routing |
| track | `ga` |
| transport | `learn_mcp` |
| source path | `microsoftteams/direct-routing-voice-routing` |
| parser warnings | 0 |
| live chunks | 69 |
| stored chunks | 69 |
| chunk IDs match stored index | `true` |

### B. Parsed structure (before chunking)

Title: **Configure call routing for Direct Routing**

- **H1** `Configure call routing for Direct Routing` — sectionId=`sec-1` kind=`generic` headingPath=`Configure call routing for Direct Routing`
  - block 0 `paragraph` (142 chars)
    This article describes how to configure call routing for Direct Routing. This is step 3 of the following steps for configuring Direct Routing:
  - block 1 `unordered_list` (233 chars)
    - Step 1. Connect the SBC with Teams Phone and validate the connection
    - Step 2. Enable users for Direct Routing, voice, and voicemail
    - Step 3. Configure call routing (This article)
    - Step 4. Translate numbers to an alternate format
  - block 2 `paragraph` (102 chars)
    For information on all the steps required for setting up Direct Routing, see Configure Direct Routing.
  - **H2** `Call routing overview` — sectionId=`sec-2` kind=`generic` headingPath=`Configure call routing for Direct Routing → Call routing overview`
    - block 0 `paragraph` (121 chars)
      Teams Phone has a routing mechanism that allows a call to be sent to a specific Session Border Controller (SBC) based on:
    - block 1 `unordered_list` (97 chars)
      - The called number pattern
      - The called number pattern plus the specific user who makes the call
    - block 2 `paragraph` (176 chars)
      SBCs can be designated as active and backup. When the SBC that is configured as active is not available for a specific call route, then the call will be routed to a backup SBC.
    - block 3 `paragraph` (50 chars)
      Call routing is made up of the following elements:
    - block 4 `unordered_list` (617 chars)
      - Call routing policy – Also called a voice routing policy. A container for PSTN usages, which can be assigned to a user or to multiple users.
      - PSTN usages – A container for voice routes and PSTN usages, which can be shared in different voice routing policies.
      - Voice routes – A…
  - **H2** `Voice routing policy considerations` — sectionId=`sec-3` kind=`generic` headingPath=`Configure call routing for Direct Routing → Voice routing policy considerations`
    - block 0 `paragraph` (534 chars)
      If a user has a Calling Plan license, that user’s outgoing calls are automatically routed through the Microsoft Calling Plan PSTN infrastructure. If you configure and assign an online voice routing policy to a Calling Plan user, that user’s outgoing calls are checked to determine…
    - block 1 `paragraph` (7 chars)
      Caution
    - block 2 `ordered_list` (698 chars)
      1. If you configure and apply the global (Org-wide default) online voice routing policy, all voice-enabled users in your organization will inherit that policy, which might result in PSTN calls from Calling Plan and Operator Connect users being inadvertently routed to a Direct Rou…
  - **H2** `Example 1: Voice routing with one PSTN usage` — sectionId=`sec-4` kind=`powershell_examples` headingPath=`Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
    - block 0 `paragraph` (82 chars)
      The following diagram shows two examples of voice routing policies in a call flow.
    - block 1 `paragraph` (239 chars)
      Call Flow 1 (on the left): If a user makes a call to +1 425 XXX XX XX or +1 206 XXX XX XX, the call is routed to SBC sbc1.contoso.com or sbc2.contoso.com. If neither sbc1.contoso.com nor sbc2.contoso.com are available, the call is dropped.
    - block 2 `paragraph` (331 chars)
      Call Flow 2 (on the right): If a user makes a call to +1 425 XXX XX XX or +1 206 XXX XX XX, the call is first routed to SBC sbc1.contoso.com or sbc2.contoso.com. If neither SBC is available, the route with lower priority will be tried (sbc3.contoso.com and sbc4.contoso.com). If n…
    - block 3 `paragraph` (52 chars)
      Screenshot that shows voice routing policy examples.
    - block 4 `paragraph` (113 chars)
      In both examples, while the voice route is assigned priorities, the SBCs in the routes are tried in random order.
    - block 5 `paragraph` (4 chars)
      Note
    - block 6 `paragraph` (504 chars)
      Unless the user also has a Microsoft Calling Plan license, calls to any number except numbers matching the patterns +1 425 XXX XX XX or +1 206 XXX XX XX in the example configuration are dropped. If the user has a Calling Plan license, the call is automatically routed according to…
    - block 7 `paragraph` (179 chars)
      In the example shown in the following diagram, a voice route is added to send calls to all other US and Canadian numbers (calls that go to called number pattern +1 XXX XXX XX XX).
    - block 8 `paragraph` (62 chars)
      Screenshot that shows voice routing policy with a third route.
    - block 9 `paragraph` (359 chars)
      For all other calls, if a user has both licenses (Teams Phone and Microsoft Calling Plan), the automatic route is used. If nothing matches the number patterns in the administrator-created online voice routes, then the call is routed through Microsoft Calling Plan. If the user onl…
    - block 10 `paragraph` (4 chars)
      Note
    - block 11 `paragraph` (270 chars)
      The Priority value for route "Other +1" doesn't matter in this case because there is only one route that matches the pattern +1 XXX XXX XX XX. If a user makes a call to +1 324 567 89 89 and both sbc5.contoso.com and sbc6.contoso.com are unavailable, the call is dropped.
    - block 12 `paragraph` (295 chars)
      The following table summarizes the configuration using three voice routes. In this example, all three routes are part of the same PSTN usage, "US and Canada". All routes are associated with the "US and Canada" PSTN usage, and the PSTN usage is associated with the "US Only" voice…
    - block 13 `table` (95 chars)
      TABLE headers=[PSTN usage | Voice route | Number pattern | Priority | SBC | Description] rows=4
    - block 14 `paragraph` (4 chars)
      Note
    - block 15 `paragraph` (384 chars)
      In case of call forwarding or call transfer of an incoming PSTN call, when the ingress SBC is also listed as a potential egress SBC, its priority value is ignored, and it's prioritized above other SBCs. For example, in this table, if a forwarded call is ingressed over sbc5.contos…
  - **H2** `Example 1: Configuration steps` — sectionId=`sec-5` kind=`powershell_examples` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps`
    - block 0 `paragraph` (35 chars)
      The following example shows how to:
    - block 1 `ordered_list` (140 chars)
      1. Create a single PSTN usage.
      2. Configure three voice routes.
      3. Create a voice routing policy.
      4. Assign the policy to user1@contoso.com.
    - block 2 `paragraph` (82 chars)
      You can use the Microsoft Teams admin center or PowerShell to perform these steps.
    - **H3** `Using the Microsoft Teams admin center` — sectionId=`sec-6` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center`
      - _(no blocks; heading exists for hierarchy only)_
      - **H4** `Step 1: Create the "US and Canada" PSTN usage` — sectionId=`sec-7` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "US and Canada" PSTN usage`
        - block 0 `ordered_list` (220 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then in the upper-right corner, select Manage PSTN usage records.
          2. Select Add, type US and Canada, and then select Apply.
      - **H4** `Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)` — sectionId=`sec-8` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
        - block 0 `paragraph` (217 chars)
          The following steps describe how to create a voice route. Use these steps to create the three voice routes named Redmond 1, Redmond 2, and Other +1 for this example by using the settings outlined in the earlier table.
        - block 1 `ordered_list` (583 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then select the Voice routes tab.
          2. Select Add, and then enter a name and description for the voice route.
          3. Set the priority and specify the dialed number pattern.
          4. To enroll an…
      - **H4** `Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy` — sectionId=`sec-9` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
        - block 0 `ordered_list` (309 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Voice > Voice routing policies, and then select Add.
          2. Type US Only as the name and add a description.
          3. Under PSTN usage records, select Add PSTN usage, select the "US and Canada" PSTN usage record, and then…
        - block 1 `paragraph` (49 chars)
          To learn more, see Manage voice routing policies.
      - **H4** `Step 4: Assign the voice routing policy to user1@contoso.com` — sectionId=`sec-10` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user1@contoso.com`
        - block 0 `ordered_list` (252 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Users, and then select the user.
          2. Select Policies, and then next to Assigned policies, select Edit.
          3. Under Voice routing policy, select the "US Only" policy, and then select Save.
        - block 1 `paragraph` (49 chars)
          To learn more, see Manage voice routing policies.
    - **H3** `Using PowerShell` — sectionId=`sec-11` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell`
      - _(no blocks; heading exists for hierarchy only)_
      - **H4** `Step 1: Create the "US and Canada" PSTN usage` — sectionId=`sec-12` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
        - block 0 `paragraph` (46 chars)
          In a remote PowerShell session in Teams, type:
        - block 1 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 2 `paragraph` (46 chars)
          Verify that the usage was created by entering:
        - block 3 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 4 `paragraph` (52 chars)
          Which returns a list of names that may be truncated:
        - block 5 `code_block` (21 chars)
          CODE(console) 2 lines
        - block 6 `paragraph` (141 chars)
          The following example shows the result of running the (Get-CSOnlinePSTNUsage).usage PowerShell command to display full names (not truncated):
        - block 7 `code_block` (21 chars)
          CODE(console) 9 lines
      - **H4** `Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)` — sectionId=`sec-13` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
        - block 0 `paragraph` (73 chars)
          To create the "Redmond 1" route, in a PowerShell session in Teams, enter:
        - block 1 `code_block` (24 chars)
          CODE(PowerShell) 2 lines
        - block 2 `paragraph` (14 chars)
          Which returns:
        - block 3 `code_block` (21 chars)
          CODE(console) 7 lines
        - block 4 `paragraph` (37 chars)
          To create the Redmond 2 route, enter:
        - block 5 `code_block` (24 chars)
          CODE(PowerShell) 2 lines
        - block 6 `paragraph` (36 chars)
          To create the Other +1 route, enter:
        - block 7 `code_block` (24 chars)
          CODE(PowerShell) 2 lines
        - block 8 `paragraph` (7 chars)
          Caution
        - block 9 `paragraph` (153 chars)
          Make sure that your regular expression in the NumberPattern attribute is a valid expression. You can test it using this website: https://www.regexpal.com
        - block 10 `paragraph` (90 chars)
          In some cases, there is a need to route all calls to the same SBC; use -NumberPattern ".*"
        - block 11 `paragraph` (32 chars)
          Route all calls to the same SBC.
        - block 12 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 13 `paragraph` (130 chars)
          Verify that you've correctly configured the route by running the Get-CSOnlineVoiceRoute PowerShell command using options as shown:
        - block 14 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 15 `paragraph` (20 chars)
          Which should return:
        - block 16 `code_block` (22 chars)
          CODE(console) 22 lines
        - block 17 `paragraph` (75 chars)
          In the example, the route "Other +1" was automatically assigned priority 4.
      - **H4** `Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy` — sectionId=`sec-14` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
        - block 0 `paragraph` (39 chars)
          In a PowerShell session in Teams, type:
        - block 1 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 2 `paragraph` (36 chars)
          The result is shown in this example:
        - block 3 `code_block` (21 chars)
          CODE(console) 4 lines
      - **H4** `Step 4: Assign the voice routing policy to user1@contoso.com` — sectionId=`sec-15` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
        - block 0 `paragraph` (39 chars)
          In a PowerShell session in Teams, type:
        - block 1 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 2 `paragraph` (56 chars)
          Validate the policy assignment by entering this command:
        - block 3 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 4 `paragraph` (34 chars)
          The command returns the following:
        - block 5 `code_block` (21 chars)
          CODE(console) 3 lines
  - **H2** `Example 2: Voice routing with multiple PSTN usages` — sectionId=`sec-16` kind=`powershell_examples` headingPath=`Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
    - block 0 `paragraph` (185 chars)
      The voice routing policy created in Example 1 only allows calls to phone numbers in the United States and Canada--unless the Microsoft Calling Plan license is also assigned to the user.
    - block 1 `paragraph` (291 chars)
      In the example that follows, you can create the "No Restrictions" voice routing policy. The policy reuses the "US and Canada" PSTN usage created in Example 1, as well as the new "International" PSTN usage. This policy routes all other calls to the SBCs sbc2.contoso.com and sbc5.c…
    - block 2 `paragraph` (167 chars)
      The examples that are shown assign the US Only policy to user user1@contoso.com, and the No Restrictions policy to user2@contoso.com so that routing occurs as follows:
    - block 3 `unordered_list` (526 chars)
      - user1@contoso.com – US Only policy. Calls are allowed only to United States and Canadian numbers. When calling to the Redmond number range, the specific set of SBCs must be used. Non-United States numbers will not be routed unless the Calling Plan license is assigned to the use…
    - block 4 `paragraph` (73 chars)
      Screenshot that shows voice routing policy assigned to user1@contoso.com.
    - block 5 `paragraph` (353 chars)
      For all other calls, if a user has both licenses (Teams Phone and Microsoft Calling Plan), automatic route is used. If nothing matches the number patterns in the administrator-created online voice routes, then the call is routed using Microsoft Calling Plan. If the user has only…
    - block 6 `paragraph` (73 chars)
      Screenshot that shows voice routing policy assigned to user2@contoso.com.
    - block 7 `paragraph` (100 chars)
      The following table summarizes routing policy "No Restrictions" usage designations and voice routes.
    - block 8 `table` (95 chars)
      TABLE headers=[PSTN usage | Voice route | Number pattern | Priority | SBC | Description] rows=4
    - block 9 `paragraph` (4 chars)
      Note
    - block 10 `unordered_list` (765 chars)
      - The order of PSTN usages in voice routing policies is critical. The usages are applied in order, and if a match is found in the first usage, then other usages are never evaluated. The "International" PSTN usage must be placed after the "US and Canada" PSTN usage. To change the…
  - **H2** `Example 2: Configuration steps` — sectionId=`sec-17` kind=`powershell_examples` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps`
    - block 0 `paragraph` (35 chars)
      The following example shows how to:
    - block 1 `ordered_list` (198 chars)
      1. Create a new PSTN usage called International.
      2. Create a new voice route called International.
      3. Create a voice routing policy called No Restrictions.
      4. Assign the policy to user2@contoso.com.
    - block 2 `paragraph` (82 chars)
      You can use the Microsoft Teams admin center or PowerShell to perform these steps.
    - **H3** `Using the Microsoft Teams admin center` — sectionId=`sec-18` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center`
      - _(no blocks; heading exists for hierarchy only)_
      - **H4** `Step 1: Create the "International" PSTN usage` — sectionId=`sec-19` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "International" PSTN usage`
        - block 0 `ordered_list` (218 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then in the upper-right corner, select Manage PSTN usage records.
          2. Click Add, type International, and then click Apply.
      - **H4** `Step 2: Create the "International" voice route` — sectionId=`sec-20` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create the "International" voice route`
        - block 0 `ordered_list` (546 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then select the Voice routes tab.
          2. Click Add, enter "International" as the name, and then add the description.
          3. Set the priority to 4, and then set the dialed number pattern to \d…
      - **H4** `Step 3: Create a voice routing policy named "No Restrictions" and add the "US and Canada" and "International" PSTN usages to the policy` — sectionId=`sec-21` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "No Restrictions" and add the "US and Canada" and "International" PSTN usages to the policy`
        - block 0 `paragraph` (191 chars)
          The PSTN usage "US and Canada" is reused in this voice routing policy to preserve special handling for calls to number "+1 425 XXX XX XX" and "+1 206 XXX XX XX" as local or on-premises calls.
        - block 1 `ordered_list` (897 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Voice > Voice routing policies, and then click Add.
          2. Type No Restrictions as the name and add a description.
          3. Under PSTN usage records, click Add PSTN usage, select the "US and Canada" PSTN usage record, and…
        - block 2 `paragraph` (49 chars)
          To learn more, see Manage voice routing policies.
      - **H4** `Step 4: Assign the voice routing policy to user2@contoso.com` — sectionId=`sec-22` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user2@contoso.com`
        - block 0 `ordered_list` (260 chars)
          1. In the left navigation of the Microsoft Teams admin center, go to Users, and then select the user.
          2. Select Policies, and then next to Assigned policies, select Edit.
          3. Under Voice routing policy, select the "No Restrictions" policy, and then select Save.
        - block 1 `paragraph` (200 chars)
          The result is that the voice policy applied to the calls for user2@contoso.com is unrestricted and will follow the logic of call routing available for United States, Canada, and International calling.
    - **H3** `Using PowerShell` — sectionId=`sec-23` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell`
      - _(no blocks; heading exists for hierarchy only)_
      - **H4** `Step 1: Create the "International" PSTN usage` — sectionId=`sec-24` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`
        - block 0 `paragraph` (47 chars)
          In a remote PowerShell session in Teams, enter:
        - block 1 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
      - **H4** `Step 2: Create a new voice route named "International"` — sectionId=`sec-25` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
        - block 0 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 1 `paragraph` (14 chars)
          Which returns:
        - block 2 `code_block` (21 chars)
          CODE(console) 7 lines
      - **H4** `Step 3: Create a voice routing policy named "No Restrictions"` — sectionId=`sec-26` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
        - block 0 `paragraph` (202 chars)
          The PSTN usage "Redmond 1" and "Redmond" are reused in this voice routing policy to preserve special handling for calls to number "+1 425 XXX XX XX" and "+1 206 XXX XX XX" as local or on-premises calls.
        - block 1 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 2 `paragraph` (30 chars)
          Note the order of PSTN usages:
        - block 3 `unordered_list` (635 chars)
          - If a call is made to number "+1 425 XXX XX XX" with the usages configured as in the following example, the call follows the route set in "US and Canada" usage and the special routing logic is applied. That is, the call is routed using sbc1.contoso.com and sbc2.contoso.com first…
        - block 4 `paragraph` (14 chars)
          Which returns:
        - block 5 `code_block` (21 chars)
          CODE(console) 4 lines
      - **H4** `Step 4: Assign the voice routing policy to user2@contoso.com` — sectionId=`sec-27` kind=`generic` headingPath=`Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
        - block 0 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 1 `paragraph` (45 chars)
          Then verify the assignment using the command:
        - block 2 `code_block` (24 chars)
          CODE(PowerShell) 1 lines
        - block 3 `paragraph` (14 chars)
          Which returns:
        - block 4 `code_block` (21 chars)
          CODE(console) 3 lines
        - block 5 `paragraph` (201 chars)
          The result is that the voice policy applied to the calls for user2@contoso.com is unrestricted, and will follow the logic of call routing available for United States, Canada, and International calling.
  - **H2** `Run a Self-diagnostics tool` — sectionId=`sec-28` kind=`generic` headingPath=`Configure call routing for Direct Routing → Run a Self-diagnostics tool`
    - block 0 `paragraph` (147 chars)
      Microsoft 365 admin users have access to diagnostics that can be run within the tenant to verify a user is correctly configured for Direct Routing.
    - block 1 `paragraph` (4 chars)
      Note
    - block 2 `paragraph` (120 chars)
      This feature isn't available for Microsoft 365 Government, Microsoft 365 operated by 21Vianet, or Microsoft 365 Germany.
    - block 3 `paragraph` (98 chars)
      Select Run Tests, as follows. This will populate the diagnostic in the Microsoft 365 admin center.
    - block 4 `paragraph` (55 chars)
      The diagnostic performs a large range of verifications.

### B. Chunker diagnostics

- `table_chunked_separately` @ `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage` (`sec-4`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage` (`sec-4`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage` (`sec-12`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)` (`sec-13`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy` (`sec-14`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com` (`sec-15`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `table_chunked_separately` @ `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages` (`sec-16`): Table rendered as a standalone chunk to preserve row/header semantics.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages` (`sec-16`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage` (`sec-24`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"` (`sec-25`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"` (`sec-26`): Section exceeded chunk size threshold and was split on safe structural boundaries.
- `oversized_section_split` @ `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com` (`sec-27`): Section exceeded chunk size threshold and was split on safe structural boundaries.

### B. Produced chunks

#### B-00 chunk index 0

- chunk ID: `6e6e2b7bd0c6b1c1be8e275bbeba41beb5bce92fbf6ad55dac56c61e5416e719`
- heading path: `Configure call routing for Direct Routing`
- source section: `sec-1` kind=`configuration` sourceOrder=0
- structural refs: paragraph#0, unordered_list#1, paragraph#2
- character count (retrievalText): 590
- character count (body): 481
- approximate token count: 148 (chars/4)
- first ~120 characters: This article describes how to configure call routing for Direct Routing. This is step 3 of the following steps for confi…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Call routing overview`
- previous chunk heading: _start of document_

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing

This article describes how to configure call routing for Direct Routing. This is step 3 of the following steps for configuring Direct Routing:

- Step 1. Connect the SBC with Teams Phone and validate the connection
- Step 2. Enable users for Direct Routing, voice, and voicemail
- Step 3. Configure call routing (This article)
- Step 4. Translate numbers to an alternate format

For information on all the steps required for setting up Direct Routing, see Configure Direct Routing.
````

#### B-01 chunk index 1

- chunk ID: `425f01855aeacfbeef9f0509eb7c96f282b0b1a74a319019df5767ab22b19961`
- heading path: `Configure call routing for Direct Routing → Call routing overview`
- source section: `sec-2` kind=`configuration` sourceOrder=1
- structural refs: paragraph#0, unordered_list#1, paragraph#2, paragraph#3, unordered_list#4
- character count (retrievalText): 1203
- character count (body): 1069
- approximate token count: 301 (chars/4)
- first ~120 characters: Teams Phone has a routing mechanism that allows a call to be sent to a specific Session Border Controller (SBC) based on…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Voice routing policy considerations`
- previous chunk heading: `Configure call routing for Direct Routing`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Call routing overview

Teams Phone has a routing mechanism that allows a call to be sent to a specific Session Border Controller (SBC) based on:

- The called number pattern
- The called number pattern plus the specific user who makes the call

SBCs can be designated as active and backup. When the SBC that is configured as active is not available for a specific call route, then the call will be routed to a backup SBC.

Call routing is made up of the following elements:

- Call routing policy – Also called a voice routing policy. A container for PSTN usages, which can be assigned to a user or to multiple users.
- PSTN usages – A container for voice routes and PSTN usages, which can be shared in different voice routing policies.
- Voice routes – A number pattern and set of online PSTN gateways to use for calls where the calling number matches the pattern.
- Online PSTN gateway - A pointer to an SBC that also stores the configuration that is applied when a call is placed through the SBC, such as forward P-Asserted-Identity (PAI) or Preferred Codecs; can be added to voice routes.
````

#### B-02 chunk index 2

- chunk ID: `5ab89c406a9f5914eb1cee7759925082f03054fba33ea622a17247542bcc1bb6`
- heading path: `Configure call routing for Direct Routing → Voice routing policy considerations`
- source section: `sec-3` kind=`procedure` sourceOrder=2
- structural refs: paragraph#0, paragraph#1, ordered_list#2
- character count (retrievalText): 1391
- character count (body): 1243
- approximate token count: 348 (chars/4)
- first ~120 characters: If a user has a Calling Plan license, that user’s outgoing calls are automatically routed through the Microsoft Calling…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Call routing overview`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Voice routing policy considerations

If a user has a Calling Plan license, that user’s outgoing calls are automatically routed through the Microsoft Calling Plan PSTN infrastructure. If you configure and assign an online voice routing policy to a Calling Plan user, that user’s outgoing calls are checked to determine whether the dialed number matches a number pattern defined in the online voice routing policy. If there’s a match, the call is routed through the Direct Routing trunk. If there’s no match, the call is routed through the Calling Plan PSTN infrastructure.

Caution

1. If you configure and apply the global (Org-wide default) online voice routing policy, all voice-enabled users in your organization will inherit that policy, which might result in PSTN calls from Calling Plan and Operator Connect users being inadvertently routed to a Direct Routing trunk. If you don't want all users to use the global online voice routing policy, configure a custom online voice routing policy and assign it to individual voice-enabled users.
2. If the called number contains an extension, the called number pattern is applied only to the number without the extension. For example, if a user calls +1425XXXXXXX;ext=YYY, the called number pattern is applied only to +1425XXXXXXX.
````

#### B-03 chunk index 3

- chunk ID: `2946b32fee9a81095840b60fe3724e3c435a15b1a3e7847679e8306877f94089`
- heading path: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- source section: `sec-4` kind=`powershell_example` sourceOrder=3
- structural refs: paragraph#0, paragraph#1, paragraph#2, paragraph#3, paragraph#4, paragraph#5, paragraph#6, paragraph#7, paragraph#8, paragraph#9, paragraph#10
- character count (retrievalText): 2106
- character count (body): 1949
- approximate token count: 527 (chars/4)
- first ~120 characters: The following diagram shows two examples of voice routing policies in a call flow. Call Flow 1 (on the left): If a user…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Voice routing policy considerations`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Voice routing with one PSTN usage

The following diagram shows two examples of voice routing policies in a call flow.

Call Flow 1 (on the left): If a user makes a call to +1 425 XXX XX XX or +1 206 XXX XX XX, the call is routed to SBC sbc1.contoso.com or sbc2.contoso.com. If neither sbc1.contoso.com nor sbc2.contoso.com are available, the call is dropped.

Call Flow 2 (on the right): If a user makes a call to +1 425 XXX XX XX or +1 206 XXX XX XX, the call is first routed to SBC sbc1.contoso.com or sbc2.contoso.com. If neither SBC is available, the route with lower priority will be tried (sbc3.contoso.com and sbc4.contoso.com). If none of the SBCs are available, the call is dropped.

Screenshot that shows voice routing policy examples.

In both examples, while the voice route is assigned priorities, the SBCs in the routes are tried in random order.

Note

Unless the user also has a Microsoft Calling Plan license, calls to any number except numbers matching the patterns +1 425 XXX XX XX or +1 206 XXX XX XX in the example configuration are dropped. If the user has a Calling Plan license, the call is automatically routed according to the policies of the Microsoft Calling Plan. The Microsoft Calling Plan applies automatically as the last route to all users with the Microsoft Calling Plan license and does not require additional call routing configuration.

In the example shown in the following diagram, a voice route is added to send calls to all other US and Canadian numbers (calls that go to called number pattern +1 XXX XXX XX XX).

Screenshot that shows voice routing policy with a third route.

For all other calls, if a user has both licenses (Teams Phone and Microsoft Calling Plan), the automatic route is used. If nothing matches the number patterns in the administrator-created online voice routes, then the call is routed through Microsoft Calling Plan. If the user only has Teams Phone, the call is dropped because no matching rules are available.

Note
````

#### B-04 chunk index 4

- chunk ID: `a661cbe800538e1751bd63d750138a60a5fdcf87f10b5c3576d9594418878601`
- heading path: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- source section: `sec-4` kind=`powershell_example` sourceOrder=4
- structural refs: paragraph#11, paragraph#12
- character count (retrievalText): 724
- character count (body): 567
- approximate token count: 181 (chars/4)
- first ~120 characters: The Priority value for route "Other +1" doesn't matter in this case because there is only one route that matches the pat…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Voice routing with one PSTN usage

The Priority value for route "Other +1" doesn't matter in this case because there is only one route that matches the pattern +1 XXX XXX XX XX. If a user makes a call to +1 324 567 89 89 and both sbc5.contoso.com and sbc6.contoso.com are unavailable, the call is dropped.

The following table summarizes the configuration using three voice routes. In this example, all three routes are part of the same PSTN usage, "US and Canada". All routes are associated with the "US and Canada" PSTN usage, and the PSTN usage is associated with the "US Only" voice routing policy.
````

#### B-05 chunk index 5

- chunk ID: `1a6edf08ac4b2c571d00b2b1e679ece320ce839f261ff5c58a27b879fb53b7c6`
- heading path: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- source section: `sec-4` kind=`powershell_example` sourceOrder=5
- structural refs: table#13
- character count (retrievalText): 800
- character count (body): 643
- approximate token count: 200 (chars/4)
- first ~120 characters: | PSTN usage | Voice route | Number pattern | Priority | SBC | Description | | --- | --- | --- | --- | --- | --- | | US…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Voice routing with one PSTN usage

| PSTN usage | Voice route | Number pattern | Priority | SBC | Description |
| --- | --- | --- | --- | --- | --- |
| US and Canada | "Redmond 1" | ^+1(425 | 206)(\d{7})$ | 1 | sbc1.contoso.comsbc2.contoso.com | Active route for called numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Redmond 2" | ^+1(425 | 206)(\d{7})$ | 2 | sbc3.contoso.comsbc4.contoso.com | Backup route for called numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Other +1" | ^+1(\d{10})$ | 3 | sbc5.contoso.comsbc6.contoso.com | Route for called numbers +1 XXX XXX XX XX (except +1 425 XXX XX XX or +1 206 XXX XX XX) |
|  |  |  |  |  |  |
````

#### B-06 chunk index 6

- chunk ID: `63dc2a08858df9f7917c3693d2d615bbf426f993756da7b6e253b945184e0d5e`
- heading path: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`
- source section: `sec-4` kind=`powershell_example` sourceOrder=6
- structural refs: paragraph#14, paragraph#15
- character count (retrievalText): 547
- character count (body): 390
- approximate token count: 137 (chars/4)
- first ~120 characters: Note In case of call forwarding or call transfer of an incoming PSTN call, when the ingress SBC is also listed as a pote…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Voice routing with one PSTN usage

Note

In case of call forwarding or call transfer of an incoming PSTN call, when the ingress SBC is also listed as a potential egress SBC, its priority value is ignored, and it's prioritized above other SBCs. For example, in this table, if a forwarded call is ingressed over sbc5.contoso.com, the first SBC attempted for egress will be sbc5.contoso.com, even though its priority value is 3.
````

#### B-07 chunk index 7

- chunk ID: `0620267a8ce65162972f54f02280501233367eaad510757b59e508b79de7a1e8`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps`
- source section: `sec-5` kind=`powershell_example` sourceOrder=7
- structural refs: paragraph#0, ordered_list#1, paragraph#2
- character count (retrievalText): 404
- character count (body): 261
- approximate token count: 101 (chars/4)
- first ~120 characters: The following example shows how to: 1. Create a single PSTN usage. 2. Configure three voice routes. 3. Create a voice ro…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Voice routing with one PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps

The following example shows how to:

1. Create a single PSTN usage.
2. Configure three voice routes.
3. Create a voice routing policy.
4. Assign the policy to user1@contoso.com.

You can use the Microsoft Teams admin center or PowerShell to perform these steps.
````

#### B-08 chunk index 8

- chunk ID: `ee0252a07ba4310ba10aa6a4308b5c67de1e8afa63445123e3c751783aa147d0`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-7` kind=`procedure` sourceOrder=8
- structural refs: ordered_list#0
- character count (retrievalText): 454
- character count (body): 220
- approximate token count: 114 (chars/4)
- first ~120 characters: 1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then in the upper-right…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using the Microsoft Teams admin center -> Step 1: Create the "US and Canada" PSTN usage

1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then in the upper-right corner, select Manage PSTN usage records.
2. Select Add, type US and Canada, and then select Apply.
````

#### B-09 chunk index 9

- chunk ID: `2a561e22d20127eb7b5596aa488624c0675eedad840078dceced0eba61b9ce11`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-8` kind=`procedure` sourceOrder=9
- structural refs: paragraph#0, ordered_list#1
- character count (retrievalText): 1061
- character count (body): 802
- approximate token count: 266 (chars/4)
- first ~120 characters: The following steps describe how to create a voice route. Use these steps to create the three voice routes named Redmond…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using the Microsoft Teams admin center -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

The following steps describe how to create a voice route. Use these steps to create the three voice routes named Redmond 1, Redmond 2, and Other +1 for this example by using the settings outlined in the earlier table.

1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then select the Voice routes tab.
2. Select Add, and then enter a name and description for the voice route.
3. Set the priority and specify the dialed number pattern.
4. To enroll an SBC with the voice route, under SBCs enrolled (optional), select Add SBCs, select the SBCs you want to enroll, and then select Apply.
5. To add PSTN usage records, under PSTN usage records (optional), select Add PSTN usage, select the PSTN records you want to add, and then select Apply.
6. Select Save.
````

#### B-10 chunk index 10

- chunk ID: `08332aa331660bb7c007b3ca230c8da2b9422540677fdeafe097cbca6b502635`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- source section: `sec-9` kind=`procedure` sourceOrder=10
- structural refs: ordered_list#0, paragraph#1
- character count (retrievalText): 655
- character count (body): 360
- approximate token count: 164 (chars/4)
- first ~120 characters: 1. In the left navigation of the Microsoft Teams admin center, go to Voice > Voice routing policies, and then select Add…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using the Microsoft Teams admin center -> Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

1. In the left navigation of the Microsoft Teams admin center, go to Voice > Voice routing policies, and then select Add.
2. Type US Only as the name and add a description.
3. Under PSTN usage records, select Add PSTN usage, select the "US and Canada" PSTN usage record, and then select Apply.
4. Select Save.

To learn more, see Manage voice routing policies.
````

#### B-11 chunk index 11

- chunk ID: `878d9b379b242c24dffef57c81eb9b41a0a070e757e3dcf04aedaca3a5b78728`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-10` kind=`procedure` sourceOrder=11
- structural refs: ordered_list#0, paragraph#1
- character count (retrievalText): 552
- character count (body): 303
- approximate token count: 138 (chars/4)
- first ~120 characters: 1. In the left navigation of the Microsoft Teams admin center, go to Users, and then select the user. 2. Select Policies…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using the Microsoft Teams admin center -> Step 4: Assign the voice routing policy to user1@contoso.com

1. In the left navigation of the Microsoft Teams admin center, go to Users, and then select the user.
2. Select Policies, and then next to Assigned policies, select Edit.
3. Under Voice routing policy, select the "US Only" policy, and then select Save.

To learn more, see Manage voice routing policies.
````

#### B-12 chunk index 12

- chunk ID: `205f9323fa8d76eb8e59cabf9ed8b0415b556a1f9149ea04a785b6000079acbe`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`configuration` sourceOrder=12
- structural refs: paragraph#0
- character count (retrievalText): 258
- character count (body): 46
- approximate token count: 65 (chars/4)
- first ~120 characters: In a remote PowerShell session in Teams, type:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

In a remote PowerShell session in Teams, type:
````

#### B-13 chunk index 13

- chunk ID: `75c0179bddc8703ddb847ba573c1f8901499d974a376dcbc85931e41326e4222`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`code` sourceOrder=13
- structural refs: code_block#1
- character count (retrievalText): 298
- character count (body): 86
- approximate token count: 75 (chars/4)
- first ~120 characters: ```PowerShell Set-CsOnlinePstnUsage -Identity Global -Usage @{Add="US and Canada"} ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

```PowerShell
Set-CsOnlinePstnUsage -Identity Global -Usage @{Add="US and Canada"}
```
````

#### B-14 chunk index 14

- chunk ID: `8b15e54eac17df13f1ac22b912bb81beb28cd29b709cbf50b2f583b88909bcdb`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`configuration` sourceOrder=14
- structural refs: paragraph#2
- character count (retrievalText): 258
- character count (body): 46
- approximate token count: 65 (chars/4)
- first ~120 characters: Verify that the usage was created by entering:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

Verify that the usage was created by entering:
````

#### B-15 chunk index 15

- chunk ID: `0057f40777cb87347883cc94c5d77e7c70c6e046178507af8b195af455821c6e`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`code` sourceOrder=15
- structural refs: code_block#3
- character count (retrievalText): 251
- character count (body): 39
- approximate token count: 63 (chars/4)
- first ~120 characters: ```PowerShell Get-CSOnlinePSTNUsage ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

```PowerShell
Get-CSOnlinePSTNUsage
```
````

#### B-16 chunk index 16

- chunk ID: `33747a0205f14fed43b33ab9bef83a3faf2f9aa04ee7b38b745c7d468e312518`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`configuration` sourceOrder=16
- structural refs: paragraph#4
- character count (retrievalText): 264
- character count (body): 52
- approximate token count: 66 (chars/4)
- first ~120 characters: Which returns a list of names that may be truncated:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

Which returns a list of names that may be truncated:
````

#### B-17 chunk index 17

- chunk ID: `5ffb08dab2b0d63a40c0cd65e235fd1c061ffc3f29533a366ca8d25f66b765e7`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`code` sourceOrder=17
- structural refs: code_block#5
- character count (retrievalText): 321
- character count (body): 109
- approximate token count: 81 (chars/4)
- first ~120 characters: ```console Identity : Global Usage : {testusage, US and Canada, International, karlUsage. . .} ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

```console
Identity    : Global
Usage        : {testusage, US and Canada, International, karlUsage. . .}
```
````

#### B-18 chunk index 18

- chunk ID: `0957f7b74063608c0d733b661f0ba583be8c9f82dedc97720cf24919f57d1340`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`configuration` sourceOrder=18
- structural refs: paragraph#6
- character count (retrievalText): 353
- character count (body): 141
- approximate token count: 89 (chars/4)
- first ~120 characters: The following example shows the result of running the (Get-CSOnlinePSTNUsage).usage PowerShell command to display full n…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

The following example shows the result of running the (Get-CSOnlinePSTNUsage).usage PowerShell command to display full names (not truncated):
````

#### B-19 chunk index 19

- chunk ID: `c887b8c53f4aa3610514ae19a61c1e3de64929faf7b0918afba01773a98ddd09`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`
- source section: `sec-12` kind=`code` sourceOrder=19
- structural refs: code_block#7
- character count (retrievalText): 357
- character count (body): 145
- approximate token count: 90 (chars/4)
- first ~120 characters: ```console testusage US and Canada International karlUsage New test env Tallinn Lab Sonus karlUsage2 Unrestricted Two tr…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 1: Create the "US and Canada" PSTN usage

```console
 testusage
 US and Canada
 International
 karlUsage
 New test env
 Tallinn Lab Sonus
 karlUsage2
 Unrestricted
 Two trunks
```
````

#### B-20 chunk index 20

- chunk ID: `8c945f7e47b9592cbab2635827084fb2aa19dc8a3dc0758433e18aa138999ad8`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=20
- structural refs: paragraph#0
- character count (retrievalText): 310
- character count (body): 73
- approximate token count: 78 (chars/4)
- first ~120 characters: To create the "Redmond 1" route, in a PowerShell session in Teams, enter:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 1: Create the "US and Canada" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

To create the "Redmond 1" route, in a PowerShell session in Teams, enter:
````

#### B-21 chunk index 21

- chunk ID: `741c7f796b86eabde51481ded3bea27bfa7e0606a7aa707dae312c175964b8e0`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=21
- structural refs: code_block#1
- character count (retrievalText): 444
- character count (body): 207
- approximate token count: 111 (chars/4)
- first ~120 characters: ```PowerShell New-CsOnlineVoiceRoute -Identity "Redmond 1" -NumberPattern "^\+1(425|206) (\d{7})$" -OnlinePstnGatewayLis…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```PowerShell
New-CsOnlineVoiceRoute -Identity "Redmond 1" -NumberPattern "^\+1(425|206)
(\d{7})$" -OnlinePstnGatewayList sbc1.contoso.com, sbc2.contoso.com -Priority 1 -OnlinePstnUsages "US and Canada"
```
````

#### B-22 chunk index 22

- chunk ID: `6b599f50cfe236c4412654af7e4fad1d9ba5ffd38b9959a72549c1ed19cb234b`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=22
- structural refs: paragraph#2
- character count (retrievalText): 251
- character count (body): 14
- approximate token count: 63 (chars/4)
- first ~120 characters: Which returns:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

Which returns:
````

#### B-23 chunk index 23

- chunk ID: `ccdf158ea319307cada674c49fbc81ee7a819b92a41cc5154345c99dba4577c4`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=23
- structural refs: code_block#3
- character count (retrievalText): 537
- character count (body): 300
- approximate token count: 135 (chars/4)
- first ~120 characters: ```console Identity : Redmond 1 Priority : 1 Description : NumberPattern : ^\+1(425|206) (\d{7})$ OnlinePstnUsages : {US…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```console
Identity                : Redmond 1
Priority                : 1
Description             :
NumberPattern           : ^\+1(425|206) (\d{7})$
OnlinePstnUsages        : {US and Canada}
OnlinePstnGatewayList   : {sbc1.contoso.com, sbc2.contoso.com}
Name                    : Redmond 1
```
````

#### B-24 chunk index 24

- chunk ID: `2da2a8d692b5311d8219502c4080f31761dafbee5d0fa1aaaa357fd05d6aae63`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=24
- structural refs: paragraph#4
- character count (retrievalText): 274
- character count (body): 37
- approximate token count: 69 (chars/4)
- first ~120 characters: To create the Redmond 2 route, enter:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

To create the Redmond 2 route, enter:
````

#### B-25 chunk index 25

- chunk ID: `0b26e2501d51d0232f95d2229319880fb867a66bfa6b11accf06a8fb75f7c061`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=25
- structural refs: code_block#5
- character count (retrievalText): 444
- character count (body): 207
- approximate token count: 111 (chars/4)
- first ~120 characters: ```PowerShell New-CsOnlineVoiceRoute -Identity "Redmond 2" -NumberPattern "^\+1(425|206) (\d{7})$" -OnlinePstnGatewayLis…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```PowerShell
New-CsOnlineVoiceRoute -Identity "Redmond 2" -NumberPattern "^\+1(425|206)
(\d{7})$" -OnlinePstnGatewayList sbc3.contoso.com, sbc4.contoso.com -Priority 2 -OnlinePstnUsages "US and Canada"
```
````

#### B-26 chunk index 26

- chunk ID: `4a845daa6cc20525ad7138f846e8eeac955cd0c52e0067bcb5ddb7b1403bf007`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=26
- structural refs: paragraph#6
- character count (retrievalText): 273
- character count (body): 36
- approximate token count: 69 (chars/4)
- first ~120 characters: To create the Other +1 route, enter:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

To create the Other +1 route, enter:
````

#### B-27 chunk index 27

- chunk ID: `2b91413b2f2ce3fa359db0dbf1beff9f9f67c62614a832b6cecaa36ff7180bfb`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=27
- structural refs: code_block#7
- character count (retrievalText): 422
- character count (body): 185
- approximate token count: 106 (chars/4)
- first ~120 characters: ```PowerShell New-CsOnlineVoiceRoute -Identity "Other +1" -NumberPattern "^\+1(\d{10})$" -OnlinePstnGatewayList sbc5.con…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```PowerShell
New-CsOnlineVoiceRoute -Identity "Other +1" -NumberPattern "^\+1(\d{10})$"
-OnlinePstnGatewayList sbc5.contoso.com, sbc6.contoso.com -OnlinePstnUsages "US and Canada"
```
````

#### B-28 chunk index 28

- chunk ID: `6636ee3c9823315b74b38b6483d775af6e21695bfff7a9f47b36ad228467712b`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=28
- structural refs: paragraph#8, paragraph#9, paragraph#10, paragraph#11
- character count (retrievalText): 525
- character count (body): 288
- approximate token count: 132 (chars/4)
- first ~120 characters: Caution Make sure that your regular expression in the NumberPattern attribute is a valid expression. You can test it usi…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

Caution

Make sure that your regular expression in the NumberPattern attribute is a valid expression. You can test it using this website: https://www.regexpal.com

In some cases, there is a need to route all calls to the same SBC; use -NumberPattern ".*"

Route all calls to the same SBC.
````

#### B-29 chunk index 29

- chunk ID: `edd30e232d2317ad1249832723e1e6f0222c207be9a84fa030fce8cd0d8bb7bb`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=29
- structural refs: code_block#12
- character count (retrievalText): 353
- character count (body): 116
- approximate token count: 89 (chars/4)
- first ~120 characters: ```PowerShell Set-CsOnlineVoiceRoute -id "Redmond 1" -NumberPattern ".*" -OnlinePstnGatewayList sbc1.contoso.com ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```PowerShell
Set-CsOnlineVoiceRoute -id "Redmond 1" -NumberPattern ".*" -OnlinePstnGatewayList sbc1.contoso.com
```
````

#### B-30 chunk index 30

- chunk ID: `aab11c87389ee10ad2740a9eb6a8da096c52b2d6fc6ade9ec8ffe6ddcf8b3fc6`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=30
- structural refs: paragraph#13
- character count (retrievalText): 367
- character count (body): 130
- approximate token count: 92 (chars/4)
- first ~120 characters: Verify that you've correctly configured the route by running the Get-CSOnlineVoiceRoute PowerShell command using options…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

Verify that you've correctly configured the route by running the Get-CSOnlineVoiceRoute PowerShell command using options as shown:
````

#### B-31 chunk index 31

- chunk ID: `b3c3bfbf9ce93890614cec53c08f6cb337b5f6a79f35a7158f3c44593874303f`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=31
- structural refs: code_block#14
- character count (retrievalText): 526
- character count (body): 289
- approximate token count: 132 (chars/4)
- first ~120 characters: ```PowerShell Get-CsOnlineVoiceRoute | Where-Object {($_.priority -eq 1) -or ($_.priority -eq 2) or ($_.priority -eq 4)…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```PowerShell
Get-CsOnlineVoiceRoute | Where-Object {($_.priority -eq 1) -or ($_.priority -eq 2) or ($_.priority -eq 4) -Identity "Redmond 1" -NumberPattern "^\+1(425|206) (\d{7})$" -OnlinePstnGatewayList sbc1.contoso.com, sbc2.contoso.com -Priority 1 -OnlinePstnUsages "US and Canada"
```
````

#### B-32 chunk index 32

- chunk ID: `c7fabf826cb43ddf0053dd9c74e327a5552c9691ae2fad9506a5556dc59626c0`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=32
- structural refs: paragraph#15
- character count (retrievalText): 257
- character count (body): 20
- approximate token count: 65 (chars/4)
- first ~120 characters: Which should return:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

Which should return:
````

#### B-33 chunk index 33

- chunk ID: `ce9bd1e03270b13a11c311bbdf78245bde8e8ed321302ff832e4aa2039e248ef`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`code` sourceOrder=33
- structural refs: code_block#16
- character count (retrievalText): 1059
- character count (body): 822
- approximate token count: 265 (chars/4)
- first ~120 characters: ```console Identity : Redmond 1 Priority : 1 Description : NumberPattern : ^\+1(425|206) (\d{7})$ OnlinePstnUsages : {US…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

```console
Identity            : Redmond 1 
Priority               : 1
Description         : 
NumberPattern         : ^\+1(425|206) (\d{7})$
OnlinePstnUsages     : {US and Canada}     
OnlinePstnGatewayList    : {sbc1.contoso.com, sbc2.contoso.com}
Name             : Redmond 1
Identity        : Redmond 2 
Priority               : 2
Description         : 
NumberPattern         : ^\+1(425|206) (\d{7})$
OnlinePstnUsages     : {US and Canada}     
OnlinePstnGatewayList    : {sbc3.contoso.com, sbc4.contoso.com}
Name             : Redmond 2
    
Identity        : Other +1 
Priority               : 4
Description         : 
NumberPattern         : ^\+1(\d{10})$
OnlinePstnUsages     : {US and Canada}     
OnlinePstnGatewayList    : {sbc5.contoso.com, sbc6.contoso.com}
Name             : Other +1
```
````

#### B-34 chunk index 34

- chunk ID: `bb2e680e00728d7ed31766a321e2ad14ce4f4d0d394c369d620946f28f9335f8`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`
- source section: `sec-13` kind=`configuration` sourceOrder=34
- structural refs: paragraph#17
- character count (retrievalText): 312
- character count (body): 75
- approximate token count: 78 (chars/4)
- first ~120 characters: In the example, the route "Other +1" was automatically assigned priority 4.
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

In the example, the route "Other +1" was automatically assigned priority 4.
````

#### B-35 chunk index 35

- chunk ID: `2b9336bc3fd5c68f98bd67be8a4e15e93662d7575353cfde06be39963679fbe4`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- source section: `sec-14` kind=`configuration` sourceOrder=35
- structural refs: paragraph#0
- character count (retrievalText): 312
- character count (body): 39
- approximate token count: 78 (chars/4)
- first ~120 characters: In a PowerShell session in Teams, type:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

In a PowerShell session in Teams, type:
````

#### B-36 chunk index 36

- chunk ID: `6bd3023ece280198a0d14852668830e5a9ea5b1f523237e438d77702824cd38f`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- source section: `sec-14` kind=`code` sourceOrder=36
- structural refs: code_block#1
- character count (retrievalText): 365
- character count (body): 92
- approximate token count: 92 (chars/4)
- first ~120 characters: ```PowerShell New-CsOnlineVoiceRoutingPolicy "US Only" -OnlinePstnUsages "US and Canada" ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

```PowerShell
New-CsOnlineVoiceRoutingPolicy "US Only" -OnlinePstnUsages "US and Canada"
```
````

#### B-37 chunk index 37

- chunk ID: `3f5685ed658e40b4112dff0f27bc355578f2a515631a261572ac905defb950d6`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- source section: `sec-14` kind=`configuration` sourceOrder=37
- structural refs: paragraph#2
- character count (retrievalText): 309
- character count (body): 36
- approximate token count: 78 (chars/4)
- first ~120 characters: The result is shown in this example:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

The result is shown in this example:
````

#### B-38 chunk index 38

- chunk ID: `6b49cdd2293f29c8e1fce85f3cc1e43168fbc389b967a37f02a2dcb2b75a9665`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`
- source section: `sec-14` kind=`code` sourceOrder=38
- structural refs: code_block#3
- character count (retrievalText): 411
- character count (body): 138
- approximate token count: 103 (chars/4)
- first ~120 characters: ```console Identity : Tag:US only OnlinePstnUsages : {US and Canada} Description : RouteType : BYOT ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

```console
Identity            : Tag:US only
OnlinePstnUsages    : {US and Canada}
Description         :
RouteType           : BYOT
```
````

#### B-39 chunk index 39

- chunk ID: `1411fec1f35f135799841c7945196c0ceb3076ae6f16e5321fe7dae780b9a3be`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-15` kind=`configuration` sourceOrder=39
- structural refs: paragraph#0
- character count (retrievalText): 266
- character count (body): 39
- approximate token count: 67 (chars/4)
- first ~120 characters: In a PowerShell session in Teams, type:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user1@contoso.com

In a PowerShell session in Teams, type:
````

#### B-40 chunk index 40

- chunk ID: `bb5f3aae573e8f0c7eab5c791346bc4e8e5166654e79c6578dadb86031f9179d`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-15` kind=`code` sourceOrder=40
- structural refs: code_block#1
- character count (retrievalText): 329
- character count (body): 102
- approximate token count: 83 (chars/4)
- first ~120 characters: ```PowerShell Grant-CsOnlineVoiceRoutingPolicy -Identity "user1@contoso.com" -PolicyName "US Only" ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user1@contoso.com

```PowerShell
Grant-CsOnlineVoiceRoutingPolicy -Identity "user1@contoso.com" -PolicyName "US Only"
```
````

#### B-41 chunk index 41

- chunk ID: `66da68f389c18f385219250e0694dd81de45b4dd9b1b497b85afdfb612d5b010`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-15` kind=`configuration` sourceOrder=41
- structural refs: paragraph#2
- character count (retrievalText): 283
- character count (body): 56
- approximate token count: 71 (chars/4)
- first ~120 characters: Validate the policy assignment by entering this command:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user1@contoso.com

Validate the policy assignment by entering this command:
````

#### B-42 chunk index 42

- chunk ID: `4ce6f966020d1b260bec99eabd453710c9dd8cf203cc09087f880724f1537435`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-15` kind=`code` sourceOrder=42
- structural refs: code_block#3
- character count (retrievalText): 315
- character count (body): 88
- approximate token count: 79 (chars/4)
- first ~120 characters: ```PowerShell Get-CsOnlineUser "user1@contoso.com" | select OnlineVoiceRoutingPolicy ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user1@contoso.com

```PowerShell
Get-CsOnlineUser "user1@contoso.com" | select OnlineVoiceRoutingPolicy
```
````

#### B-43 chunk index 43

- chunk ID: `4379f0ee4f70d44744174dd7746cdf52df1f67a989a420380cf69aeab53c35f9`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-15` kind=`configuration` sourceOrder=43
- structural refs: paragraph#4
- character count (retrievalText): 261
- character count (body): 34
- approximate token count: 66 (chars/4)
- first ~120 characters: The command returns the following:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user1@contoso.com

The command returns the following:
````

#### B-44 chunk index 44

- chunk ID: `2ebf2e3f6172f269d4edeed673719bf38606fee3a8ccf09f18e9973af22b2633`
- heading path: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`
- source section: `sec-15` kind=`code` sourceOrder=44
- structural refs: code_block#5
- character count (retrievalText): 298
- character count (body): 71
- approximate token count: 75 (chars/4)
- first ~120 characters: ```console OnlineVoiceRoutingPolicy --------------------- US Only ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 1: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user1@contoso.com

```console
OnlineVoiceRoutingPolicy
---------------------
US Only
```
````

#### B-45 chunk index 45

- chunk ID: `57e2eed46883952ccf943cfc3b4ddcdf76790ca3f05434d7ab19ccdacc254c86`
- heading path: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
- source section: `sec-16` kind=`powershell_example` sourceOrder=45
- structural refs: paragraph#0, paragraph#1, paragraph#2, unordered_list#3, paragraph#4, paragraph#5, paragraph#6, paragraph#7
- character count (retrievalText): 1945
- character count (body): 1782
- approximate token count: 487 (chars/4)
- first ~120 characters: The voice routing policy created in Example 1 only allows calls to phone numbers in the United States and Canada--unless…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
- previous chunk heading: `Configure call routing for Direct Routing → Example 1: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user1@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Voice routing with multiple PSTN usages

The voice routing policy created in Example 1 only allows calls to phone numbers in the United States and Canada--unless the Microsoft Calling Plan license is also assigned to the user.

In the example that follows, you can create the "No Restrictions" voice routing policy. The policy reuses the "US and Canada" PSTN usage created in Example 1, as well as the new "International" PSTN usage. This policy routes all other calls to the SBCs sbc2.contoso.com and sbc5.contoso.com.

The examples that are shown assign the US Only policy to user user1@contoso.com, and the No Restrictions policy to user2@contoso.com so that routing occurs as follows:

- user1@contoso.com – US Only policy. Calls are allowed only to United States and Canadian numbers. When calling to the Redmond number range, the specific set of SBCs must be used. Non-United States numbers will not be routed unless the Calling Plan license is assigned to the user.
- user2@contoso.com – International policy. Calls are allowed to any number. When calling to the Redmond number range, the specific set of SBCs must be used. Non-United States numbers will be routed using sbc2.contoso.com and sbc5.contoso.com.

Screenshot that shows voice routing policy assigned to user1@contoso.com.

For all other calls, if a user has both licenses (Teams Phone and Microsoft Calling Plan), automatic route is used. If nothing matches the number patterns in the administrator-created online voice routes, then the call is routed using Microsoft Calling Plan. If the user has only Teams Phone, the call is dropped because no matching rules are available.

Screenshot that shows voice routing policy assigned to user2@contoso.com.

The following table summarizes routing policy "No Restrictions" usage designations and voice routes.
````

#### B-46 chunk index 46

- chunk ID: `de4fd639374a3aaca978f77d16bdf877de4e1be53e552d45c2d192eff19569d5`
- heading path: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
- source section: `sec-16` kind=`powershell_example` sourceOrder=46
- structural refs: table#8
- character count (retrievalText): 896
- character count (body): 733
- approximate token count: 224 (chars/4)
- first ~120 characters: | PSTN usage | Voice route | Number pattern | Priority | SBC | Description | | --- | --- | --- | --- | --- | --- | | US…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Voice routing with multiple PSTN usages

| PSTN usage | Voice route | Number pattern | Priority | SBC | Description |
| --- | --- | --- | --- | --- | --- |
| US and Canada | "Redmond 1" | ^+1(425 | 206)(\d{7})$ | 1 | sbc1.contoso.comsbc2.contoso.com | Active route for callee numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Redmond 2" | ^+1(425 | 206)(\d{7})$ | 2 | sbc3.contoso.comsbc4.contoso.com | Backup route for callee numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Other +1" | ^+1(\d{10})$ | 3 | sbc5.contoso.comsbc6.contoso.com | Route for callee numbers +1 XXX XXX XX XX (except +1 425 XXX XX XX or +1 206 XXX XX XX) |
| International | International | \d+ | 4 | sbc2.contoso.comsbc5.contoso.com | Route for any number pattern |
````

#### B-47 chunk index 47

- chunk ID: `2a8b3398de2f147a3166316e375c84109be61fa6380ebf485aafce1ae05f4c9a`
- heading path: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`
- source section: `sec-16` kind=`powershell_example` sourceOrder=47
- structural refs: paragraph#9, unordered_list#10
- character count (retrievalText): 934
- character count (body): 771
- approximate token count: 234 (chars/4)
- first ~120 characters: Note - The order of PSTN usages in voice routing policies is critical. The usages are applied in order, and if a match i…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Voice routing with multiple PSTN usages

Note

- The order of PSTN usages in voice routing policies is critical. The usages are applied in order, and if a match is found in the first usage, then other usages are never evaluated. The "International" PSTN usage must be placed after the "US and Canada" PSTN usage. To change the order of the PSTN usages, run the Set-CSOnlineVoiceRoutingPolicy command. For example, to change the order from "US and Canada" first and "International" second to the reverse order run:Set-CsOnlineVoiceRoutingPolicy -id tag:"no Restrictions" -OnlinePstnUsages @{Replace="International", "US and Canada"}
- The priority for "Other +1" and "International" voice routes are assigned automatically. They don't matter as long as they have lower priorities than "Redmond 1" and "Redmond 2."
````

#### B-48 chunk index 48

- chunk ID: `2678ee21c81925cf2f1e8910dfd773fa7a622bbff514d641dcb89189fc250005`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps`
- source section: `sec-17` kind=`powershell_example` sourceOrder=48
- structural refs: paragraph#0, ordered_list#1, paragraph#2
- character count (retrievalText): 462
- character count (body): 319
- approximate token count: 116 (chars/4)
- first ~120 characters: The following example shows how to: 1. Create a new PSTN usage called International. 2. Create a new voice route called…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "International" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Voice routing with multiple PSTN usages`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps

The following example shows how to:

1. Create a new PSTN usage called International.
2. Create a new voice route called International.
3. Create a voice routing policy called No Restrictions.
4. Assign the policy to user2@contoso.com.

You can use the Microsoft Teams admin center or PowerShell to perform these steps.
````

#### B-49 chunk index 49

- chunk ID: `670efccbd73a10400adb23f059df4dee6676d3ff9ed1c2d6c04597fcecbc0e59`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "International" PSTN usage`
- source section: `sec-19` kind=`procedure` sourceOrder=49
- structural refs: ordered_list#0
- character count (retrievalText): 452
- character count (body): 218
- approximate token count: 113 (chars/4)
- first ~120 characters: 1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then in the upper-right…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create the "International" voice route`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using the Microsoft Teams admin center -> Step 1: Create the "International" PSTN usage

1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then in the upper-right corner, select Manage PSTN usage records.
2. Click Add, type International, and then click Apply.
````

#### B-50 chunk index 50

- chunk ID: `0688e48ce9304da0b91433a9bc3828137465bbcec5f2b68bdeffd4174d19cdf1`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create the "International" voice route`
- source section: `sec-20` kind=`procedure` sourceOrder=50
- structural refs: ordered_list#0
- character count (retrievalText): 781
- character count (body): 546
- approximate token count: 196 (chars/4)
- first ~120 characters: 1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then select the Voice r…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "No Restrictions" and add the "US and Canada" and "International" PSTN usages to the policy`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 1: Create the "International" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using the Microsoft Teams admin center -> Step 2: Create the "International" voice route

1. In the left navigation of the Microsoft Teams admin center, go to Voice > Direct Routing, and then select the Voice routes tab.
2. Click Add, enter "International" as the name, and then add the description.
3. Set the priority to 4, and then set the dialed number pattern to \d+.
4. Under SBCs enrolled (optional), click Add SBCs, select sbc2.contoso.com and sbc5.contoso.com, and then click Apply.
5. Under PSTN usage records (optional), click Add PSTN usage, select the "International" PSTN usage record, and then click Apply.
6. Click Save.
````

#### B-51 chunk index 51

- chunk ID: `abfed687a5671ca745f9b3b8e15a2d545e667ff51806e2df6a362c93bbbde7d1`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "No Restrictions" and add the "US and Canada" and "International" PSTN usages to the policy`
- source section: `sec-21` kind=`procedure` sourceOrder=51
- structural refs: paragraph#0, ordered_list#1, paragraph#2
- character count (retrievalText): 1465
- character count (body): 1141
- approximate token count: 367 (chars/4)
- first ~120 characters: The PSTN usage "US and Canada" is reused in this voice routing policy to preserve special handling for calls to number "…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 2: Create the "International" voice route`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using the Microsoft Teams admin center -> Step 3: Create a voice routing policy named "No Restrictions" and add the "US and Canada" and "International" PSTN usages to the policy

The PSTN usage "US and Canada" is reused in this voice routing policy to preserve special handling for calls to number "+1 425 XXX XX XX" and "+1 206 XXX XX XX" as local or on-premises calls.

1. In the left navigation of the Microsoft Teams admin center, go to Voice > Voice routing policies, and then click Add.
2. Type No Restrictions as the name and add a description.
3. Under PSTN usage records, click Add PSTN usage, select the "US and Canada" PSTN usage record, and then select the "International" PSTN usage record. Click Apply.Take note of the order of PSTN usages:If a call made to number "+1 425 XXX XX XX" with the usages configured as in this example, the call follows the route set in "US and Canada" usage and the special routing logic is applied. That is, the call is routed using sbc1.contoso.com and sbc2.contoso.com first, and then sbc3.contoso.com and sbc4.contoso.com as the backup routes.If "International" PSTN usage is before "US and Canada," calls to +1 425 XXX XX XX are routed to sbc2.contoso.com and sbc5.contoso.com as part of the routing logic.
4. Click Save.

To learn more, see Manage voice routing policies.
````

#### B-52 chunk index 52

- chunk ID: `685f96037d84f8f37c861860396f4af2c8b975f485d0937b9ab54daf9c2c294e`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-22` kind=`procedure` sourceOrder=52
- structural refs: ordered_list#0, paragraph#1
- character count (retrievalText): 711
- character count (body): 462
- approximate token count: 178 (chars/4)
- first ~120 characters: 1. In the left navigation of the Microsoft Teams admin center, go to Users, and then select the user. 2. Select Policies…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 3: Create a voice routing policy named "No Restrictions" and add the "US and Canada" and "International" PSTN usages to the policy`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using the Microsoft Teams admin center -> Step 4: Assign the voice routing policy to user2@contoso.com

1. In the left navigation of the Microsoft Teams admin center, go to Users, and then select the user.
2. Select Policies, and then next to Assigned policies, select Edit.
3. Under Voice routing policy, select the "No Restrictions" policy, and then select Save.

The result is that the voice policy applied to the calls for user2@contoso.com is unrestricted and will follow the logic of call routing available for United States, Canada, and International calling.
````

#### B-53 chunk index 53

- chunk ID: `398cc867c99c1d724fe6d2092ae4f923eac5ed63b16a7789e3ef904504eeff89`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`
- source section: `sec-24` kind=`configuration` sourceOrder=53
- structural refs: paragraph#0
- character count (retrievalText): 259
- character count (body): 47
- approximate token count: 65 (chars/4)
- first ~120 characters: In a remote PowerShell session in Teams, enter:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using the Microsoft Teams admin center → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 1: Create the "International" PSTN usage

In a remote PowerShell session in Teams, enter:
````

#### B-54 chunk index 54

- chunk ID: `ecd745f0767feefb79161f2e7306b340b545c0affc20846f8ed61ce7abffc7e0`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`
- source section: `sec-24` kind=`code` sourceOrder=54
- structural refs: code_block#1
- character count (retrievalText): 298
- character count (body): 86
- approximate token count: 75 (chars/4)
- first ~120 characters: ```PowerShell Set-CsOnlinePstnUsage -Identity Global -Usage @{Add="International"} ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 1: Create the "International" PSTN usage

```PowerShell
Set-CsOnlinePstnUsage -Identity Global -Usage @{Add="International"}
```
````

#### B-55 chunk index 55

- chunk ID: `3c4c7bfaabf205d8d2237234f7f855f4a2fa66a17b51990b654d85db32850dbc`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
- source section: `sec-25` kind=`code` sourceOrder=55
- structural refs: code_block#0
- character count (retrievalText): 399
- character count (body): 178
- approximate token count: 100 (chars/4)
- first ~120 characters: ```PowerShell New-CsOnlineVoiceRoute -Identity "International" -NumberPattern ".*" -OnlinePstnGatewayList sbc2.contoso.c…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 1: Create the "International" PSTN usage`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 2: Create a new voice route named "International"

```PowerShell
New-CsOnlineVoiceRoute -Identity "International" -NumberPattern ".*" -OnlinePstnGatewayList sbc2.contoso.com, sbc5.contoso.com -OnlinePstnUsages "International"
```
````

#### B-56 chunk index 56

- chunk ID: `bdaddfdf9c72ff9439f20f1d7237e57de2aedc44331b795fae376d41ea2d3b1f`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
- source section: `sec-25` kind=`configuration` sourceOrder=56
- structural refs: paragraph#1
- character count (retrievalText): 235
- character count (body): 14
- approximate token count: 59 (chars/4)
- first ~120 characters: Which returns:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 2: Create a new voice route named "International"

Which returns:
````

#### B-57 chunk index 57

- chunk ID: `213c9eb8a83b610ac878f90124c7c2781ef16281d22eef1753d5067d5a6a72e2`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`
- source section: `sec-25` kind=`code` sourceOrder=57
- structural refs: code_block#2
- character count (retrievalText): 523
- character count (body): 302
- approximate token count: 131 (chars/4)
- first ~120 characters: ```console Identity : International Priority : 5 Description : NumberPattern : .* OnlinePstnUsages : {International} Onl…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 2: Create a new voice route named "International"

```console
Identity                  : International
Priority                  : 5
Description               :
NumberPattern             : .*
OnlinePstnUsages          : {International}
OnlinePstnGatewayList     : {sbc2.contoso.com, sbc5.contoso.com}
Name                      : International
```
````

#### B-58 chunk index 58

- chunk ID: `5cf0ef630ba2e7a25a79ef7c7e6d9a48ba918d945d6665e3a85fff57bbcad2c0`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- source section: `sec-26` kind=`configuration` sourceOrder=58
- structural refs: paragraph#0
- character count (retrievalText): 430
- character count (body): 202
- approximate token count: 108 (chars/4)
- first ~120 characters: The PSTN usage "Redmond 1" and "Redmond" are reused in this voice routing policy to preserve special handling for calls…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 2: Create a new voice route named "International"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "No Restrictions"

The PSTN usage "Redmond 1" and "Redmond" are reused in this voice routing policy to preserve special handling for calls to number "+1 425 XXX XX XX" and "+1 206 XXX XX XX" as local or on-premises calls.
````

#### B-59 chunk index 59

- chunk ID: `877863dc98aaea9d75852eb9019ea0481ee2d919159148f554bc95076354bb6f`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- source section: `sec-26` kind=`code` sourceOrder=59
- structural refs: code_block#1
- character count (retrievalText): 345
- character count (body): 117
- approximate token count: 87 (chars/4)
- first ~120 characters: ```PowerShell New-CsOnlineVoiceRoutingPolicy "No Restrictions" -OnlinePstnUsages "US and Canada", "International" ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "No Restrictions"

```PowerShell
New-CsOnlineVoiceRoutingPolicy "No Restrictions" -OnlinePstnUsages "US and Canada", "International"
```
````

#### B-60 chunk index 60

- chunk ID: `d763689023b565438ae922642ba8d94af2d9d28905eede7bb678c919d42894a7`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- source section: `sec-26` kind=`configuration` sourceOrder=60
- structural refs: paragraph#2, unordered_list#3, paragraph#4
- character count (retrievalText): 911
- character count (body): 683
- approximate token count: 228 (chars/4)
- first ~120 characters: Note the order of PSTN usages: - If a call is made to number "+1 425 XXX XX XX" with the usages configured as in the fol…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "No Restrictions"

Note the order of PSTN usages:

- If a call is made to number "+1 425 XXX XX XX" with the usages configured as in the following example, the call follows the route set in "US and Canada" usage and the special routing logic is applied. That is, the call is routed using sbc1.contoso.com and sbc2.contoso.com first, and then sbc3.contoso.com and sbc4.contoso.com as the backup routes.
- If "International" PSTN usage is before "US and Canada," calls to +1 425 XXX XX XX are routed to sbc2.contoso.com and sbc5.contoso.com as part of the routing logic. Enter the command:New-CsOnlineVoiceRoutingPolicy "No Restrictions" -OnlinePstnUsages "US and Canada", "International"

Which returns:
````

#### B-61 chunk index 61

- chunk ID: `6f781ecb66f73bcee0b19f512dbfe87dc70183fd5a0ca829c11a0f1b580563d5`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`
- source section: `sec-26` kind=`code` sourceOrder=61
- structural refs: code_block#5
- character count (retrievalText): 410
- character count (body): 182
- approximate token count: 103 (chars/4)
- first ~120 characters: ```console Identity : International OnlinePstnUsages : {US and Canada, International} Description : RouteType : BYOT ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 3: Create a voice routing policy named "No Restrictions"

```console
    Identity              : International 
    OnlinePstnUsages : {US and Canada, International}     
    Description         :  
    RouteType               : BYOT
```
````

#### B-62 chunk index 62

- chunk ID: `fc644f181ad717ea619e17707c51a25ea367cbb0f211bd16a9c0e9491a0eaccf`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-27` kind=`code` sourceOrder=62
- structural refs: code_block#0
- character count (retrievalText): 337
- character count (body): 110
- approximate token count: 85 (chars/4)
- first ~120 characters: ```PowerShell Grant-CsOnlineVoiceRoutingPolicy -Identity "user2@contoso.com" -PolicyName "No Restrictions" ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 3: Create a voice routing policy named "No Restrictions"`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user2@contoso.com

```PowerShell
Grant-CsOnlineVoiceRoutingPolicy -Identity "user2@contoso.com" -PolicyName "No Restrictions"
```
````

#### B-63 chunk index 63

- chunk ID: `327e90091358af7a19c23d06dd2d917283d1a007d10cefe685f48ace5a1c6c3f`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-27` kind=`configuration` sourceOrder=63
- structural refs: paragraph#1
- character count (retrievalText): 272
- character count (body): 45
- approximate token count: 68 (chars/4)
- first ~120 characters: Then verify the assignment using the command:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user2@contoso.com

Then verify the assignment using the command:
````

#### B-64 chunk index 64

- chunk ID: `82852d16198932338bb0febe1e880cfc68d0b8592b9b168f6be0bdcf7e4c0387`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-27` kind=`code` sourceOrder=64
- structural refs: code_block#2
- character count (retrievalText): 315
- character count (body): 88
- approximate token count: 79 (chars/4)
- first ~120 characters: ```PowerShell Get-CsOnlineUser "user2@contoso.com" | Select OnlineVoiceRoutingPolicy ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user2@contoso.com

```PowerShell
Get-CsOnlineUser "user2@contoso.com" | Select OnlineVoiceRoutingPolicy
```
````

#### B-65 chunk index 65

- chunk ID: `f33f4d2193702ef33c8262152c3228b7091ef3182b2868816b55e557a121e480`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-27` kind=`configuration` sourceOrder=65
- structural refs: paragraph#3
- character count (retrievalText): 241
- character count (body): 14
- approximate token count: 61 (chars/4)
- first ~120 characters: Which returns:
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user2@contoso.com

Which returns:
````

#### B-66 chunk index 66

- chunk ID: `eaf248b69199dc0be393cf25152df313225bfda18389e44a1c8d0c856a60b104`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-27` kind=`code` sourceOrder=66
- structural refs: code_block#4
- character count (retrievalText): 309
- character count (body): 82
- approximate token count: 78 (chars/4)
- first ~120 characters: ```console OnlineVoiceRoutingPolicy ------------------------ No Restrictions ```
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user2@contoso.com

```console
OnlineVoiceRoutingPolicy
------------------------
No Restrictions
```
````

#### B-67 chunk index 67

- chunk ID: `5cd1c1d5008267c52938120d048c3e6d1acda7d9a86c5d6db9f4aa8202828892`
- heading path: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`
- source section: `sec-27` kind=`configuration` sourceOrder=67
- structural refs: paragraph#5
- character count (retrievalText): 428
- character count (body): 201
- approximate token count: 107 (chars/4)
- first ~120 characters: The result is that the voice policy applied to the calls for user2@contoso.com is unrestricted, and will follow the logi…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: `Configure call routing for Direct Routing → Run a Self-diagnostics tool`
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Example 2: Configuration steps -> Using PowerShell -> Step 4: Assign the voice routing policy to user2@contoso.com

The result is that the voice policy applied to the calls for user2@contoso.com is unrestricted, and will follow the logic of call routing available for United States, Canada, and International calling.
````

#### B-68 chunk index 68

- chunk ID: `7f9a4ab3b51d674621d4fa792324982f328f626b905bf94514631774f34e7944`
- heading path: `Configure call routing for Direct Routing → Run a Self-diagnostics tool`
- source section: `sec-28` kind=`configuration` sourceOrder=68
- structural refs: paragraph#0, paragraph#1, paragraph#2, paragraph#3, paragraph#4
- character count (retrievalText): 572
- character count (body): 432
- approximate token count: 143 (chars/4)
- first ~120 characters: Microsoft 365 admin users have access to diagnostics that can be run within the tenant to verify a user is correctly con…
- previous overlap: _None. Production `chunkKnowledgeDocument` does not implement sliding-window overlap. Adjacent chunks share heading-path metadata only._
- next chunk heading: _end of document_
- previous chunk heading: `Configure call routing for Direct Routing → Example 2: Configuration steps → Using PowerShell → Step 4: Assign the voice routing policy to user2@contoso.com`

**Full chunk text**

````text
Document: Configure call routing for Direct Routing
Heading Path: Configure call routing for Direct Routing -> Run a Self-diagnostics tool

Microsoft 365 admin users have access to diagnostics that can be run within the tenant to verify a user is correctly configured for Direct Routing.

Note

This feature isn't available for Microsoft 365 Government, Microsoft 365 operated by 21Vianet, or Microsoft 365 Germany.

Select Run Tests, as follows. This will populate the diagnostic in the Microsoft 365 admin center.

The diagnostic performs a large range of verifications.
````


---

## 4. Boundary-quality evaluation

Classifications are from reading the production chunks above. Heading-path metadata is present on every chunk (`Document:` + `Heading Path:`). “Heading detachment” here means the *body* is orphaned from the prose/steps it governs, even if the path string remains.

### Document A — every chunk

| Chunk | Grade | Why |
|---|---|---|
| A-00 | GOOD | Full “what is media bypass” definition, SBC/client path, Set-CsOnlinePSTNGateway, with/without bypass in one slice. |
| A-01 | QUESTIONABLE | Tiny H2 intro only (“depend on whether the user has direct access…”). Children hold the real scenarios. Independently weak. |
| A-02 | GOOD | Named scenario + bullets + recommended internal-direct-media path. |
| A-03 | GOOD | Named no-public-IP scenario; Transport Relay path stays with the heading. |
| A-04 | GOOD | Outside-network scenario plus the NOTE that it is not recommended. Callout packed with prose. |
| A-05 | GOOD | Media Processors vs Transport Relays explained before the table. |
| A-06 | QUESTIONABLE | Standalone comparison table. Heading path names the section, but “see the following table” lives in A-05. |
| A-07 | QUESTIONABLE | Starts “The IP ranges are:” after the table flush. Subject is recoverable from heading path, not from the body. |
| A-08 | GOOD | When processors are still inserted on a bypass trunk (escalation, etc.). |
| A-09 | GOOD | SIP signaling FQDN requirements vs non-bypass. |
| A-10 | GOOD | Commercial PSTN hub FQDNs as a list. |
| A-11 | GOOD | DoD FQDN. |
| A-12 | GOOD | GCC High FQDN. |
| A-13 | QUESTIONABLE | Port-requirements sentence split from the actual port table (A-14). |
| A-14 | QUESTIONABLE | SIP/TLS port table alone. |
| A-15 | QUESTIONABLE | One-sentence H2 “media flows between SBC and client…” with no ports. |
| A-16 | QUESTIONABLE | “must have access to the specified ports (see table)” without the table. |
| A-17 | QUESTIONABLE | UDP/SRTP client↔SBC table alone. |
| A-18 | QUESTIONABLE | NAT source-port NOTE after the table. |
| A-19 | BAD | Body is only “Transport Relays are in the same range as Media Processors (for non-bypass cases):” — colon, no ranges. |
| A-20 | BAD | Body is one CIDR bullet. Meaning lives only in heading path. Duplicate of A-26. |
| A-21 | BAD | Body is `- 52.127.64.0/21` (16 chars). Duplicate of A-27. |
| A-22 | BAD | One CIDR + “port range shown in the following table” without the table. |
| A-23 | QUESTIONABLE | Transport Relay port table isolated under GCC High heading (table is “applicable to all environments”). |
| A-24 | QUESTIONABLE | Two-ports-per-call NOTE after that table. |
| A-25 | GOOD | Processors always in path for voice apps / web clients. |
| A-26 | BAD | Duplicate commercial CIDR list under a different parent (processors vs relays). |
| A-27 | BAD | Duplicate DoD CIDR. |
| A-28 | BAD | Duplicate GCC High CIDR + “following table”. |
| A-29 | QUESTIONABLE | Media Processor port table isolated. |
| A-30 | GOOD | High-level ordered test-trunk procedure (users, two FQDNs, OVRP, assign). Interview-useful. |
| A-31 | QUESTIONABLE | Example user/trunk table split from A-30’s “the following example”. |
| A-32 | QUESTIONABLE | Same-SBC two-trunk TLS/SAN facts plus vendor-doc link dump. Useful TLS point; vendor list is noise. |
| A-33 | GOOD | Supported endpoints and automatic conversion of non-bypass endpoints. |

**A counts:** 10 GOOD / 14 QUESTIONABLE / 10 BAD (of 34).

### Document B — every chunk

Pattern key:
- **Admin-center step with its ordered list** → GOOD if the list is complete for that heading.
- **PowerShell “type:” / “by entering:” paragraph flushed away from the following code fence** → BAD.
- **Bare code fence** → QUESTIONABLE if heading names the step, BAD if the body has no surrounding verb.
- **“Example N” sections** are parser-typed `powershell_examples` because the heading starts with “Example”.

| Chunk | Grade | Why |
|---|---|---|
| B-00 | QUESTIONABLE | “This article describes… Step 3 of configuring Direct Routing.” Independently true; interview-poison boilerplate. |
| B-01 | GOOD | Entire policy → PSTN usage → voice route → online PSTN gateway chain in one chunk. |
| B-02 | GOOD | Calling Plan vs Direct Routing check + Caution numbered caveats stay together. Easy to steal as an off-topic first claim. |
| B-03 | QUESTIONABLE | Example call-flow prose; ends on a dangling `Note`. |
| B-04 | QUESTIONABLE | Continues after the split; “the following table” without the table. |
| B-05 | QUESTIONABLE | Standalone example-1 summary table. |
| B-06 | QUESTIONABLE | Leftover screenshot/note tail of the same section. |
| B-07 | GOOD | Four-step configuration outline (usage, routes, policy, assign). |
| B-08 | GOOD | Admin-center PSTN usage steps stay with the step heading. |
| B-09 | GOOD | Admin-center create-three-routes procedure. |
| B-10 | GOOD | Admin-center create policy + add usage. |
| B-11 | GOOD | Admin-center assign policy to user. |
| B-12 | BAD | Body: “In a remote PowerShell session in Teams, type:” — no cmdlet. |
| B-13 | QUESTIONABLE | Bare `Set-CsOnlinePstnUsage` fence. Heading saves it; body has no verb. |
| B-14 | BAD | “Verify that the usage was created by entering:” — no command. |
| B-15 | QUESTIONABLE | Bare `Get-CSOnlinePSTNUsage`. |
| B-16–B-35 | mixed | Remaining Example 1 PowerShell steps repeat the same **prose / code / verify / code** fragmentation. Step headings keep identity; bodies often do not. Treat intro-only and verify-only slices as BAD, code-only as QUESTIONABLE, packed prose+list as GOOD. |
| B-36+ Example 2 | same pattern | Admin-center steps mostly GOOD; PowerShell code isolation BAD/QUESTIONABLE. |
| Final self-diagnostics | QUESTIONABLE | Tenant diagnostic marketing; not the routing chain. |

Exact PowerShell intro/code splits observed in Example 1 Step 1 (B-12–B-15) recur whenever a section is `paragraph + code_block + paragraph + code_block`, because **code is always flushed as its own chunk**.

**B structural takeaway:** 69 chunks for one article. The conceptual answer lives in **one** chunk (B-01). The other 68 are setup boilerplate, Calling Plan caveats, diagrams, per-step UI, and PowerShell fragments.

---

## 5. Interview-question simulation (no retrieval)

### A. “Walk me through one-way audio / media-path troubleshooting on Direct Routing.”

This page is a **media-bypass planning** article, not a one-way-audio runbook. It does not contain an ordered diagnostic like: scope direction → signaling vs media → RTP/NAT/SDP → bypass state → telemetry.

**Chunks that would support a 3–5 point interview answer:**

1. A-00 — what bypass changes (media SBC↔client vs via Teams Phone)
2. A-02 / A-03 — client must reach SBC public IP, else Transport Relays
3. A-08 — processors still inserted (escalation / some endpoints)
4. A-16+A-17 — UDP/SRTP ports (currently split)
5. A-30 — how to test bypass on a separate trunk/OVRP

- **How many chunks to reconstruct 3–5 points:** 4–6 (5 if ports stay split).
- **One coherent chunk?** Yes for the *definition* (A-00). No for a diagnostic path.
- **Concepts scattered?** Call-flow, firewall, ports, and test-trunk procedure are in different H2/H3s. That matches the source outline. Tiny CIDR chunks (A-19–A-21, A-26–A-28) do not help and can pollute.
- **Heading/context preserved?** Yes in the retrieval prefix. A-19 still fails because the body is a hanging colon.

### B. “Explain voice-routing policy → PSTN usage → route → gateway.”

- **How many chunks:** **1** (B-01) is sufficient for the conceptual chain. B-07 adds the configure-order talking points. B-05’s table is optional illustration.
- **One coherent chunk?** **Yes — B-01.**
- **Concepts scattered?** Not the core chain. They are concentrated. What *is* scattered is the example/PowerShell implementation across ~60 chunks.
- **Heading/context preserved?** Yes.

This matches I4 behavior: the pack already contains a good conceptual extract; Interview Quick still led with other extracts (Calling Plan caveat, admin-center step, SBC-connect leftover). That is downstream selection, not absence of a well-bounded chunk.

---

## 6. Current chunk configuration (explicit)

| Setting | Production value |
|---|---|
| Target chunk size | None (pack whole blocks until the next block would exceed max) |
| Maximum chunk size | **2200 characters** of *rendered block text* (`DEFAULT_MAX_CHUNK_CHARS`). Floor if overridden: 600. The `Document:` / `Heading Path:` prefix is added **after** packing, so `retrievalText` can slightly exceed 2200 (A-00 is 2280). |
| Overlap | **None** |
| Heading preservation | Section tree flattened; each chunk prefixed with document title + heading path. Headings are not copied into the body. Empty headings (no blocks) produce no chunk. |
| List handling | Entire list = one canonical block. Not split item-by-item unless that single rendered list exceeds 2200, then whitespace hard-split. |
| Table handling | **Always a standalone chunk** (`table_chunked_separately`). |
| Code handling | **Always a standalone chunk**. |
| Paragraph boundary | Split between blocks when the next block would exceed max; oversized block splits on blank lines then words. |
| Callouts | Only blockquote `NOTE:`/`IMPORTANT:` etc. become `callout`. Plain “Note” / “Caution” paragraphs do not. |
| Semantic rules | PowerShell section kinds; generic `chunkKind` from heading keywords. No NLP splitter. “Example 1 …” headings are classified as `powershell_examples` because the heading starts with “Example”. |

### Appropriate for general Microsoft documentation search?

**Mostly yes.** Heading-path prefixes, no overlap duplication, tables kept intact, 2200 chars is a reasonable browse/search window. Tiny environment CIDR headings are a Learn-structure problem the chunker does not merge.

### Appropriate for Interview Quick troubleshooting/procedural answers?

**Only partly.** Interview Quick needs 3–5 grounded points from few chunks. The chunker:

- Does well when a heading’s blocks fit in 2200 chars (A-00, B-01, A-30, admin-center steps).
- Hurts when it **isolates code from the sentence that introduces it** and **isolates tables from “see the following table”**.
- Emits many **sub-200-character bodies** (10/34 on A, 38/69 on B) that cannot stand as interview talking points.

---

## CHUNKER VERDICT

**mixed result; specific document structures are problematic**

Heading-path prefixes and section packing preserve a lot of Microsoft Learn meaning. Conceptual overviews that fit in one section become excellent interview chunks. The same chunker then systematically tears procedural Learn pages into intro-colon / table / code / CIDR fragments that are weak standalone evidence.

Interview Quick failures are **not explained by missing overlap**, and **not fully explained by chunking**. B-01 already contains the routing chain. One-way audio still lacks a diagnostic runbook on this media-bypass page. Downstream claim selection remains the larger I4 issue. Chunking **does** add retrieval noise that can win over the good chunk.

### TOP 5 BOUNDARY FAILURES

1. **Code flushed away from its intro sentence** — B-12 “type:” without `Set-CsOnlinePstnUsage`; B-14 “by entering:” without `Get-CSOnlinePSTNUsage`.
2. **Hanging-colon / CIDR-only children** — A-19 body ends with “:”; A-21 body is 16 characters.
3. **Table isolation** — A-16 “see table” vs A-17 ports; B-04 “the following table” vs B-05.
4. **Duplicate environment slices** — A-20/A-26 and A-21/A-27 are near-identical CIDR chunks under different parents (source duplication + no merge).
5. **Boilerplate H1 chunk** — B-00 “This article describes step 3…” is a well-formed chunk that is a bad interview answer.

### EXAMPLES OF GOOD CHUNKS

- **A-00** — media bypass definition + SBC/client path + `Set-CsOnlinePSTNGateway -MediaBypass`.
- **B-01** — voice routing policy, PSTN usages, voice routes, online PSTN gateway in one list.
- **A-30** — four high-level test-trunk steps (users, two FQDNs, OVRP, assign).
- **B-07** — usage → routes → policy → assign outline.
- **B-08 / B-09** — admin-center steps remain ordered lists under the correct step heading.
- **B-02** — Calling Plan interaction + Caution items (structurally good; topically easy to misuse).

### EXAMPLES OF BAD/QUESTIONABLE CHUNKS

- **A-21** full body: `- 52.127.64.0/21`
- **A-19** full body: `Transport Relays are in the same range as Media Processors (for non-bypass cases):`
- **B-12** full body: `In a remote PowerShell session in Teams, type:`
- **B-14** full body: `Verify that the usage was created by entering:`
- **A-07** starts `The IP ranges are:` after a table split
- **B-00** Learn series navigation, not an interview answer

### WOULD RE-CHUNKING THE 76-DOCUMENT INTERVIEW PACK LIKELY HELP?

**Uncertain — limited, not a silver bullet.**

Evidence **for** limited help:

- 38/69 bodies on the routing page are under 200 characters. Merging intro+code+verify, and merging one-line CIDR children into the parent, would remove fragments that can outrank B-01 / A-00.
- Table+intro splits are a chunker rule, not a missing-source problem. Changing that rule and re-indexing the pack would change the retrieval surface.

Evidence **against** expecting I4 to jump to 10 PASS:

- The routing-chain fact already exists as **one good chunk** (B-01). I4 still did not prefer it. That is selection/aspecting, not missing boundaries.
- The media-bypass page does not contain a one-way-audio diagnostic sequence no matter how you slice it.
- No overlap means re-chunking would not be fighting duplication from windows; duplication here is Learn repeating CIDR sections.

Do not change the chunker until a later slice explicitly owns that work.

