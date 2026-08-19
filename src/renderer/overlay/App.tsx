import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type {
  ConnectionStatus,
  EvidenceReadinessStatus,
  LiveAssistProjection,
  LiveAssistSessionView
} from "@shared/types";
import { updateProjectionFeed } from "./projectionFeed";
import {
  evidenceSourceItemId,
  excerptOverlayPreview,
  formatEvidenceCardHeading,
  formatEvidenceSourceRoleLabel,
  listEvidenceCardSources,
  parseEvidenceCardContent,
  toggleExpandedEvidenceSource,
  type EvidenceCardSource
} from "@shared/evidenceCard";

function overlayAnswerLabel(answerText: string | null | undefined): string {
  const parsed = parseEvidenceCardContent(answerText ?? "");
  return parsed ? formatEvidenceCardHeading(parsed.payload) : "Relay Quick";
}

function evidenceReadinessLabel(status: EvidenceReadinessStatus): string {
  if (status === "ready") return "Evidence ready";
  if (status === "failed") return "Evidence unavailable";
  return "Preparing evidence...";
}

function OverlayEvidenceSource(props: {
  source: EvidenceCardSource;
  index: number;
  expanded: boolean;
  citationId: string | null;
  onToggle(): void;
  onOpenCitation(citationId: string): void;
}): JSX.Element {
  const collapsed = excerptOverlayPreview(
    props.source.preview || props.source.body
  );
  const shown = props.expanded
    ? props.source.preview || props.source.body
    : collapsed;
  const canExpand =
    (props.source.preview || props.source.body).length > collapsed.length;
  return (
    <article
      className="overlayEvidenceItem"
      data-evidence-parent-id={props.source.parentId}
      data-publisher={props.source.publisher}
      data-source-role={props.source.sourceRole}
      data-expanded={props.expanded ? "true" : "false"}
    >
      <div className="overlayEvidenceIndex">{props.index + 1}.</div>
      <div className="overlayEvidenceBody">
        <div className="overlayEvidenceTitle">{props.source.title}</div>
        <div
          className="overlayEvidencePublisher"
          data-publisher={props.source.publisher}
        >
          {formatEvidenceSourceRoleLabel(props.source)}
        </div>
        {props.source.section ? (
          <div className="overlayEvidenceSection">{props.source.section}</div>
        ) : null}
        <p className="overlayEvidencePreview">{shown}</p>
        {canExpand ? (
          <button
            type="button"
            className="overlayEvidenceExpand"
            aria-expanded={props.expanded}
            onClick={props.onToggle}
          >
            {props.expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
        {props.citationId ? (
          <button
            type="button"
            className="overlayEvidenceUrl"
            onClick={() => void props.onOpenCitation(props.citationId!)}
          >
            {props.source.url}
          </button>
        ) : (
          <div className="overlayEvidenceUrlText">{props.source.url}</div>
        )}
      </div>
    </article>
  );
}

function OverlayAnswerCard(props: {
  item: LiveAssistProjection;
}): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set()
  );
  const parsed = parseEvidenceCardContent(props.item.answerText ?? "");
  const sources = parsed ? listEvidenceCardSources(parsed.payload) : [];
  const citationByDocumentId = new Map(
    props.item.sources.map((source) => [
      source.documentId ?? source.title,
      source.citationId
    ])
  );
  const heading = parsed
    ? formatEvidenceCardHeading(parsed.payload)
    : props.item.state === "failed"
      ? "Evidence"
      : overlayAnswerLabel(props.item.answerText);
  const pending =
    props.item.state === "executing" || props.item.state === "accepted";

  let body: JSX.Element;
  if (parsed && sources.length > 0) {
    body = (
      <div className="overlayEvidenceList">
        {sources.map((source, index) => {
          const sourceId = evidenceSourceItemId(source, index);
          return (
            <OverlayEvidenceSource
              key={sourceId}
              source={source}
              index={index}
              expanded={expandedIds.has(sourceId)}
              citationId={
                citationByDocumentId.get(source.parentId) ??
                citationByDocumentId.get(source.title) ??
                null
              }
              onToggle={() =>
                setExpandedIds((current) =>
                  toggleExpandedEvidenceSource(current, sourceId)
                )
              }
              onOpenCitation={(citationId) => {
                const match = props.item.sources.find(
                  (source) => source.citationId === citationId
                );
                void window.overlayApi.openLiveCitation(
                  match?.messageId ?? "",
                  citationId
                );
              }}
            />
          );
        })}
      </div>
    );
  } else if (props.item.answerText) {
    body = (
      <p className="answer">
        {parsed?.visibleText ?? props.item.answerText}
      </p>
    );
  } else if (props.item.state === "failed") {
    body = <p className="answer">Evidence retrieval failed.</p>;
  } else if (props.item.state === "accepted") {
    body = <p className="answer">Question accepted.</p>;
  } else {
    body = <p className="answer">Retrieving evidence…</p>;
  }

  return (
    <article
      className={`answerCard${
        pending ? " pending" : props.item.state === "failed" ? " failed" : ""
      }`}
      data-turn-state={props.item.state}
      data-evidence-card={parsed ? "true" : "false"}
    >
      <span className="bubbleLabel">{heading}</span>
      {body}
    </article>
  );
}

export function OverlayApp(): JSX.Element {
  const [status, setStatus] =
    useState<ConnectionStatus>("idle");
  const [evidenceStatus, setEvidenceStatus] =
    useState<EvidenceReadinessStatus>("starting");
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
        setProjections(hydration.projections);
        setEvidenceStatus(hydration.evidenceStatus);
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
      window.overlayApi.onEvidenceStatus(setEvidenceStatus),
      window.overlayApi.onLiveAssistSession(setSession),
      window.overlayApi.onLiveAssistProjection((projection) => {
        setProjections((current) =>
          updateProjectionFeed(current, projection)
        );
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
          <div
            className={`evidenceStatus evidenceStatus-${evidenceStatus}`}
            data-evidence-status={evidenceStatus}
          >
            {evidenceReadinessLabel(evidenceStatus)}
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
          <section
            key={item.answerRunId}
            data-answer-run-id={item.answerRunId}
            data-user-message-id={item.userMessageId}
            className="interviewTurn"
          >
            <article className="userBubble">
              <span className="bubbleLabel">Interviewer</span>
              <p className="question">{item.question}</p>
            </article>
            <OverlayAnswerCard item={item} />
          </section>
        ))}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
