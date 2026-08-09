import type { CaptureSourceTag } from "@shared/types";
import type { CompletedSttUtterance } from "./sttProvider";

/**
 * The controlled both-mode run observed system/microphone completion 316 ms
 * apart. A 650 ms window covers approximately twice that measured skew plus
 * scheduling margin without becoming a long-lived text suppression rule.
 */
export const CROSS_SOURCE_ARBITRATION_WINDOW_MS = 650;
export const CROSS_SOURCE_SIMILARITY_THRESHOLD = 0.82;

export interface SourceCompletedUtterance {
  sessionId: string;
  source: CaptureSourceTag;
  utterance: CompletedSttUtterance;
  completedAtMs: number;
}

export interface CrossSourceArbitrationDiagnostic {
  sessionId: string;
  outcome: "accepted" | "duplicate_suppressed" | "cleared_on_stop";
  retainedUtteranceId: string | null;
  retainedSource: CaptureSourceTag | null;
  suppressedUtteranceId: string | null;
  suppressedSource: CaptureSourceTag | null;
  retainedNormalizedText: string | null;
  suppressedNormalizedText: string | null;
  similarity: number | null;
  completionDeltaMs: number | null;
  sourceTimingDeltaMs: number | null;
  arbitrationDelayMs: number;
  reason:
    | "single_source_mode"
    | "window_elapsed_no_duplicate"
    | "cross_source_transcript_match"
    | "session_stopped";
}

interface Scheduler {
  now(): number;
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const DEFAULT_SCHEDULER: Scheduler = {
  now: () => Date.now(),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>)
};

interface PendingGroup {
  order: number;
  firstCompletedAtMs: number;
  dueAtMs: number;
  selected: SourceCompletedUtterance;
  suppressed: SourceCompletedUtterance | null;
  similarity: number | null;
  completionDeltaMs: number | null;
  sourceTimingDeltaMs: number | null;
  resolvedDuplicate: boolean;
}

