# Manage - Voice applications policies

This article is for IT pros and administrators who want to delegate auto attendant and call queue change capabilities to users in their organization.

As an administrator, you create and assign voice applications policies to authorized users. Voice applications policies control what configuration changes an authorized user can make to the auto attendants and call queues they're authorized for.

Before creating and assigning policies, read [Plan for authorized users](aa-cq-plan-authorized-users) for licensing information and [Set up authorized users](aa-cq-setup-authorized-users). Some configuration capabilities require a Teams Premium license.

You can manage voice applications policies by using the [Teams admin center](https://go.microsoft.com/fwlink/p/?linkid=2066851) or with PowerShell to create and assign custom policies. Users in your organization automatically get the global policy unless you create and assign a custom policy.

To manage voice applications policies with PowerShell, use the following PowerShell cmdlets:

- [Set-CsTeamsVoiceApplicationsPolicy](/en-us/powershell/module/teams/set-csteamsvoiceapplicationspolicy):
    - Update Teams voice applications policy settings.
- [Get-CsTeamsVoiceApplicationsPolicy](/en-us/powershell/module/teams/get-csteamsvoiceapplicationspolicy):
    - Retrieve Teams voice applications policy information.
- [Grant-CsTeamsVoiceApplicationsPolicy](/en-us/powershell/module/teams/grant-csteamsvoiceapplicationspolicy):
    - Assign a Teams voice applications policy to one or more users.
- [New-CsTeamsVoiceApplicationsPolicy](/en-us/powershell/module/teams/new-csteamsvoiceapplicationspolicy):
    - Create a new Teams voice applications policy.
- [Remove-CsTeamsVoiceApplicationsPolicy](/en-us/powershell/module/teams/remove-csteamsvoiceapplicationspolicy):
    - Delete an existing Teams voice applications policy.

Important

The global, org-wide default policy disables all configuration change capabilities for all users. This policy shouldn't be changed.

You must create and assign custom policies to allow authorized users to make configuration changes to auto attendants and call queues.

Best practice: The custom policy assigned to a user should provide the minimum levels of permissions the user needs to perform their job.

## Create a custom voice applications policy

Create custom policies that reflect the configuration changes you want to allow authorized users to make to auto attendants and call queues.

1. In the left navigation of the [Teams admin center](https://go.microsoft.com/fwlink/p/?linkid=2066851), go to **Voice** &gt; **Voice applications policies**.
2. Select **Add**.
3. Enter a name and description for the policy.
4. From here, choose the settings you want to allow your authorized users to configure.

    Note

    Choose the policy name and description carefully, as they can't be changed later.
5. Select **Save**.

## Edit a custom voice applications policy

You can edit any custom voice applications policies you create.

1. In the left navigation of the [Teams admin center](https://go.microsoft.com/fwlink/p/?linkid=2066851), go to **Voice** &gt; **Voice applications policies**.
2. Select the option to the left of the policy name, and then select **Edit**.
3. Change the settings you want to allow your authorized users to configure.
4. Select **Save**.

Note

It's not possible to change the name or description of the policy.

## Assign a custom voice applications policy to users

To individually assign a custom voice applications policy to users, you can use the Teams admin center or the [Grant-CsTeamsVoiceApplicationsPolicy](/en-us/powershell/module/teams/grant-csteamsvoiceapplicationspolicy) cmdlet.

In addition to creating and assigning a voice applications policy to users, a user must also be assigned as an [authorized user](aa-cq-setup-authorized-users) to at least one auto attendant or call queue.

A user must be an authorized user to at least one auto attendant or call queue, and must have a voice applications policy assigned, to perform the actions described in Voice applications policy settings.

To learn more about the different ways that you can assign policies to users, see [Assign policies to your users in Teams](policy-assignment-overview).

## Voice applications policy settings

Voice applications policies control the configuration changes and actions an authorized user can make to the auto attendants and call queues they're authorized for. In addition, they also control which real-time and historical reports authorized users have access to. The following settings are available:

### Auto attendants - Features

| Teams voice applications policy setting | Description | PowerShell parameter | Teams Premium required^1^ |
| --- | --- | --- | --- |
| Business hours greeting | This setting allows authorized users to change the Business Hours Greeting. | AllowAutoAttendantBusinessHoursGreetingChange | No, Generally Available |
| After hours greeting | This setting allows authorized users to change the After Hours Greeting. | AllowAutoAttendantAfterHoursGreetingChange | No, Generally Available |
| Holiday greeting | This setting allows authorized users to change the Holiday Greeting. | AllowAutoAttendantHolidayGreetingChange | No, Generally Available |
| Time zone | This setting allows authorized users to change the Time zone. | AllowAutoAttendantTimeZoneChange | Yes^3^ |
| Language | This setting allows authorized users to change the Language. | AllowAutoAttendantLanguageChange | Yes^3^ |
| Business hours | This setting allows authorized users to change the auto attendant business hours schedule. | AllowAutoAttendantBusinessHoursChange | Yes |
| Holiday dates and hours | This setting allows authorized users to change the auto attendant holiday schedule.^2^ | AllowAutoAttendantHolidaysChange | Yes^2^ |
| Business hours call routing | This setting allows authorized users to change the auto attendant business hours call flow. | AllowAutoAttendantBusinessHoursRoutingChange | Yes |
| After hours call routing | This setting allows authorized users to change the auto attendant after hours call flow. | AllowAutoAttendantAfterHoursRoutingChange | Yes |
| Holiday hours call routing | This setting allows authorized users to change the auto attendant holiday call flow. | AllowAutoAttendantHolidayRoutingChange | Yes |

**Notes**

1. Authorized users require a Teams Premium license to access this functionality.
2. To change the holiday schedule, the authorized user must be authorized for all auto attendants that reference the holiday.
3. This option isn't currently available for authorized users.

### Auto attendants - Reporting

| Teams voice applications policy setting | Description | PowerShell parameter | Teams Premium required^1^ |
| --- | --- | --- | --- |
| Real-time auto attendant metrics | This setting allows authorized users to access real-time auto attendant metrics. | RealTimeAutoAttendantMetricsPermission | Yes |
| Historical auto attendant metrics | This setting allows authorized users to access historical auto attendant metrics in Power BI and Queues App. | HistoricalAutoAttendantMetricsPermission | Power BI - No, Generally AvailableQueues App - Yes |

Reporting values:

- **None** - no access to any metrics.
- **AuthorizedOnly** - the authorized user only sees metrics for the auto attendants, call queues, and associated representatives (agents) they're authorized for.
- **All** - the authorized user sees metrics for all auto attendants, call queues, and representatives.

Important

The **All** value for real-time auto attendant metrics is no longer supported.

**Notes**

1. Authorized users require a Teams Premium license and Queues App to access this functionality.

### Call queues - Features

| Teams voice applications policy setting | Description | PowerShell parameter | Teams Premium required^1^ |
| --- | --- | --- | --- |
| Welcome greeting | This setting allows authorized users to change the Welcome Greeting. | AllowCallQueueWelcomeGreetingChange | No, Generally Available |
| Music on Hold | This setting allows authorized users to change the Music on Hold. | AllowCallQueueMusicOnHoldChange | No, Generally Available |
| Shared voicemail greeting for call overflow | This setting allows authorized users to change the Overflow Shared Voicemail Greeting. | AllowCallQueueOverflowSharedVoicemailGreetingChange | No, Generally Available |
| Shared voicemail greeting for call timeout | This setting allows authorized users to change the Timeout Shared Voicemail Greeting. | AllowCallQueueTimeoutSharedVoicemailGreetingChange | No, Generally Available |
| Shared voicemail greeting for no agents | This setting allows authorized users to change the No Agents Shared Voicemail Greeting. | AllowCallQueueNoAgentSharedVoicemailGreetingChange | Yes |
| Language | This setting allows authorized users to change the Language. | AllowCallQueueLanguageChange | Yes^4^ |
| Membership | This setting allows authorized users to change the representatives who are part of the call queue. | AllowCallQueueMembershipChange | Yes^2,3^ |
| Conference mode | This setting allows authorized users to change the call queue conference mode setting. | AllowCallQueueConferenceModeChange | Yes^4^ |
| Agent routing method | This setting allows authorized users to change the call queue representative routing (selection) method. | AllowCallQueueRoutingMethodChange | Yes |
| Presence-based routing | This setting allows authorized users to change the call queue presence-based routing setting. | AllowCallQueuePresenceBasedRoutingChange | Yes |
| Opt out (queue configuration) | This setting allows authorized users to change the call queue opt-out setting. | AllowCallQueueOptOutChange | Yes |
| Routing for call overflow | This setting allows authorized users to change the call queue overflow handling. | AllowCallQueueOverflowRoutingChange | Yes |
| Routing for call timeout | This setting allows authorized users to change the call queue timeout handling. | AllowCallQueueTimeoutRoutingChange | Yes |
| Routing for no agents | This setting allows authorized users to change the call queue No Agents handling. | AllowCallQueueNoAgentsRoutingChange | Yes |

**Notes**

1. Authorized users require a Teams Premium license to access this functionality.
2. If the call queue uses a distribution list, Microsoft 365 Group, Microsoft Teams channel, or Microsoft Shifts, the owner can add or remove representatives without a Teams Premium license or Queues App.
3. Authorized users aren't able to add or remove a Teams channel or Shift.
4. This option isn't currently available for authorized users.

### Call queues - Agent actions

| Teams voice applications policy setting | Description | PowerShell parameter | Teams Premium required^1^ |
| --- | --- | --- | --- |
| Opt agent in/out of queue | This setting allows authorized users to change a representative's opt-in status. | AllowCallQueueAgentOptChange | Yes |
| Agent monitor mode | This setting allows authorized users to monitor a representative's inbound call queue calls.^2,3,4^ | CallQueueAgentMonitorMode | Yes |
| Agent monitor notification mode | This setting controls if representatives are notified that they're being monitored. | CallQueueAgentMonitorNotificationMode | Yes |

Agent monitor mode values:

- **Off** (default) - The authorized user can't monitor a representative.
- **Monitor** - The authorized user can monitor (listen only) a representative and listen to their call queue calls.
- **Whisper** - The authorized user can monitor and whisper to a representative on a call queue call. Only the representative hears what the authorized user says.
- **Barge** - The authorized user can monitor, whisper, and barge into a representative's call queue call.
- **Takeover** - The authorized user can monitor, whisper, barge into, and take over a representative's call queue call.

Agent monitor notification mode values:

- **Off** (default) - The representative isn't notified that they're being monitored.
- **Agent** - The representative is notified that they're being monitored.

**Notes**

1. The authorized user requires a Teams Premium license and Queues App to access this functionality.
2. Under *Call answering*, the call queue must have **Conference mode** enabled.
3. Under *Agent selection*, the call queue must have **Presence-based** routing enabled.
4. If the authorized user is also a member in the call queue, they must be opted out in order to monitor.

### Call queues - Reporting

| Teams voice applications policy setting | Description | PowerShell parameter | Teams Premium required^1^ |
| --- | --- | --- | --- |
| Real-time call queue metrics | This setting allows authorized users to access real-time call queue metrics. | RealTimeQueueMetricsPermission | Yes |
| Real-time agent metrics | This setting allows authorized users to access real-time call queue representative metrics. | RealTimeAgentMetricsPermission | Yes |
| Historical call queue metrics | This setting allows authorized users to access historical call queue metrics in Power BI and Queues App. | HistoricalQueueMetricsPermission | Power BI - No, Generally AvailableQueues App - Yes^1^ |
| Historical agent metrics | This setting allows authorized users to access historical call queue representative metrics in Power BI and Queues App. | HistoricalAgentMetricsPermission | Power BI - No, Generally AvailableQueues App - Yes^1^ |

Reporting values:

- **None** - no access to any metrics.
- **AuthorizedOnly** - the authorized user only sees metrics for the auto attendants, call queues, and associated representatives they're authorized for.
- **All** - the authorized user sees metrics for all auto attendants, call queues, and associated representatives configured in the tenant.

Important

The **All** value for real-time call queue and real-time representative metrics is no longer supported.

**Notes**

1. The authorized user requires a Teams Premium license and Queues App to access this functionality.
