import type {
  HelpdeskAnswerRun,
  HelpdeskConversationView,
  HelpdeskMessage
} from "@shared/helpdesk";

export type HelpdeskTimelineRow =
  | {
      kind: "message";
      id: string;
      message: HelpdeskMessage;
    }
  | {
      kind: "answer_status";
      id: string;
      run: HelpdeskAnswerRun;
      text: string;
      tone: "neutral" | "error";
    };

export function resolveComposerInputOrigin(
  hasPastedContent: boolean
): "typed" | "pasted" {
  return hasPastedContent ? "pasted" : "typed";
}

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export async function copyAnswerText(
  answerText: string,
  clipboard: ClipboardWriter
): Promise<void> {
  await clipboard.writeText(answerText);
}

function statusPresentation(run: HelpdeskAnswerRun): {
  text: string;
  tone: "neutral" | "error";
} | null {
  if (run.state === "completed" || run.state === "partial") return null;
  if (run.state === "failed") {
    return {
      text:
        "Relay could not complete and validate this answer. No factual answer was saved.",
      tone: "error"
    };
  }
  if (run.state === "cancelled") {
    return { text: "The answer request was cancelled.", tone: "neutral" };
  }
  return { text: "Preparing an answer…", tone: "neutral" };
}

export function buildHelpdeskTimeline(
  view: HelpdeskConversationView
): HelpdeskTimelineRow[] {
  const runsByUserMessage = new Map<string, HelpdeskAnswerRun[]>();
  for (const run of view.answerRuns) {
    const existing = runsByUserMessage.get(run.triggeringUserMessageId) ?? [];
    existing.push(run);
    runsByUserMessage.set(run.triggeringUserMessageId, existing);
  }

  const rows: HelpdeskTimelineRow[] = [];
  for (const message of [...view.messages].sort(
    (left, right) => left.turnIndex - right.turnIndex
  )) {
    rows.push({
      kind: "message",
      id: message.id,
      message
    });
    if (message.role !== "user") continue;
    const runs = runsByUserMessage.get(message.id) ?? [];
    for (const run of runs) {
      const presentation = statusPresentation(run);
      if (!presentation) continue;
      rows.push({
        kind: "answer_status",
        id: `status:${run.id}`,
        run,
        ...presentation
      });
    }
  }
  return rows;
}
