export class EmbeddingCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingCodecError";
  }
}

function assertFiniteNumber(value: number, index: number): void {
  if (!Number.isFinite(value)) {
    throw new EmbeddingCodecError(`Vector value at index ${index} is not finite.`);
  }
}

export function encodeFloat32Vector(values: readonly number[]): Buffer {
  if (values.length === 0) {
    throw new EmbeddingCodecError("Cannot encode empty vector.");
  }
  const buffer = Buffer.allocUnsafe(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === undefined) {
      throw new EmbeddingCodecError(`Missing vector value at index ${i}.`);
    }
    assertFiniteNumber(value, i);
    buffer.writeFloatLE(value, i * 4);
  }
  return buffer;
}

export function decodeFloat32Vector(
  blob: Uint8Array,
  expectedDimensions?: number
): Float32Array {
  if (blob.byteLength === 0) {
    throw new EmbeddingCodecError("Cannot decode empty vector blob.");
  }
  if (blob.byteLength % 4 !== 0) {
    throw new EmbeddingCodecError("Vector blob length is not aligned to Float32 width.");
  }

  const dimensions = blob.byteLength / 4;
  if (expectedDimensions !== undefined && expectedDimensions !== dimensions) {
    throw new EmbeddingCodecError(
      `Vector dimension mismatch. Expected ${expectedDimensions}, got ${dimensions}.`
    );
  }

  const view = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const out = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i += 1) {
    const value = view.readFloatLE(i * 4);
    assertFiniteNumber(value, i);
    out[i] = value;
  }
  return out;
}
