---
title: "Assign a Teams calling policy to a user"
sourceId: "teams_ps_recipes"
documentId: "Recipes__03_assign_calling_policy"
ingest: true
format: markdown
license: "Internal. Authored in-house."
level: intermediate
documentType: procedure
primary_command: "Grant-CsTeamsCallingPolicy -Identity user@contoso.com -PolicyName PolicyName"
cmdlets: [Connect-MicrosoftTeams, Get-CsTeamsCallingPolicy, Get-CsUserPolicyAssignment, Grant-CsTeamsCallingPolicy]
modules: [MicrosoftTeams]
tags: [calling-policy, grant, grant-csteamscallingpolicy]
retrievalIntents:
  - "how do I assign a calling policy to a user"
  - "how do I change a user's calling policy"
  - "grant calling policy powershell"
  - "set teams calling policy for user"
source_basis:
  - "Authored in-house"
  - "https://learn.microsoft.com/en-us/powershell/module/teams/grant-csteamscallingpolicy"
derivation: "internal"
---

# Assign a Teams calling policy to a user

## Command

```powershell
Grant-CsTeamsCallingPolicy -Identity user@contoso.com -PolicyName PolicyName
```

## Prerequisites

- Connected Teams PowerShell session (`Connect-MicrosoftTeams`)
- The calling policy already exists in the tenant

## Steps

1. Connect:

   ```powershell
   Connect-MicrosoftTeams
   ```

2. List available policies:

   ```powershell
   Get-CsTeamsCallingPolicy
   ```

3. Check the current assignment:

   ```powershell
   Get-CsUserPolicyAssignment -Identity user@contoso.com
   ```

4. Assign:

   ```powershell
   Grant-CsTeamsCallingPolicy -Identity user@contoso.com -PolicyName "AllowCalling"
   ```

5. To revert to the global policy:

   ```powershell
   Grant-CsTeamsCallingPolicy -Identity user@contoso.com -PolicyName $null
   ```

## Notes

- Policy changes usually propagate within minutes but can take up to an hour.
- The global policy applies to all users without an explicit assignment.
- List policy names with `Get-CsTeamsCallingPolicy | Select-Object Identity`.
