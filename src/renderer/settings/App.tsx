import { FormEvent, useEffect, useState } from "react";
import type { JSX } from "react";
import type { ApiKeys, OverlayPrefs } from "@shared/types";

export function SettingsApp(): JSX.Element {
  const [topic, setTopic] = useState("");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
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
    try {
      await Promise.all([
        api.updateTopic(topic),
        api.updateApiKeys(apiKeys),
        api.updateOverlayPrefs(normalizedOverlay)
      ]);

      setOverlay(normalizedOverlay);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveError(`Save failed: ${message}`);
    }
  };

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
