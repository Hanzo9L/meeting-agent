## How to detect using the SDK

Your application can use [User Facing Diagnostics API](../../../../concepts/voice-video-calling/user-facing-diagnostics) and register a listener callback to detect the device issue.

There are several events related to the microphone issues, including:

- `noMicrophoneDevicesEnumerated`: There's no microphone device available in the system.
- `microphoneNotFunctioning`: The browser ends the audio input track.
- `microphoneMuteUnexpectedly`: The browser mutes the audio input track.

In addition, the [Media Stats API](../../../../concepts/voice-video-calling/media-quality-sdk) also provides a way to monitor the audio input or output level.

To check the audio level at the sending end, look at `audioInputLevel` value, which ranges from 0 to 65536 and indicates the volume level of the audio captured by the audio input device.

To check the audio level at the receiving end, look at `audioOutputLevel` value, which also ranges from 0 to 65536. This value indicates the volume level of the decoded audio samples. If the `audioOutputLevel` value is low, it indicates that the volume sent by the sender is also low.
