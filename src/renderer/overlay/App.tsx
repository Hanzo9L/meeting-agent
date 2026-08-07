import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { AnswerSourceRef, CaptureSourceTag, ConnectionStatus, QaItem } from "@shared/types";
import { startLoopbackCapture, stopLoopbackCapture } from "@renderer/audio-capture/captureLoopbackAudio";

export function OverlayApp(): JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [demoMode, setDemoMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [feed, setFeed] = useState<QaItem[]>([]);
  const [answeringQuestion, setAnsweringQuestion] = useState("");
  const [activeSources, setActiveSources] = useState<CaptureSourceTag[]>([]);
  const [pendingSources, setPendingSources] = useState<AnswerSourceRef[]>([]);
  const draftAnswerRef = useRef("");
  const answeringQuestionRef = useRef("");
  const pendingSourcesRef = useRef<AnswerSourceRef[]>([]);
  const runningRef = useRef(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const formatStartError = (error: unknown): string => {
    if (error instanceof DOMException) {
      if (error.name === "NotSupportedError") {
        return "System audio capture is not supported on this device/session.";
      }
      if (error.name === "NotAllowedError") {
        return "Screen/audio capture permission was denied.";
      }
      return `${error.name}: ${error.message}`;
    }
    if (error instanceof Error) return error.message;
    return "Unknown start error";
  };

  useEffect(() => {
    draftAnswerRef.current = draftAnswer;
  }, [draftAnswer]);

  useEffect(() => {
    answeringQuestionRef.current = answeringQuestion;
  }, [answeringQuestion]);

  useEffect(() => {
    pendingSourcesRef.current = pendingSources;
  }, [pendingSources]);

  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed, draftAnswer, answeringQuestion, status]);

  const startCaptureFlow = async (): Promise<void> => {
    if (runningRef.current) return;
    try {
      setLiveTranscript("Initializing audio capture...");
      const runtimeConfig = await window.overlayApi.getRuntimeCaptureConfig();
      const captureResult = await startLoopbackCapture(runtimeConfig.captureSourceMode);
      setActiveSources(captureResult.activeSources);
      await window.overlayApi.startCapture({
        sources: captureResult.activeSources,
        answerTriggerMode: runtimeConfig.answerTriggerMode
      });
      // Prime the IPC/STT path with a short silent frame.
      captureResult.activeSources.forEach((source) => {
        window.overlayApi.sendAudioChunk({ source, buffer: new Int16Array(320).buffer });
      });
      setIsRunning(true);
      setStatus("capturing");
      setLiveTranscript(`${captureResult.statusMessage} Waiting for speech...`);
    } catch (error) {
      const message = formatStartError(error);
      await stopLoopbackCapture().catch(() => undefined);
      await window.overlayApi.stopCapture().catch(() => undefined);
      setStatus("error");
      setLiveTranscript(`Start failed: ${message}`);
      console.error("Start capture failed", error);
    }
  };

  const stopCaptureFlow = async (): Promise<void> => {
    if (!runningRef.current) return;
    try {
      await stopLoopbackCapture();
      await window.overlayApi.stopCapture();
      setIsRunning(false);
      setActiveSources([]);
      setStatus("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to stop capture";
      setStatus("error");
      setLiveTranscript(`Stop failed: ${message}`);
    }
  };

  useEffect(() => {
    void window.overlayApi.getDemoMode().then(setDemoMode).catch(() => undefined);
    const unsubDemoMode = window.overlayApi.onDemoMode(setDemoMode);
    const unsubTranscript = window.overlayApi.onTranscript((payload) => {
      const text = payload.text.trim();
      if (!text) return;
      setLiveTranscript(text);
    });
    const unsubAnswerStart = window.overlayApi.onAnswerStart((payload) => {
      setAnsweringQuestion(payload.question.trim());
      setDraftAnswer("");
    });
    const unsubChunk = window.overlayApi.onAnswerChunk((payload) => {
      setDraftAnswer((prev) => prev + payload.text);
    });
    const unsubSources = window.overlayApi.onAnswerSources((payload) => {
      setPendingSources(payload.sources);
    });
    const unsubDone = window.overlayApi.onAnswerDone(() => {
      if (!answeringQuestionRef.current || !draftAnswerRef.current.trim()) {
        setDraftAnswer("");
        setPendingSources([]);
        setAnsweringQuestion("");
        setLiveTranscript("");
        return;
      }
      setFeed((prev) => [
        ...prev,
        {
          question: answeringQuestionRef.current,
          answer: draftAnswerRef.current.trim(),
          sources: pendingSourcesRef.current,
          createdAt: Date.now()
        }
      ]);
      setDraftAnswer("");
      setPendingSources([]);
      setAnsweringQuestion("");
      setLiveTranscript("");
    });
    const unsubStatus = window.overlayApi.onStatus((nextStatus) => setStatus(nextStatus));

    return () => {
      unsubDemoMode();
      unsubTranscript();
      unsubAnswerStart();
      unsubChunk();
      unsubSources();
      unsubDone();
      unsubStatus();
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (!isRunning) return "Stopped";
    switch (status) {
      case "capturing":
        return "Listening";
      case "answering":
        return "Answering";
      case "error":
        return "Error";
      default:
        return "Starting";
    }
  }, [isRunning, status]);

  const sourceLabel = useMemo(() => {
    if (!activeSources.length) return "No source";
    if (activeSources.length === 2) return "System + Microphone";
    return activeSources[0] === "system" ? "System" : "Microphone";
  }, [activeSources]);

  const toggleCapture = async (): Promise<void> => {
    if (!isRunning) {
      await startCaptureFlow();
      return;
    }

    await stopCaptureFlow();
  };

  const clearFeed = async (): Promise<void> => {
    setFeed([]);
    setDraftAnswer("");
    setLiveTranscript("");
    setPendingSources([]);
    setAnsweringQuestion("");
    await window.overlayApi.clearFeed();
  };

  return (
    <div className={`overlayRoot${demoMode ? " demoMode" : ""}`}>
      <div className="toolbar dragZone">
        <div className="toolbarMeta">
          <div className={`status status-${status}`}>{statusLabel}</div>
          {isRunning ? <div className="demoBadge">Source: {sourceLabel}</div> : null}
          {demoMode ? <div className="demoBadge">Demo · visible in share</div> : null}
        </div>
        <div className="actions">
          <button type="button" onClick={() => void toggleCapture()}>
            {isRunning ? "Stop" : "Start"}
          </button>
          <button type="button" onClick={() => void clearFeed()}>
            Clear
          </button>
        </div>
      </div>

      <div className="liveRow">
        <span className="liveLabel">Live transcript</span>
        <p>{liveTranscript || "Waiting for speech..."}</p>
      </div>
      <div className="feed" ref={feedRef}>
        {feed.map((item) => (
          <article key={item.createdAt} className="qaItem">
            <p className="question">{item.question}</p>
            <p className="answer">{item.answer}</p>
            {item.sources && item.sources.length > 0 ? (
              <div className="sourceRow">
                {item.sources.map((source) => (
                  <button
                    key={source.path}
                    type="button"
                    className="sourceChip"
                    onClick={() => void window.overlayApi.openExternalUrl(source.url)}
                    title={source.path}
                  >
                    Open: {source.title}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {answeringQuestion && draftAnswer ? (
          <article className="qaItem pending">
            <p className="question">{answeringQuestion}</p>
            <p className="answer">{draftAnswer}</p>
            {pendingSources.length > 0 ? (
              <div className="sourceRow">
                {pendingSources.map((source) => (
                  <button
                    key={source.path}
                    type="button"
                    className="sourceChip"
                    onClick={() => void window.overlayApi.openExternalUrl(source.url)}
                    title={source.path}
                  >
                    Open: {source.title}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ) : null}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
