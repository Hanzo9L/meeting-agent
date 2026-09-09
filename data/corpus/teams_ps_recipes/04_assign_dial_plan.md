---
title: "Assign a dial plan to a user"
sourceId: "teams_ps_recipes"
documentId: "Recipes__04_assign_dial_plan"
ingest: true
format: markdown
license: "Internal. Authored in-house."
level: intermediate
documentType: procedure
primary_command: "Grant-CsTenantDialPlan -Identity user@contoso.com -PolicyName DialPlanName"
cmdlets: [Connect-MicrosoftTeams, Get-CsTenantDialPlan, Get-CsEffectiveTenantDialPlan, Grant-CsTenantDialPlan, Test-CsEffectiveTenantDialPlan]
modules: [MicrosoftTeams]
tags: [dial-plan, normalization, grant-cstenantdialplan]
retrievalIntents:
  - "how do I assign a dial plan to a user"
  - "grant dial plan powershell"
  - "set user dial plan teams"
  - "how do I change a user's dial plan"
  - "why isn't my user's number normalizing correctly"
source_basis:
  - "Authored in-house"
  - "https://learn.microsoft.com/en-us/powershell/module/teams/grant-cstenantdialplan"
derivation: "internal"
---

# Assign a dial plan to a user

## Command

```powershell
Grant-CsTenantDialPlan -Identity user@contoso.com -PolicyName DialPlanName
```

## Prerequisites

- Connected Teams PowerShell session (`Connect-MicrosoftTeams`)
- The tenant dial plan already exists

## Steps

1. Connect:

   ```powershell
   Connect-MicrosoftTeams
   ```

2. List available dial plans:

   ```powershell
   Get-CsTenantDialPlan
   ```

3. Check the effective dial plan:

   ```powershell
   Get-CsEffectiveTenantDialPlan -Identity user@contoso.com
   ```

4. Assign:

   ```powershell
   Grant-CsTenantDialPlan -Identity user@contoso.com -PolicyName "DP-US-Seattle"
   ```

5. Test normalization:

   ```powershell
   Test-CsEffectiveTenantDialPlan -DialedNumber +12065551234 -Identity user@contoso.com
   ```

## Notes

- Dial plans control number normalization before routing.
- If there is no explicit assignment, the tenant-level dial plan applies.
- `Test-CsEffectiveTenantDialPlan` shows the merged rules the user actually gets.
- Normalization rules run in order; the first match wins.
