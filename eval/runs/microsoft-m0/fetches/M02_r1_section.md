## Example 2: Voice routing with multiple PSTN usages

The voice routing policy created in Example 1 only allows calls to phone numbers in the United States and Canada--unless the Microsoft Calling Plan license is also assigned to the user.

In the example that follows, you can create the "No Restrictions" voice routing policy. The policy reuses the "US and Canada" PSTN usage created in Example 1, as well as the new "International" PSTN usage. This policy routes all other calls to the SBCs sbc2.contoso.com and sbc5.contoso.com.

The examples that are shown assign the US Only policy to user user1@contoso.com, and the No Restrictions policy to user2@contoso.com so that routing occurs as follows:

- user1@contoso.com – US Only policy. Calls are allowed only to United States and Canadian numbers. When calling to the Redmond number range, the specific set of SBCs must be used. Non-United States numbers will not be routed unless the Calling Plan license is assigned to the user.
- user2@contoso.com – International policy. Calls are allowed to any number. When calling to the Redmond number range, the specific set of SBCs must be used. Non-United States numbers will be routed using sbc2.contoso.com and sbc5.contoso.com.

![Screenshot that shows voice routing policy assigned to user1@contoso.com.](media/configdirectrouting-voiceroutingpolicyassignedtospencerlow.png)

For all other calls, if a user has both licenses (Teams Phone and Microsoft Calling Plan), automatic route is used. If nothing matches the number patterns in the administrator-created online voice routes, then the call is routed using Microsoft Calling Plan. If the user has only Teams Phone, the call is dropped because no matching rules are available.

![Screenshot that shows voice routing policy assigned to user2@contoso.com.](media/configdirectrouting-voiceroutingpolicyassignedtojohnwoods.png)

The following table summarizes routing policy "No Restrictions" usage designations and voice routes.

| PSTN usage | Voice route | Number pattern | Priority | SBC | Description |
| --- | --- | --- | --- | --- | --- |
| US and Canada | "Redmond 1" | ^\+1(425|206)(\d{7})$ | 1 | sbc1.contoso.comsbc2.contoso.com | Active route for callee numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Redmond 2" | ^\+1(425|206)(\d{7})$ | 2 | sbc3.contoso.comsbc4.contoso.com | Backup route for callee numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Other +1" | ^\+1(\d{10})$ | 3 | sbc5.contoso.comsbc6.contoso.com | Route for callee numbers +1 XXX XXX XX XX (except +1 425 XXX XX XX or +1 206 XXX XX XX) |
| International | International | \d+ | 4 | sbc2.contoso.comsbc5.contoso.com | Route for any number pattern |

Note

- The order of PSTN usages in voice routing policies is critical. The usages are applied in order, and if a match is found in the first usage, then other usages are never evaluated. The "International" PSTN usage must be placed after the "US and Canada" PSTN usage. To change the order of the PSTN usages, run the `Set-CSOnlineVoiceRoutingPolicy` command. For example, to change the order from "US and Canada" first and "International" second to the reverse order run:`Set-CsOnlineVoiceRoutingPolicy -id tag:"no Restrictions" -OnlinePstnUsages @{Replace="International", "US and Canada"}`
- The priority for "Other +1" and "International" voice routes are assigned automatically. They don't matter as long as they have lower priorities than "Redmond 1" and "Redmond 2."
