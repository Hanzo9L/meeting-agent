import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type {
  ConnectionStatus,
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";

export function OverlayApp(): JSX.Element {
  const [status, setStatus] =
    useState<ConnectionStatus>("idle");
  const [demoMode, setDemoMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [session, setSession] =
    useState<LiveAssistSessionView | null>(null);
  const [projections, setProjections] = useState<
    LiveAssistProjection[]
  >([]);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [projections, liveTranscript, status]);

  useEffect(() => {
    void window.overlayApi
      .getLiveAssistHydration()
      .then((hydration) => {
        setSession(hydration.session);
        setStatus(hydration.status);
        setLiveTranscript(hydration.transcript?.text ?? "");
        setProjections(
          hydration.projection ? [hydration.projection] : []
        );
      })
      .catch(() => undefined);
    void window.overlayApi
      .getDemoMode()
      .then(setDemoMode)
      .catch(() => undefined);
    const unsubscribe = [
      window.overlayApi.onDemoMode(setDemoMode),
      window.overlayApi.onTranscript((payload) => {
        const text = payload.text.trim();
        if (text) setLiveTranscript(text);
      }),
      window.overlayApi.onStatus(setStatus),
      window.overlayApi.onLiveAssistSession(setSession),
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

  return (
    <div
      className={`overlayRoot${demoMode ? " demoMode" : ""}`}
    >
      <div className="toolbar dragZone">
        <div className="toolbarMeta">
          <div className={`status status-${status}`}>
            {statusLabel}
          </div>
          {demoMode ? (
            <div className="demoBadge">
              Demo · visible in share
            </div>
          ) : null}
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() => void window.overlayApi.hideOverlay()}
          >
            Hide
          </button>
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
