import type { AppLocation } from "./webPanel.ts";

const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
export type DshPortalTarget = { url: string; reason: null } | { url: null; reason: "unavailable" | "remote" | "https" | "host" };

/** Match Ovis's existing frame policy without redirecting a remote device to its own localhost. */
export function dshPortalTarget(value: string | null, app: AppLocation): DshPortalTarget {
  if (!value) return { url: null, reason: "unavailable" };
  let target: URL;
  try { target = new URL(value); } catch { return { url: null, reason: "unavailable" }; }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== "/") return { url: null, reason: "unavailable" };
  if (local(target.hostname)) {
    if (!local(app.hostname)) return { url: null, reason: "remote" };
    target.hostname = app.hostname;
  }
  if (app.protocol === "https:" && target.protocol !== "https:") return { url: null, reason: "https" };
  if (target.hostname !== app.hostname || target.origin === app.origin) return { url: null, reason: "host" };
  return { url: target.href, reason: null };
}
