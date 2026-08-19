# Microsoft 365 Copilot data and compliance readiness

Copilot operates within your Office 365 trust boundary. That means your data stays your data. Microsoft will never use your files or communications with Copilot to train models or share with other customers. And we don't sell your information to advertisers. Copilot also builds on the work you've already done to secure your environment, whether that's SharePoint, email, Teams, or OneDrive. Use built-in Microsoft controls in SharePoint, Purview, and any third-party apps you have to protect your organization's data. For more information, see [Architecture diagrams of Microsoft 365 data protection features that affect Microsoft 365 Copilot](microsoft-365-copilot-architecture-data-protection-auditing).

Note

Documents using legacy Information Rights Management (IRM) are not used in Copilot grounding. If your users are using IRM document protection, they should use sensitivity labeling in Copilot Purview to protect documents and prevent oversharing.

## Microsoft SharePoint

To ensure responses provided by Microsoft 365 Copilot are appropriate, accurate, and compliant, as your organization's admin, it's crucial for you to ensure that your organization's data is protected and appropriately governed. You can use the steps below in SharePoint to help govern your organization's data effectively:

1. Reduce accidental oversharing with SharePoint sharing settings
2. Ensure all sites have valid owners
3. Clean up unused sites
4. Identify sites with potentially overshared content
5. Control access to content
6. Take proactive measures on business-critical sites

For more information, see [Get ready for Microsoft 365 Copilot with SharePoint Advanced Management](/en-us/sharepoint/get-ready-copilot-sharepoint-advanced-management).

### Microsoft OneDrive

Configure OneDrive governance before enabling Microsoft 365 Copilot. Copilot accesses OneDrive files only within the user's existing permissions and honors the same security, compliance, and privacy controls applied across Microsoft 365.

OneDrive uses SharePoint Online as its underlying platform, which means tenant-level SharePoint sharing policies also apply to OneDrive. You can control external sharing, link types, and default permissions to reduce unintended exposure of user files. These controls directly affect what content Copilot can surface in responses.

For more information, see [How data is protected and audited](microsoft-365-copilot-architecture-data-protection-auditing).

## Microsoft Purview

Microsoft 365 Copilot works together with third-party apps or Microsoft Purview sensitivity labels and encryption to provide an extra layer of protection. Microsoft 365 Copilot honors your security and data protection controls. There are also features you can use to audit Copilot usage data. For more information, see [Data, Privacy, and Security for Microsoft 365 Copilot](microsoft-365-copilot-privacy).

## Microsoft Teams integration

As an admin, you can manage how users in your organization use Copilot for Teams meetings and events. Before users in your organization can use Copilot in Teams, they must have the Microsoft 365 Copilot add-on license. For Teams phone, users also require a Teams phone license. The following topics will help you get started with rolling out Teams in your organization:

- [Manage Microsoft 365 Copilot in Teams meetings and events](/en-us/microsoftteams/copilot-teams-transcription)
- [Manage Microsoft 365 Copilot in Teams calls](/en-us/microsoftteams/copilot-teams-calling-transcription)
- [Teams Rooms and Copilot overview](/en-us/microsoftteams/rooms/copilot-admin-mtr)
