import { useEffect, useState } from "react";
import type { BotSettings } from "../../shared/bots.ts";
import { apiFetch } from "../lib/api-request-id.ts";
import { useT } from "../lib/i18n.ts";

export function BotControls({ runtimeId, botId, online, revision, onChanged }: { runtimeId: string; botId: string; online: boolean; revision: number; onChanged(): void }) {
  const t = useT();
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    if (!online) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await apiFetch(`/api/bots/settings?${new URLSearchParams({ runtimeId, botId })}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(32000)]) });
        if (!response.ok) throw new Error("Settings unavailable");
        const value = await response.json() as BotSettings;
        if (!abort.signal.aborted) { setSettings(value); setFailed(false); }
      } catch { if (!abort.signal.aborted) setFailed(true); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 5000); }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [runtimeId, botId, online, revision]);
  const chosen = model ?? settings?.model ?? "";
  const enabled = online && !failed && settings?.writable && !busy;
  const control = async (action: "model" | "stop") => {
    if (!enabled || !settings) return;
    setBusy(true); setUncertain(false);
    try {
      const response = await apiFetch("/api/bots/control", {
        method: "POST", headers: { "content-type": "application/json", "x-ovis-bot": "1" }, signal: AbortSignal.timeout(35000),
        body: JSON.stringify({ runtimeId, botId, requestId: crypto.randomUUID(), action, ...(action === "model" ? { model: chosen } : { sessionId: settings.sessionId }) }),
      });
      if (!response.ok || (await response.json() as { accepted?: boolean }).accepted !== true) throw new Error("Not confirmed");
      if (action === "model") setSettings((value) => value && { ...value, model: chosen });
      onChanged();
    } catch { setUncertain(true); onChanged(); }
    finally { setBusy(false); }
  };
  return <div className="bot-controls">
    <form onSubmit={(event) => { event.preventDefault(); void control("model"); }}>
      <label htmlFor={`model-${botId}`}>{t("Bot model")}</label>
      <select id={`model-${botId}`} value={chosen} disabled={!enabled} onChange={(event) => setModel(event.target.value)}>
        <option value="">{t("Choose a model")}</option>
        {settings?.model && !settings.models.some((entry) => entry.ref === settings.model) && <option value={settings.model} disabled>{settings.model}</option>}
        {settings?.models.map((entry) => <option key={entry.ref} value={entry.ref} disabled={!entry.available}>{entry.provider} · {entry.name}{entry.available ? "" : ` (${t("Provider setup needed")})`}</option>)}
      </select>
      <button type="submit" className="btn" disabled={!enabled || !chosen || chosen === settings?.model || !settings?.models.some((entry) => entry.ref === chosen && entry.available)}>{t("Apply model")}</button>
      <button type="button" className="btn btn-ghost" disabled={!enabled || !settings?.working} onClick={() => void control("stop")}>{t("Stop reply")}</button>
    </form>
    {!settings?.model && settings && <p>{t("Choose a model here to start this Bot. Its welcome reply will begin.")}</p>}
    {failed && <p role="status">{t("Bot controls are unavailable. Check the bridge and refresh.")}</p>}
    {uncertain && <p role="alert">{t("Action not confirmed. Check the Bot state before trying again.")}</p>}
  </div>;
}
