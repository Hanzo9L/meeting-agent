# Knowledge Model

## 1) Source authority model

Authority is declared by source tier before retrieval scoring.

## Tier 1 (authoritative)

### Teams administration

- Logical source id: `ms-teams-admin`
- Acquisition transport: `learn_mcp`
- Canonical namespace: `https://learn.microsoft.com/en-us/microsoftteams/...`
- Purpose: primary Teams admin authority
- Notes: historical GitHub edit coordinates may still appear in metadata, but are not runtime acquisition dependencies

### Teams PowerShell

- Logical source id: `ms-teams-powershell`
- Acquisition transport: `github`
- Repository: `MicrosoftDocs/office-docs-powershell`
- Branch: `main`
- Paths:
  - `teams/docs-conceptual/**/*.md`
  - `teams/teams-ps/MicrosoftTeams/**/*.md`
- Purpose: cmdlet/reference authority

### Microsoft Graph v1.0

- Logical source id: `ms-graph-docs`
- Acquisition transport: `github`
- Repository: `microsoftgraph/microsoft-graph-docs-contrib`
- Branch: `main`
- Purpose: API authority for Teams-adjacent scenarios

### Microsoft Entra

- Logical source id: `ms-entra-docs`
- Acquisition transport: `github`
- Repository: `MicrosoftDocs/entra-docs`
- Branch: `main`
- Purpose: identity/auth/policy dependencies

### Microsoft 365

- Logical source id: `ms-m365-docs`
- Acquisition transport: `github`
- Repository: `MicrosoftDocs/microsoft-365-docs`
- Branch: `public`
- Purpose: tenant-level administration dependencies

## Secondary/specialized

### Teams developer docs

- Logical source id: `ms-teams-dev-docs`
- Acquisition transport: `github`
- Repository: `MicrosoftDocs/msteams-docs`
- Branch: `main`
- Role: developer-platform questions only

## Beta handling

- Beta/preview sources are explicit metadata flags.
- Beta must never silently override GA evidence.

---

## 2) Authority vs relevance separation

Candidate progression evaluates separate signals:

- relevance
- authority tier
- freshness
- domain/product match
- specificity/entity match
- GA vs beta state
- conflict status

Relevance cannot override hard authority/freshness policy.

---

## 3) Canonical document contract

```typescript
interface CanonicalDocument {
  // Source identity
  sourceId: string; // stable logical source id
  sourcePath: string;
  sourceRevision: SourceRevision;
  contentHash: string;
  learnUrl?: string;

  // Authority metadata
  authorityTier: "tier1" | "secondary";
  sourceDomain: "teams_admin" | "teams_powershell" | "graph" | "entra" | "m365" | "teams_dev";
  sourceStatus: "ga" | "beta" | "preview" | "unknown";

  // Preserved Microsoft metadata
  frontMatterRaw: Record<string, unknown>;
  normalizedMeta: {
    title?: string;
    description?: string;
    product?: string;
    service?: string;
    subservice?: string;
    audience?: string;
    topic?: string;
    applicableProducts?: string[];
    documentType?: string;
    author?: string;
    msDate?: string;
    createdDate?: string;
    updatedDate?: string;
    deprecationStatus?: string;
    previewStatus?: string;
  };

  // Structure
  sections: StructuredSection[];
  extractedEntities: ExtractedEntity[];
}

interface StructuredSection {
  sectionId: string;
  headingPath: string[]; // H1->H2->H3
  blocks: StructuredBlock[];
}

type StructuredBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "ordered_list"; items: string[] }
  | { kind: "unordered_list"; items: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "code_block"; language?: string; text: string }
  | { kind: "callout"; level: "note" | "warning" | "important" | "tip"; text: string }
  | { kind: "link"; text: string; href: string };

interface ExtractedEntity {
  type: "cmdlet" | "parameter" | "policy" | "feature" | "api" | "sku" | "unknown";
  value: string;
}

type SourceRevision =
  | {
      transport: "github";
      repository: string;
      branch: string;
      commitSha: string;
      blobSha: string;
      path: string;
    }
  | {
      transport: "learn_mcp";
      canonicalUrl: string;
      locale: string;
      retrievedAt: string;
      contentHash: string;
      lastUpdated?: string;
      documentId?: string;
      sourcePath?: string;
    };
```

Unknown frontmatter keys must be preserved, not discarded.

---

## 4) Semantic chunk model

Primary boundaries:

- document
- H2 section
- H3 subsection
- procedure
- troubleshooting section
- configuration section
- PowerShell syntax/parameter/example groups

Fallback token splitting is allowed only after semantic boundaries are respected.

Must not split:

- code blocks
- cmdlet parameter name from its description
- tightly coupled table rows where row meaning depends on adjacent rows

```typescript
interface KnowledgeChunk {
  chunkId: string;
  documentId: string;
  sectionId: string;
  headingPath: string[];
  chunkKind:
    | "section_summary"
    | "procedure_step_group"
    | "powershell_syntax"
    | "powershell_parameter"
    | "powershell_example"
    | "troubleshooting"
    | "configuration"
    | "table_region"
    | "generic";
  text: string;
  tokenCount: number;
  entities: ExtractedEntity[];
  provenance: {
    sourceId: string;
    sourcePath: string;
    sourceRevision: SourceRevision;
    headingPath: string[];
    blockRange?: [number, number];
  };
}
```

---

## 5) Query intent contract

```typescript
interface QueryIntent {
  originalQuestion: string;
  normalizedQuestion: string;
  domains: Array<"teams_admin" | "teams_powershell" | "graph" | "entra" | "m365" | "teams_dev">;
  products: string[];
  technologies: string[];
  entities: string[];
  commandNames?: string[];
  policyNames?: string[];
  requiresFreshnessCheck: boolean;
  allowsBetaSources: boolean;
  expectedAnswerType:
    | "conceptual"
    | "procedural"
    | "troubleshooting"
    | "configuration"
    | "comparison"
    | "reference";
  retrievalHints: string[];
}
```

### Example A

Question: `How does Teams Direct Routing voice routing work?`

- domains: `teams_admin`, `teams_powershell`
- entities: `Direct Routing`, `voice routing`, `voice route`, `voice routing policy`
- expectedAnswerType: `conceptual` (with procedural hints)
- requiresFreshnessCheck: `false` (unless user asks latest/supported)

### Example B

Question: `How does Conditional Access affect Teams on unmanaged devices?`

- domains: `entra`, `teams_admin`, `m365`
- entities: `Conditional Access`, `unmanaged devices`
- expectedAnswerType: `configuration`
- requiresFreshnessCheck: `true` (policy behavior can change)

### Example C

Question: `What does Set-CsOnlineVoiceRoutingPolicy do?`

- domains: `teams_powershell`
- commandNames: `Set-CsOnlineVoiceRoutingPolicy`
- expectedAnswerType: `reference`
- exact cmdlet/entity match path required

