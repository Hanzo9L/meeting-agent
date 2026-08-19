## Example 1: Voice routing with one PSTN usage

The following diagram shows two examples of voice routing policies in a call flow.

**Call Flow 1 (on the left):** If a user makes a call to +1 425 XXX XX XX or +1 206 XXX XX XX, the call is routed to SBC sbc1.contoso.com or sbc2.contoso.com. If neither sbc1.contoso.com nor sbc2.contoso.com are available, the call is dropped.

**Call Flow 2 (on the right):** If a user makes a call to +1 425 XXX XX XX or +1 206 XXX XX XX, the call is first routed to SBC sbc1.contoso.com or sbc2.contoso.com. If neither SBC is available, the route with lower priority will be tried (sbc3.contoso.com and sbc4.contoso.com). If none of the SBCs are available, the call is dropped.

![Screenshot that shows voice routing policy examples.](media/configdirectrouting-voiceroutingpolicyexamples.png)

In both examples, while the voice route is assigned priorities, the SBCs in the routes are tried in random order.

Note

Unless the user also has a Microsoft Calling Plan license, calls to any number except numbers matching the patterns +1 425 XXX XX XX or +1 206 XXX XX XX in the example configuration are dropped. If the user has a Calling Plan license, the call is automatically routed according to the policies of the Microsoft Calling Plan. The Microsoft Calling Plan applies automatically as the last route to all users with the Microsoft Calling Plan license and does not require additional call routing configuration.

In the example shown in the following diagram, a voice route is added to send calls to all other US and Canadian numbers (calls that go to called number pattern +1 XXX XXX XX XX).

![Screenshot that shows voice routing policy with a third route.](media/configdirectrouting-voiceroutingpolicywith3rdroute.png)

For all other calls, if a user has both licenses (Teams Phone and Microsoft Calling Plan), the automatic route is used. If nothing matches the number patterns in the administrator-created online voice routes, then the call is routed through Microsoft Calling Plan. If the user only has Teams Phone, the call is dropped because no matching rules are available.

Note

The Priority value for route "Other +1" doesn't matter in this case because there is only one route that matches the pattern +1 XXX XXX XX XX. If a user makes a call to +1 324 567 89 89 and both sbc5.contoso.com and sbc6.contoso.com are unavailable, the call is dropped.

The following table summarizes the configuration using three voice routes. In this example, all three routes are part of the same PSTN usage, "US and Canada". All routes are associated with the "US and Canada" PSTN usage, and the PSTN usage is associated with the "US Only" voice routing policy.

| **PSTN usage** | **Voice route** | **Number pattern** | **Priority** | **SBC** | **Description** |
| --- | --- | --- | --- | --- | --- |
| US and Canada | "Redmond 1" | ^\+1(425|206)(\d{7})$ | 1 | sbc1.contoso.comsbc2.contoso.com | Active route for called numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Redmond 2" | ^\+1(425|206)(\d{7})$ | 2 | sbc3.contoso.comsbc4.contoso.com | Backup route for called numbers +1 425 XXX XX XX or +1 206 XXX XX XX |
| US and Canada | "Other +1" | ^\+1(\d{10})$ | 3 | sbc5.contoso.comsbc6.contoso.com | Route for called numbers +1 XXX XXX XX XX (except +1 425 XXX XX XX or +1 206 XXX XX XX) |
|  |  |  |  |  |  |

Note

In case of call forwarding or call transfer of an incoming PSTN call, when the ingress SBC is also listed as a potential egress SBC, its priority value is ignored, and it's prioritized above other SBCs. For example, in this table, if a forwarded call is ingressed over sbc5.contoso.com, the first SBC attempted for egress will be sbc5.contoso.com, even though its priority value is 3.
