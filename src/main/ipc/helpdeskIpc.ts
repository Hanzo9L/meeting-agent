import { IPC_CHANNELS } from "@shared/constants";
import type {
  HelpdeskErrorCode,
  HelpdeskResult,
  SubmitHelpdeskMessageInput
} from "@shared/helpdesk";
import type { LiveAssistSessionView } from "@shared/types";
import {
  HelpdeskService,
  HelpdeskServiceError
} from "../services/conversations/helpdeskService";

export interface IpcEventLike {
  sender: {
    id: number;
  };
}

export interface IpcHandlerRegistrar {
  handle(
    channel: string,
    listener: (event: IpcEventLike, ...args: unknown[]) => unknown
  ): void;
}

export interface RegisterHelpdeskIpcOptions {
  registrar: IpcHandlerRegistrar;
  service: HelpdeskService;
  isTrustedSender(event: IpcEventLike): boolean;
  openExternal(url: string): Promise<void>;
  getLiveAssistSession(): LiveAssistSessionView | null;
  startLiveAssist(
    conversationId: string
  ): LiveAssistSessionView;
  stopLiveAssist(): Promise<LiveAssistSessionView | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HelpdeskServiceError(
      "invalid_request",
      `${field} is required and must be at most ${maxLength} characters.`
    );
  }
  return value.trim();
}

function resultError(
  code: HelpdeskErrorCode,
  message: string
): HelpdeskResult<never> {
  return {
    ok: false,
    error: { code, message }
  };
}

function secureHandler<T>(
  options: RegisterHelpdeskIpcOptions,
  handler: (...args: unknown[]) => T | Promise<T>
): (event: IpcEventLike, ...args: unknown[]) => Promise<HelpdeskResult<T>> {
  return async (event, ...args) => {
    if (!options.isTrustedSender(event)) {
      return resultError("unauthorized", "This request is not allowed.");
    }
    try {
      return {
        ok: true,
        data: await handler(...args)
      };
    } catch (error) {
      if (error instanceof HelpdeskServiceError) {
        return resultError(error.code, error.message);
      }
      return resultError("operation_failed", "The conversation operation could not be completed.");
    }
  };
}

export function registerHelpdeskIpcHandlers(
  options: RegisterHelpdeskIpcOptions
): void {
  options.registrar.handle(
    IPC_CHANNELS.helpdeskListConversations,
    secureHandler(options, () => options.service.listConversations())
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskCreateConversation,
    secureHandler(options, (rawTitle) => {
      if (rawTitle !== undefined && typeof rawTitle !== "string") {
        throw new HelpdeskServiceError("invalid_request", "Conversation title is invalid.");
      }
      const title =
        typeof rawTitle === "string"
          ? requiredString(rawTitle, "Conversation title", 200)
          : undefined;
      return options.service.createConversation(title);
    })
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskLoadConversation,
    secureHandler(options, (rawConversationId) =>
      options.service.loadConversation(
        requiredString(rawConversationId, "Conversation ID", 200)
      )
    )
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskRenameConversation,
    secureHandler(options, (rawInput) => {
      if (!isRecord(rawInput)) {
        throw new HelpdeskServiceError("invalid_request", "Rename request is invalid.");
      }
      return options.service.renameConversation(
        requiredString(rawInput["conversationId"], "Conversation ID", 200),
        requiredString(rawInput["title"], "Conversation title", 200)
      );
    })
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskDeleteConversation,
    secureHandler(options, (rawConversationId) =>
      options.service.deleteConversation(
        requiredString(rawConversationId, "Conversation ID", 200)
      )
    )
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskSubmitMessage,
    secureHandler(options, async (rawInput) => {
      if (!isRecord(rawInput)) {
        throw new HelpdeskServiceError("invalid_request", "Message request is invalid.");
      }
      const inputOrigin = rawInput["inputOrigin"];
      if (inputOrigin !== "typed" && inputOrigin !== "pasted") {
        throw new HelpdeskServiceError("invalid_request", "Message origin is invalid.");
      }
      const input: SubmitHelpdeskMessageInput = {
        conversationId: requiredString(
          rawInput["conversationId"],
          "Conversation ID",
          200
        ),
        content: requiredString(rawInput["content"], "Message text", 100_000),
        inputOrigin
      };
      return options.service.submitMessage(input);
    })
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskOpenCitation,
    secureHandler(options, async (rawInput) => {
      if (!isRecord(rawInput)) {
        throw new HelpdeskServiceError(
          "invalid_request",
          "Citation request is invalid."
        );
      }
      const url = options.service.getActionableCitationUrl(
        requiredString(rawInput["messageId"], "Message ID", 200),
        requiredString(rawInput["citationId"], "Citation ID", 200)
      );
      await options.openExternal(url);
      return { opened: true as const };
    })
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskGetLiveAssistSession,
    secureHandler(options, () => options.getLiveAssistSession())
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskStartLiveAssist,
    secureHandler(options, (rawConversationId) =>
      options.startLiveAssist(
        requiredString(
          rawConversationId,
          "Conversation ID",
          200
        )
      )
    )
  );

  options.registrar.handle(
    IPC_CHANNELS.helpdeskStopLiveAssist,
    secureHandler(options, () => options.stopLiveAssist())
  );
}
