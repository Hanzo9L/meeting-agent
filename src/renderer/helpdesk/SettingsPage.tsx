import { useEffect, useState, type FormEvent } from "react";
import type {
  ProviderCredentialId,
  RelaySettingsSnapshot
} from "@shared/types";

function providerLabel(provider: ProviderCredentialId): string {
  return provider === "deepgram"
    ? "Deepgram STT"
    : "OpenAI";
}

function ProviderSetting(props: {
  provider: ProviderCredentialId;
  settings: RelaySettingsSnapshot;
  onChanged(settings: RelaySettingsSnapshot): void;
}) {
  const status =
    props.provider === "deepgram"
      ? props.settings.providers.deepgram
      : props.settings.providers.openAiEmbeddings;
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);

  const configure = async (): Promise<void> => {
    setError(null);
    const result =
      await window.helpdeskApi.setProviderCredential(
        props.provider,
        credential
      );
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCredential("");
    props.onChanged(result.data);
  };

  const clear = async (): Promise<void> => {
    setError(null);
    const result =
      await window.helpdeskApi.clearProviderCredential(
        props.provider
      );
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCredential("");
    props.onChanged(result.data);
  };

  return (
    <div className="provider-setting">
      <div className="provider-setting-heading">
        <div>
          <strong>{providerLabel(props.provider)}</strong>
          <p>
            {props.provider === "deepgram"
              ? "Speech-to-text for Live Assist."
              : "Semantic retrieval, live question completion/planning, and one evidence-bound interview answer call."}
          </p>
        </div>
        <span className={`provider-state ${status.state}`}>
          {status.state}
          {status.externallyManaged
            ? " · externally managed"
            : status.maskedSuffix
              ? ` · ••••${status.maskedSuffix}`
              : ""}
        </span>
      </div>
      <div className="credential-row">
        <input
          type="password"
          autoComplete="new-password"
          aria-label={`${providerLabel(props.provider)} credential`}
          placeholder={
            status.externallyManaged
              ? "Managed by environment"
              : "Enter a replacement credential"
          }
          disabled={status.externallyManaged}
          value={credential}
          onChange={(event) => setCredential(event.target.value)}
        />
        <button
          type="button"
          disabled={
            status.externallyManaged || !credential.trim()
          }
          onClick={() => void configure()}
        >
          Configure
        </button>
        <button
          type="button"
          disabled={
            status.externallyManaged ||
            status.state === "missing"
          }
          onClick={() => void clear()}
        >
          Clear
        </button>
      </div>
      {error ? <p className="settings-error">{error}</p> : null}
    </div>
  );
}

