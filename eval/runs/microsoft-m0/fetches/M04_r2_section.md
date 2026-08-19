## Admin settings

### End User Enrollment

Connect to PowerShell and ensure you're running the latest version. For detailed instructions and the update command, refer to the [Install Microsoft Teams PowerShell](/en-us/microsoftteams/teams-powershell-install) article.

Admins can manage voice and face enrollment using the `CsTeamsAIPolicy`. This policy is accessible exclusively via Microsoft PowerShell and replaces the previous `EnrollUserOverride` setting in `CsTeamsMeetingPolicy`.

The new policy includes three distinct settings which are enabled by default:

| Parameter | Description |
| --- | --- |
| EnrollVoice | Allows users to manually create and manage their voice profiles via the Recognition settings for speaker identification, transcription, and voice isolation. |
| EnrollFace | Allows users to manually create and manage their face profiles via their Recognition settings for facial identification in meetings using supported cameras. |
| PassiveVoiceEnrollment | Allows users to create their voice profiles via Express enrollment for speaker identification, transcription, and voice isolation. |

Admins can turn on or off voice and face enrollment for specific users or groups using the Teams AI Policy. By default, voice and face enrollment is enabled for all users in the organization. Admins can change the states of these parameters using PowerShell. Organizations with any of the above parameters enabled means the corresponding functionality is made accessible for the user. **Users will still need to opt in after the feature is available to begin enrolling their voice and face profile.** See [Set-CsTeamsAIPolicy](/en-us/powershell/module/microsoftteams/set-csteamsaipolicy) and [New-CsTeamsAIPolicy](/en-us/powershell/module/microsoftteams/new-csteamsaipolicy) for specific guidance on policy creation and assignment.

#### Examples

To only enable manual voice and face enrollment from the Recognition settings and apply to all users in your organization:

```Powershell
Set-CsTeamsAIPolicy -Identity Global -EnrollVoice Enabled -EnrollFace Enabled
```

To enable express voice enrollment from the Recognition settings and apply to all users in your organization:

```Powershell
Set-CsTeamsAIPolicy -Identity Global -PassiveVoiceEnrollment Enabled
```

To disable manual voice and face enrollment for specific users, admins can create and assign a custom meeting policy to the users:

```Powershell
New-CsTeamsAIPolicy -Identity DisableEnrollment -EnrollVoice Disabled -EnrollFace Disabled
Grant-CsTeamsAIPolicy -Identity DisableEnrollment -Identity testuser@test.onmicrosoft.com 
```

For detailed guidance on how to configure and manage these settings, including more parameters and examples, see the [Set-CsTeamsAIPolicy (MicrosoftTeamsPowerShell)](/en-us/powershell/module/teams/set-csteamsaipolicy) documentation.

Note

The `CsTeamsAIPolicy` also includes the configuration for Voice Isolation `-VoiceIsolation`. Learn more in [Manage voice isolation](/en-us/microsoftteams/voice-isolation).

### Meeting Room Recognition

To provide granular controls for IT administrators, there is a separate configuration to allow Teams Rooms to utilize user biometric profiles to identify who is in a meeting room. See [Enable People Recognition on Teams Rooms](/en-us/MicrosoftTeams/rooms/teams-rooms-people-recognition) to learn how to enable recognition.
