import { safeStorage } from "electron";
import Store from "electron-store";
import {
  DEFAULT_HOTKEY,
  DEFAULT_TOPIC,
  DEFAULT_TOPIC_PROMPT
} from "@shared/constants";
import type { ApiKeys, AppSettings, OverlayPrefs } from "@shared/types";

type StoreSchema = {
  topic: string;
  topicPromptTemplate: string;
  hotkey: string;
  overlay: OverlayPrefs;
  deepgramApiKey: string;
  openAiApiKey: string;
};

const defaults: StoreSchema = {
  topic: DEFAULT_TOPIC,
  topicPromptTemplate: DEFAULT_TOPIC_PROMPT,
  hotkey: DEFAULT_HOTKEY,
  overlay: {
    x: 40,
    y: 40,
    width: 540,
    height: 420,
    opacity: 0.94
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
    return {
      topic: this.store.get("topic"),
      topicPromptTemplate: this.store.get("topicPromptTemplate"),
      hotkey: this.store.get("hotkey"),
      overlay: this.store.get("overlay"),
      apiKeys: {
        deepgramApiKey: this.decrypt(this.store.get("deepgramApiKey")),
        openAiApiKey: this.decrypt(this.store.get("openAiApiKey"))
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

  updateHotkey(hotkey: string): void {
    this.store.set("hotkey", hotkey);
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
