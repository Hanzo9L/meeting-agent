let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let usedLoopback = false;
let keepAliveInterval: number | null = null;

export async function startLoopbackCapture(): Promise<void> {
  if (stream) return;

  try {
    // Prefer microphone-first capture for reliability in local testing.
    usedLoopback = false;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch {
    // Fallback: try system loopback capture if mic capture is unavailable.
    await window.overlayApi.enableLoopbackAudio();
    usedLoopback = true;
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream?.removeTrack(track);
    });
  } finally {
    if (usedLoopback) {
      await window.overlayApi.disableLoopbackAudio().catch(() => undefined);
    }
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error("No audio track available from selected capture source");
  }
  audioTracks.forEach((track) => {
    track.enabled = true;
  });

  context = new AudioContext({ sampleRate: 48000 });
  await context.resume();
  keepAliveInterval = window.setInterval(() => {
    if (context?.state === "suspended") {
      void context.resume();
    }
  }, 1000);
  sourceNode = context.createMediaStreamSource(stream);
  processorNode = context.createScriptProcessor(4096, 2, 1);
  sourceNode.connect(processorNode);
  processorNode.connect(context.destination);

  processorNode.onaudioprocess = (event) => {
    const channels = event.inputBuffer.numberOfChannels;
    if (channels === 0) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm16 = downsampleToPcm16(input, event.inputBuffer.sampleRate, 16000);
    if (pcm16.length > 0) {
      const buffer = pcm16.buffer.slice(
        pcm16.byteOffset,
        pcm16.byteOffset + pcm16.byteLength
      ) as ArrayBuffer;
      window.overlayApi.sendAudioChunk(buffer);
    }
  };
}

export async function stopLoopbackCapture(): Promise<void> {
  processorNode?.disconnect();
  sourceNode?.disconnect();
  processorNode = null;
  sourceNode = null;

  stream?.getTracks().forEach((track) => track.stop());
  stream = null;

  if (usedLoopback) {
    await window.overlayApi.disableLoopbackAudio().catch(() => undefined);
  }
  usedLoopback = false;
  if (keepAliveInterval !== null) {
    window.clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }

  if (context) {
    await context.close();
    context = null;
  }
}

function downsampleToPcm16(input: Float32Array, inputRate: number, targetRate: number): Int16Array {
  if (!input.length) return new Int16Array(0);

  const ratio = inputRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  let offsetInput = 0;
  for (let i = 0; i < outputLength; i += 1) {
    const nextOffsetInput = Math.min(input.length, Math.floor((i + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let j = offsetInput; j < nextOffsetInput; j += 1) {
      accum += input[j] ?? 0;
      count += 1;
    }
    offsetInput = nextOffsetInput;
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return output;
}
