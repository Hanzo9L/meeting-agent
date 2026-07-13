import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { ConnectionStatus, QaItem } from "@shared/types";
import { startLoopbackCapture, stopLoopbackCapture } from "@renderer/audio-capture/captureLoopbackAudio";

export function OverlayApp(): JSX.Element {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [feed, setFeed] = useState<QaItem[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const activeQuestionRef = useRef("");
  const draftAnswerRef = useRef("");

  useEffect(() => {
    activeQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    draftAnswerRef.current = draftAnswer;
  }, [draftAnswer]);

  useEffect(() => {
    const unsubTranscript = window.overlayApi.onTranscript((payload) => {
      setTranscript(payload.text);
      if (payload.isFinal) {
        setCurrentQuestion(payload.text);
      }
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
      unsubTranscript();
      unsubChunk();
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

  const toggleCapture = async (): Promise<void> => {
    if (!isRunning) {
      await window.overlayApi.startCapture();
      await startLoopbackCapture();
      setIsRunning(true);
      return;
    }

    await stopLoopbackCapture();
    await window.overlayApi.stopCapture();
    setIsRunning(false);
    setStatus("idle");
  };

  const clearFeed = async (): Promise<void> => {
    setFeed([]);
    setDraftAnswer("");
    setTranscript("");
    await window.overlayApi.clearFeed();
  };

  return (
    <div className="overlayRoot">
      <div className="toolbar dragZone">
        <div className={`status status-${status}`}>{statusLabel}</div>
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
