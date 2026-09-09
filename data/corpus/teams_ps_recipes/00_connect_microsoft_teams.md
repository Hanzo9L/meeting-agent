---
title: "Connect to Microsoft Teams PowerShell"
sourceId: "teams_ps_recipes"
documentId: "Recipes__00_connect_microsoft_teams"
ingest: true
format: markdown
license: "Internal. Authored in-house."
level: intermediate
documentType: procedure
primary_command: "Connect-MicrosoftTeams"
cmdlets: [Install-Module, Import-Module, Connect-MicrosoftTeams, Get-CsOnlineUser, Disconnect-MicrosoftTeams]
modules: [MicrosoftTeams]
tags: [connect, login, authenticate, powershell, module]
retrievalIntents:
  - "how do I connect to Microsoft Teams PowerShell"
  - "what is the command to log into Microsoft Teams online"
  - "sign in to Teams PowerShell module"
  - "how do I log into Teams PowerShell"
  - "connect to teams powershell"
  - "authenticate to Microsoft Teams"
source_basis:
  - "Authored in-house"
  - "https://learn.microsoft.com/en-us/powershell/module/teams/connect-microsoftteams"
derivation: "internal"
---

# Connect to Microsoft Teams PowerShell

## Command

`Connect-MicrosoftTeams`

## Prerequisites

- Windows PowerShell 5.1 or PowerShell 7
- Permission to install the MicrosoftTeams module, or the module already installed

## Steps

1. Install the module if it is not already present:

   ```powershell
   Install-Module MicrosoftTeams
   ```

2. Connect (modern auth; a browser or device-code prompt appears for interactive sign-in):

   ```powershell
   Connect-MicrosoftTeams
   ```

3. Verify the session can query the tenant:

   ```powershell
   Get-CsOnlineUser -ResultSize 1
   ```

## Notes

- Modern auth is the default. Interactive MFA accounts do not need `-Credential`.
- For automation or service accounts, acquire a token first and pass it with `-AccessTokens`.
- The session stays connected until you run `Disconnect-MicrosoftTeams` or close the shell.
- If cmdlets are "not recognized", import the module: `Import-Module MicrosoftTeams`.
