import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type {
  CaptureSourceTag,
  ConnectionStatus,
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";
import {
  startLoopbackCapture,
  stopLoopbackCapture
} from "@renderer/audio-capture/captureLoopbackAudio";

export function OverlayApp(): JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] =
    useState<ConnectionStatus>("idle");
  const [demoMode, setDemoMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [activeSources, setActiveSources] = useState<
    CaptureSourceTag[]
  >([]);
  const [session, setSession] =
    useState<LiveAssistSessionView | null>(null);
  const [projections, setProjections] = useState<
    LiveAssistProjection[]
  >([]);
  const runningRef = useRef(false);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [projections, liveTranscript, status]);

  const startCaptureFlow = async (
    sessionId: string
  ): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      setLiveTranscript("Initializing audio capture...");
      const runtimeConfig =
        await window.overlayApi.getRuntimeCaptureConfig();
      const captureResult = await startLoopbackCapture(
        runtimeConfig.captureSourceMode,
        sessionId
      );
      setActiveSources(captureResult.activeSources);
      await window.overlayApi.startCapture({
        sessionId,
        sources: captureResult.activeSources
      });
      captureResult.activeSources.forEach((source) => {
        window.overlayApi.sendAudioChunk({
          source,
          sessionId,
          buffer: new Int16Array(320).buffer
        });
      });
      setIsRunning(true);
      setStatus("capturing");
      setLiveTranscript(
        `${captureResult.statusMessage} Waiting for speech...`
      );
    } catch (error) {
      runningRef.current = false;
      await stopLoopbackCapture().catch(() => undefined);
      await window.overlayApi
        .reportLiveAssistCaptureError(sessionId)
        .catch(() => undefined);
      setIsRunning(false);
      setActiveSources([]);
      setStatus("error");
      setLiveTranscript(
        `Start failed: ${
          error instanceof Error
            ? error.message
            : "Unknown start error"
        }`
      );
    }
  };

  const stopCaptureFlow = async (
    sessionId: string
  ): Promise<void> => {
    runningRef.current = false;
    await stopLoopbackCapture().catch(() => undefined);
    await window.overlayApi
      .stopCapture(sessionId)
      .catch(() => undefined);
    setIsRunning(false);
    setActiveSources([]);
    setStatus("idle");
  };

  useEffect(() => {
    void window.overlayApi
      .getDemoMode()
      .then(setDemoMode)
      .catch(() => undefined);
    void window.overlayApi
      .getLiveAssistSession()
      .then((activeSession) => {
        setSession(activeSession);
        if (activeSession?.state === "active") {
          void startCaptureFlow(activeSession.id);
        }
      })
      .catch(() => undefined);
    const unsubscribe = [
      window.overlayApi.onDemoMode(setDemoMode),
      window.overlayApi.onTranscript((payload) => {
        const text = payload.text.trim();
        if (text) setLiveTranscript(text);
      }),
      window.overlayApi.onStatus(setStatus),
      window.overlayApi.onLiveAssistSession(setSession),
      window.overlayApi.onLiveAssistCaptureCommand((command) => {
        if (command.action === "start") {
          void startCaptureFlow(command.sessionId);
        } else {
          void stopCaptureFlow(command.sessionId);
        }
      }),
      window.overlayApi.onLiveAssistProjection((projection) => {
        setProjections((current) => {
          const key = `${projection.sessionId}:${projection.question}`;
          const next = current.filter(
            (item) =>
              `${item.sessionId}:${item.question}` !== key
          );
          return [...next, projection].slice(-6);
        });
      })
    ];
    return () => unsubscribe.forEach((stop) => stop());
  }, []);

  const statusLabel = useMemo(() => {
    if (!session || session.state !== "active") return "Stopped";
    if (status === "capturing") return "Listening";
    if (status === "answering") return "Grounding";
    if (status === "error") return "Error";
    return "Starting";
  }, [session, status]);

  const sourceLabel = useMemo(() => {
    if (!activeSources.length) return "No source";
    if (activeSources.length === 2) {
      return "System + Microphone";
    }
    return activeSources[0] === "system"
      ? "System"
      : "Microphone";
  }, [activeSources]);

  return (
    <div
      className={`overlayRoot${demoMode ? " demoMode" : ""}`}
    >
      <div className="toolbar dragZone">
        <div className="toolbarMeta">
          <div className={`status status-${status}`}>
            {statusLabel}
          </div>
          {isRunning ? (
            <div className="demoBadge">Source: {sourceLabel}</div>
          ) : null}
          {demoMode ? (
            <div className="demoBadge">
              Demo · visible in share
            </div>
          ) : null}
        </div>
        <div className="actions">
          <span className="demoBadge">
            Controlled by Relay
          </span>
        </div>
      </div>

      <div className="liveRow">
        <span className="liveLabel">Live transcript</span>
        <p>{liveTranscript || "Waiting for speech..."}</p>
      </div>
      <div className="feed">
        {projections.map((item) => (
          <article
            key={`${item.sessionId}:${item.question}`}
            className={`qaItem${
              item.state === "executing" ||
              item.state === "accepted"
                ? " pending"
                : ""
            }`}
          >
            <p className="question">{item.question}</p>
            <p className="answer">
              {item.answerText ??
                (item.state === "failed"
                  ? "Relay could not complete and validate this answer."
                  : item.state === "accepted"
                    ? "Question accepted."
                    : "Grounding answer…")}
            </p>
            {item.sources.length > 0 ? (
              <div className="sourceRow">
                {item.sources.slice(0, 2).map((source) => (
                  <button
                    key={source.citationId}
                    type="button"
                    className="sourceChip"
                    onClick={() =>
                      void window.overlayApi.openLiveCitation(
                        source.messageId,
                        source.citationId
                      )
                    }
                  >
                    Open: {source.title}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
