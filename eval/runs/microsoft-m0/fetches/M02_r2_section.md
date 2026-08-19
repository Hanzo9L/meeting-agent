## Example 1: Configuration steps

The following example shows how to:

1. Create a single PSTN usage.
2. Configure three voice routes.
3. Create a voice routing policy.
4. Assign the policy to user1@contoso.com.

You can use the Microsoft Teams admin center or PowerShell to perform these steps.

### Using the Microsoft Teams admin center

#### Step 1: Create the "US and Canada" PSTN usage

1. In the left navigation of the Microsoft Teams admin center, go to **Voice** &gt; **Direct Routing**, and then in the upper-right corner, select **Manage PSTN usage records**.
2. Select **Add**, type **US and Canada**, and then select **Apply**.

#### Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

The following steps describe how to create a voice route. Use these steps to create the three voice routes named Redmond 1, Redmond 2, and Other +1 for this example by using the settings outlined in the earlier table.

1. In the left navigation of the Microsoft Teams admin center, go to **Voice** &gt; **Direct Routing**, and then select the **Voice routes** tab.
2. Select **Add**, and then enter a name and description for the voice route.
3. Set the priority and specify the dialed number pattern.
4. To enroll an SBC with the voice route, under **SBCs enrolled (optional)**, select **Add SBCs**, select the SBCs you want to enroll, and then select **Apply**.
5. To add PSTN usage records, under **PSTN usage records (optional)**, select **Add PSTN usage**, select the PSTN records you want to add, and then select **Apply**.
6. Select **Save**.

#### Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

1. In the left navigation of the Microsoft Teams admin center, go to **Voice** &gt; **Voice routing policies**, and then select **Add**.
2. Type **US Only** as the name and add a description.
3. Under **PSTN usage records**, select **Add PSTN usage**, select the "US and Canada" PSTN usage record, and then select **Apply**.
4. Select **Save**.

To learn more, see [Manage voice routing policies](manage-voice-routing-policies).

#### Step 4: Assign the voice routing policy to user1@contoso.com

1. In the left navigation of the Microsoft Teams admin center, go to **Users**, and then select the user.
2. Select **Policies**, and then next to **Assigned policies**, select **Edit**.
3. Under **Voice routing policy**, select the "US Only" policy, and then select **Save**.

To learn more, see [Manage voice routing policies](manage-voice-routing-policies).

### Using PowerShell

#### Step 1: Create the "US and Canada" PSTN usage

In a remote PowerShell session in Teams, type:

```PowerShell
Set-CsOnlinePstnUsage -Identity Global -Usage @{Add="US and Canada"}
```

Verify that the usage was created by entering:

```PowerShell
Get-CSOnlinePSTNUsage
```

Which returns a list of names that may be truncated:

```console
Identity    : Global
Usage        : {testusage, US and Canada, International, karlUsage. . .}
```

The following example shows the result of running the `(Get-CSOnlinePSTNUsage).usage` PowerShell command to display full names (not truncated):

```console
 testusage
 US and Canada
 International
 karlUsage
 New test env
 Tallinn Lab Sonus
 karlUsage2
 Unrestricted
 Two trunks
```

#### Step 2: Create three voice routes (Redmond 1, Redmond 2, and Other +1)

To create the "Redmond 1" route, in a PowerShell session in Teams, enter:

```PowerShell
New-CsOnlineVoiceRoute -Identity "Redmond 1" -NumberPattern "^\+1(425|206)
(\d{7})$" -OnlinePstnGatewayList sbc1.contoso.com, sbc2.contoso.com -Priority 1 -OnlinePstnUsages "US and Canada"
```

Which returns:

```console
Identity                : Redmond 1
Priority                : 1
Description             :
NumberPattern           : ^\+1(425|206) (\d{7})$
OnlinePstnUsages        : {US and Canada}
OnlinePstnGatewayList   : {sbc1.contoso.com, sbc2.contoso.com}
Name                    : Redmond 1
```

To create the Redmond 2 route, enter:

```PowerShell
New-CsOnlineVoiceRoute -Identity "Redmond 2" -NumberPattern "^\+1(425|206)
(\d{7})$" -OnlinePstnGatewayList sbc3.contoso.com, sbc4.contoso.com -Priority 2 -OnlinePstnUsages "US and Canada"
```

To create the Other +1 route, enter:

```PowerShell
New-CsOnlineVoiceRoute -Identity "Other +1" -NumberPattern "^\+1(\d{10})$"
-OnlinePstnGatewayList sbc5.contoso.com, sbc6.contoso.com -OnlinePstnUsages "US and Canada"
```

Caution

Make sure that your regular expression in the NumberPattern attribute is a valid expression. You can test it using this website: https://www.regexpal.com

In some cases, there is a need to route all calls to the same SBC; use -NumberPattern ".\*"

Route all calls to the same SBC.

```PowerShell
Set-CsOnlineVoiceRoute -id "Redmond 1" -NumberPattern ".*" -OnlinePstnGatewayList sbc1.contoso.com
```

Verify that you've correctly configured the route by running the `Get-CSOnlineVoiceRoute` PowerShell command using options as shown:

```PowerShell
Get-CsOnlineVoiceRoute | Where-Object {($_.priority -eq 1) -or ($_.priority -eq 2) or ($_.priority -eq 4) -Identity "Redmond 1" -NumberPattern "^\+1(425|206) (\d{7})$" -OnlinePstnGatewayList sbc1.contoso.com, sbc2.contoso.com -Priority 1 -OnlinePstnUsages "US and Canada"
```

Which should return:

```console
Identity            : Redmond 1 
Priority               : 1
Description         : 
NumberPattern         : ^\+1(425|206) (\d{7})$
OnlinePstnUsages     : {US and Canada}     
OnlinePstnGatewayList    : {sbc1.contoso.com, sbc2.contoso.com}
Name             : Redmond 1
Identity        : Redmond 2 
Priority               : 2
Description         : 
NumberPattern         : ^\+1(425|206) (\d{7})$
OnlinePstnUsages     : {US and Canada}     
OnlinePstnGatewayList    : {sbc3.contoso.com, sbc4.contoso.com}
Name             : Redmond 2
    
Identity        : Other +1 
Priority               : 4
Description         : 
NumberPattern         : ^\+1(\d{10})$
OnlinePstnUsages     : {US and Canada}     
OnlinePstnGatewayList    : {sbc5.contoso.com, sbc6.contoso.com}
Name             : Other +1
```

In the example, the route "Other +1" was automatically assigned priority 4.

#### Step 3: Create a voice routing policy named "US Only" and add the "US and Canada" PSTN usage to the policy

In a PowerShell session in Teams, type:

```PowerShell
New-CsOnlineVoiceRoutingPolicy "US Only" -OnlinePstnUsages "US and Canada"
```

The result is shown in this example:

```console
Identity            : Tag:US only
OnlinePstnUsages    : {US and Canada}
Description         :
RouteType           : BYOT
```

#### Step 4: Assign the voice routing policy to user1@contoso.com

In a PowerShell session in Teams, type:

```PowerShell
Grant-CsOnlineVoiceRoutingPolicy -Identity "user1@contoso.com" -PolicyName "US Only"
```

Validate the policy assignment by entering this command:

```PowerShell
Get-CsOnlineUser "user1@contoso.com" | select OnlineVoiceRoutingPolicy
```

The command returns the following:

```console
OnlineVoiceRoutingPolicy
---------------------
US Only
```
