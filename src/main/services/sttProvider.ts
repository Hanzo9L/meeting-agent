export type SttUtteranceCompletionSignal =
  | "speech_final"
  | "utterance_end";

export interface CompletedSttUtterance {
  utteranceId: string;
  text: string;
  completionSignal: SttUtteranceCompletionSignal;
  segmentCount: number;
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
  speechFinalObserved: boolean;
}

export interface SttEvents {
  onInterim: (text: string) => void;
  onUtterance: (utterance: CompletedSttUtterance) => void;
  onError: (message: string) => void;
}

export interface SttProvider {
  start(events: SttEvents): Promise<void>;
  sendAudio(chunk: Int16Array): void;
  stop(): Promise<void>;
}
