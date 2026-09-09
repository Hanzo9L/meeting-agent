---
title: "Assign a Calling Plan phone number to a user"
sourceId: "teams_ps_recipes"
documentId: "Recipes__01_assign_phone_number_calling_plan"
ingest: true
format: markdown
license: "Internal. Authored in-house."
level: intermediate
documentType: procedure
primary_command: "Set-CsPhoneNumberAssignment -Identity user@contoso.com -TelephoneNumber +12065551234 -NumberType CallingPlan"
cmdlets: [Connect-MicrosoftTeams, Set-CsPhoneNumberAssignment, Get-CsPhoneNumberAssignment, Get-CsOnlineUser, Get-CsOnlineLisLocation, Remove-CsPhoneNumberAssignment]
modules: [MicrosoftTeams]
tags: [phone-number, calling-plan, assignment, enterprise-voice]
retrievalIntents:
  - "how do I assign a Calling Plan number to a user"
  - "how do I assign a phone number with PowerShell"
  - "Set-CsPhoneNumberAssignment CallingPlan"
  - "assign Teams Phone number to a user"
  - "enable a user for Enterprise Voice with a phone number"
source_basis:
  - "Authored in-house"
  - "https://learn.microsoft.com/en-us/powershell/module/teams/set-csphonenumberassignment"
derivation: "internal"
---

# Assign a Calling Plan phone number to a user

## Command

```powershell
Set-CsPhoneNumberAssignment -Identity user@contoso.com -TelephoneNumber +12065551234 -NumberType CallingPlan
```

## Prerequisites

- Connected Teams PowerShell session (`Connect-MicrosoftTeams`)
- The user exists and is licensed for Teams Phone / Calling Plan as required by the tenant
- The telephone number is an acquired Calling Plan number in the tenant

## Steps

1. Connect if you are not already connected:

   ```powershell
   Connect-MicrosoftTeams
   ```

2. Assign the Calling Plan number. Use E.164 without a `tel:` prefix:

   ```powershell
   Set-CsPhoneNumberAssignment -Identity user@contoso.com -TelephoneNumber +12065551234 -NumberType CallingPlan
   ```

3. Optionally attach an emergency location (LocationId from `Get-CsOnlineLisLocation`):

   ```powershell
   $loc = Get-CsOnlineLisLocation -City Vancouver
   Set-CsPhoneNumberAssignment -Identity user@contoso.com -TelephoneNumber +12065551234 -NumberType CallingPlan -LocationId $loc.LocationId
   ```

4. Verify the assignment:

   ```powershell
   Get-CsPhoneNumberAssignment -AssignedPstnTargetId user@contoso.com
   Get-CsOnlineUser -Identity user@contoso.com | Select-Object UserPrincipalName, LineURI, EnterpriseVoiceEnabled
   ```

## Notes

- Assigning a phone number automatically sets `EnterpriseVoiceEnabled` to True. You do not need a separate enable step for that flag when the number assignment succeeds.
- `NumberType` must match how the number was acquired. `CallingPlan`, `DirectRouting`, and `OperatorConnect` are not interchangeable. A NumberType mismatch is a common failure: the cmdlet rejects a Direct Routing or Operator Connect number if you pass `-NumberType CallingPlan`.
- `TelephoneNumber` supports E.164 (`+12065551234`) and non-E.164 digits (`12065551234`). Do not prefix `tel:`. Direct Routing numbers with extensions use `+1206555000;ext=1234`.
- `-Identity` accepts ObjectId, SIP proxy address, or UserPrincipalName.
- To remove a number from a user or resource account, use `Remove-CsPhoneNumberAssignment`, not a second `Set-CsPhoneNumberAssignment` with an empty number.
- The cmdlet is in Teams PowerShell module 3.0.0 or later.
