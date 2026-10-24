import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { BotsService } from "./bots.ts";
import { BotChatService } from "./bot-chat.ts";
import { DeviceStore } from "./devices.ts";

test("the directory uses Ovis authentication and cannot write to DSH", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ovis-bots-"));
  let reads = 0;
  const bots = new BotsService({ url: "http://127.0.0.1:3090", fetch: async (_url, init) => {
    reads++;
    expect(init.headers).toBeUndefined();
    expect(init.method).toBeUndefined();
    return Response.json({ version: 1, runtimeId: "runtime", observedAt: Date.now(), bots: [] });
  } });
  const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir, token: "fixture-bots", machines: false, tailscaleOwner: null, bots });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    expect((await fetch(`${base}/api/bots`)).status).toBe(401);
    expect(reads).toBe(0);
    const response = await fetch(`${base}/api/bots`, { headers: { authorization: "Bearer fixture-bots" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).runtimeId).toBe("runtime");
    const mutation = await fetch(`${base}/api/bots`, { method: "POST", headers: { authorization: "Bearer fixture-bots", origin: base } });
    expect(mutation.status).toBe(405);
    expect(reads).toBe(1);
  } finally { server.stop(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("Bot chat requires full Ovis access, same origin and an explicit send header", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ovis-bot-chat-"));
  const devices = new DeviceStore(stateDir);
  const watch = devices.pair(devices.startPairing().code, "Watch", "watch")!;
  devices.match(watch.token);
  let calls = 0;
  const botChat = new BotChatService({ url: "http://127.0.0.1:3096", token: "private-bridge", fetch: async (_url, init) => {
    calls++;
    const input = JSON.parse(String(init.body));
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-bridge");
    return Response.json(input.text ? { accepted: true, requestId: input.requestId } : { sessionId: "s", sendState: "ready", cursor: null, items: [] });
  } });
  const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir, token: "full-fixture", machines: false, tailscaleOwner: null, botChat });
  const base = `http://127.0.0.1:${server.port}`;
  const auth = { authorization: "Bearer full-fixture" };
  const body = JSON.stringify({ runtimeId: "r", botId: "b", text: "Hello", requestId: "request-id-00000001" });
  try {
    expect((await fetch(`${base}/api/bots/chat?runtimeId=r&botId=b`)).status).toBe(401);
    expect((await fetch(`${base}/api/bots/send`, { method: "POST", headers: { ...auth, origin: "http://evil.test", "x-ovis-bot": "1" }, body })).status).toBe(403);
    expect((await fetch(`${base}/api/bots/send`, { method: "POST", headers: { ...auth, origin: base }, body })).status).toBe(403);
    expect(calls).toBe(0);
    for (const action of ["chat", "events", "settings"]) expect((await fetch(`${base}/api/bots/${action}?runtimeId=r&botId=b`, { headers: { cookie: `ovis_device=${watch.token}` } })).status).toBe(403);
    const control = JSON.stringify({ runtimeId: "r", botId: "b", action: "stop", sessionId: "s", requestId: "control-id-000001" });
    expect((await fetch(`${base}/api/bots/control`, { method: "POST", headers: { cookie: `ovis_device=${watch.token}`, origin: base, "x-ovis-bot": "1" }, body: control })).status).toBe(403);
    expect((await fetch(`${base}/api/bots/control`, { method: "POST", headers: { ...auth, origin: "http://evil.test", "x-ovis-bot": "1" }, body: control })).status).toBe(403);
    expect((await fetch(`${base}/api/bots/send`, { method: "POST", headers: { cookie: `ovis_device=${watch.token}`, origin: base, "x-ovis-bot": "1" }, body })).status).toBe(403);
    expect(calls).toBe(0);
    expect((await fetch(`${base}/api/bots/chat?runtimeId=r&botId=b`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/bots/send`, { method: "POST", headers: { ...auth, origin: base, "x-ovis-bot": "1" }, body })).status).toBe(200);
    expect(calls).toBe(2);
  } finally { server.stop(); rmSync(stateDir, { recursive: true, force: true }); }
});
