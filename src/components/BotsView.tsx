import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ExternalLink, X } from "lucide-react";
import type { BotDirectory, BotStatus } from "../../shared/bots.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { useT } from "../lib/i18n.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import "./BotsView.css";

const ORDER: Record<BotStatus, number> = { attention: 0, working: 1, waiting: 2, available: 3, unknown: 4 };

export function BotsLauncher() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <section className="agent-list bot-navigation" aria-label={t("Bots")}>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)} aria-haspopup="dialog"><Bot aria-hidden="true" />{t("Bots")}</button>
    </section>
    {open && <BotsView onClose={close} />}
  </>;
}

export function BotsView({ onClose }: { onClose(): void }) {
  const t = useT();
  const statusWords: Record<BotStatus, string> = { attention: t("Needs attention"), working: t("Working"), waiting: t("Waiting"), available: t("Available"), unknown: t("Status unavailable") };
  const id = useId();
  const surface = useFocusTrap<HTMLElement>(true);
  usePhoneSheetBack(onClose);
  const [directory, setDirectory] = useState<BotDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || nativeModalOver(surface.current)) return;
      event.stopPropagation(); event.preventDefault(); onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, surface]);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await apiFetch("/api/bots", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]), cache: "no-store" });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) setDirectory(null);
          throw new Error("Directory unavailable");
        }
        const value = await response.json() as BotDirectory;
        if (!abort.signal.aborted) { setDirectory(value); setFailed(false); }
      } catch { if (!abort.signal.aborted) setFailed(true); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 5000); }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, []);

  const online = !failed && directory?.state === "online";
  const bots = [...(directory?.bots ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  const key = (botId: string) => `${directory?.runtimeId}:${botId}`;
  const bot = bots.find((bot) => key(bot.id) === selected) ?? bots[0];
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const link = directory?.openUrl ? new URL(directory.openUrl) : null;
  const reachableLink = link && (!loopback(link.hostname) || loopback(window.location.hostname));
  const notice = failed || directory?.state === "offline" ? t("DSH is offline. Shown Bots may be out of date.")
    : directory?.state === "incompatible" ? t("DSH is reachable, but its Bot directory is unavailable. Check the integration plugins.")
    : directory?.state === "not_configured" ? t("Connect DSH to see your Bots here.") : null;

  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={surface} className="modal bots-view" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <header className="modal-header">
        <div className="bots-heading"><h2 className="modal-title" id={`${id}-title`}>{t("Bots")}</h2><p className="bots-caption">{t("Your DS Bot team on the host")}</p></div>
        <button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      <div className="bots-toolbar">
        <span>{t("Read only · chat and approvals stay in DSH")}</span>
        {reachableLink && <a className="btn" href={link.href} target="_blank" rel="noopener noreferrer">{t("Open in DSH")}<ExternalLink aria-hidden="true" /></a>}
        {link && !reachableLink && <span>{t("Open DSH on the host, or configure its address for this device.")}</span>}
      </div>
      {notice && <p className="bots-notice" role="status">{notice}</p>}
      {!directory && !failed && <p className="bots-notice" role="status">{t("Loading Bots…")}</p>}
      {online && bots.length === 0 && <p className="bots-notice">{t("No Bots yet. Create your team in DSH.")}</p>}
      {bots.length > 0 && <div className="bots-content">
        <ul className="bots-roster" aria-label={t("Bots")}>
          {bots.map((row) => <li key={key(row.id)}><button type="button" className={`bots-row${bot?.id === row.id ? " is-selected" : ""}`} aria-pressed={bot?.id === row.id} onClick={() => setSelected(key(row.id))}>
            <Bot aria-hidden="true" /><span className="bots-copy"><strong>{row.name}</strong><span>{row.role}</span></span>
            <span className={`bots-status is-${online ? row.status : "unknown"}`}>{statusWords[online ? row.status : "unknown"]}</span>
          </button></li>)}
        </ul>
        {bot && <article className="bots-detail" aria-label={bot.name}>
          <h3>{bot.name}</h3><p>{bot.role}</p>
          <h4>{t("Conversations")}</h4>
          <ul>{bot.conversations.map((conversation) => <li key={conversation.id}><strong>{conversation.kind === "direct" ? t("Direct chat") : conversation.name}</strong><span>{t(conversation.sessionIds.length === 1 ? "1 session part" : "{count} session parts", { count: conversation.sessionIds.length })}</span></li>)}</ul>
          <details><summary>{t("Integration identity")}</summary><dl><dt>{t("Runtime")}</dt><dd>{directory?.runtimeId}</dd><dt>{t("Bot ID")}</dt><dd>{bot.id}</dd></dl></details>
        </article>}
      </div>}
      {directory?.observedAt != null && <p className="bots-updated">{t("Last checked: {time}", { time: new Date(directory.observedAt).toLocaleTimeString() })}</p>}
    </section>
  </div>, document.body);
}
