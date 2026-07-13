declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class Pcm16Worklet extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const mono = channels[0];
    if (!mono) return true;

    const downsampled = this.downsampleBuffer(mono, sampleRate, 16000);
    if (downsampled.length > 0) {
      this.port.postMessage(downsampled.buffer, [downsampled.buffer]);
    }

    return true;
  }

  private downsampleBuffer(input: Float32Array, inputRate: number, outputRate: number): Int16Array {
    if (outputRate >= inputRate) {
      return this.floatTo16BitPCM(input);
    }

    const ratio = inputRate / outputRate;
    const newLength = Math.floor(input.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < newLength) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
        accum += input[i] ?? 0;
        count += 1;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult += 1;
      offsetBuffer = nextOffsetBuffer;
    }

    return this.floatTo16BitPCM(result);
  }

  private floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }
}

registerProcessor("pcm16-worklet", Pcm16Worklet);
