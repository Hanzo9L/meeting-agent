import { safeStorage } from "electron";
import Store from "electron-store";
import {
  DEFAULT_KNOWLEDGE_BASE_BRANCH,
  DEFAULT_KNOWLEDGE_BASE_REPO_URL,
  DEFAULT_TOPIC,
  DEFAULT_TOPIC_PROMPT
} from "@shared/constants";
import type { ApiKeys, AppSettings, KnowledgeBaseSettings, OverlayPrefs } from "@shared/types";

const ENV_DEEPGRAM_API_KEY = process.env["DEEPGRAM_API_KEY"] ?? "";
const ENV_OPENAI_API_KEY = process.env["OPENAI_API_KEY"] ?? "";

type StoreSchema = {
  topic: string;
  topicPromptTemplate: string;
  overlay: OverlayPrefs;
  demoMode: boolean;
  knowledgeBase: KnowledgeBaseSettings;
  deepgramApiKey: string;
  openAiApiKey: string;
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
  demoMode: false,
  knowledgeBase: {
    enabled: true,
    repoUrl: DEFAULT_KNOWLEDGE_BASE_REPO_URL,
    branch: DEFAULT_KNOWLEDGE_BASE_BRANCH
  },
  deepgramApiKey: "",
  openAiApiKey: ""
};

export class SettingsStore {
  private readonly store = new Store<StoreSchema>({
    name: "meeting-agent-settings",
    defaults
  });

  getSettings(): AppSettings {
    const storedDeepgram = this.decrypt(this.store.get("deepgramApiKey"));
    const storedOpenAi = this.decrypt(this.store.get("openAiApiKey"));

    return {
      topic: this.store.get("topic"),
      topicPromptTemplate: this.store.get("topicPromptTemplate"),
      overlay: this.store.get("overlay"),
      demoMode: this.store.get("demoMode"),
      knowledgeBase: this.store.get("knowledgeBase"),
      apiKeys: {
        deepgramApiKey: storedDeepgram || ENV_DEEPGRAM_API_KEY,
        openAiApiKey: storedOpenAi || ENV_OPENAI_API_KEY
      }
    };
  }

  updateTopic(topic: string): void {
    this.store.set("topic", topic);
  }

  updateOverlay(prefs: Partial<OverlayPrefs>): void {
    this.store.set("overlay", {
      ...this.store.get("overlay"),
      ...prefs
    });
  }

  updateDemoMode(enabled: boolean): void {
    this.store.set("demoMode", enabled);
  }

  updateKnowledgeBaseSettings(settings: Partial<KnowledgeBaseSettings>): void {
    this.store.set("knowledgeBase", {
      ...this.store.get("knowledgeBase"),
      ...settings
    });
  }

  updateApiKeys(apiKeys: ApiKeys): void {
    this.store.set("deepgramApiKey", this.encrypt(apiKeys.deepgramApiKey));
    this.store.set("openAiApiKey", this.encrypt(apiKeys.openAiApiKey));
  }

  private encrypt(value: string): string {
    if (!value) return "";
    if (!safeStorage.isEncryptionAvailable()) return value;
    return safeStorage.encryptString(value).toString("base64");
  }

  private decrypt(value: string): string {
    if (!value) return "";
    if (!safeStorage.isEncryptionAvailable()) return value;
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }
}
