import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import type {
  HelpdeskConversation,
  HelpdeskConversationView,
  HelpdeskMessage
} from "@shared/helpdesk";
import {
  buildHelpdeskTimeline,
  copyAnswerText,
  resolveComposerInputOrigin
} from "./viewModel";

function resultErrorMessage(
  fallback: string,
  result: { ok: false; error: { message: string } }
): string {
  return result.error.message || fallback;
}

function Sidebar(props: {
  conversations: HelpdeskConversation[];
  activeId: string | null;
  busy: boolean;
  onCreate(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): Promise<boolean>;
  onDelete(id: string): void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const beginRename = (conversation: HelpdeskConversation): void => {
    setEditingId(conversation.id);
    setTitle(conversation.title);
  };

  const submitRename = async (
    event: FormEvent,
    conversationId: string
  ): Promise<void> => {
    event.preventDefault();
    if (await props.onRename(conversationId, title)) {
      setEditingId(null);
    }
  };

  return (
    <aside className="sidebar" aria-label="Conversations">
      <div className="sidebar-header">
        <div>
          <div className="eyebrow">Real-Time Operations</div>
          <h1>Relay</h1>
        </div>
        <button
          className="new-chat-button"
          type="button"
          disabled={props.busy}
          onClick={props.onCreate}
        >
          + New Chat
        </button>
      </div>

      <div className="conversation-list" role="list">
        {props.conversations.length === 0 ? (
          <p className="sidebar-empty">No conversations yet.</p>
        ) : null}
        {props.conversations.map((conversation) => {
          const active = conversation.id === props.activeId;
          return (
            <div
              className={`conversation-item${active ? " active" : ""}`}
              key={conversation.id}
              role="listitem"
            >
              {editingId === conversation.id ? (
                <form
                  className="rename-form"
                  onSubmit={(event) => void submitRename(event, conversation.id)}
                >
                  <input
                    aria-label="Conversation title"
                    autoFocus
                    maxLength={200}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <div className="rename-actions">
                    <button type="submit" disabled={props.busy || !title.trim()}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    className="conversation-select"
                    type="button"
                    onClick={() => props.onSelect(conversation.id)}
                  >
                    <span>{conversation.title}</span>
                    <small>
                      {new Date(conversation.updatedAt).toLocaleDateString()}
                    </small>
                  </button>
                  <div className="conversation-actions">
                    <button
                      type="button"
                      aria-label={`Rename ${conversation.title}`}
                      onClick={() => beginRename(conversation)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      onClick={() => props.onDelete(conversation.id)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AssistantMessage(props: {
  message: HelpdeskMessage;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const copy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) {
        throw new Error("clipboard unavailable");
      }
      await copyAnswerText(props.message.content, navigator.clipboard);
      setNotice("Answer copied.");
    } catch {
      setNotice("The answer could not be copied.");
    }
  };

  const openCitation = async (
    citationId: string
  ): Promise<void> => {
    const result = await window.helpdeskApi.openCitation({
      messageId: props.message.id,
      citationId
    });
    if (!result.ok) {
      setNotice(result.error.message);
    }
  };

  const label =
    props.message.answerability === "partial"
      ? "Partial answer"
      : props.message.answerability === "insufficient_evidence"
        ? "Insufficient evidence"
        : "Grounded answer";

  return (
    <>
      <div className="message-label">
        Relay
        <span
          className={`answerability-label ${props.message.answerability ?? ""}`}
        >
          {label}
        </span>
      </div>
      <div className="message-content">{props.message.content}</div>
      <div className="assistant-actions">
        <button type="button" onClick={() => void copy()}>
          Copy answer
        </button>
        {props.message.citations.length > 0 ? (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((open) => !open)}
          >
            {sourcesOpen
              ? "Hide sources"
              : `Sources (${props.message.citations.length})`}
          </button>
        ) : null}
        {notice ? <span role="status">{notice}</span> : null}
      </div>
      {sourcesOpen ? (
        <div className="source-list" aria-label="Answer sources">
          {props.message.citations.map((citation) => (
            <div className="source-card" key={citation.citationId}>
              <button
                type="button"
                className="source-link"
                onClick={() =>
                  void openCitation(citation.citationId)
                }
              >
                {citation.sourceTitle}
              </button>
              {citation.headingPath.length > 1 ? (
                <div className="source-heading">
                  {citation.headingPath.join(" › ")}
                </div>
              ) : null}
              <div className="source-url">
                {citation.canonicalUrl}
              </div>
              {citation.preview ? (
                <span className="preview-label">Preview</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ConversationTimeline(props: {
  view: HelpdeskConversationView | null;
  loading: boolean;
  executing: boolean;
}) {
  const rows = useMemo(
    () => (props.view ? buildHelpdeskTimeline(props.view) : []),
    [props.view]
  );
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [props.view?.conversation.id, rows.length]);

  if (props.loading) {
    return <div className="center-state">Loading conversation…</div>;
  }
  if (!props.view) {
    return (
      <div className="center-state empty-state">
        <h2>How can I help?</h2>
        <p>Create a conversation to start building persistent Relay history.</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="center-state empty-state">
        <h2>New conversation</h2>
        <p>Ask or paste a helpdesk question below.</p>
      </div>
    );
  }

  return (
    <div className="timeline" aria-live="polite">
      <div className="timeline-content">
        {rows.map((row) =>
          row.kind === "message" ? (
            <article
              key={row.id}
              className={`message-row ${row.message.role}`}
              data-message-origin={row.message.inputOrigin ?? undefined}
            >
              {row.message.role === "user" ? (
                <div className="message-label">
                  You
                  {row.message.inputOrigin === "pasted" ? (
                    <span className="origin-label">Pasted</span>
                  ) : null}
                </div>
              ) : null}
              {row.message.role === "assistant" ? (
                <AssistantMessage message={row.message} />
              ) : (
                <div className="message-content">
                  {row.message.content}
                </div>
              )}
            </article>
          ) : (
            <div
              key={row.id}
              className={`answer-status ${row.tone}`}
              role={row.tone === "error" ? "alert" : "status"}
            >
              {row.text}
            </div>
          )
        )}
        {props.executing ? (
          <div className="answer-status executing" role="status">
            Relay is retrieving evidence and validating a grounded answer…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Composer(props: {
  disabled: boolean;
  hasConversation: boolean;
  onSubmit(content: string, pasted: boolean): Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [hasPaste, setHasPaste] = useState(false);

  const submit = async (): Promise<void> => {
    if (!draft.trim() || props.disabled || !props.hasConversation) return;
    if (await props.onSubmit(draft, hasPaste)) {
      setDraft("");
      setHasPaste(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer-shell">
      <div className="composer">
        <textarea
          aria-label="Ask or paste anything"
          placeholder={
            props.hasConversation
              ? "Ask or paste anything…"
              : "Create a conversation to begin"
          }
          rows={3}
          maxLength={100_000}
          disabled={props.disabled || !props.hasConversation}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (!event.target.value) setHasPaste(false);
          }}
          onPaste={() => setHasPaste(true)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-footer">
          <span>Enter to send · Shift+Enter for a new line</span>
          <button
            type="button"
            disabled={
              props.disabled || !props.hasConversation || !draft.trim()
            }
            onClick={() => void submit()}
          >
            {props.disabled ? "Grounding…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HelpdeskApp() {
  const [conversations, setConversations] = useState<HelpdeskConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<HelpdeskConversationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRequest = useRef(0);

  const loadConversation = useCallback(async (conversationId: string) => {
    const requestId = ++loadRequest.current;
    setLoading(true);
    try {
      const result = await window.helpdeskApi.loadConversation(conversationId);
      if (requestId !== loadRequest.current) return;
      if (!result.ok) {
        setView(null);
        setError(resultErrorMessage("Conversation could not be loaded.", result));
      } else {
        setView(result.data);
        setError(null);
      }
    } catch {
      if (requestId !== loadRequest.current) return;
      setView(null);
      setError("Conversation could not be loaded.");
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.helpdeskApi.listConversations();
        if (cancelled) return;
        if (!result.ok) {
          setError(resultErrorMessage("Conversations could not be loaded.", result));
          setLoading(false);
          return;
        }
        setConversations(result.data);
        const first = result.data[0];
        if (first) {
          setActiveId(first.id);
          await loadConversation(first.id);
        } else {
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        setError("Conversations could not be loaded.");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConversation]);

  const createConversation = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.helpdeskApi.createConversation();
      if (!result.ok) {
        setError(resultErrorMessage("Conversation could not be created.", result));
      } else {
        setConversations((current) => [
          result.data.conversation,
          ...current.filter((item) => item.id !== result.data.conversation.id)
        ]);
        setActiveId(result.data.conversation.id);
        setView(result.data);
        setError(null);
      }
    } catch {
      setError("Conversation could not be created.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  };

  const selectConversation = (conversationId: string): void => {
    setActiveId(conversationId);
    void loadConversation(conversationId);
  };

  const renameConversation = async (
    conversationId: string,
    title: string
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await window.helpdeskApi.renameConversation(
        conversationId,
        title
      );
      if (!result.ok) {
        setError(resultErrorMessage("Conversation could not be renamed.", result));
        return false;
      }
      setConversations((current) =>
        current.map((item) => (item.id === conversationId ? result.data : item))
      );
      setView((current) =>
        current && current.conversation.id === conversationId
          ? { ...current, conversation: result.data }
          : current
      );
      setError(null);
      return true;
    } catch {
      setError("Conversation could not be renamed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = async (conversationId: string): Promise<void> => {
    const conversation = conversations.find((item) => item.id === conversationId);
    if (
      !window.confirm(
        `Delete "${conversation?.title ?? "this conversation"}"? This removes it from history.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.helpdeskApi.deleteConversation(conversationId);
      if (!result.ok || !result.data.deleted) {
        setError(
          result.ok
            ? "Conversation could not be deleted."
            : resultErrorMessage("Conversation could not be deleted.", result)
        );
        return;
      }

      const remaining = conversations.filter((item) => item.id !== conversationId);
      setConversations(remaining);
      if (activeId === conversationId) {
        const next = remaining[0];
        if (next) {
          setActiveId(next.id);
          await loadConversation(next.id);
        } else {
          setActiveId(null);
          setView(null);
          setLoading(false);
        }
      }
      setError(null);
    } catch {
      setError("Conversation could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const submitMessage = async (
    content: string,
    pasted: boolean
  ): Promise<boolean> => {
    if (!activeId) return false;
    setBusy(true);
    try {
      const result = await window.helpdeskApi.submitMessage({
        conversationId: activeId,
        content,
        inputOrigin: resolveComposerInputOrigin(pasted)
      });
      if (!result.ok) {
        setError(resultErrorMessage("Message could not be saved.", result));
        return false;
      }
      setView(result.data.view);
      setConversations((current) => [
        result.data.view.conversation,
        ...current.filter((item) => item.id !== activeId)
      ]);
      setError(null);
      return true;
    } catch {
      setError("Message could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        busy={busy}
        onCreate={() => void createConversation()}
        onSelect={selectConversation}
        onRename={renameConversation}
        onDelete={(id) => void deleteConversation(id)}
      />
      <main className="conversation-pane">
        <header className="conversation-header">
          <div>
            <div className="eyebrow">Relay: Real-Time Operations</div>
            <h2>{view?.conversation.title ?? "Relay"}</h2>
          </div>
          <div className={`engine-state${busy ? " active" : ""}`}>
            {busy ? "Grounding answer…" : "Grounded answers ready"}
          </div>
        </header>
        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        <ConversationTimeline
          view={view}
          loading={loading}
          executing={busy && !loading}
        />
        <Composer
          disabled={busy}
          hasConversation={activeId !== null}
          onSubmit={submitMessage}
        />
      </main>
    </div>
  );
}
