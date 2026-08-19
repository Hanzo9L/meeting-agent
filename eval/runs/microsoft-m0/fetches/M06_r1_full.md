# Improve call quality in Microsoft Teams

This article introduces three key tools you can use to monitor, troubleshoot, manage, and improve call quality in Microsoft Teams.

- **Call Quality Dashboard (CQD)**: To analyze org-wide trends or problems, drive improvements to performance
- **Teams admin center**: To analyze call and meeting quality (in-progress and completed) for individual users.
- **Quality of Service (QoS)**: To prioritize important network traffic

## Monitor and troubleshoot call quality

You'll use **Teams admin center** and **Call Quality Dashboard** to find and troubleshoot call and meeting quality problems that come up during ongoing operation. This lets you drive performance improvements across your network.

- **Teams admin center** shows detailed information about the devices, networks, and connectivity related to ***specific calls and meetings*** for each user in Teams. Teams admin and helpdesk agents can use this information to troubleshoot quality and connection problems in specific meetings and calls. To learn more, read [Monitor and troubleshoot Teams meetings and calls](monitor-troubleshoot-teams-meetings-calls).
- **Call Quality Dashboard (CQD)** gives you a ***network-wide view*** of call quality across your organization. Use CQD information to help you identify and fix problems. First, [Set up CQD](turning-on-and-using-call-quality-dashboard). Then read [Manage call and meeting quality in Teams](quality-of-experience-review-guide).

Teams admin center and CQD can be used independently or together. For example, if a communications support specialist determines that they need more help troubleshooting a user's call problem, they escalate the call to a communications support engineer, who has access to additional information about the call. In turn, the communications support engineer alerts a network engineer to a possible site-related issue they noticed in Teams admin center. The network engineer checks CQD to see if an overall site-related issue could be a contributing cause of the user's call problem.

## Participant visibility in call quality tools

If an organization's users join a federated meeting but did not organize the meeting, that organization will only see details for their own users in all call quality tools. This includes the troubleshooting experience in Teams admin center and Call quality dashboard. The organization that organized a federated meeting will see all participants.

## Prioritize important network traffic using QoS

As your users start using Teams for calls and meetings, they may experience a caller's voice breaking up or cutting in and out of a call or meeting. Shared video may freeze or pixelate, or fail altogether. This is due to the IP packets that represent voice and video traffic encountering network congestion and arriving out of sequence or not at all. If this happens (or to prevent it from happening in the first place), use **Quality of Service (QoS)**.

With QoS, you prioritize delay-sensitive network traffic (for example, voice or video streams), allowing it to "cut in line" in front of traffic that is less sensitive (like downloading a new app, where an extra second to download isn't a big deal). QoS identifies and marks all packets in real-time streams using Windows Group Policy Objects and a routing feature called Port-based Access Control Lists, which instructs your network to give voice, video, and screen sharing their own dedicated network bandwidth.

Ideally, you'll implement QoS on your internal network while getting ready to roll out Teams, but you can do it anytime. If you're small enough, you might not need QoS.

When you're ready, read [Implement Quality of Service (QoS) in Microsoft Teams](qos-in-teams).

To use QoS to manage meeting traffic, read [Set how you want to handle real-time media traffic for Teams meetings](meeting-settings-in-teams#set-how-you-want-to-handle-real-time-media-traffic-for-teams-meetings).
