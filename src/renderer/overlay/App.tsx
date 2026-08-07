import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { CaptureSourceTag, ConnectionStatus, QaItem } from "@shared/types";
import { startLoopbackCapture, stopLoopbackCapture } from "@renderer/audio-capture/captureLoopbackAudio";

export function OverlayApp(): JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [demoMode, setDemoMode] = useState(false);
  const [recentFinals, setRecentFinals] = useState<string[]>([]);
  const [livePartial, setLivePartial] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [feed, setFeed] = useState<QaItem[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [activeSources, setActiveSources] = useState<CaptureSourceTag[]>([]);
  const activeQuestionRef = useRef("");
  const draftAnswerRef = useRef("");
  const runningRef = useRef(false);

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
    activeQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    draftAnswerRef.current = draftAnswer;
  }, [draftAnswer]);

  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);

  const startCaptureFlow = async (): Promise<void> => {
    if (runningRef.current) return;
    try {
      setLivePartial("Initializing audio capture...");
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
      setLivePartial(`${captureResult.statusMessage} Waiting for speech...`);
    } catch (error) {
      const message = formatStartError(error);
      await stopLoopbackCapture().catch(() => undefined);
      await window.overlayApi.stopCapture().catch(() => undefined);
      setStatus("error");
      setLivePartial(`Start failed: ${message}`);
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
      setLivePartial(`Stop failed: ${message}`);
    }
  };

  useEffect(() => {
    void window.overlayApi.getDemoMode().then(setDemoMode).catch(() => undefined);
    const unsubDemoMode = window.overlayApi.onDemoMode(setDemoMode);
    const unsubTranscript = window.overlayApi.onTranscript((payload) => {
      if (payload.isFinal) {
        const text = payload.text.trim();
        if (text) {
          setRecentFinals((prev) => [...prev.slice(-3), text]);
          setCurrentQuestion(text);
        }
        setLivePartial("");
        return;
      }
      setLivePartial(payload.text);
    });
    const unsubChunk = window.overlayApi.onAnswerChunk((payload) => {
      setDraftAnswer((prev) => prev + payload.text);
    });
    const unsubDone = window.overlayApi.onAnswerDone(() => {
      if (!activeQuestionRef.current || !draftAnswerRef.current.trim()) {
        setDraftAnswer("");
        return;
      }
      setFeed((prev) => [
        {
          question: activeQuestionRef.current,
          answer: draftAnswerRef.current.trim(),
          createdAt: Date.now()
        },
        ...prev
      ]);
      setDraftAnswer("");
    });
    const unsubStatus = window.overlayApi.onStatus((nextStatus) => setStatus(nextStatus));

    return () => {
      unsubDemoMode();
      unsubTranscript();
      unsubChunk();
      unsubDone();
      unsubStatus();
    };
  }, []);

  const transcript = useMemo(() => {
    return [...recentFinals, livePartial].filter(Boolean).join("\n").trim();
  }, [recentFinals, livePartial]);

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
    setRecentFinals([]);
    setLivePartial("");
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
        <p>{transcript || "Waiting for speech..."}</p>
      </div>
      {draftAnswer ? (
        <div className="draftAnswer">
          <span>Draft answer</span>
          <p>{draftAnswer}</p>
        </div>
      ) : null}

      <div className="feed">
        {feed.map((item) => (
          <article key={item.createdAt} className="qaItem">
            <p className="question">{item.question}</p>
            <p className="answer">{item.answer}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
