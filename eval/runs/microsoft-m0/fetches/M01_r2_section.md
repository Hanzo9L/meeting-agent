## No ringback tone when Teams receives a call from a PSTN endpoint

This issue occurs in the following scenario:

When a Microsoft Teams client receives a call, it first sends a SIP 180 Ringing message, and then sends a SIP 183 Session Progress message together with a media offer (SDP).

According to RFC 3261 and RFC 3960 standards, when the endpoint that's used by the caller receives a SIP 180 Ringing message, it must generate the ring tone locally. If the caller's device receives a SIP 183 Session Progress message with SDP, it allows the destination (the Teams client in this scenario) to play audio or a ring tone before the session is accepted by the called user. Such audio is known as early media.

However, some caller devices and carriers stop generating the ring tone locally when they receive a SIP 183 Session Progress message. This occurs even though the devices and carriers should continue to generate the ring tone until the actual media packets are received.

### Resolution

To fix the issue, you must update the Session Border Controller (SBC) configuration to handle multiple SIP 18x messages.

Most SBCs offer one of the following mitigation options:

- Forward only the first SIP 18x message and ignore subsequent messages until the call is answered or ended. This option is offered by AudioCodes SBCs, for example.
- Remove the SDP information from the SIP 183 Session Progress message, and then change the message to an SIP 180 Ringing message. This option is offered by Metaswitch SBCs, for example.

For instructions to update the SIP manipulation rules in your SBC, refer to the documentation that's specific to your SBC model, and contact your SBC vendor for other recommended options.
