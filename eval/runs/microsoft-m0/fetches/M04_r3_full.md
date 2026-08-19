# Overview and configuration of voice and face enrollment

Voice and face enrollment is a feature in Microsoft Teams that allows users to create a voice and face profile. A user can opt in to enroll their voice either from the Recognition settings or through the user prompts to begin automatically generating their voice profile based on the user’s in-meeting speech.

Voice and face enrollment is used to improve the audio quality and user experience of Teams meetings and calls. This feature helps to reduce background noise and secondary speakers and provides speaker attribution and Microsoft Copilot accuracy in meeting rooms equipped with Microsoft Teams Rooms devices. Admins and security teams can manage and control this feature and ensure for which user the enrollment and usage of the profile are turned on.

Users have full control over their voice and face data. They can choose to opt in or opt out of enrollment at any time through their desktop client. If admins disable enrollment after the user enrolled, the user will still have the ability to opt out after. See [Create your Microsoft Teams recognition profile](https://support.microsoft.com/office/create-recognition-profiles-for-microsoft-intelliframe-f0084478-52a7-4c52-bcdc-9063ed0e0bc0).

This article covers:

- Enrollment process: Users can use the enrollment process to get started.
- Data handling: The duration that Microsoft Teams stores and processes the voice and face data of users.
- Data retention: The duration that Microsoft Teams keeps the voice and face profiles of users.
- Admin settings: Admins can turn on or off voice and face enrollment for specific users, groups of users, or the whole organization. They can configure the feature using PowerShell.
- Data export: Data export is managed directly by end users.
- Frequently asked questions: Common questions and answers.

By providing detailed information on how Microsoft Teams stores and handles user data, this article aims to ensure peace of mind and control for IT admins, security teams, and legal teams.

Note

Microsoft doesn't use the voice and face profiles of users to train any models or for any other purposes other than providing the voice and face enrollment feature in Microsoft Teams.

## Enrollment process

If the policy for enrollment is enabled, for users who are already enrolled, they can update their voice and face profile using the Teams Desktop app to make their experience even better.

In the Teams app, go to **Setting** &gt; **Recognition** to opt in allow the Teams app to automatically capture and update their voice profile via their in-meeting speech. Generating a voice profile using in-meeting speech typically takes a couple of meetings. If the user needs to generate their voice profile more quickly, they have the option to manually enroll their voice after they opt-in.

Users can delete their voice and face profile at any time using the Teams desktop app, even if the policy for enrollment is turned off after they enrolled.

### Supported languages for enrollment

The language of the Teams app that is installed determines the voice enrollment languages. These are the localized versions that are available:

- en-us
- en-gb
- en-ca
- en-in
- en-au
- en-nz
- ar-sa
- da-dk
- de-de
- es-es
- es-mx
- fi-fi
- fr-ca
- fr-fr
- it-it
- ja-jp
- ko-kr
- nb-no
- nl-nl
- pl-pl
- pt-br
- ru-ru
- sv-se
- zh-cn
- zh-tw

Note

There's no language requirement for face enrollment.

Important

If the language you're looking for isn't supported for enrolling your voice, Microsoft is currently exploring fallback options.

## Data handling

When a user is enrolled in the feature and has an active Teams account, Microsoft, on behalf of the user’s organization, retains their voice and face profiles in accordance with the following retention policies. The user’s voice and face profile is removed right away if the user unenrolls from the feature. If the organization deletes the user’s Teams account, the user’s voice and face profile is removed within 90 days of the Teams account being deleted. In addition, a voice and face profile that isn't used for one year is removed automatically. Once a voice or face profile has been removed, the user has to enroll again if they want to use the features.

If users enroll their voice or face profile, they can always choose to unenroll it later, even if their organization no longer allows enrollment in the feature through a policy setting.

When a user also uses Voice Isolation on their device, a local copy of the voice profile is stored encrypted. This copy of the voice profile expires after 14 days and is replaced with a new copy of the voice profile. If users leave the organization, the customer data is deleted accordingly with the customer's data retention policy.

## Data retention

When a user is enrolled in the feature and has an active Teams account, Microsoft, on behalf of the user’s organization, retains their voice and face profiles in accordance with the following retention policies. The user’s voice and face profile is removed right away if the user unenrolls from the feature. If the organization deletes the user’s Teams account, the user’s voice and face profile is removed within 90 days of the Teams account being deleted. In addition, a voice and face profile that isn't used for one year is removed automatically. Once a voice or face profile has been removed, the user has to enroll again if they want to use the features.

If users enroll their voice or face profile, they can always choose to unenroll it later, even if their organization no longer allows enrollment in the feature through a policy setting.

When a user also uses Voice Isolation on their device, a local copy of the voice profile is stored encrypted. This copy of the voice profile expires after 14 days and is replaced with a new copy of the voice profile.

If users leave the organization, the customer data is deleted accordingly with the customer's data retention policy.

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

## Data export

Data exports are available only to the enrolled user. They can follow these steps to export their data:

- Go to **Settings** &gt; **Recognition**
- Select Export to download your voice or face data. The data is saved directly to your device's Downloads folder

*Exporting your voice profile*

- For users enrolling their voice profile manually via the Recognition settings, an audio recording will be available for exporting after enrollment is complete.
- For users enrolling their voice profile via Express enrollment, an audio recording is not retained as this process is continuous. The export button will not be available next to your Voice profile after the user is enrolled.

*Exporting your face profile*

- For users enrolling their face profile manually via the Recognition settings, the user’s images captured to generate the face profile will be available for exporting after enrollment is complete.

## Teams Admin Center management

Admins can now use **Teams Admin Center (TAC)** to view end-user **voice and face enrollment status** and manage enrolled data directly from the admin experience.

This new experience helps admins better understand readiness for features that depend on enrollment, such as:

- **Speaker attribution**
- **Voice isolation**
- **Face-based room experiences**

Admins can also **delete end-user voice and face enrollment data directly from TAC**. If enrollment data is deleted, the user must complete enrollment again to continue using features that rely on that profile data.

Admins **can’t export end-user voice or face enrollment data from TAC**. Export of enrollment data remains under the **end user’s control** and within the user experience.

This capability does **not change default enrollment behavior**. Existing policies and end-user controls for voice and face enrollment remain the same.

## Frequently asked questions

**Question:** Regarding the user's voice enrollments, where do you store the data?**Answer:** Voice data is stored in the Office 365 trusted compliance store.

**Question:** Can both users and admins control the data being saved?**Answer:** Only the end user is able to export their data. Users are able to opt out to unenroll and remove their profile from the Teams app.

**Question:** For how long do you keep the data?**Answer:** The retention policy is one year. User's data is deleted if it isn't used for one year.

**Question:** How is data stored and processed for cross tenants?

**Answer:** We don't support getting data cross-tenant. We only retrieve data for their tenant only.

**Question:** Are voice and face enrollments available in GCCH and DOD?

**Answer:** No, voice and face enrollments are currently available only up to GCC and aren't available in GCCH or DOD environments.

**Question:** Can admins download end users' voice and face data?

**Answer:** No, data export is managed directly by end users. Admins don't have access to export voice and face data, giving users full control over their profiles.

**Question:** Can admins manage voice and face enrollment data in Teams Admin Center?

**Answer:** Yes. Admins can now use **Teams Admin Center** to view enrollment status and delete end-user **voice and face enrollment data** directly from TAC. If a profile is deleted, the user will need to re-enroll to continue using experiences that depend on it.

**Question:** Can admins export end-user voice or face enrollment data from TAC?

**Answer:** No. Admins can’t export end-user voice or face enrollment data from TAC. Export capability remains with the **end user**.

**Question:** Why does voice enrollment fail with errors like “Couldn't capture your voice”?

**Answer:** This can be caused by network restrictions blocking required Microsoft speech service endpoints. Ensure the following endpoint is allow-listed:

- `*.speech.microsoft.com`

For more information, see [Microsoft 365 URLs and IP address ranges](/en-us/microsoft-365/enterprise/urls-and-ip-address-ranges?view=o365-worldwide).
