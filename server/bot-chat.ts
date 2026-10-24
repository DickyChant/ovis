import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BotApproval, BotChatCursor, BotChatPage, BotSettings } from "../shared/bots.ts";
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
  return { ...(value.recent === true ? { recent: true } : {}), sessionId: string(value.sessionId), sendState: value.sendState as BotChatPage["sendState"], cursor: chatCursor(value.cursor), items: value.items.map((item) => {
    if (!isJsonObject(item) || !["user", "bot", "divider"].includes(String(item.kind))) throw new Error("Invalid item");
    return { id: string(item.id), kind: item.kind as "user" | "bot" | "divider", text: string(item.text, 100000), ...(item.name !== undefined ? { name: string(item.name) } : {}), ...(item.files !== undefined ? { files: parseFiles(item.files) } : {}) };
  }) };
}

export class BotChatService {
  constructor(private readonly options: { url?: string; token?: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> } = {}) {}

  async handle(request: Request, onRevoke?: (close: () => void) => () => void): Promise<Response> {
    const headers = { "cache-control": "no-store" };
    const fail = (status: number, code: string) => jsonResponse({ error: { code, message: "Bot conversation unavailable" } }, status, headers);
    const url = new URL(request.url);
    const action = url.pathname.slice("/api/bots/".length);
    if (!["chat", "send", "events", "settings", "control", "upload", "download", "approvals", "answer"].includes(action)) return fail(404, "not_found");
    const mutation = ["send", "control", "upload", "answer"].includes(action);
    if (request.method !== (mutation ? "POST" : "GET")) return fail(405, "method_not_allowed");
    if (mutation && request.headers.get("x-ovis-bot") !== "1") return fail(403, "invalid_origin");
    if (!this.options.url || !this.options.token) return fail(503, "bridge_not_configured");
    let input: Record<string, unknown>;
    try {
      if (mutation) {
        const body = await boundedJson(new Response(request.body), action === "upload" ? 14000000 : 140000);
        if (!isJsonObject(body)) throw new Error("Invalid body");
        input = { runtimeId: string(body.runtimeId), botId: string(body.botId), requestId: string(body.requestId, 80) };
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(input.requestId))) throw new Error("Invalid request id");
        if (body.roomId !== undefined) input.roomId = string(body.roomId);
        if (action === "upload") {
          input.name = string(body.name); input.data = string(body.data, 13981016); input.sessionId = string(body.sessionId);
        } else if (action === "answer") {
          if (!["allow", "reject"].includes(String(body.choice))) throw new Error("Invalid decision");
          input.choice = body.choice; input.approvalId = string(body.approvalId); input.sessionId = string(body.sessionId);
        } else if (action === "send") {
          input.text = string(body.text, 32000);
          if (body.receipts !== undefined) {
            if (!Array.isArray(body.receipts) || body.receipts.length > 8) throw new Error("Invalid files");
            input.receipts = body.receipts.map((id) => string(id)); input.sessionId = string(body.sessionId);
          }
          if (!String(input.text).trim() && !(input.receipts as unknown[] | undefined)?.length) throw new Error("Invalid send");
        } else {
          if (!["model", "stop"].includes(String(body.action))) throw new Error("Invalid control");
          input.action = body.action;
          if (body.action === "model") input.model = string(body.model);
          else input.sessionId = string(body.sessionId);
        }
      } else {
        input = { runtimeId: string(url.searchParams.get("runtimeId")), botId: string(url.searchParams.get("botId")) };
        if (url.searchParams.has("roomId")) input.roomId = string(url.searchParams.get("roomId"));
        if (action === "download") input.fileId = string(url.searchParams.get("fileId"));
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
      if (action === "events") target.search = new URLSearchParams({ runtimeId: String(input.runtimeId), botId: String(input.botId), ...(input.roomId ? { roomId: String(input.roomId) } : {}) }).toString();
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
      const value = await boundedJson(response, action === "download" ? 14000000 : 2000000);
      if (action === "download") {
        if (!isJsonObject(value)) throw new Error("Invalid file");
        const name = string(value.name); const data = string(value.data, 13981016);
        const bytes = Buffer.from(data, "base64");
        if (bytes.length > 10485760 || bytes.toString("base64") !== data) throw new Error("Invalid file");
        return new Response(bytes, { headers: { ...headers, "content-type": "application/octet-stream", "x-content-type-options": "nosniff", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
      }
      if (action === "upload") {
        if (!isJsonObject(value) || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0 || Number(value.bytes) > 10485760) throw new Error("Invalid upload");
        return jsonResponse({ receiptId: string(value.receiptId), sessionId: string(value.sessionId), name: string(value.name), bytes: Number(value.bytes) }, 200, headers);
      }
      if (action === "approvals") return jsonResponse({ items: parseApprovals(value) }, 200, headers);
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

function parseFiles(value: unknown) {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid files");
  return value.map((file) => {
    if (!isJsonObject(file) || !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0) throw new Error("Invalid file");
    return { id: string(file.id), name: string(file.name), bytes: Number(file.bytes) };
  });
}

export function parseApprovals(value: unknown): BotApproval[] {
  if (!isJsonObject(value) || !Array.isArray(value.items) || value.items.length > 100) throw new Error("Invalid approvals");
  return value.items.map((entry) => {
    if (!isJsonObject(entry) || typeof entry.answerable !== "boolean") throw new Error("Invalid approval");
    return { id: string(entry.id), sessionId: string(entry.sessionId), botId: string(entry.botId), name: string(entry.name), tool: string(entry.tool), reason: string(entry.reason, 4000), detail: string(entry.detail, 20000), answerable: entry.answerable };
  });
}
