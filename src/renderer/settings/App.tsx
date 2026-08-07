import { FormEvent, useEffect, useState } from "react";
import type { JSX } from "react";
import type {
  AnswerTriggerMode,
  ApiKeys,
  CaptureSourceMode,
  KnowledgeBaseSettings,
  KnowledgeBaseStatus,
  OverlayPrefs
} from "@shared/types";

const DEFAULT_KNOWLEDGE_BASE_STATUS: KnowledgeBaseStatus = {
  ready: false,
  syncing: false,
  docCount: 0,
  lastSyncedAt: null,
  error: null,
  localPath: ""
};

export function SettingsApp(): JSX.Element {
  const [topic, setTopic] = useState("");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [captureSourceMode, setCaptureSourceMode] = useState<CaptureSourceMode>("both");
  const [answerTriggerMode, setAnswerTriggerMode] = useState<AnswerTriggerMode>("questions_only");
  const [knowledgeBaseEnabled, setKnowledgeBaseEnabled] = useState(true);
  const [knowledgeBaseRepoUrl, setKnowledgeBaseRepoUrl] = useState("");
  const [knowledgeBaseBranch, setKnowledgeBaseBranch] = useState("main");
  const [knowledgeBaseStatus, setKnowledgeBaseStatus] = useState<KnowledgeBaseStatus>(
    DEFAULT_KNOWLEDGE_BASE_STATUS
  );
  const [overlay, setOverlay] = useState<OverlayPrefs>({
    x: 40,
    y: 40,
    width: 540,
    height: 420,
    opacity: 0.94
  });
  const [savedAt, setSavedAt] = useState("");
  const [saveError, setSaveError] = useState("");
  const [bridgeReady, setBridgeReady] = useState(false);

  useEffect(() => {
    const api = window.settingsApi;
    if (!api) {
      setSaveError("Settings API is unavailable.");
      return;
    }
    setBridgeReady(true);

    void (async () => {
      try {
        const settings = await api.getSettings();
        setTopic(settings.topic);
        setDeepgramApiKey(settings.apiKeys.deepgramApiKey);
        setOpenAiApiKey(settings.apiKeys.openAiApiKey);
        setOverlay(settings.overlay);
        setDemoMode(settings.demoMode);
        setCaptureSourceMode(settings.captureSourceMode);
        setAnswerTriggerMode(settings.answerTriggerMode);
        setKnowledgeBaseEnabled(settings.knowledgeBase.enabled);
        setKnowledgeBaseRepoUrl(settings.knowledgeBase.repoUrl);
        setKnowledgeBaseBranch(settings.knowledgeBase.branch);
        const status = await api.getKnowledgeBaseStatus();
        setKnowledgeBaseStatus(status);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setSaveError(`Failed to load settings: ${message}`);
      }
    })();
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaveError("");
    const api = window.settingsApi;
    if (!api) {
      setSaveError("Settings API is unavailable.");
      return;
    }

    const normalizedOverlay: OverlayPrefs = {
      x: Number.isFinite(overlay.x) ? overlay.x : 40,
      y: Number.isFinite(overlay.y) ? overlay.y : 40,
      width: Number.isFinite(overlay.width) && overlay.width > 200 ? overlay.width : 540,
      height: Number.isFinite(overlay.height) && overlay.height > 140 ? overlay.height : 420,
      opacity:
        Number.isFinite(overlay.opacity) && overlay.opacity >= 0.2 && overlay.opacity <= 1
          ? overlay.opacity
          : 0.94
    };
    const apiKeys: ApiKeys = { deepgramApiKey, openAiApiKey };
    const knowledgeBaseSettings: KnowledgeBaseSettings = {
      enabled: knowledgeBaseEnabled,
      repoUrl: knowledgeBaseRepoUrl.trim(),
      branch: knowledgeBaseBranch.trim() || "main"
    };
    try {
      await Promise.all([
        api.updateTopic(topic),
        api.updateApiKeys(apiKeys),
        api.updateCaptureSourceMode(captureSourceMode),
        api.updateAnswerTriggerMode(answerTriggerMode),
        api.updateOverlayPrefs(normalizedOverlay),
        api.updateDemoMode(demoMode),
        api.updateKnowledgeBaseSettings(knowledgeBaseSettings)
      ]);

      setOverlay(normalizedOverlay);
      setKnowledgeBaseStatus(await api.getKnowledgeBaseStatus());
      setSavedAt(new Date().toLocaleTimeString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveError(`Save failed: ${message}`);
    }
  };

  const syncKnowledgeBase = async (): Promise<void> => {
    setSaveError("");
    try {
      const status = await window.settingsApi.syncKnowledgeBase();
      setKnowledgeBaseStatus(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveError(`Knowledge base sync failed: ${message}`);
    }
  };

  const lastSyncedLabel = knowledgeBaseStatus.lastSyncedAt
    ? new Date(knowledgeBaseStatus.lastSyncedAt).toLocaleString()
    : "Never";

  return (
    <main className="settingsRoot">
      <h1>Meeting Agent Settings</h1>
      <form onSubmit={(event) => void save(event)}>
        <label>
          Topic
          <input value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>

        <label>
          Deepgram API key
          <input
            value={deepgramApiKey}
            onChange={(event) => setDeepgramApiKey(event.target.value)}
            placeholder="dg_..."
          />
        </label>

        <label>
          OpenAI API key
          <input
            value={openAiApiKey}
            onChange={(event) => setOpenAiApiKey(event.target.value)}
            placeholder="sk-..."
          />
        </label>

        <section>
          <h2>Live capture behavior</h2>
          <div className="grid">
            <label>
              Capture source
              <select
                value={captureSourceMode}
                onChange={(event) => setCaptureSourceMode(event.target.value as CaptureSourceMode)}
              >
                <option value="system">System (callee / participant)</option>
                <option value="microphone">Microphone (self)</option>
                <option value="both">Both (system + microphone)</option>
              </select>
            </label>
            <label>
              Answer trigger
              <select
                value={answerTriggerMode}
                onChange={(event) => setAnswerTriggerMode(event.target.value as AnswerTriggerMode)}
              >
                <option value="questions_only">Questions only</option>
                <option value="all_final">Any finalized utterance</option>
              </select>
            </label>
          </div>
          <p className="hint">
            In <strong>Both</strong> mode, transcripts are tagged by source and answer generation
            prefers system audio so participant questions trigger reliably on Teams, Slack, and
            Webex calls.
          </p>
        </section>

        <section>
          <h2>Demo mode</h2>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(event) => setDemoMode(event.target.checked)}
            />
            <span>Show overlay in screen shares</span>
          </label>
          <p className="hint">
            Turns off Windows capture exclusion so meeting participants can see the overlay. Leave
            this off for private use during real calls.
          </p>
        </section>

        <section>
          <h2>Knowledge base (msteams-docs)</h2>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={knowledgeBaseEnabled}
              onChange={(event) => setKnowledgeBaseEnabled(event.target.checked)}
            />
            <span>Enable knowledge retrieval for answers</span>
          </label>
          <div className="grid">
            <label>
              Repository URL
              <input
                value={knowledgeBaseRepoUrl}
                onChange={(event) => setKnowledgeBaseRepoUrl(event.target.value)}
                placeholder="https://github.com/MicrosoftDocs/msteams-docs.git"
              />
            </label>
            <label>
              Branch
              <input
                value={knowledgeBaseBranch}
                onChange={(event) => setKnowledgeBaseBranch(event.target.value)}
                placeholder="main"
              />
            </label>
          </div>
          <div className="statusRow">
            <button type="button" onClick={() => void syncKnowledgeBase()}>
              Sync knowledge base now
            </button>
            <p className="hint compact">
              {knowledgeBaseStatus.syncing ? "Sync in progress..." : "Sync idle"} | Docs indexed:{" "}
              {knowledgeBaseStatus.docCount} | Last sync: {lastSyncedLabel}
              {knowledgeBaseStatus.error ? ` | Error: ${knowledgeBaseStatus.error}` : ""}
            </p>
          </div>
        </section>

        <section>
          <h2>Overlay</h2>
          <div className="grid">
            <label>
              X
              <input
                type="number"
                value={overlay.x}
                onChange={(event) =>
                  setOverlay((prev) => ({ ...prev, x: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              Y
              <input
                type="number"
                value={overlay.y}
                onChange={(event) =>
                  setOverlay((prev) => ({ ...prev, y: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              Width
              <input
                type="number"
                value={overlay.width}
                onChange={(event) =>
                  setOverlay((prev) => ({ ...prev, width: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              Height
              <input
                type="number"
                value={overlay.height}
                onChange={(event) =>
                  setOverlay((prev) => ({ ...prev, height: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              Opacity
              <input
                type="number"
                min="0.2"
                max="1"
                step="0.01"
                value={overlay.opacity}
                onChange={(event) =>
                  setOverlay((prev) => ({ ...prev, opacity: Number(event.target.value) }))
                }
              />
            </label>
          </div>
        </section>

        <button type="submit">Save settings</button>
        {!bridgeReady ? <p className="saveError">Loading settings...</p> : null}
        {savedAt ? <p className="saved">Saved at {savedAt}</p> : null}
        {saveError ? <p className="saveError">{saveError}</p> : null}
      </form>
    </main>
  );
}