function normalizeTranscript(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenEditDistance(left: string[], right: string[]): number {
  const previous = right.map((_, index) => index + 1);
  previous.unshift(0);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (
      let rightIndex = 0;
      rightIndex < right.length;
      rightIndex += 1
    ) {
      current.push(
        Math.min(
          (current[rightIndex] ?? 0) + 1,
          (previous[rightIndex + 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) +
            (left[leftIndex] === right[rightIndex] ? 0 : 1)
        )
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

export function transcriptSimilarity(
  leftText: string,
  rightText: string
): number {
  const left = normalizeTranscript(leftText);
  const right = normalizeTranscript(rightText);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  const maximumLength = Math.max(
    leftTokens.length,
    rightTokens.length
  );
  return (
    1 -
    tokenEditDistance(leftTokens, rightTokens) / maximumLength
  );
}

function sourceTimingDeltaMs(
  left: SourceCompletedUtterance,
  right: SourceCompletedUtterance
): number | null {
  const leftEnd = left.utterance.sourceEndSeconds;
  const rightEnd = right.utterance.sourceEndSeconds;
  if (leftEnd === null || rightEnd === null) return null;
  return Math.abs(leftEnd - rightEnd) * 1000;
}

export class CrossSourceUtteranceArbiter {
  private readonly pending: PendingGroup[] = [];
  private nextOrder = 0;
  private timer: unknown = null;

  constructor(
    private readonly options: {
      sessionId: string;
      bothMode: boolean;
      accept(input: SourceCompletedUtterance): void;
      diagnostic(
        diagnostic: CrossSourceArbitrationDiagnostic
      ): void;
      scheduler?: Scheduler;
    }
  ) {}

  submit(input: Omit<SourceCompletedUtterance, "sessionId">): void {
    const completed: SourceCompletedUtterance = {
      ...input,
      sessionId: this.options.sessionId
    };
    if (!this.options.bothMode) {
      this.options.accept(completed);
      this.options.diagnostic(
        this.diagnosticForAccepted(
          completed,
          "single_source_mode",
          0
        )
      );
      return;
    }

    const now = this.scheduler.now();
    const duplicate = this.findDuplicate(completed);
    if (duplicate) {
      const existing = duplicate.group.selected;
      const system =
        existing.source === "system" ? existing : completed;
      const microphone =
        existing.source === "microphone" ? existing : completed;
      duplicate.group.selected = system;
      duplicate.group.suppressed = microphone;
      duplicate.group.similarity = duplicate.similarity;
      duplicate.group.completionDeltaMs =
        duplicate.completionDeltaMs;
      duplicate.group.sourceTimingDeltaMs =
        duplicate.sourceTimingDeltaMs;
      duplicate.group.resolvedDuplicate = true;
      duplicate.group.dueAtMs = now;
      this.drain(now);
      this.armTimer();
      return;
    }

    this.pending.push({
      order: this.nextOrder++,
      firstCompletedAtMs: completed.completedAtMs,
      dueAtMs:
        completed.completedAtMs +
        CROSS_SOURCE_ARBITRATION_WINDOW_MS,
      selected: completed,
      suppressed: null,
      similarity: null,
      completionDeltaMs: null,
      sourceTimingDeltaMs: null,
      resolvedDuplicate: false
    });
    this.sortPending();
    this.drain(now);
    this.armTimer();
  }

  stop(): void {
    if (this.timer !== null) {
      this.scheduler.clear(this.timer);
      this.timer = null;
    }
    for (const group of this.pending) {
      this.options.diagnostic({
        sessionId: this.options.sessionId,
        outcome: "cleared_on_stop",
        retainedUtteranceId:
          group.selected.utterance.utteranceId,
        retainedSource: group.selected.source,
        suppressedUtteranceId: null,
        suppressedSource: null,
        retainedNormalizedText: normalizeTranscript(
          group.selected.utterance.text
        ),
        suppressedNormalizedText: null,
        similarity: null,
        completionDeltaMs: null,
        sourceTimingDeltaMs: null,
        arbitrationDelayMs: Math.max(
          0,
          this.scheduler.now() - group.firstCompletedAtMs
        ),
        reason: "session_stopped"
      });
    }
    this.pending.splice(0);
  }

  private get scheduler(): Scheduler {
    return this.options.scheduler ?? DEFAULT_SCHEDULER;
  }

  private findDuplicate(input: SourceCompletedUtterance): {
    group: PendingGroup;
    similarity: number;
    completionDeltaMs: number;
    sourceTimingDeltaMs: number | null;
  } | null {
    const candidates = this.pending
      .filter(
        (group) =>
          !group.resolvedDuplicate &&
          group.selected.source !== input.source
      )
      .map((group) => {
        const completionDeltaMs = Math.abs(
          group.selected.completedAtMs - input.completedAtMs
        );
        const timingDelta = sourceTimingDeltaMs(
          group.selected,
          input
        );
        return {
          group,
          similarity: transcriptSimilarity(
            group.selected.utterance.text,
            input.utterance.text
          ),
          completionDeltaMs,
          sourceTimingDeltaMs: timingDelta
        };
      })
      .filter(
        (candidate) =>
          candidate.completionDeltaMs <=
            CROSS_SOURCE_ARBITRATION_WINDOW_MS &&
          candidate.similarity >=
            CROSS_SOURCE_SIMILARITY_THRESHOLD &&
          (candidate.sourceTimingDeltaMs === null ||
            candidate.sourceTimingDeltaMs <=
              CROSS_SOURCE_ARBITRATION_WINDOW_MS * 2)
      )
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          left.completionDeltaMs - right.completionDeltaMs ||
          left.group.order - right.group.order
      );
    return candidates[0] ?? null;
  }

  private drain(now: number): void {
    this.sortPending();
    while (this.pending.length > 0) {
      const group = this.pending[0];
      if (
        !group ||
        (!group.resolvedDuplicate && group.dueAtMs > now)
      ) {
        break;
      }
      this.pending.shift();
      this.options.accept(group.selected);
      const delay = Math.max(
        0,
        now - group.firstCompletedAtMs
      );
      if (group.resolvedDuplicate && group.suppressed) {
        this.options.diagnostic({
          sessionId: this.options.sessionId,
          outcome: "duplicate_suppressed",
          retainedUtteranceId:
            group.selected.utterance.utteranceId,
          retainedSource: group.selected.source,
          suppressedUtteranceId:
            group.suppressed.utterance.utteranceId,
          suppressedSource: group.suppressed.source,
          retainedNormalizedText: normalizeTranscript(
            group.selected.utterance.text
          ),
          suppressedNormalizedText: normalizeTranscript(
            group.suppressed.utterance.text
          ),
          similarity: group.similarity,
          completionDeltaMs: group.completionDeltaMs,
          sourceTimingDeltaMs: group.sourceTimingDeltaMs,
          arbitrationDelayMs: delay,
          reason: "cross_source_transcript_match"
        });
      } else {
        this.options.diagnostic(
          this.diagnosticForAccepted(
            group.selected,
            "window_elapsed_no_duplicate",
            delay
          )
        );
      }
    }
  }

  private diagnosticForAccepted(
    input: SourceCompletedUtterance,
    reason:
      | "single_source_mode"
      | "window_elapsed_no_duplicate",
    delay: number
  ): CrossSourceArbitrationDiagnostic {
    return {
      sessionId: this.options.sessionId,
      outcome: "accepted",
      retainedUtteranceId: input.utterance.utteranceId,
      retainedSource: input.source,
      suppressedUtteranceId: null,
      suppressedSource: null,
      retainedNormalizedText: normalizeTranscript(
        input.utterance.text
      ),
      suppressedNormalizedText: null,
      similarity: null,
      completionDeltaMs: null,
      sourceTimingDeltaMs: null,
      arbitrationDelayMs: delay,
      reason
    };
  }

  private sortPending(): void {
    this.pending.sort(
      (left, right) =>
        left.firstCompletedAtMs - right.firstCompletedAtMs ||
        left.order - right.order
    );
  }

  private armTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clear(this.timer);
      this.timer = null;
    }
    const unresolved = this.pending.filter(
      (group) => !group.resolvedDuplicate
    );
    if (unresolved.length === 0) return;
    const nextDue = Math.min(
      ...unresolved.map((group) => group.dueAtMs)
    );
    const delay = Math.max(0, nextDue - this.scheduler.now());
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      this.drain(this.scheduler.now());
      this.armTimer();
    }, delay);
  }
}

