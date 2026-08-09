import { createHash } from "node:crypto";
import type {
  CompletedSttUtterance,
  SttUtteranceCompletionSignal
} from "./sttProvider";

export interface DeepgramWordTiming {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
}

export interface DeepgramFinalSegment {
  text: string;
  start?: number;
  duration?: number;
  words?: DeepgramWordTiming[];
}

export interface DeepgramTranscriptMessage {
  type?: string;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      words?: DeepgramWordTiming[];
    }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
}

export interface ProcessedDeepgramTranscript {
  interimText: string | null;
  completedUtterance: CompletedSttUtterance | null;
}

function normalizeToken(token: string): string {
  return token.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function mergeOverlappingText(base: string, incoming: string): string {
  const baseTokens = base.split(/\s+/).filter(Boolean);
  const incomingTokens = incoming.split(/\s+/).filter(Boolean);
  if (baseTokens.length === 0) return incomingTokens.join(" ");
  if (incomingTokens.length === 0) return baseTokens.join(" ");

  const maximum = Math.min(baseTokens.length, incomingTokens.length);
  let overlap = 0;
  for (let size = maximum; size > 0; size -= 1) {
    const baseSuffix = baseTokens
      .slice(-size)
      .map(normalizeToken);
    const incomingPrefix = incomingTokens
      .slice(0, size)
      .map(normalizeToken);
    if (
      baseSuffix.every(
        (token, index) =>
          token.length > 0 && token === incomingPrefix[index]
      )
    ) {
      overlap = size;
      break;
    }
  }
  return [...baseTokens, ...incomingTokens.slice(overlap)]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export class DeepgramUtteranceAssembler {
  private text = "";
  private segmentCount = 0;
  private firstStartSeconds: number | null = null;
  private lastEndSeconds: number | null = null;
  private speechFinalObserved = false;
  private nextUtteranceSequence = 1;
  private readonly timedSegmentKeys = new Set<string>();

  addFinalSegment(segment: DeepgramFinalSegment): string {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) return this.text;

    const start = finite(segment.start);
    const duration = finite(segment.duration);
    const wordStarts =
      segment.words?.map((word) => finite(word.start)).filter(
        (value): value is number => value !== null
      ) ?? [];
    const wordEnds =
      segment.words?.map((word) => finite(word.end)).filter(
        (value): value is number => value !== null
      ) ?? [];
    const segmentStart = start ?? wordStarts[0] ?? null;
    const segmentEnd =
      (start !== null && duration !== null
        ? start + duration
        : null) ??
      wordEnds.at(-1) ??
      null;

    if (segmentStart !== null || segmentEnd !== null) {
      const timedKey = `${segmentStart ?? "?"}:${
        segmentEnd ?? "?"
      }:${text}`;
      if (this.timedSegmentKeys.has(timedKey)) return this.text;
      this.timedSegmentKeys.add(timedKey);
    }

    this.text = mergeOverlappingText(this.text, text);
    this.segmentCount += 1;
    this.firstStartSeconds ??= segmentStart;
    if (segmentEnd !== null) {
      this.lastEndSeconds = Math.max(
        this.lastEndSeconds ?? segmentEnd,
        segmentEnd
      );
    }
    return this.text;
  }

  preview(interimText: string): string {
    return mergeOverlappingText(
      this.text,
      interimText.replace(/\s+/g, " ").trim()
    );
  }

  observeSpeechFinal(): void {
    this.speechFinalObserved = true;
  }

  complete(
    completionSignal: SttUtteranceCompletionSignal
  ): CompletedSttUtterance | null {
    const text = this.text.trim();
    if (!text) {
      this.clear();
      return null;
    }
    const identity = createHash("sha256")
      .update(
        JSON.stringify({
          utteranceSequence: this.nextUtteranceSequence,
          text,
          segmentCount: this.segmentCount,
          firstStartSeconds: this.firstStartSeconds,
          lastEndSeconds: this.lastEndSeconds,
          speechFinalObserved: this.speechFinalObserved
        })
      )
      .digest("hex")
      .slice(0, 24);
    this.nextUtteranceSequence += 1;
    const utterance: CompletedSttUtterance = {
      utteranceId: `utterance:${identity}`,
      text,
      completionSignal,
      segmentCount: this.segmentCount,
      sourceStartSeconds: this.firstStartSeconds,
      sourceEndSeconds: this.lastEndSeconds,
      speechFinalObserved: this.speechFinalObserved
    };
    this.clear();
    return utterance;
  }

  clear(): void {
    this.text = "";
    this.segmentCount = 0;
    this.firstStartSeconds = null;
    this.lastEndSeconds = null;
    this.speechFinalObserved = false;
    this.timedSegmentKeys.clear();
  }

  get bufferedText(): string {
    return this.text;
  }
}

/**
 * Interprets Deepgram transport events using UtteranceEnd as the authoritative
 * completion boundary. Results with is_final only extend the current buffer;
 * speech_final records an endpoint candidate but does not promote it.
 */
export class DeepgramUtteranceProcessor {
  private readonly assembler = new DeepgramUtteranceAssembler();

  process(
    message: DeepgramTranscriptMessage
  ): ProcessedDeepgramTranscript {
    if (message.type === "UtteranceEnd") {
      return {
        interimText: null,
        completedUtterance:
          this.assembler.complete("utterance_end")
      };
    }
    if (message.type !== "Results") {
      return {
        interimText: null,
        completedUtterance: null
      };
    }

    const alternative = message.channel?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim() ?? "";
    const isFinal = Boolean(message.is_final);
    if (isFinal && transcript) {
      this.assembler.addFinalSegment({
        text: transcript,
        start: message.start,
        duration: message.duration,
        words: alternative?.words
      });
    }
    if (message.speech_final) {
      this.assembler.observeSpeechFinal();
    }

    const interimText =
      !isFinal && transcript
        ? this.assembler.preview(transcript)
        : this.assembler.bufferedText;
    return {
      interimText: interimText || null,
      completedUtterance: null
    };
  }

  clear(): void {
    this.assembler.clear();
  }
}

