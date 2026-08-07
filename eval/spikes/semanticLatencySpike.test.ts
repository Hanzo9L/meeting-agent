import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeNormalizedVectorBlob,
  encodeNormalizedVectorBlob,
  generateDeterministicVector,
  scoreCandidates,
  selectTopK
} from "./semanticLatencyKernel";

test("identical vector ranks highest against itself", () => {
  const vector = generateDeterministicVector(42, 16);
  const blob = encodeNormalizedVectorBlob(vector);
  const query = decodeNormalizedVectorBlob(blob, 16);
  const candidates = [
    { id: "same", vector: decodeNormalizedVectorBlob(blob, 16) },
    { id: "other", vector: decodeNormalizedVectorBlob(encodeNormalizedVectorBlob(generateDeterministicVector(43, 16)), 16) }
  ];
  const top = selectTopK(scoreCandidates(query, candidates), 1);
  assert.equal(top[0]?.id, "same");
});

test("known nearest vector ranks correctly", () => {
  const query = decodeNormalizedVectorBlob(
    encodeNormalizedVectorBlob(generateDeterministicVector(99, 8)),
    8
  );
  const close = decodeNormalizedVectorBlob(
    encodeNormalizedVectorBlob(generateDeterministicVector(99, 8)),
    8
  );
  const far = decodeNormalizedVectorBlob(
    encodeNormalizedVectorBlob(generateDeterministicVector(2, 8)),
    8
  );
  const top = selectTopK(
    scoreCandidates(query, [
      { id: "far", vector: far },
      { id: "close", vector: close }
    ]),
    2
  );
  assert.equal(top[0]?.id, "close");
});

test("incompatible dimensions fail", () => {
  const query = decodeNormalizedVectorBlob(
    encodeNormalizedVectorBlob(generateDeterministicVector(5, 4)),
    4
  );
  const candidate = decodeNormalizedVectorBlob(
    encodeNormalizedVectorBlob(generateDeterministicVector(6, 8)),
    8
  );
  assert.throws(() => scoreCandidates(query, [{ id: "x", vector: candidate }]));
});

test("corrupt blob decode fails", () => {
  assert.throws(() => decodeNormalizedVectorBlob(Uint8Array.from([1, 2, 3]), 4));
});

test("top-k ordering is deterministic on repeated run", () => {
  const query = decodeNormalizedVectorBlob(
    encodeNormalizedVectorBlob(generateDeterministicVector(10, 12)),
    12
  );
  const candidates = Array.from({ length: 20 }).map((_, index) => ({
    id: `id-${index}`,
    vector: decodeNormalizedVectorBlob(
      encodeNormalizedVectorBlob(generateDeterministicVector(index + 100, 12)),
      12
    )
  }));
  const scored = scoreCandidates(query, candidates);
  const first = selectTopK(scored, 5);
  const second = selectTopK(scored, 5);
  assert.deepEqual(first, second);
});

test("deterministic generation yields stable ranking output", () => {
  const buildTop = () => {
    const query = decodeNormalizedVectorBlob(
      encodeNormalizedVectorBlob(generateDeterministicVector(777, 10)),
      10
    );
    const candidates = Array.from({ length: 30 }).map((_, index) => ({
      id: `c-${index}`,
      vector: decodeNormalizedVectorBlob(
        encodeNormalizedVectorBlob(generateDeterministicVector(index + 1, 10)),
        10
      )
    }));
    return selectTopK(scoreCandidates(query, candidates), 10);
  };

  assert.deepEqual(buildTop(), buildTop());
});
