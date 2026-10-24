import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, PanelsTopLeft, RotateCw, X } from "lucide-react";
import type { BotDirectory } from "../../shared/bots.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { dshPortalTarget, type DshPortalTarget } from "../lib/dshPortal.ts";
import { useT } from "../lib/i18n.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import "./DshPortal.css";

export function DshPortalLauncher() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <section className="dsh-navigation" aria-label={t("DSH workspace")}><button type="button" className="btn btn-ghost" onClick={() => setOpen(true)} aria-haspopup="dialog"><PanelsTopLeft aria-hidden="true" />{t("Open DSH")}</button></section>
    {open && <DshPortal onClose={close} />}
  </>;
}

function DshPortal({ onClose }: { onClose(): void }) {
  const t = useT();
  const id = useId();
  const surface = useFocusTrap<HTMLElement>(true);
  usePhoneSheetBack(onClose);
  const [target, setTarget] = useState<DshPortalTarget | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch("/api/bots", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]), cache: "no-store" });
        if (!response.ok) throw new Error("DSH unavailable");
        const directory = await response.json() as BotDirectory;
        if (!abort.signal.aborted) setTarget(dshPortalTarget(directory.openUrl, window.location));
      } catch { if (!abort.signal.aborted) setTarget({ url: null, reason: "unavailable" }); }
    })();
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || nativeModalOver(surface.current)) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose, surface]);

  const reason = target?.reason;
  const unavailable = reason === "remote" ? t("Open Ovis on the host, or configure a DSH address reachable from this device.")
    : reason === "https" ? t("This secure Ovis page needs an HTTPS address for DSH.")
    : reason === "host" ? t("Embedding needs DSH on another port of the same host as Ovis.")
    : t("DSH is not configured. Connect DSH and reload this view.");
  return createPortal(<div className="modal-scrim">
    <section ref={surface} role="dialog" aria-modal="true" aria-labelledby={id} className="modal dsh-portal" tabIndex={-1}>
      <header className="modal-header">
        <h2 className="modal-title" id={id}>{t("DSH workspace")}</h2>
        <div className="dsh-portal-actions">
          <button type="button" className="icon-button" aria-label={t("Reload DSH")} title={t("Reload DSH")} onClick={() => setRevision((value) => value + 1)}><RotateCw aria-hidden="true" /></button>
          {target?.url && <a className="icon-button" href={target.url} target="_blank" rel="noopener noreferrer" aria-label={t("Open DSH in a new tab")} title={t("Open DSH in a new tab")}><ExternalLink aria-hidden="true" /></a>}
          <button type="button" className="icon-button" aria-label={t("Close DSH")} title={t("Close DSH")} onClick={onClose}><X aria-hidden="true" /></button>
        </div>
      </header>
      <p className="dsh-portal-caption">{t("Uses your DSH login. If sign-in is requested, open the DSH startup login link, then reload this view.")}</p>
      {target?.url ? <iframe key={`${target.url}:${revision}`} src={target.url} title={t("DeepSeek Harness workspace")} className="dsh-portal-frame" referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads" />
        : <p className="dsh-portal-notice" role="status">{target ? unavailable : t("Loading DSH…")}</p>}
    </section>
  </div>, document.body);
}
