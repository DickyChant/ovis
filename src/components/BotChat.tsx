import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BotChatItem, BotChatPage } from "../../shared/bots.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { useT } from "../lib/i18n.ts";
import type { BotDrafts } from "../lib/botDrafts.ts";

export function BotChat({ runtimeId, botId, name, online, drafts, onActivity }: {
  runtimeId: string; botId: string; name: string; online: boolean; drafts: BotDrafts; onActivity?(): void;
}) {
  const t = useT();
  const identity = `${runtimeId}:${botId}`;
  const { text: draft, sending, uncertain } = useSyncExternalStore(drafts.subscribe, () => drafts.get(identity));
  const [page, setPage] = useState<BotChatPage | null>(null);
  const [earlier, setEarlier] = useState<BotChatItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<BotChatPage["cursor"] | undefined>(undefined);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const refreshRef = useRef<() => void>(() => {});
  const activityRef = useRef(onActivity); activityRef.current = onActivity;
  const history = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const query = new URLSearchParams({ runtimeId, botId }).toString();

  useEffect(() => {
    if (!online) { setConnected(false); return; }
    const abort = new AbortController();
    let busy = false;
    let again = false;
    const refresh = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const response = await apiFetch(`/api/bots/chat?${query}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]), cache: "no-store" });
        if (!response.ok) throw new Error("Chat unavailable");
        const value = await response.json() as BotChatPage;
        if (!abort.signal.aborted) { setPage(value); setFailed(false); }
      } catch { if (!abort.signal.aborted) setFailed(true); }
      finally { busy = false; if (again && !abort.signal.aborted) { again = false; void refresh(); } }
    };
    refreshRef.current = () => void refresh();
    const events = new EventSource(`/api/bots/events?${query}`);
    events.addEventListener("ready", () => { setConnected(true); setStreams({}); void refresh(); });
    events.addEventListener("changed", () => void refresh());
    events.addEventListener("stream", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { attemptId?: string; phase?: string; text?: string };
        if (typeof data.attemptId !== "string" || data.attemptId.length > 256) return;
        const id = data.attemptId;
        if (data.phase === "start" || data.phase === "end") activityRef.current?.();
        setStreams((current) => {
          if (data.phase === "end") { const next = { ...current }; delete next[id]; return next; }
          if (Object.keys(current).length > 32) return current;
          return { ...current, [id]: ((current[id] ?? "") + (typeof data.text === "string" ? data.text : "")).slice(0, 100000) };
        });
        if (data.phase === "end") void refresh();
      } catch { /* A reconnect obtains a fresh history page. */ }
    });
    events.onerror = () => { setConnected(false); setStreams({}); };
    void refresh();
    return () => { abort.abort(); events.close(); refreshRef.current = () => {}; };
  }, [online, query]);

  useEffect(() => {
    if (follow.current && history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [page, streams]);

  const loadEarlier = async () => {
    const cursor = olderCursor === undefined ? page?.cursor : olderCursor;
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const response = await apiFetch(`/api/bots/chat?${query}&cursor=${encodeURIComponent(JSON.stringify(cursor))}`, { signal: AbortSignal.timeout(35000), cache: "no-store" });
      if (!response.ok) throw new Error("Chat unavailable");
      const value = await response.json() as BotChatPage;
      setEarlier((current) => [...value.items, ...current]); setOlderCursor(value.cursor);
    } catch { setFailed(true); }
    finally { setLoadingEarlier(false); }
  };

  const send = useCallback(async () => {
    if (!draft.trim() || drafts.get(identity).sending || !online || !connected || failed || page?.sendState !== "ready") return;
    const text = draft;
    drafts.update(identity, { sending: true, uncertain: false });
    try {
      const response = await apiFetch("/api/bots/send", {
        method: "POST", headers: { "content-type": "application/json", "x-ovis-bot": "1" }, signal: AbortSignal.timeout(35000),
        body: JSON.stringify({ runtimeId, botId, requestId: crypto.randomUUID(), text }),
      });
      if (!response.ok) throw new Error("Send not confirmed");
      const result = await response.json() as { accepted?: boolean };
      if (result.accepted !== true) throw new Error("Send not confirmed");
      drafts.accepted(identity, text);
      follow.current = true; refreshRef.current();
    } catch { drafts.update(identity, { sending: false, uncertain: true }); }
  }, [draft, sending, online, connected, failed, runtimeId, botId, drafts, identity, page?.sendState]);

  const ids = new Set<string>();
  const items = [...earlier, ...(page?.items ?? [])].filter((item) => { if (ids.has(item.id)) return false; ids.add(item.id); return true; });
  return <section className="bot-chat" aria-label={t("Chat with {name}", { name })}>
    <h4>{t("Direct chat")}</h4>
    <p className="bot-chat-state" role="status">{connected && !failed ? t("Connected to DSH") : t("Chat disconnected. Your draft stays here.")}</p>
    {page?.sendState === "setup_required" && <p role="status">{t("Choose a model above before sending messages.")}</p>}
    {page?.sendState === "read_only" && <p role="status">{t("This team is read only here. Send from its active DSH host.")}</p>}
    <div className="bot-chat-history" ref={history} tabIndex={0} aria-label={t("Conversation history")} onScroll={() => {
      const node = history.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    }}>
      {(olderCursor === undefined ? page?.cursor : olderCursor) && <button type="button" className="btn btn-ghost" disabled={loadingEarlier || !online} onClick={() => void loadEarlier()}>{t("Load earlier messages")}</button>}
      {!page && !failed && <p>{t("Loading conversation…")}</p>}
      {page && items.length === 0 && <p>{t("Start a conversation with this Bot.")}</p>}
      {items.map((item) => item.kind === "divider" ? <p key={item.id} className="bot-chat-divider">{t("Earlier session part")}</p> : <div className={`bot-chat-message is-${item.kind}`} key={item.id}><strong>{item.kind === "user" ? t("You") : name}</strong><div>{item.text}</div></div>)}
      {Object.entries(streams).map(([id, text]) => text && <div className="bot-chat-message is-bot is-streaming" key={id}><strong>{name}</strong><div>{text}</div></div>)}
    </div>
    <form className="bot-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label htmlFor={`message-${botId}`}>{t("Message {name}", { name })}</label>
      <textarea id={`message-${botId}`} value={draft} maxLength={32000} rows={3} onChange={(event) => drafts.update(identity, { text: event.target.value })} />
      {uncertain && <p role="alert">{t("Send was not confirmed. Check the conversation before sending again; your draft is preserved.")}</p>}
      <button type="submit" className="btn" disabled={sending || !draft.trim() || !online || !connected || failed || page?.sendState !== "ready"}>{sending ? t("Sending…") : t("Send message")}</button>
    </form>
    <p className="bot-chat-caption">{t("Group chats, attachments and approvals open in DSH.")}</p>
  </section>;
}
