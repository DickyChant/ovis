import { useEffect, useState } from "react";
import type { BotApproval } from "../../shared/bots.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { useT } from "../lib/i18n.ts";

export function BotApprovals({ runtimeId, botId, roomId, online }: { runtimeId: string; botId: string; roomId?: string; online: boolean }) {
  const t = useT();
  const [items, setItems] = useState<BotApproval[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const query = new URLSearchParams({ runtimeId, botId, ...(roomId ? { roomId } : {}) }).toString();
  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await apiFetch(`/api/bots/approvals?${query}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]) });
        if (!response.ok) throw new Error("Approval status unavailable");
        const value = await response.json() as { items: BotApproval[] };
        if (!abort.signal.aborted) { setItems(value.items); setFailed(false); }
      } catch { if (!abort.signal.aborted) setFailed(true); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 2000); }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [online, query]);
  const answer = async (item: BotApproval, choice: "allow" | "reject") => {
    setBusy(item.id); setUncertain(false);
    try {
      const response = await apiFetch("/api/bots/answer", { method: "POST", headers: { "content-type": "application/json", "x-ovis-bot": "1" }, signal: AbortSignal.timeout(35000), body: JSON.stringify({ runtimeId, botId, roomId, approvalId: item.id, sessionId: item.sessionId, choice, requestId: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Decision not confirmed");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch { setUncertain(true); }
    finally { setBusy(null); }
  };
  return <div className="bot-approvals" aria-label={t("Pending approvals")}>
    {failed && <p role="status">{t("Approval status unavailable. Reconnect before deciding.")}</p>}
    {items.map((item) => <article className="bot-approval" key={item.id}>
      <strong>{item.name} · {item.tool}</strong><p>{item.reason}</p>{item.detail && <pre>{item.detail}</pre>}
      <button type="button" className="btn" disabled={!online || failed || busy !== null || !item.answerable} onClick={() => void answer(item, "allow")}>{t("Allow once")}</button>
      <button type="button" className="btn btn-ghost" disabled={!online || failed || busy !== null || !item.answerable} onClick={() => void answer(item, "reject")}>{t("Reject")}</button>
    </article>)}
    {uncertain && <p role="alert">{t("Decision was not confirmed. Check the pending request before trying again.")}</p>}
  </div>;
}
