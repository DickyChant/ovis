import type { BotDirectory, BotStatus, DirectoryBot } from "../shared/bots.ts";
import { isJsonObject, jsonResponse } from "./http.ts";

/** Fixed server configuration only: a browser cannot supply a fetch target or credentials. */
export function dshUrl(value: string, local: boolean): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid DSH URL");
  if (local && (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("DSH must use a loopback IP");
  return url;
}

const statuses = new Set<BotStatus>(["available", "working", "attention", "waiting", "unknown"]);
const string = (value: unknown, max = 256): string => {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid directory string");
  return value;
};
const rows = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid directory list");
  return value;
};

/** Rebuild the whitelist at the Ovis boundary; never forward arbitrary plugin fields. */
export function parseBotDirectory(value: unknown): Pick<BotDirectory, "runtimeId" | "observedAt" | "bots"> {
  if (!isJsonObject(value) || value.version !== 1 || typeof value.observedAt !== "number" || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0) throw new Error("Unsupported Bot directory");
  const runtimeId = string(value.runtimeId, 128);
  if (!runtimeId) throw new Error("Missing runtime identity");
  const ids = new Set<string>();
  const bots: DirectoryBot[] = rows(value.bots, 1000).map((entry) => {
    if (!isJsonObject(entry) || !statuses.has(entry.status as BotStatus)) throw new Error("Invalid Bot");
    const id = string(entry.id);
    if (!id || ids.has(id)) throw new Error("Invalid Bot identity");
    ids.add(id);
    return {
      id, name: string(entry.name), role: string(entry.role), status: entry.status as BotStatus,
      conversations: rows(entry.conversations, 1000).map((conversation) => {
        if (!isJsonObject(conversation) || !["direct", "group"].includes(String(conversation.kind))) throw new Error("Invalid conversation");
        return {
          id: string(conversation.id), name: string(conversation.name), kind: conversation.kind as "direct" | "group",
          currentSessionId: conversation.currentSessionId === null ? null : string(conversation.currentSessionId),
          sessionIds: rows(conversation.sessionIds, 10000).map((id) => string(id)),
        };
      }),
    };
  });
  return { runtimeId, observedAt: value.observedAt, bots };
}

export async function boundedJson(response: Response, limit = 2_000_000): Promise<unknown> {
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("Response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel(); }
}

export class BotsService {
  private last: Pick<BotDirectory, "runtimeId" | "observedAt" | "bots"> = { runtimeId: null, observedAt: null, bots: [] };
  private pending: Promise<BotDirectory> | null = null;
  private cached: BotDirectory | null = null;
  private checkedAt = 0;

  constructor(private readonly options: { url?: string; publicUrl?: string; fetch?: (url: URL, init: RequestInit) => Promise<Response>; now?: () => number } = {}) {}

  snapshot(): Promise<BotDirectory> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached && now - this.checkedAt < 2000) return Promise.resolve(this.cached);
    this.pending ??= this.read().then((value) => { this.checkedAt = now; this.cached = value; return value; }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async read(): Promise<BotDirectory> {
    let state: BotDirectory["state"] = "not_configured";
    let openUrl: string | null = null;
    if (this.options.url) {
      state = "incompatible";
      try {
        const target = dshUrl(this.options.url, true);
        openUrl = dshUrl(this.options.publicUrl ?? target.href, false).href;
        target.pathname = "/herdr-bots";
        state = "offline";
        const response = await (this.options.fetch ?? fetch)(target, { redirect: "error", signal: AbortSignal.timeout(3000) });
        if (response.ok) {
          state = "incompatible";
          this.last = parseBotDirectory(await boundedJson(response));
          state = "online";
        } else {
          await response.body?.cancel();
          state = response.status === 404 || response.status === 503 ? "incompatible" : "offline";
        }
      } catch { /* Stable state words only; upstream errors may contain private data. */ }
    }
    return {
      version: 1, machineId: "local", ...this.last, state, openUrl,
      bots: state === "online" ? this.last.bots : this.last.bots.map((bot) => ({ ...bot, status: "unknown" })),
    };
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "GET") return jsonResponse({ error: { code: "method_not_allowed", message: "Use GET" } }, 405, { allow: "GET", "cache-control": "no-store" });
    return jsonResponse(await this.snapshot(), 200, { "cache-control": "no-store" });
  }
}
