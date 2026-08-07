import type { CaptureSourceMode, CaptureSourceTag } from "@shared/types";

type CaptureNode = {
  source: CaptureSourceTag;
  stream: MediaStream;
  sourceNode: MediaStreamAudioSourceNode;
  processorNode: ScriptProcessorNode;
};

type CaptureStartResult = {
  activeSources: CaptureSourceTag[];
  statusMessage: string;
};

let context: AudioContext | null = null;
let captureNodes: CaptureNode[] = [];
let keepAliveInterval: number | null = null;
let loopbackBridgeEnabled = false;

export async function startLoopbackCapture(mode: CaptureSourceMode): Promise<CaptureStartResult> {
  if (captureNodes.length > 0 && context) {
    return {
      activeSources: captureNodes.map((node) => node.source),
      statusMessage: `Using ${captureNodes.map((node) => node.source).join(" + ")} source(s).`
    };
  }

  context = new AudioContext({ sampleRate: 48000 });
  await context.resume();
  keepAliveInterval = window.setInterval(() => {
    if (context?.state === "suspended") {
      void context.resume();
    }
  }, 1000);

  const requestedSources: CaptureSourceTag[] =
    mode === "both" ? ["system", "microphone"] : [mode];

  const failures: string[] = [];
  for (const source of requestedSources) {
    try {
      const stream = source === "system" ? await requestSystemStream() : await requestMicrophoneStream();
      attachSourceToProcessor(source, stream);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown capture error";
      failures.push(`${source}: ${message}`);
    }
  }

  if (captureNodes.length === 0) {
    await stopLoopbackCapture();
    throw new Error(
      `No audio sources are available for mode "${mode}". ${failures.length ? failures.join(" | ") : ""}`.trim()
    );
  }

  const activeSources = captureNodes.map((node) => node.source);
  const statusMessage =
    failures.length > 0
      ? `Using ${activeSources.join(" + ")} source(s). Fallback applied: ${failures.join(" | ")}`
      : `Using ${activeSources.join(" + ")} source(s).`;
  return { activeSources, statusMessage };
}

export async function stopLoopbackCapture(): Promise<void> {
  captureNodes.forEach((node) => {
    node.processorNode.disconnect();
    node.sourceNode.disconnect();
    node.stream.getTracks().forEach((track) => track.stop());
  });
  captureNodes = [];

  if (loopbackBridgeEnabled) {
    await window.overlayApi.disableLoopbackAudio().catch(() => undefined);
    loopbackBridgeEnabled = false;
  }

  if (keepAliveInterval !== null) {
    window.clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }

  if (context) {
    await context.close();
    context = null;
  }
}

async function requestSystemStream(): Promise<MediaStream> {
  await window.overlayApi.enableLoopbackAudio();
  loopbackBridgeEnabled = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
    const hasAudio = stream.getAudioTracks().length > 0;
    if (!hasAudio) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Display capture started without a system-audio track.");
    }
    return stream;
  } finally {
    await window.overlayApi.disableLoopbackAudio().catch(() => undefined);
    loopbackBridgeEnabled = false;
  }
}

async function requestMicrophoneStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

function attachSourceToProcessor(source: CaptureSourceTag, stream: MediaStream): void {
  if (!context) throw new Error("Audio context is not initialized.");

  stream.getAudioTracks().forEach((track) => {
    track.enabled = true;
  });

  const sourceNode = context.createMediaStreamSource(stream);
  const processorNode = context.createScriptProcessor(4096, 2, 1);
  sourceNode.connect(processorNode);
  processorNode.connect(context.destination);

  processorNode.onaudioprocess = (event) => {
    const channels = event.inputBuffer.numberOfChannels;
    if (channels === 0) return;
    const frameLength = event.inputBuffer.length;
    const mono = new Float32Array(frameLength);

    for (let channel = 0; channel < channels; channel += 1) {
      const data = event.inputBuffer.getChannelData(channel);
      for (let i = 0; i < frameLength; i += 1) {
        mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels;
      }
    }

    const pcm16 = downsampleToPcm16(mono, event.inputBuffer.sampleRate, 16000);
    if (pcm16.length === 0) return;
    const buffer = pcm16.buffer.slice(
      pcm16.byteOffset,
      pcm16.byteOffset + pcm16.byteLength
    ) as ArrayBuffer;
    window.overlayApi.sendAudioChunk({ source, buffer });
  };

  captureNodes.push({ source, stream, sourceNode, processorNode });
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
