# Networking for Beginners — Curated Markdown Corpus

This folder is designed to be useful in **three ways at once**:

1. as a beginner networking study guide;
2. as a clean Markdown corpus for Claude, ChatGPT, local search, embeddings, or RAG;
3. as source material that can be converted to Word with Pandoc.

The emphasis is practical understanding: what each component does, where it sits in a packet's path, what usually breaks, and how the pieces relate to real-time communications and enterprise voice.

## Recommended reading order

Start with `Networking_Fundamentals/00_Networking_Terminology.md` and move in numerical order through `16_Network_Troubleshooting.md`.

After that, use `UC_Networking_Bridge/` to connect the fundamentals to SIP, RTP, NAT traversal, SBCs, VLANs, QoS, and troubleshooting voice/media paths.

## Folder layout

```text
Networking_Beginner_Corpus/
├── README.md
├── ATTRIBUTION.md
├── SOURCES.md
├── Combined_Networking_Study_Guide.md
├── manifest.jsonl
├── PANDOC_CONVERSION.md
├── Networking_Fundamentals/
│   ├── 00_Networking_Terminology.md
│   ├── 01_How_Networks_Work.md
│   ├── 02_OSI_and_TCPIP_Models.md
│   ├── 03_Ethernet_MAC_and_ARP.md
│   ├── 04_IP_Addressing.md
│   ├── 05_Subnetting.md
│   ├── 06_DHCP.md
│   ├── 07_DNS.md
│   ├── 08_Switches_and_VLANs.md
│   ├── 09_Routers_and_Default_Gateways.md
│   ├── 10_Routing_Basics.md
│   ├── 11_NAT_and_PAT.md
│   ├── 12_TCP_UDP_and_Ports.md
│   ├── 13_Firewalls.md
│   ├── 14_Network_Topology.md
│   ├── 15_QoS_Latency_Jitter_and_Loss.md
│   └── 16_Network_Troubleshooting.md
└── UC_Networking_Bridge/
    ├── 00_UC_Networking_Overview.md
    ├── 01_SIP.md
    ├── 02_RTP_and_SRTP.md
    ├── 03_NAT_Traversal_STUN_TURN_ICE.md
    ├── 04_SBC_Fundamentals.md
    ├── 05_Voice_VLANs_and_QoS.md
    └── 06_UC_Troubleshooting_Flow.md
```


## Store integration

The canonical `sourceId` for this corpus is **`networking_beginner`**. Every ingestible topic document carries that value in YAML front matter.

Before ingestion, wire the source into the application-side source registry and the project's existing taxonomy/domain mapping. See `INTEGRATION/README.md`. The example TypeScript files there are scaffolding only because the exact local interfaces/constants must match the target codebase.

Only ingest Markdown files with `ingest: true`. In particular, keep `Combined_Networking_Study_Guide.md` out of the index to avoid duplicate concepts competing with the canonical topic files.

Before expanding the corpus, run the smoke questions in `EVALUATION/retrieval_questions.jsonl`. They deliberately test explanatory and procedural retrieval, including NAT/one-way audio and SIP-vs-RTP.

## Corpus design

Each topic file includes YAML front matter with a title, level, tags, and upstream source paths. This makes the files easier to index and chunk. Files are intentionally self-contained; some repetition is deliberate because a RAG system may retrieve only one document at a time.

## A useful mental model

For most troubleshooting, follow a device's path in this order:

```text
Physical link / Wi-Fi
        ↓
Ethernet + VLAN
        ↓
DHCP gives IP / mask / gateway / DNS
        ↓
DNS resolves names
        ↓
Routing selects the next network path
        ↓
Firewall/NAT permits and translates traffic
        ↓
TCP or UDP carries application traffic
        ↓
Application protocol (HTTP, SIP, etc.)
        ↓
Real-time media (RTP/SRTP when applicable)
```

If you can explain that sequence clearly, most beginner network questions become much easier.
