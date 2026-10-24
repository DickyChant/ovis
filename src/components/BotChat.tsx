import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BotChatItem, BotChatPage, BotUpload } from "../../shared/bots.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { useT } from "../lib/i18n.ts";
import { BotApprovals } from "./BotApprovals.tsx";
import type { BotDrafts } from "../lib/botDrafts.ts";

export function BotChat({ runtimeId, botId, name, online, drafts, roomId, onActivity }: {
  runtimeId: string; botId: string; roomId?: string; name: string; online: boolean; drafts: BotDrafts; onActivity?(): void;
}) {
  const t = useT();
  const identity = `${runtimeId}:${roomId ? `group:${roomId}` : botId}`;
  const { text: draft, sending, uncertain, files = [] } = useSyncExternalStore(drafts.subscribe, () => drafts.get(identity));
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
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
  const query = new URLSearchParams({ runtimeId, botId, ...(roomId ? { roomId } : {}) }).toString();

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
    const poll = setInterval(() => void refresh(), 5000);
    void refresh();
    return () => { clearInterval(poll); abort.abort(); events.close(); refreshRef.current = () => {}; };
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
    if ((!draft.trim() && !files.length) || uploading || drafts.get(identity).sending || !online || !connected || failed || page?.sendState !== "ready") return;
    const text = draft;
    const receipts = files.map((file) => file.receiptId);
    if (files.some((file) => file.sessionId !== page?.sessionId)) { setUploadFailed(true); return; }
    drafts.update(identity, { sending: true, uncertain: false });
    try {
      const response = await apiFetch("/api/bots/send", {
        method: "POST", headers: { "content-type": "application/json", "x-ovis-bot": "1" }, signal: AbortSignal.timeout(35000),
        body: JSON.stringify({ runtimeId, botId, roomId, requestId: crypto.randomUUID(), text, ...(receipts.length ? { receipts, sessionId: page?.sessionId } : {}) }),
      });
      if (!response.ok) throw new Error("Send not confirmed");
      const result = await response.json() as { accepted?: boolean };
      if (result.accepted !== true) throw new Error("Send not confirmed");
      drafts.accepted(identity, text, receipts);
      follow.current = true; refreshRef.current();
    } catch { drafts.update(identity, { sending: false, uncertain: true }); }
  }, [draft, files, uploading, roomId, page?.sessionId, sending, online, connected, failed, runtimeId, botId, drafts, identity, page?.sendState]);

  const ids = new Set<string>();
  const items = [...earlier, ...(page?.items ?? [])].filter((item) => { if (ids.has(item.id)) return false; ids.add(item.id); return true; });
  return <section className="bot-chat" aria-label={t("Chat with {name}", { name })}>
    <h4>{roomId ? name : t("Direct chat")}</h4>
    {page?.recent && <p className="bot-chat-caption">{t("Showing recent group messages. Full history is available in DSH.")}</p>}
    <p className="bot-chat-state" role="status">{connected && !failed ? t("Connected to DSH") : t("Chat disconnected. Your draft stays here.")}</p>
    {page?.sendState === "setup_required" && <p role="status">{t("Choose a model above before sending messages.")}</p>}
    {page?.sendState === "read_only" && <p role="status">{t("This team is read only here. Send from its active DSH host.")}</p>}
    <BotApprovals runtimeId={runtimeId} botId={botId} roomId={roomId} online={online && connected} />
    <div className="bot-chat-history" ref={history} tabIndex={0} aria-label={t("Conversation history")} onScroll={() => {
      const node = history.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    }}>
      {(olderCursor === undefined ? page?.cursor : olderCursor) && <button type="button" className="btn btn-ghost" disabled={loadingEarlier || !online} onClick={() => void loadEarlier()}>{t("Load earlier messages")}</button>}
      {!page && !failed && <p>{t("Loading conversation…")}</p>}
      {page && items.length === 0 && <p>{t("Start a conversation with this Bot.")}</p>}
      {items.map((item) => item.kind === "divider" ? <p key={item.id} className="bot-chat-divider">{t("Earlier session part")}</p> : <div className={`bot-chat-message is-${item.kind}`} key={item.id}><strong>{item.kind === "user" ? t("You") : item.name || name}</strong><div>{item.text}</div>{item.files?.map((file) => <a key={file.id} href={`/api/bots/download?${query}&fileId=${encodeURIComponent(file.id)}`} download={file.name}>{file.name} ({Math.ceil(file.bytes / 1024)} KB)</a>)}</div>)}
      {Object.entries(streams).map(([id, text]) => text && <div className="bot-chat-message is-bot is-streaming" key={id}><strong>{name}</strong><div>{text}</div></div>)}
    </div>
    <form className="bot-chat-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label htmlFor={`message-${botId}`}>{t("Message {name}", { name })}</label>
      <textarea id={`message-${botId}`} value={draft} maxLength={32000} rows={3} onChange={(event) => drafts.update(identity, { text: event.target.value })} />
      <label>{uploading ? t("Uploading attachment…") : t("Attach files (up to 10 MB each)")}<input type="file" multiple disabled={uploading || sending || !online || !connected || page?.sendState !== "ready"} onChange={(event) => {
        const selected = Array.from(event.target.files ?? []); event.target.value = "";
        if (!page || selected.length + files.length > 8 || selected.some((file) => file.size > 10485760)) { setUploadFailed(true); return; }
        setUploading(true); setUploadFailed(false);
        void (async () => {
          try {
            for (const file of selected) {
              const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]!); reader.onerror = reject; reader.readAsDataURL(file); });
              const response = await apiFetch("/api/bots/upload", { method: "POST", headers: { "content-type": "application/json", "x-ovis-bot": "1" }, signal: AbortSignal.timeout(35000), body: JSON.stringify({ runtimeId, botId, roomId, sessionId: page.sessionId, requestId: crypto.randomUUID(), name: file.name, data }) });
              if (!response.ok) throw new Error("Upload failed");
              const uploaded = await response.json() as BotUpload;
              drafts.update(identity, { files: [...(drafts.get(identity).files ?? []), uploaded] });
            }
          } catch { setUploadFailed(true); }
          finally { setUploading(false); }
        })();
      }} /></label>
      {files.map((file) => <div key={file.receiptId}>{file.name}<button type="button" className="btn btn-ghost" disabled={sending} onClick={() => drafts.update(identity, { files: files.filter((entry) => entry.receiptId !== file.receiptId) })}>{t("Remove attachment")}</button></div>)}
      {uploadFailed && <p role="alert">{t("Attachment unavailable. Use up to 8 files of 10 MB each; reattach files if the session changed.")}</p>}
      {uncertain && <p role="alert">{t("Send was not confirmed. Check the conversation before sending again; your draft is preserved.")}</p>}
      <button type="submit" className="btn" disabled={uploading || sending || (!draft.trim() && !files.length) || !online || !connected || failed || page?.sendState !== "ready"}>{sending ? t("Sending…") : t("Send message")}</button>
    </form>
  </section>;
}
