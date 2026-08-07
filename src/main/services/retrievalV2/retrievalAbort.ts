export class RetrievalAbortedError extends Error {
  constructor(message = "retrieval_aborted") {
    super(message);
    this.name = "RetrievalAbortedError";
  }
}

export function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RetrievalAbortedError();
  }
}
