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
      run: HelpdeskAnswerRun | null;
    }
  | {
      kind: "answer_status";
      id: string;
      run: HelpdeskAnswerRun;
      text: string;
      tone: "neutral" | "error";
    };

export const HELP_DESK_ACTIVE_CONVERSATION_KEY =
  "relay.helpdesk.activeConversationId";

export function resolveComposerInputOrigin(
  hasPastedContent: boolean
): "typed" | "pasted" {
  return hasPastedContent ? "pasted" : "typed";
}

export function resolveSubmitConversationId(
  activeConversationId: string | null
): string | null {
  return activeConversationId ? activeConversationId : null;
}

export function resolveInitialConversationId(
  conversations: Array<{ id: string }>,
  storedId: string | null
): string | null {
  if (storedId && conversations.some((item) => item.id === storedId)) {
    return storedId;
  }
  return conversations[0]?.id ?? null;
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

  const messages = [...view.messages].sort(
    (left, right) => left.turnIndex - right.turnIndex
  );
  const messagesById = new Map(
    messages.map((message) => [message.id, message] as const)
  );
  const claimedAssistantIds = new Set<string>();
  const rows: HelpdeskTimelineRow[] = [];
  for (const message of messages.filter(
    (entry) => entry.role === "user"
  )) {
    rows.push({
      kind: "message",
      id: message.id,
      message,
      run: null
    });
    const runs = [
      ...(runsByUserMessage.get(message.id) ?? [])
    ].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
    for (const run of runs) {
      const assistant = run.assistantMessageId
        ? messagesById.get(run.assistantMessageId)
        : undefined;
      if (assistant?.role === "assistant") {
        claimedAssistantIds.add(assistant.id);
        rows.push({
          kind: "message",
          id: `answer:${run.id}`,
          message: assistant,
          run
        });
        continue;
      }
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
  // Preserve any legacy/orphan assistant messages without assigning them to a
  // different user's run.
  for (const message of messages) {
    if (
      message.role === "assistant" &&
      !claimedAssistantIds.has(message.id)
    ) {
      rows.push({
        kind: "message",
        id: message.id,
        message,
        run: null
      });
    }
  }
  return rows;
}

export type HelpdeskInterviewTurn =
  | {
      kind: "turn";
      id: string;
      userMessageId: string;
      rows: HelpdeskTimelineRow[];
    }
  | {
      kind: "orphan";
      id: string;
      row: HelpdeskTimelineRow;
    };

export function groupHelpdeskInterviewTurns(
  rows: HelpdeskTimelineRow[]
): HelpdeskInterviewTurn[] {
  const grouped: HelpdeskInterviewTurn[] = [];
  let current: Extract<HelpdeskInterviewTurn, { kind: "turn" }> | null = null;
  const flush = (): void => {
    if (current) grouped.push(current);
    current = null;
  };
  for (const row of rows) {
    if (row.kind === "message" && row.message.role === "user") {
      flush();
      current = {
        kind: "turn",
        id: `turn:${row.message.id}`,
        userMessageId: row.message.id,
        rows: [row]
      };
      continue;
    }
    if (current) {
      current.rows.push(row);
      continue;
    }
    grouped.push({
      kind: "orphan",
      id: `orphan:${row.id}`,
      row
    });
  }
  flush();
  return grouped;
}

export function newestTurnUserMessageId(
  turns: HelpdeskInterviewTurn[]
): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.kind === "turn") return turn.userMessageId;
  }
  return null;
}
