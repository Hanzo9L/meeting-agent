import { FormEvent, useEffect, useState } from "react";
import type { JSX } from "react";
import type { ApiKeys, OverlayPrefs } from "@shared/types";

export function SettingsApp(): JSX.Element {
  const [topic, setTopic] = useState("");
  const [hotkey, setHotkey] = useState("");
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

  useEffect(() => {
    void (async () => {
      const settings = await window.settingsApi.getSettings();
      setTopic(settings.topic);
      setHotkey(settings.hotkey);
      setDeepgramApiKey(settings.apiKeys.deepgramApiKey);
      setOpenAiApiKey(settings.apiKeys.openAiApiKey);
      setOverlay(settings.overlay);
    })();
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const apiKeys: ApiKeys = { deepgramApiKey, openAiApiKey };
    await Promise.all([
      window.settingsApi.updateTopic(topic),
      window.settingsApi.updateHotkey(hotkey),
      window.settingsApi.updateApiKeys(apiKeys),
      window.settingsApi.updateOverlayPrefs(overlay)
    ]);

    setSavedAt(new Date().toLocaleTimeString());
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
          Global hotkey
          <input value={hotkey} onChange={(event) => setHotkey(event.target.value)} />
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
        {savedAt ? <p className="saved">Saved at {savedAt}</p> : null}
      </form>
    </main>
  );
}
