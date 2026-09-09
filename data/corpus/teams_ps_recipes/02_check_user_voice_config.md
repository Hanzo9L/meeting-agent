---
title: "Check a user's voice configuration"
sourceId: "teams_ps_recipes"
documentId: "Recipes__02_check_user_voice_config"
ingest: true
format: markdown
license: "Internal. Authored in-house."
level: intermediate
documentType: procedure
primary_command: "Get-CsOnlineUser -Identity user@contoso.com"
cmdlets: [Connect-MicrosoftTeams, Get-CsOnlineUser, Get-CsUserPolicyAssignment, Get-CsPhoneNumberAssignment]
modules: [MicrosoftTeams]
tags: [get-csonlineuser, voice, lineuri, policies]
retrievalIntents:
  - "how do I check a user's voice configuration"
  - "how do I see what phone number a user has"
  - "what policies does this user have"
  - "check if a user is voice enabled"
  - "get user Teams phone settings"
source_basis:
  - "Authored in-house"
  - "https://learn.microsoft.com/en-us/powershell/module/teams/get-csonlineuser"
derivation: "internal"
---

# Check a user's voice configuration

## Command

```powershell
Get-CsOnlineUser -Identity user@contoso.com
```

## Prerequisites

- Connected Teams PowerShell session (`Connect-MicrosoftTeams`)

## Steps

1. Connect:

   ```powershell
   Connect-MicrosoftTeams
   ```

2. Get the full user object:

   ```powershell
   Get-CsOnlineUser -Identity user@contoso.com
   ```

3. For assigned policies specifically:

   ```powershell
   Get-CsUserPolicyAssignment -Identity user@contoso.com
   ```

4. For the assigned phone number:

   ```powershell
   Get-CsPhoneNumberAssignment -AssignedPstnTargetId user@contoso.com
   ```

## Notes

Key fields on `Get-CsOnlineUser`:

- `LineUri` — the assigned phone number
- `EnterpriseVoiceEnabled` — must be True for calling to work
- `HostingProvider` — must be `sipfed.online.lync.com` for cloud users
- `OnlineVoiceRoutingPolicy` — for Operator Connect / Calling Plan users, often blank
- `TeamsUpgradeEffectiveMode` — should be `TeamsOnly`

- Use `-ResultSize` to page large tenants: `Get-CsOnlineUser -ResultSize 100`
- `LineUri` format is `tel:+E164`; if blank, no number is assigned