export function SettingsPage(props: {
  settings: RelaySettingsSnapshot;
  onChanged(settings: RelaySettingsSnapshot): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(props.settings);
  const [microphones, setMicrophones] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setMicrophones(
          devices
            .filter((device) => device.kind === "audioinput")
            .map((device, index) => ({
              deviceId: device.deviceId,
              label:
                device.label || `Microphone ${index + 1}`
            }))
        );
      })
      .catch(() => setMicrophones([]));
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setNotice(null);
    const result =
      await window.helpdeskApi.updateRelaySettings({
        captureSourceMode: draft.speech.captureSourceMode,
        answerTriggerMode: draft.speech.answerTriggerMode,
        microphoneDeviceId: draft.speech.microphoneDeviceId,
        microphoneLabel: draft.speech.microphoneLabel,
        overlayAutoShow: draft.overlay.autoShow,
        overlay: {
          width: draft.overlay.width,
          height: draft.overlay.height,
          opacity: draft.overlay.opacity
        },
        visibleInScreenShare:
          draft.overlay.visibleInScreenShare
      });
    if (!result.ok) {
      setNotice(result.error.message);
      return;
    }
    props.onChanged(result.data);
    setNotice("Settings saved.");
  };

  const applyProviderSettings = (
    settings: RelaySettingsSnapshot
  ): void => {
    setDraft(settings);
    props.onChanged(settings);
  };

  return (
    <main className="settings-page">
      <header className="settings-page-header">
        <div>
          <div className="eyebrow">
            Relay: Real-Time Operations
          </div>
          <h2>Settings</h2>
        </div>
        <button type="button" onClick={props.onClose}>
          Back to conversation
        </button>
      </header>

      <section>
        <h3>Providers</h3>
        <ProviderSetting
          provider="deepgram"
          settings={draft}
          onChanged={applyProviderSettings}
        />
        <ProviderSetting
          provider="openai_embeddings"
          settings={draft}
          onChanged={applyProviderSettings}
        />
      </section>

      <form onSubmit={(event) => void save(event)}>
        <section>
          <h3>Speech / Live Assist</h3>
          <div className="settings-grid">
            <label>
              Capture mode
              <select
                value={draft.speech.captureSourceMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    speech: {
                      ...current.speech,
                      captureSourceMode: event.target.value as
                        | "microphone"
                        | "system"
                        | "both"
                    }
                  }))
                }
              >
                <option value="microphone">Microphone</option>
                <option value="system">System audio</option>
                <option value="both">
                  Microphone and system audio
                </option>
              </select>
            </label>
            <label>
              Microphone
              <select
                value={draft.speech.microphoneDeviceId ?? ""}
                onChange={(event) => {
                  const selected = microphones.find(
                    (device) =>
                      device.deviceId === event.target.value
                  );
                  setDraft((current) => ({
                    ...current,
                    speech: {
                      ...current.speech,
                      microphoneDeviceId:
                        selected?.deviceId || null,
                      microphoneLabel: selected?.label || null
                    }
                  }));
                }}
              >
                <option value="">System default</option>
                {microphones.map((microphone) => (
                  <option
                    key={microphone.deviceId}
                    value={microphone.deviceId}
                  >
                    {microphone.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Question trigger
              <select
                value={draft.speech.answerTriggerMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    speech: {
                      ...current.speech,
                      answerTriggerMode: event.target.value as
                        | "questions_only"
                        | "all_final"
                    }
                  }))
                }
              >
                <option value="questions_only">
                  Questions only
                </option>
                <option value="all_final">
                  Every finalized utterance (advanced)
                </option>
              </select>
            </label>
          </div>
        </section>

        <section>
          <h3>Overlay</h3>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.overlay.autoShow}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  overlay: {
                    ...current.overlay,
                    autoShow: event.target.checked
                  }
                }))
              }
            />
            Show overlay when Live Assist starts
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.overlay.visibleInScreenShare}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  overlay: {
                    ...current.overlay,
                    visibleInScreenShare: event.target.checked
                  }
                }))
              }
            />
            Show overlay in screen shares
          </label>
          <div className="settings-grid">
            <label>
              Width
              <input
                type="number"
                min="240"
                value={draft.overlay.width}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    overlay: {
                      ...current.overlay,
                      width: Number(event.target.value)
                    }
                  }))
                }
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="160"
                value={draft.overlay.height}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    overlay: {
                      ...current.overlay,
                      height: Number(event.target.value)
                    }
                  }))
                }
              />
            </label>
            <label>
              Opacity
              <input
                type="number"
                min="0.2"
                max="1"
                step="0.05"
                value={draft.overlay.opacity}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    overlay: {
                      ...current.overlay,
                      opacity: Number(event.target.value)
                    }
                  }))
                }
              />
            </label>
          </div>
        </section>

        <section>
          <h3>Privacy</h3>
          <p>
            Relay persists accepted questions and validated answers.
            Raw audio and continuous transcript text are not persisted.
          </p>
        </section>

        <div className="settings-save-row">
          <button type="submit">Save settings</button>
          {notice ? <span role="status">{notice}</span> : null}
        </div>
      </form>
    </main>
  );
}
