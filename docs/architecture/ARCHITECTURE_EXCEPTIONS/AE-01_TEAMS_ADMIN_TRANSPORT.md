# AE-01: Teams Admin Source Transport Pivot

## Status

Accepted architecture exception.

## Trigger

WB-06 live synchronization validation showed that the historical Teams Admin GitHub coordinates no longer provide a reliable public acquisition path in the current runtime environment.

## Conflicting assumption

The architecture had implicitly assumed that all authoritative sources (including Teams Admin) were publicly synchronizable as Git repositories.

## Evidence

1. GitHub REST branch-resolution for historical Teams Admin source returned 404 in live smoke tests.
2. Alternate repository coordinates from page metadata also did not provide a stable public runtime acquisition path.
3. Teams PowerShell GitHub source remained accessible and synchronized successfully, isolating the issue to source transport assumptions rather than sync framework structure.
4. Microsoft Learn MCP is publicly documented as a supported mechanism for dynamic tool discovery, documentation search, and full article Markdown fetch.

## Decision

Separate **source identity/authority** from **source acquisition transport**.

- Source identity and authority policies remain unchanged.
- Acquisition transport is now explicit and transport-specific.
- Supported transports in this phase:
  - `github`
  - `learn_mcp`

## Source-specific outcome

- `ms-teams-admin` remains Tier-1 authority for Teams admin semantics.
- `ms-teams-admin` acquisition transport changes to `learn_mcp`.
- `ms-teams-powershell` remains Tier-1 GitHub-backed source.

## Contract impact

1. Source registry supports transport-specific acquisition configuration.
2. Provenance/revision identity is transport-aware:
   - GitHub: repository/branch/commit/blob/path
   - Learn MCP: canonical URL/retrievedAt/contentHash/(optional update metadata)
3. A Source Acquisition Coordinator chooses transport adapters by source config.
4. Parser/indexing stages consume a transport-neutral acquisition result.

## Constraints

- No parser/index/embedding/retrieval implementation is introduced by AE-01.
- Legacy production behavior remains unchanged.
- GitHub sync adapter remains valid for GitHub-backed sources.

## Revisit conditions

Revisit if Microsoft restores a stable publicly readable Teams Admin Git repository that is contractually suitable for runtime acquisition and maintenance.

