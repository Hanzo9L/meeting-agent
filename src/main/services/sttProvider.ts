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

export interface RawSttDiagnostic {
  event: "results" | "utterance_end";
  timestamp: number;
  transcriptLength: number;
  transcriptPreview: string | null;
  isFinal: boolean | null;
  speechFinal: boolean | null;
}

export interface SttEvents {
  onInterim: (text: string) => void;
  onUtterance: (utterance: CompletedSttUtterance) => void;
  onError: (message: string) => void;
  onDiagnostic?: (diagnostic: RawSttDiagnostic) => void;
}

export interface SttProvider {
  start(events: SttEvents): Promise<void>;
  sendAudio(chunk: Int16Array): void;
  stop(): Promise<void>;
}
