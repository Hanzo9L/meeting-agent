# What is Call Quality Dashboard (CQD)?

The Microsoft Call Quality Dashboard (CQD) - https://cqd.teams.cloud.microsoft - shows call and meeting quality, at an **org-wide level**, for Microsoft Teams, and Skype for Business Server.

The latest version of CQD features a [near-real-time (NRT) data feed](cqd-data-and-reports), which means that call records are typically available in CQD within 30 minutes of the end of a call.

Wherever CQD includes [end-user identifiable information (EUII) data](cqd-data-and-reports#euii-data), it's managed in the same way as [EUII throughout Microsoft 365](/en-us/office365/Enterprise/office-365-data-retention-deletion-and-destruction-overview).

CQD is designed to help Teams admins, Skype for Business admins, and network engineers monitor call and meeting quality at an org-wide level. You can use CQD to help you **optimize your network** to drive performance quality. CQD captures both the individual call experience and the overall quality of calls made using Teams or Skype for Business. With CQD, overall patterns can become apparent, so network engineers can make informed assessments of call quality. CQD provides reports of call quality metrics that give you insight into overall call quality, server-client streams, client-client streams, and voice quality [SLA](https://developer.microsoft.com/microsoft-edge/webview2/).

![Screenshot of Call Quality Dashboard.](media/teams-difference-between-call-analytics-and-call-quality-dashboard-image3.png)

We encourage you to upload building and endpoint information, which lets you use Location-Enhanced Reports to analyze call quality and reliability within a user's building. The data can be assessed to determine if the problem is isolated to a single user or affects a larger segment of users. To turn on building or endpoint-specific views in CQD, an admin must [upload building or endpoint information](cqd-upload-tenant-building-data) in Teams admin center.

![Screenshot of Call Quality Dashboard's Location-Enhanced Reports.](media/teams-difference-between-call-analytics-and-call-quality-dashboard-image4.png)

Don't miss our [Manage call and meeting quality](quality-of-experience-review-guide) article, which offers in-depth guidance for the Teams admin or support engineer responsible for managing service quality in Teams.

## What's New

This section summarizes recent minor changes to the Call Quality Dashboard schema and logic.

### July 2026

- Added support for Public IP values when [managing building metadata files](cqd-upload-tenant-building-data).
- Added **First/Second Public IP** columns to reflect the values used in an active building file.
- Modified logic for the **First/Second Transport Protocol** columns to improve data coverage for web platforms.
- Modified **First/Second User Agent Category** from `Microsoft Teams VDI VMware` to `Microsoft Teams VDI Omnissa`.
- Modified **First/Second User Agent Category** to `Microsoft Teams VDI (VM Screenshare)` for sessions that utilize virtual machine screensharing, as announced in Message Center post MC1387528.

### April 2026

- Revised logic for **First/Second Feedback Rating** to populate "0" when a user submits a Rate My Call survey with no call rating. A "0" value indicates the survey was offered but the user either did not submit the survey or submitted the survey with no call rating.

### February 2026

- Revised logic for **Meeting Id** to align the value with the numeric Meeting Id found in Teams meeting invites. This change was announced in Message Center post MC1183608.
- Added **Thread Id** column to allow searching for meetings by the value that was previously populated under Meeting Id.

### January 2026

- Added **First/Second Is Call Throttled** and **Avg First/Second Is Call Throttled** columns to indicate when media quality may be affected by device CPU throttling.
- Added **First/Second HW Encoder Blocked** and **First/Second HW Decoder Blocked** columns to indicate when media quality may be affected by blocked hardware drivers.

### December 2025

- Revised logic for the **Total Stream Duration (Minutes)** calculation to ensure it reflects the correct endpoint's stream duration.
- Revised logic for **First/Second Video Duration** columns to improve accuracy when one endpoint does not report a video duration value.

### October 2025

- Rolled out a new interface in Teams Admin Center for [managing building and endpoint metadata files](cqd-upload-tenant-building-data) for call quality reporting.
- Revised logic for **First/Second User Agent Category** to reflect the Amazon Workspaces VDI platform.

## Use Power BI to analyze CQD data

[Download Power BI query templates for CQD](https://download.microsoft.com/download/f/b/f/fbf2527c-f392-410e-aeb6-1a02ac1b5dd1/CQD-Power-BI-query-templates.zip). Use customizable Power BI templates to analyze and report your CQD data.

For more information, see [Use Power BI to analyze CQD data](cqd-power-bi-query-templates).
