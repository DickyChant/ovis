import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BotChatCursor, BotChatPage, BotSettings } from "../shared/bots.ts";
import { boundedJson, dshUrl } from "./bots.ts";
import { isJsonObject, jsonResponse } from "./http.ts";

export function readBotBridgeToken(path = join(homedir(), ".config", "ovis-dsh", "bridge-token")): string | undefined {
  try { const value = readFileSync(path, "utf8").trim(); return /^[a-f0-9]{64}$/.test(value) ? value : undefined; } catch { return undefined; }
}

function string(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid string");
  return value;
}
export function chatCursor(value: unknown): BotChatCursor | null {
  if (value == null) return null;
  if (!isJsonObject(value) || !Number.isSafeInteger(value.part) || Number(value.part) < 0 || (value.beforeSeq !== undefined && (!Number.isSafeInteger(value.beforeSeq) || Number(value.beforeSeq) < 0))) throw new Error("Invalid cursor");
  return { part: Number(value.part), ...(value.beforeSeq !== undefined ? { beforeSeq: Number(value.beforeSeq) } : {}) };
}
export function parseBotChat(value: unknown): BotChatPage {
  if (!isJsonObject(value) || !Array.isArray(value.items) || value.items.length > 1000 || !["ready", "setup_required", "read_only"].includes(String(value.sendState))) throw new Error("Invalid chat");
  return { sessionId: string(value.sessionId), sendState: value.sendState as BotChatPage["sendState"], cursor: chatCursor(value.cursor), items: value.items.map((item) => {
    if (!isJsonObject(item) || !["user", "bot", "divider"].includes(String(item.kind))) throw new Error("Invalid item");
    return { id: string(item.id), kind: item.kind as "user" | "bot" | "divider", text: string(item.text, 100000) };
  }) };
}

export class BotChatService {
  constructor(private readonly options: { url?: string; token?: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> } = {}) {}

  async handle(request: Request, onRevoke?: (close: () => void) => () => void): Promise<Response> {
    const headers = { "cache-control": "no-store" };
    const fail = (status: number, code: string) => jsonResponse({ error: { code, message: "Bot conversation unavailable" } }, status, headers);
    const url = new URL(request.url);
    const action = url.pathname.slice("/api/bots/".length);
    if (!["chat", "send", "events", "settings", "control"].includes(action)) return fail(404, "not_found");
    const mutation = action === "send" || action === "control";
    if (request.method !== (mutation ? "POST" : "GET")) return fail(405, "method_not_allowed");
    if (mutation && request.headers.get("x-ovis-bot") !== "1") return fail(403, "invalid_origin");
    if (!this.options.url || !this.options.token) return fail(503, "bridge_not_configured");
    let input: Record<string, unknown>;
    try {
      if (mutation) {
        const body = await boundedJson(new Response(request.body), 140000);
        if (!isJsonObject(body)) throw new Error("Invalid body");
        input = { runtimeId: string(body.runtimeId), botId: string(body.botId), requestId: string(body.requestId, 80) };
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(input.requestId))) throw new Error("Invalid request id");
        if (action === "send") {
          input.text = string(body.text, 32000);
          if (!String(input.text).trim()) throw new Error("Invalid send");
        } else {
          if (!["model", "stop"].includes(String(body.action))) throw new Error("Invalid control");
          input.action = body.action;
          if (body.action === "model") input.model = string(body.model);
          else input.sessionId = string(body.sessionId);
        }
      } else {
        input = { runtimeId: string(url.searchParams.get("runtimeId")), botId: string(url.searchParams.get("botId")) };
        if (action === "chat") input.cursor = chatCursor(url.searchParams.has("cursor") ? JSON.parse(url.searchParams.get("cursor")!) : null);
      }
      if (!input.runtimeId || !input.botId) throw new Error("Missing target");
    } catch { return fail(400, "invalid_request"); }

    const abort = new AbortController();
    const removeRevoke = onRevoke?.(() => abort.abort());
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(action === "events" ? 305000 : 32000)]);
    let streaming = false;
    try {
      const target = dshUrl(this.options.url, true);
      target.pathname = `/herdr-bots/${action}`;
      if (action === "events") target.search = new URLSearchParams({ runtimeId: String(input.runtimeId), botId: String(input.botId) }).toString();
      const response = await (this.options.fetch ?? fetch)(target, {
        method: action === "events" ? "GET" : "POST", redirect: "error", signal,
        headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json" },
        ...(action === "events" ? {} : { body: JSON.stringify(input) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return fail(response.status === 409 ? 409 : 503, response.status === 409 ? "bot_refused" : "bridge_unavailable");
      }
      if (action === "events") {
        if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) return fail(502, "invalid_stream");
        const reader = response.body.getReader();
        // Pull only as the browser reads; cancellation also closes the DSH subscription.
        let closed = false;
        const cleanup = () => { closed = true; removeRevoke?.(); abort.abort(); void reader.cancel().catch(() => {}); };
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try { const chunk = await reader.read(); if (closed) return; if (chunk.done) { controller.close(); cleanup(); } else controller.enqueue(chunk.value); }
            catch { if (!closed) controller.close(); cleanup(); }
          },
          cancel: cleanup,
        });
        streaming = true;
        return new Response(body, { headers: { ...headers, "content-type": "text/event-stream", "x-accel-buffering": "no" } });
      }
      const value = await boundedJson(response);
      if (action === "chat") return jsonResponse(parseBotChat(value), 200, headers);
      if (action === "settings") return jsonResponse(parseBotSettings(value), 200, headers);
      if (!isJsonObject(value) || value.accepted !== true || value.requestId !== input.requestId) return fail(502, "invalid_acknowledgement");
      return jsonResponse({ accepted: true, requestId: input.requestId }, 200, headers);
    } catch { return fail(503, mutation ? "send_unconfirmed" : "bridge_unavailable"); }
    finally { if (!streaming) { removeRevoke?.(); abort.abort(); } }
  }
}

export function parseBotSettings(value: unknown): BotSettings {
  if (!isJsonObject(value) || typeof value.writable !== "boolean" || typeof value.working !== "boolean" || !Array.isArray(value.models) || value.models.length > 2000) throw new Error("Invalid Bot settings");
  return { model: value.model === null ? null : string(value.model), writable: value.writable, working: value.working, sessionId: string(value.sessionId), models: value.models.map((entry) => {
    if (!isJsonObject(entry) || typeof entry.available !== "boolean") throw new Error("Invalid model");
    return { ref: string(entry.ref), name: string(entry.name), provider: string(entry.provider), available: entry.available };
  }) };
}
