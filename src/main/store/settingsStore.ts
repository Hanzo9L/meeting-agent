import { safeStorage } from "electron";
import Store from "electron-store";
import {
  DEFAULT_KNOWLEDGE_BASE_BRANCH,
  DEFAULT_KNOWLEDGE_BASE_REPO_URL,
  DEFAULT_TOPIC,
  DEFAULT_TOPIC_PROMPT
} from "@shared/constants";
import type {
  AnswerTriggerMode,
  CaptureSourceMode,
  KnowledgeBaseSettings,
  OverlayPrefs,
  ProviderCredentialId,
  ProviderCredentialStatus,
  RelaySettingsSnapshot,
  UpdateRelaySettingsInput
} from "@shared/types";
import {
  credentialPresentationStatus,
  resolveProviderCredential
} from "./providerCredentialResolver";

const ENV_DEEPGRAM_API_KEY = process.env["DEEPGRAM_API_KEY"] ?? "";
const ENV_OPENAI_API_KEY = process.env["OPENAI_API_KEY"] ?? "";

type StoreSchema = {
  topic: string;
  topicPromptTemplate: string;
  overlay: OverlayPrefs;
  captureSourceMode: CaptureSourceMode;
  answerTriggerMode: AnswerTriggerMode;
  demoMode: boolean;
  knowledgeBase: KnowledgeBaseSettings;
  deepgramApiKey: string;
  openAiApiKey: string;
  microphoneDeviceId: string | null;
  microphoneLabel: string | null;
  renderEndpointId: string | null;
  renderEndpointLabel: string | null;
  overlayAutoShow: boolean;
};

const defaults: StoreSchema = {
  topic: DEFAULT_TOPIC,
  topicPromptTemplate: DEFAULT_TOPIC_PROMPT,
  overlay: {
    x: 40,
    y: 40,
    width: 540,
    height: 420,
    opacity: 0.94
  },
  captureSourceMode: "both",
  answerTriggerMode: "questions_only",
  demoMode: false,
  knowledgeBase: {
    enabled: true,
    repoUrl: DEFAULT_KNOWLEDGE_BASE_REPO_URL,
    branch: DEFAULT_KNOWLEDGE_BASE_BRANCH
  },
  deepgramApiKey: "",
  openAiApiKey: "",
  microphoneDeviceId: null,
  microphoneLabel: null,
  renderEndpointId: null,
  renderEndpointLabel: null,
  overlayAutoShow: false
};

export class SettingsStore {
  private readonly store = new Store<StoreSchema>({
    name: "meeting-agent-settings",
    defaults
  });

  getRelaySettings(): RelaySettingsSnapshot {
    return {
      providers: {
        deepgram: this.getProviderStatus("deepgram"),
        openAiEmbeddings: this.getProviderStatus(
          "openai_embeddings"
        )
      },
      speech: {
        captureSourceMode: this.store.get("captureSourceMode"),
        answerTriggerMode: this.store.get("answerTriggerMode"),
        microphoneDeviceId:
          this.store.get("microphoneDeviceId"),
        microphoneLabel: this.store.get("microphoneLabel")
      },
      overlay: {
        ...this.store.get("overlay"),
        autoShow: this.store.get("overlayAutoShow"),
        visibleInScreenShare: this.store.get("demoMode")
      },
      privacy: {
        persistsRawAudio: false,
        persistsContinuousTranscript: false
      }
    };
  }

  updateRelaySettings(
    input: UpdateRelaySettingsInput
  ): RelaySettingsSnapshot {
    this.store.set(
      "captureSourceMode",
      input.captureSourceMode
    );
    this.store.set(
      "answerTriggerMode",
      input.answerTriggerMode
    );
    this.store.set(
      "microphoneDeviceId",
      input.microphoneDeviceId
    );
    this.store.set(
      "microphoneLabel",
      input.microphoneLabel
    );
    this.store.set("overlayAutoShow", input.overlayAutoShow);
    this.store.set("demoMode", input.visibleInScreenShare);
    this.updateOverlay(input.overlay);
    return this.getRelaySettings();
  }

  getRememberedRenderEndpoint(): {
    id: string | null;
    label: string | null;
  } {
    const id = this.store.get("renderEndpointId");
    const label = this.store.get("renderEndpointLabel");
    return {
      id: typeof id === "string" && id ? id : null,
      label: typeof label === "string" && label ? label : null
    };
  }

  setRememberedRenderEndpoint(id: string, label: string): void {
    this.store.set("renderEndpointId", id);
    this.store.set("renderEndpointLabel", label);
  }

  getProviderCredential(
    provider: ProviderCredentialId
  ): string {
    return this.resolvedCredential(provider).value;
  }

  getProviderStatus(
    provider: ProviderCredentialId
  ): ProviderCredentialStatus {
    return credentialPresentationStatus(
      provider,
      this.resolvedCredential(provider)
    );
  }

  setProviderCredential(
    provider: ProviderCredentialId,
    credential: string
  ): RelaySettingsSnapshot {
    if (this.environmentCredential(provider)) {
      throw new Error(
        "This credential is managed by the application environment."
      );
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "Secure operating-system credential storage is unavailable."
      );
    }
    const value = credential.trim();
    if (!value) {
      throw new Error("Provider credential is required.");
    }
    this.store.set(
      this.credentialStoreKey(provider),
      safeStorage.encryptString(value).toString("base64")
    );
    this.applyRuntimeCredentials();
    return this.getRelaySettings();
  }

  clearProviderCredential(
    provider: ProviderCredentialId
  ): RelaySettingsSnapshot {
    if (this.environmentCredential(provider)) {
      throw new Error(
        "This credential is managed by the application environment."
      );
    }
    this.store.set(this.credentialStoreKey(provider), "");
    this.applyRuntimeCredentials();
    return this.getRelaySettings();
  }

  applyRuntimeCredentials(): void {
    if (!ENV_OPENAI_API_KEY) {
      const stored =
        this.getProviderCredential("openai_embeddings");
      if (stored) process.env["OPENAI_API_KEY"] = stored;
      else delete process.env["OPENAI_API_KEY"];
    }
  }

  private updateOverlay(prefs: Partial<OverlayPrefs>): void {
    this.store.set("overlay", {
      ...this.store.get("overlay"),
      ...prefs
    });
  }

  private credentialStoreKey(
    provider: ProviderCredentialId
  ): "deepgramApiKey" | "openAiApiKey" {
    return provider === "deepgram"
      ? "deepgramApiKey"
      : "openAiApiKey";
  }

  private environmentCredential(
    provider: ProviderCredentialId
  ): string {
    return (
      provider === "deepgram"
        ? ENV_DEEPGRAM_API_KEY
        : ENV_OPENAI_API_KEY
    ).trim();
  }

  private resolvedCredential(provider: ProviderCredentialId) {
    return resolveProviderCredential({
      environmentValue: this.environmentCredential(provider),
      storedValue: this.store.get(
        this.credentialStoreKey(provider)
      ),
      decryptor: {
        available: safeStorage.isEncryptionAvailable(),
        decrypt: (encryptedValue) =>
          safeStorage.decryptString(
            Buffer.from(encryptedValue, "base64")
          )
      }
    });
  }
}
