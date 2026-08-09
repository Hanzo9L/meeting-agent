import { IPC_CHANNELS } from "@shared/constants";
import type {
  HelpdeskErrorCode,
  HelpdeskResult,
  SubmitHelpdeskMessageInput
} from "@shared/helpdesk";
import type {
  LiveAssistSessionView,
  OverlayVisibilityState,
  ProviderCredentialId,
  RelaySettingsSnapshot,
  UpdateRelaySettingsInput
} from "@shared/types";
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
  getRelaySettings(): RelaySettingsSnapshot;
  updateRelaySettings(
    input: UpdateRelaySettingsInput
  ): RelaySettingsSnapshot;
  setProviderCredential(
    provider: ProviderCredentialId,
    credential: string
  ): RelaySettingsSnapshot;
  clearProviderCredential(
    provider: ProviderCredentialId
  ): RelaySettingsSnapshot;
  getOverlayVisibility(): OverlayVisibilityState;
  showOverlay(): Promise<OverlayVisibilityState>;
  hideOverlay(): OverlayVisibilityState;
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

function validateRelaySettings(
  rawInput: unknown
): UpdateRelaySettingsInput {
  if (!isRecord(rawInput) || !isRecord(rawInput["overlay"])) {
    throw new HelpdeskServiceError(
      "invalid_request",
      "Relay settings are invalid."
    );
  }
  const captureSourceMode = rawInput["captureSourceMode"];
  if (
    captureSourceMode !== "microphone" &&
    captureSourceMode !== "system" &&
    captureSourceMode !== "both"
  ) {
    throw new HelpdeskServiceError(
      "invalid_request",
      "Capture mode is invalid."
    );
  }
  const answerTriggerMode = rawInput["answerTriggerMode"];
  if (
    answerTriggerMode !== "questions_only" &&
    answerTriggerMode !== "all_final"
  ) {
    throw new HelpdeskServiceError(
      "invalid_request",
      "Question trigger policy is invalid."
    );
  }
  const nullableString = (
    value: unknown,
    field: string
  ): string | null => {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 500) {
      throw new HelpdeskServiceError(
        "invalid_request",
        `${field} is invalid.`
      );
    }
    return value;
  };
  const boundedNumber = (
    value: unknown,
    field: string,
    minimum: number,
    maximum: number
  ): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new HelpdeskServiceError(
        "invalid_request",
        `${field} is invalid.`
      );
    }
    return value;
  };
  if (
    typeof rawInput["overlayAutoShow"] !== "boolean" ||
    typeof rawInput["visibleInScreenShare"] !== "boolean"
  ) {
    throw new HelpdeskServiceError(
      "invalid_request",
      "Overlay preferences are invalid."
    );
  }
  const overlay = rawInput["overlay"];
  return {
    captureSourceMode,
    answerTriggerMode,
    microphoneDeviceId: nullableString(
      rawInput["microphoneDeviceId"],
      "Microphone"
    ),
    microphoneLabel: nullableString(
      rawInput["microphoneLabel"],
      "Microphone label"
    ),
    overlayAutoShow: rawInput["overlayAutoShow"],
    overlay: {
      width: boundedNumber(
        overlay["width"],
        "Overlay width",
        240,
        1920
      ),
      height: boundedNumber(
        overlay["height"],
        "Overlay height",
        160,
        1200
      ),
      opacity: boundedNumber(
        overlay["opacity"],
        "Overlay opacity",
        0.2,
        1
      )
    },
    visibleInScreenShare:
      rawInput["visibleInScreenShare"]
  };
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

  options.registrar.handle(
    IPC_CHANNELS.relaySettingsGet,
    secureHandler(options, () => options.getRelaySettings())
  );

  options.registrar.handle(
    IPC_CHANNELS.relaySettingsUpdate,
    secureHandler(options, (rawInput) =>
      options.updateRelaySettings(
        validateRelaySettings(rawInput)
      )
    )
  );

  options.registrar.handle(
    IPC_CHANNELS.relayProviderCredentialSet,
    secureHandler(options, (rawInput) => {
      if (!isRecord(rawInput)) {
        throw new HelpdeskServiceError(
          "invalid_request",
          "Provider credential request is invalid."
        );
      }
      const provider = rawInput["provider"];
      if (
        provider !== "deepgram" &&
        provider !== "openai_embeddings"
      ) {
        throw new HelpdeskServiceError(
          "invalid_request",
          "Provider is invalid."
        );
      }
      return options.setProviderCredential(
        provider,
        requiredString(
          rawInput["credential"],
          "Provider credential",
          20_000
        )
      );
    })
  );

  options.registrar.handle(
    IPC_CHANNELS.relayProviderCredentialClear,
    secureHandler(options, (rawProvider) => {
      if (
        rawProvider !== "deepgram" &&
        rawProvider !== "openai_embeddings"
      ) {
        throw new HelpdeskServiceError(
          "invalid_request",
          "Provider is invalid."
        );
      }
      return options.clearProviderCredential(rawProvider);
    })
  );

  options.registrar.handle(
    IPC_CHANNELS.relayOverlayGetVisibility,
    secureHandler(options, () => options.getOverlayVisibility())
  );
  options.registrar.handle(
    IPC_CHANNELS.relayOverlayShow,
    secureHandler(options, () => options.showOverlay())
  );
  options.registrar.handle(
    IPC_CHANNELS.relayOverlayHide,
    secureHandler(options, () => options.hideOverlay())
  );
}
