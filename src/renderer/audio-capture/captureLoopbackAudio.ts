import workletUrl from "./pcmWorklet.ts?url";

let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;

export async function startLoopbackCapture(): Promise<void> {
  if (stream) return;

  await window.overlayApi.enableLoopbackAudio();
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true
  });

  stream.getVideoTracks().forEach((track) => {
    track.stop();
    stream?.removeTrack(track);
  });
  await window.overlayApi.disableLoopbackAudio();

  context = new AudioContext({ sampleRate: 48000 });
  await context.audioWorklet.addModule(workletUrl);

  sourceNode = context.createMediaStreamSource(stream);
  workletNode = new AudioWorkletNode(context, "pcm16-worklet");
  sourceNode.connect(workletNode);
  workletNode.connect(context.destination);

  workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    window.overlayApi.sendAudioChunk(event.data);
  };
}

export async function stopLoopbackCapture(): Promise<void> {
  workletNode?.disconnect();
  sourceNode?.disconnect();
  workletNode = null;
  sourceNode = null;

  stream?.getTracks().forEach((track) => track.stop());
  stream = null;

  await window.overlayApi.disableLoopbackAudio();

  if (context) {
    await context.close();
    context = null;
  }
}
